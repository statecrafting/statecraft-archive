//! Pure builders for the EnRaHiTu placement shape (statecraft spec 006 §3). Each returns a
//! typed `k8s-openapi` object; no I/O. `kube_ops` applies them to a cluster.
//!
//! Shapes are informed by deployd-api-rs' `acme-vue-encore` chart (statecraft spec 006 §1)
//! but deliberately minimal and stateful: single replica, Recreate strategy, one
//! PVC mounted at `/data`, no preview Postgres/Redis, no gate.

use std::collections::BTreeMap;

use k8s_openapi::api::apps::v1::{Deployment, DeploymentSpec, DeploymentStrategy};
use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{
    Capabilities, Container, ContainerPort, EnvVar, HTTPGetAction, LocalObjectReference, Namespace,
    PersistentVolumeClaim, PersistentVolumeClaimSpec, PersistentVolumeClaimVolumeSource,
    PodSecurityContext, PodSpec, PodTemplateSpec, Probe, SeccompProfile, SecurityContext, Service,
    ServicePort, ServiceSpec, Volume, VolumeMount, VolumeResourceRequirements,
};
use k8s_openapi::api::networking::v1::{
    HTTPIngressPath, HTTPIngressRuleValue, Ingress, IngressBackend, IngressRule,
    IngressServiceBackend, IngressSpec, IngressTLS, NetworkPolicy, NetworkPolicyEgressRule,
    NetworkPolicyIngressRule, NetworkPolicyPeer, NetworkPolicyPort, NetworkPolicySpec,
    ServiceBackendPort,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;

use crate::naming;
use crate::types::{BackupTarget, DeploySpec};

/// Where the EnRaHiTu container's durable volume mounts, and what restic backs
/// up (statecraft spec 006 §3).
pub const DATA_MOUNT: &str = "/data";
/// The health surface the readiness/liveness probes and E2E check hit.
pub const HEALTH_PATH: &str = "/health";
/// The non-root UID/GID the app runs as. enrahitu images declare no `USER`, so
/// they would run as root, but the hardened securityContext forbids root
/// (`runAsNonRoot`); the `node:24-slim` base carries the `node` user at 1000. So
/// the container runs as 1000 and a pod-level `fsGroup` makes the mounted PVC
/// group-writable by that GID, which is what let the container start in the
/// 2026-07-15 live E2E (statecraft spec 006 §3, finding #3).
pub const NONROOT_UID: i64 = 1000;

fn meta(app: &str, ns: &str) -> ObjectMeta {
    ObjectMeta {
        name: Some(app.to_string()),
        namespace: Some(ns.to_string()),
        labels: Some(naming::labels(app)),
        ..Default::default()
    }
}

/// One Namespace per tenant (`t-<tenantId>`). Create-or-409 idempotent.
pub fn namespace(ns: &str) -> Namespace {
    Namespace {
        metadata: ObjectMeta {
            name: Some(ns.to_string()),
            labels: Some(naming::managed_labels()),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// One ReadWriteOnce PVC (default 1Gi) on the default storage class
/// (`hcloud-volumes`); no `storageClassName` so the cluster default applies.
pub fn pvc(spec: &DeploySpec) -> PersistentVolumeClaim {
    let mut requests = BTreeMap::new();
    requests.insert(
        "storage".to_string(),
        Quantity(format!("{}Gi", spec.volume_size_gi.max(1))),
    );
    PersistentVolumeClaim {
        metadata: ObjectMeta {
            name: Some(naming::pvc_name(&spec.name)),
            namespace: Some(spec.namespace.clone()),
            labels: Some(naming::labels(&spec.name)),
            ..Default::default()
        },
        spec: Some(PersistentVolumeClaimSpec {
            access_modes: Some(vec!["ReadWriteOnce".to_string()]),
            resources: Some(VolumeResourceRequirements {
                requests: Some(requests),
                limits: None,
            }),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// One ClusterIP Service exposing the container's http port.
pub fn service(spec: &DeploySpec) -> Service {
    Service {
        metadata: meta(&spec.name, &spec.namespace),
        spec: Some(ServiceSpec {
            type_: Some("ClusterIP".to_string()),
            selector: Some(naming::selector_labels(&spec.name)),
            ports: Some(vec![ServicePort {
                name: Some("http".to_string()),
                port: spec.port as i32,
                target_port: Some(IntOrString::String("http".to_string())),
                protocol: Some("TCP".to_string()),
                ..Default::default()
            }]),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn http_probe(initial: i32, period: i32) -> Probe {
    Probe {
        http_get: Some(HTTPGetAction {
            path: Some(HEALTH_PATH.to_string()),
            port: IntOrString::String("http".to_string()),
            ..Default::default()
        }),
        initial_delay_seconds: Some(initial),
        period_seconds: Some(period),
        ..Default::default()
    }
}

fn container_security_context() -> SecurityContext {
    SecurityContext {
        run_as_non_root: Some(true),
        run_as_user: Some(NONROOT_UID),
        run_as_group: Some(NONROOT_UID),
        allow_privilege_escalation: Some(false),
        capabilities: Some(Capabilities {
            drop: Some(vec!["ALL".to_string()]),
            add: None,
        }),
        seccomp_profile: Some(SeccompProfile {
            type_: "RuntimeDefault".to_string(),
            localhost_profile: None,
        }),
        ..Default::default()
    }
}

/// One Deployment: single replica, Recreate (the container is stateful via its
/// volume, so it must fully stop before the next pod attaches the RWO PVC).
pub fn deployment(spec: &DeploySpec) -> Deployment {
    let container = Container {
        name: spec.name.clone(),
        image: Some(spec.image.clone()),
        image_pull_policy: Some("IfNotPresent".to_string()),
        ports: Some(vec![ContainerPort {
            name: Some("http".to_string()),
            container_port: spec.port as i32,
            protocol: Some("TCP".to_string()),
            ..Default::default()
        }]),
        env: Some(vec![EnvVar {
            name: "PORT".to_string(),
            value: Some(spec.port.to_string()),
            ..Default::default()
        }]),
        readiness_probe: Some(http_probe(5, 10)),
        liveness_probe: Some(http_probe(15, 20)),
        volume_mounts: Some(vec![VolumeMount {
            name: "data".to_string(),
            mount_path: DATA_MOUNT.to_string(),
            ..Default::default()
        }]),
        security_context: Some(container_security_context()),
        ..Default::default()
    };

    let pod_spec = PodSpec {
        containers: vec![container],
        image_pull_secrets: spec
            .image_pull_secret
            .as_ref()
            .map(|s| vec![LocalObjectReference { name: s.clone() }]),
        // fsGroup chowns the mounted PVC to the non-root GID so the app (running
        // as NONROOT_UID, not root) can write /data; runAs* at the pod level
        // makes the non-root identity unambiguous for every container.
        security_context: Some(PodSecurityContext {
            run_as_non_root: Some(true),
            run_as_user: Some(NONROOT_UID),
            run_as_group: Some(NONROOT_UID),
            fs_group: Some(NONROOT_UID),
            ..Default::default()
        }),
        volumes: Some(vec![Volume {
            name: "data".to_string(),
            persistent_volume_claim: Some(PersistentVolumeClaimVolumeSource {
                claim_name: naming::pvc_name(&spec.name),
                read_only: None,
            }),
            ..Default::default()
        }]),
        ..Default::default()
    };

    Deployment {
        metadata: meta(&spec.name, &spec.namespace),
        spec: Some(DeploymentSpec {
            replicas: Some(1),
            strategy: Some(DeploymentStrategy {
                type_: Some("Recreate".to_string()),
                rolling_update: None,
            }),
            selector: LabelSelector {
                match_labels: Some(naming::selector_labels(&spec.name)),
                ..Default::default()
            },
            template: PodTemplateSpec {
                metadata: Some(ObjectMeta {
                    labels: Some(naming::selector_labels(&spec.name)),
                    ..Default::default()
                }),
                spec: Some(pod_spec),
            },
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// One nginx Ingress at `<app>.<FLEET_BASE_DOMAIN>`, TLS via a cert-manager
/// DNS-01 ClusterIssuer annotation (secret minted per host).
pub fn ingress(spec: &DeploySpec) -> Ingress {
    let mut annotations = BTreeMap::new();
    annotations.insert(
        "cert-manager.io/cluster-issuer".to_string(),
        spec.tls_issuer.clone(),
    );
    let secret = spec
        .tls_secret_name
        .clone()
        .unwrap_or_else(|| naming::tls_secret_name(&spec.name));

    let mut metadata = meta(&spec.name, &spec.namespace);
    metadata.annotations = Some(annotations);

    Ingress {
        metadata,
        spec: Some(IngressSpec {
            ingress_class_name: Some("nginx".to_string()),
            tls: Some(vec![IngressTLS {
                hosts: Some(vec![spec.host.clone()]),
                secret_name: Some(secret),
            }]),
            rules: Some(vec![IngressRule {
                host: Some(spec.host.clone()),
                http: Some(HTTPIngressRuleValue {
                    paths: vec![HTTPIngressPath {
                        path: Some("/".to_string()),
                        path_type: "Prefix".to_string(),
                        backend: IngressBackend {
                            service: Some(IngressServiceBackend {
                                name: spec.name.clone(),
                                port: Some(ServiceBackendPort {
                                    name: Some("http".to_string()),
                                    number: None,
                                }),
                            }),
                            resource: None,
                        },
                    }],
                }),
            }]),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn np_meta(name: &str, ns: &str) -> ObjectMeta {
    ObjectMeta {
        name: Some(name.to_string()),
        namespace: Some(ns.to_string()),
        labels: Some(naming::managed_labels()),
        ..Default::default()
    }
}

/// NetworkPolicies for a placement (statecraft spec 006 §3): default-deny and
/// allow DNS + outbound HTTPS out (the app reaches its managed database and
/// upstreams over 443) are namespace-scoped (`podSelector: {}`), one set per
/// tenant namespace. The ingress allow is **per app**: it pins the app's port,
/// so a namespace-wide policy would freeze the first app's port and silently
/// 502 every later app on a different port (kubelet probes bypass
/// NetworkPolicy, so the rollout still reads Ready). Its podSelector matches
/// only the app's pods and its name carries the app, so per-app policies
/// coexist and each opens exactly its own port (spec 006 amendment, 0.2.0).
pub fn network_policies(spec: &DeploySpec) -> Vec<NetworkPolicy> {
    let ns = &spec.namespace;

    let deny_all = NetworkPolicy {
        metadata: np_meta("fleet-default-deny-all", ns),
        spec: Some(NetworkPolicySpec {
            pod_selector: Some(LabelSelector::default()),
            policy_types: Some(vec!["Ingress".to_string(), "Egress".to_string()]),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut ingress_ns_selector = LabelSelector::default();
    let mut ns_match = BTreeMap::new();
    ns_match.insert(
        "kubernetes.io/metadata.name".to_string(),
        "ingress-nginx".to_string(),
    );
    ingress_ns_selector.match_labels = Some(ns_match);

    let mut allow_ingress_meta = np_meta(&naming::ingress_policy_name(&spec.name), ns);
    allow_ingress_meta.labels = Some(naming::labels(&spec.name));

    let allow_ingress = NetworkPolicy {
        metadata: allow_ingress_meta,
        spec: Some(NetworkPolicySpec {
            pod_selector: Some(LabelSelector {
                match_labels: Some(naming::selector_labels(&spec.name)),
                ..Default::default()
            }),
            policy_types: Some(vec!["Ingress".to_string()]),
            ingress: Some(vec![NetworkPolicyIngressRule {
                from: Some(vec![NetworkPolicyPeer {
                    namespace_selector: Some(ingress_ns_selector),
                    ..Default::default()
                }]),
                ports: Some(vec![NetworkPolicyPort {
                    port: Some(IntOrString::Int(spec.port as i32)),
                    protocol: Some("TCP".to_string()),
                    ..Default::default()
                }]),
            }]),
            ..Default::default()
        }),
        ..Default::default()
    };

    let allow_egress = NetworkPolicy {
        metadata: np_meta("fleet-allow-egress", ns),
        spec: Some(NetworkPolicySpec {
            pod_selector: Some(LabelSelector::default()),
            policy_types: Some(vec!["Egress".to_string()]),
            egress: Some(vec![
                // DNS resolution.
                NetworkPolicyEgressRule {
                    ports: Some(vec![
                        NetworkPolicyPort {
                            port: Some(IntOrString::Int(53)),
                            protocol: Some("UDP".to_string()),
                            ..Default::default()
                        },
                        NetworkPolicyPort {
                            port: Some(IntOrString::Int(53)),
                            protocol: Some("TCP".to_string()),
                            ..Default::default()
                        },
                    ]),
                    ..Default::default()
                },
                // Outbound HTTPS (managed DB / upstream APIs).
                NetworkPolicyEgressRule {
                    ports: Some(vec![NetworkPolicyPort {
                        port: Some(IntOrString::Int(443)),
                        protocol: Some("TCP".to_string()),
                        ..Default::default()
                    }]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        }),
        ..Default::default()
    };

    vec![deny_all, allow_ingress, allow_egress]
}

/// The per-app restic repository under the target's base bucket.
pub fn backup_repository(target: &BackupTarget, namespace: &str, app: &str) -> String {
    format!(
        "{}/{}/{}",
        target.repository_base.trim_end_matches('/'),
        namespace,
        app
    )
}

/// A one-shot Job that mounts the app's PVC read-only and restics `/data` to the
/// target. The fleet service scales the Deployment to 0 first (RWO single-attach
/// + clean-shutdown consistency), then back up after (statecraft spec 006 §3).
pub fn backup_job(
    spec_name: &str,
    namespace: &str,
    target: &BackupTarget,
    repository: &str,
    tag: &str,
    job_name: &str,
) -> Job {
    let env = vec![
        EnvVar {
            name: "RESTIC_REPOSITORY".to_string(),
            value: Some(repository.to_string()),
            ..Default::default()
        },
        EnvVar {
            name: "RESTIC_PASSWORD".to_string(),
            value: Some(target.password.clone()),
            ..Default::default()
        },
        EnvVar {
            name: "AWS_ACCESS_KEY_ID".to_string(),
            value: Some(target.access_key_id.clone()),
            ..Default::default()
        },
        EnvVar {
            name: "AWS_SECRET_ACCESS_KEY".to_string(),
            value: Some(target.secret_access_key.clone()),
            ..Default::default()
        },
    ];

    // Initialize the repo on first use, then snapshot. `restic cat config`
    // exits non-zero when the repo is absent; `|| restic init` creates it.
    let script = format!(
        "set -e; restic cat config >/dev/null 2>&1 || restic init; \
         restic backup {DATA_MOUNT} --tag {tag} --host {spec_name}"
    );

    let container = Container {
        name: "restic".to_string(),
        image: Some(target.restic_image.clone()),
        command: Some(vec![
            "/bin/sh".to_string(),
            "-c".to_string(),
            script,
        ]),
        env: Some(env),
        volume_mounts: Some(vec![VolumeMount {
            name: "data".to_string(),
            mount_path: DATA_MOUNT.to_string(),
            read_only: Some(true),
            ..Default::default()
        }]),
        ..Default::default()
    };

    let pod_spec = PodSpec {
        containers: vec![container],
        restart_policy: Some("Never".to_string()),
        volumes: Some(vec![Volume {
            name: "data".to_string(),
            persistent_volume_claim: Some(PersistentVolumeClaimVolumeSource {
                claim_name: naming::pvc_name(spec_name),
                read_only: Some(true),
            }),
            ..Default::default()
        }]),
        ..Default::default()
    };

    Job {
        metadata: ObjectMeta {
            name: Some(job_name.to_string()),
            namespace: Some(namespace.to_string()),
            labels: Some(naming::labels(spec_name)),
            ..Default::default()
        },
        spec: Some(JobSpec {
            backoff_limit: Some(2),
            // Completed/failed backup Jobs self-clean after an hour.
            ttl_seconds_after_finished: Some(3600),
            template: PodTemplateSpec {
                metadata: Some(ObjectMeta {
                    labels: Some(naming::labels(spec_name)),
                    ..Default::default()
                }),
                spec: Some(pod_spec),
            },
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn spec() -> DeploySpec {
        DeploySpec {
            name: "acme".to_string(),
            namespace: "t-acme".to_string(),
            image: "ghcr.io/acme/app:v1".to_string(),
            host: "acme.deployd.xyz".to_string(),
            volume_size_gi: 1,
            port: 4000,
            tls_issuer: "letsencrypt-prod-dns01-cloudflare".to_string(),
            tls_secret_name: None,
            image_pull_secret: None,
        }
    }

    fn json<T: serde::Serialize>(v: &T) -> Value {
        serde_json::to_value(v).unwrap()
    }

    #[test]
    fn deployment_is_single_replica_recreate_stateful() {
        let v = json(&deployment(&spec()));
        assert_eq!(v.pointer("/spec/replicas").unwrap(), 1);
        assert_eq!(
            v.pointer("/spec/strategy/type").unwrap(),
            "Recreate",
            "stateful volume needs Recreate, not RollingUpdate"
        );
        assert_eq!(
            v.pointer("/spec/template/spec/containers/0/image").unwrap(),
            "ghcr.io/acme/app:v1"
        );
        assert_eq!(
            v.pointer("/spec/template/spec/containers/0/ports/0/containerPort")
                .unwrap(),
            4000
        );
        assert_eq!(
            v.pointer("/spec/template/spec/containers/0/volumeMounts/0/mountPath")
                .unwrap(),
            DATA_MOUNT
        );
        assert_eq!(
            v.pointer("/spec/template/spec/containers/0/readinessProbe/httpGet/path")
                .unwrap(),
            HEALTH_PATH
        );
        assert_eq!(
            v.pointer("/spec/template/spec/volumes/0/persistentVolumeClaim/claimName")
                .unwrap(),
            "acme-data"
        );
    }

    #[test]
    fn deployment_runs_as_nonroot_uid_with_fsgroup() {
        let v = json(&deployment(&spec()));
        // enrahitu images run as root; runAsNonRoot forbids that, so the
        // container must be pinned to the non-root node UID (1000) to start.
        let csc = "/spec/template/spec/containers/0/securityContext";
        assert_eq!(v.pointer(&format!("{csc}/runAsNonRoot")).unwrap(), true);
        assert_eq!(v.pointer(&format!("{csc}/runAsUser")).unwrap(), 1000);
        assert_eq!(v.pointer(&format!("{csc}/runAsGroup")).unwrap(), 1000);
        // Pod-level fsGroup makes the mounted PVC writable by that non-root GID.
        assert_eq!(
            v.pointer("/spec/template/spec/securityContext/fsGroup").unwrap(),
            1000
        );
        assert_eq!(
            v.pointer("/spec/template/spec/securityContext/runAsUser").unwrap(),
            1000
        );
    }

    #[test]
    fn deployment_wires_optional_image_pull_secret() {
        let mut s = spec();
        s.image_pull_secret = Some("ghcr-pull".to_string());
        let v = json(&deployment(&s));
        assert_eq!(
            v.pointer("/spec/template/spec/imagePullSecrets/0/name")
                .unwrap(),
            "ghcr-pull"
        );
    }

    #[test]
    fn pvc_requests_storage_rwo() {
        let v = json(&pvc(&spec()));
        assert_eq!(
            v.pointer("/spec/accessModes/0").unwrap(),
            "ReadWriteOnce"
        );
        assert_eq!(
            v.pointer("/spec/resources/requests/storage").unwrap(),
            "1Gi"
        );
        assert_eq!(v.pointer("/metadata/name").unwrap(), "acme-data");
        // No storageClassName -> cluster default (hcloud-volumes).
        assert!(v.pointer("/spec/storageClassName").is_none());
    }

    #[test]
    fn service_is_clusterip_named_http() {
        let v = json(&service(&spec()));
        assert_eq!(v.pointer("/spec/type").unwrap(), "ClusterIP");
        assert_eq!(v.pointer("/spec/ports/0/port").unwrap(), 4000);
        assert_eq!(v.pointer("/spec/ports/0/targetPort").unwrap(), "http");
    }

    #[test]
    fn ingress_uses_nginx_and_dns01_issuer() {
        let v = json(&ingress(&spec()));
        assert_eq!(v.pointer("/spec/ingressClassName").unwrap(), "nginx");
        assert_eq!(
            v.pointer("/metadata/annotations/cert-manager.io~1cluster-issuer")
                .unwrap(),
            "letsencrypt-prod-dns01-cloudflare"
        );
        assert_eq!(v.pointer("/spec/rules/0/host").unwrap(), "acme.deployd.xyz");
        assert_eq!(v.pointer("/spec/tls/0/hosts/0").unwrap(), "acme.deployd.xyz");
        assert_eq!(v.pointer("/spec/tls/0/secretName").unwrap(), "acme-tls");
        assert_eq!(
            v.pointer("/spec/rules/0/http/paths/0/pathType").unwrap(),
            "Prefix"
        );
        assert_eq!(
            v.pointer("/spec/rules/0/http/paths/0/backend/service/name")
                .unwrap(),
            "acme"
        );
    }

    #[test]
    fn network_policies_deny_then_allow() {
        let policies = network_policies(&spec());
        assert_eq!(policies.len(), 3);

        let deny = json(&policies[0]);
        assert_eq!(deny.pointer("/metadata/name").unwrap(), "fleet-default-deny-all");
        let types = deny.pointer("/spec/policyTypes").unwrap().as_array().unwrap();
        assert!(types.contains(&Value::from("Ingress")));
        assert!(types.contains(&Value::from("Egress")));

        let allow_in = json(&policies[1]);
        assert_eq!(
            allow_in.pointer("/metadata/name").unwrap(),
            "fleet-allow-ingress-acme"
        );
        assert_eq!(
            allow_in
                .pointer("/spec/ingress/0/from/0/namespaceSelector/matchLabels/kubernetes.io~1metadata.name")
                .unwrap(),
            "ingress-nginx"
        );
        assert_eq!(
            allow_in.pointer("/spec/ingress/0/ports/0/port").unwrap(),
            4000
        );
        // The allow targets only this app's pods, not the whole namespace.
        assert_eq!(
            allow_in
                .pointer("/spec/podSelector/matchLabels/app.kubernetes.io~1instance")
                .unwrap(),
            "acme"
        );

        let allow_out = json(&policies[2]);
        assert_eq!(
            allow_out.pointer("/spec/policyTypes/0").unwrap(),
            "Egress"
        );
    }

    #[test]
    fn ingress_allow_is_per_app_so_two_ports_coexist() {
        // Regression for the in-pod two-port E2E defect: a namespace-wide
        // ingress allow pinned the first app's port, so a second app on
        // another port rolled out Ready but 502'd from the edge.
        let first = spec();
        let mut second = spec();
        second.name = "cell".to_string();
        second.port = 8080;

        let a = json(&network_policies(&first)[1]);
        let b = json(&network_policies(&second)[1]);
        // Distinct names: placing the second app cannot 409 into the first
        // app's policy and inherit its port.
        assert_eq!(a.pointer("/metadata/name").unwrap(), "fleet-allow-ingress-acme");
        assert_eq!(b.pointer("/metadata/name").unwrap(), "fleet-allow-ingress-cell");
        assert_eq!(a.pointer("/spec/ingress/0/ports/0/port").unwrap(), 4000);
        assert_eq!(b.pointer("/spec/ingress/0/ports/0/port").unwrap(), 8080);
        assert_eq!(
            b.pointer("/spec/podSelector/matchLabels/app.kubernetes.io~1instance")
                .unwrap(),
            "cell"
        );
    }

    #[test]
    fn backup_job_restics_data_readonly() {
        let target = BackupTarget {
            repository_base: "s3:https://nbg1.your-objectstorage.com/oap-fleet-backups-prod"
                .to_string(),
            password: "secret".to_string(),
            access_key_id: "AKID".to_string(),
            secret_access_key: "SECRET".to_string(),
            restic_image: "restic/restic:0.17.3".to_string(),
        };
        let repo = backup_repository(&target, "t-acme", "acme");
        assert_eq!(
            repo,
            "s3:https://nbg1.your-objectstorage.com/oap-fleet-backups-prod/t-acme/acme"
        );

        let v = json(&backup_job("acme", "t-acme", &target, &repo, "acme-20260715", "acme-backup-1"));
        assert_eq!(
            v.pointer("/spec/template/spec/restartPolicy").unwrap(),
            "Never"
        );
        assert_eq!(
            v.pointer("/spec/template/spec/volumes/0/persistentVolumeClaim/claimName")
                .unwrap(),
            "acme-data"
        );
        assert_eq!(
            v.pointer("/spec/template/spec/volumes/0/persistentVolumeClaim/readOnly")
                .unwrap(),
            true
        );
        assert_eq!(
            v.pointer("/spec/template/spec/containers/0/image").unwrap(),
            "restic/restic:0.17.3"
        );
        // The repository + password reach the Job as env.
        let env = v
            .pointer("/spec/template/spec/containers/0/env")
            .unwrap()
            .as_array()
            .unwrap();
        assert!(env
            .iter()
            .any(|e| e.get("name").unwrap() == "RESTIC_REPOSITORY"));
    }

    #[test]
    fn namespace_carries_managed_label() {
        let v = json(&namespace("t-acme"));
        assert_eq!(v.pointer("/metadata/name").unwrap(), "t-acme");
        assert_eq!(
            v.pointer("/metadata/labels/app.kubernetes.io~1managed-by")
                .unwrap(),
            "fleet-native"
        );
    }
}
