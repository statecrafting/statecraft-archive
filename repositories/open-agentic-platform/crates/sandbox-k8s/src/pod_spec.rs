// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.2, §3 FR-003, FR-004, FR-005, FR-006

//! Per-execution Pod manifest builder.
//!
//! Pure function: given a validated [`SandboxRequest`] plus the
//! per-execution metadata (namespace, uuid, selected RuntimeClass,
//! base image) produce a fully populated [`Pod`]. Every field in spec
//! 186 §2.2 table is set verbatim; nothing is read from environment
//! state. The builder does not call kube-rs.

use std::collections::BTreeMap;

use factory_contracts::sandbox::SandboxRequest;
use k8s_openapi::api::core::v1::{
    Capabilities, Container, EmptyDirVolumeSource, EnvVar, Pod, PodSecurityContext, PodSpec,
    ResourceRequirements, SeccompProfile, SecurityContext, Volume, VolumeMount,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;

/// Container name inside the per-execution Pod. Single-container Pod;
/// the name is stable so log/exec paths in `lifecycle.rs` can address
/// it without re-discovering.
pub(crate) const CONTAINER_NAME: &str = "exec";

/// Input mount path (read-only). Spec 186 §2.2.
pub(crate) const INPUT_MOUNT_PATH: &str = "/in";

/// Output mount path (writable). Spec 186 §2.2.
pub(crate) const OUTPUT_MOUNT_PATH: &str = "/out";

/// Writable tmpfs path. Required when `readOnlyRootFilesystem=true`
/// so that processes still have a place to write transient files. Per
/// spec 186 §2.2 table.
pub(crate) const TMP_MOUNT_PATH: &str = "/tmp";

/// Label key for the sandbox uuid. The NetworkPolicy selects on this
/// label; spec 186 §2.3 uses the same key.
pub(crate) const LABEL_SANDBOX_UUID: &str = "oap.io/sandbox";

/// Label key for the backend identity. Cluster operators can
/// observability-filter by backend.
pub(crate) const LABEL_BACKEND: &str = "oap.io/backend";

/// Annotation key for the pid_limit value the request carried. K8s
/// does not expose `pids_limit` as a Pod field, so the backend records
/// the requested ceiling here for diagnostics / FU-003 wiring.
pub(crate) const ANNOTATION_PID_LIMIT_REQUESTED: &str = "oap.io/pid-limit-requested";

/// Inputs to the pod builder.
pub(crate) struct BuildInputs<'a> {
    pub request: &'a SandboxRequest,
    pub namespace: &'a str,
    pub uuid: &'a str,
    pub runtime_class_name: Option<&'a str>,
    pub image: &'a str,
}

/// Build the per-execution Pod manifest. Pure: the same inputs yield
/// the same Pod (modulo `BTreeMap` ordering, which is canonical).
pub(crate) fn build(inputs: BuildInputs<'_>) -> Pod {
    let BuildInputs {
        request,
        namespace,
        uuid,
        runtime_class_name,
        image,
    } = inputs;

    let mut labels = BTreeMap::new();
    labels.insert(LABEL_SANDBOX_UUID.to_string(), uuid.to_string());
    labels.insert(LABEL_BACKEND.to_string(), "k8s".to_string());

    let mut annotations = BTreeMap::new();
    annotations.insert(
        ANNOTATION_PID_LIMIT_REQUESTED.to_string(),
        request.resource_ceilings.pid_limit.to_string(),
    );

    let pod_security_context = PodSecurityContext {
        run_as_non_root: Some(true),
        run_as_user: Some(65534),
        run_as_group: Some(65534),
        fs_group: Some(65534),
        seccomp_profile: Some(SeccompProfile {
            type_: "RuntimeDefault".to_string(),
            localhost_profile: None,
        }),
        ..PodSecurityContext::default()
    };

    let container_security_context = SecurityContext {
        read_only_root_filesystem: Some(true),
        allow_privilege_escalation: Some(false),
        privileged: Some(false),
        run_as_non_root: Some(true),
        capabilities: Some(Capabilities {
            drop: Some(vec!["ALL".to_string()]),
            add: None,
        }),
        seccomp_profile: Some(SeccompProfile {
            type_: "RuntimeDefault".to_string(),
            localhost_profile: None,
        }),
        ..SecurityContext::default()
    };

    let resources = ResourceRequirements {
        requests: Some({
            let mut m = BTreeMap::new();
            m.insert(
                "cpu".to_string(),
                Quantity(format!("{}m", request.resource_ceilings.cpu_milli_request)),
            );
            m.insert(
                "memory".to_string(),
                Quantity(request.resource_ceilings.memory_bytes_request.to_string()),
            );
            m
        }),
        limits: Some({
            let mut m = BTreeMap::new();
            m.insert(
                "cpu".to_string(),
                Quantity(format!("{}m", request.resource_ceilings.cpu_milli_limit)),
            );
            m.insert(
                "memory".to_string(),
                Quantity(request.resource_ceilings.memory_bytes_limit.to_string()),
            );
            m
        }),
        claims: None,
    };

    let env_vars: Vec<EnvVar> = request
        .env
        .iter()
        .map(|(k, v)| EnvVar {
            name: k.clone(),
            value: Some(v.clone()),
            value_from: None,
        })
        .collect();

    let volume_mounts = vec![
        VolumeMount {
            name: "input".to_string(),
            mount_path: INPUT_MOUNT_PATH.to_string(),
            read_only: Some(true),
            ..VolumeMount::default()
        },
        VolumeMount {
            name: "output".to_string(),
            mount_path: OUTPUT_MOUNT_PATH.to_string(),
            read_only: Some(false),
            ..VolumeMount::default()
        },
        VolumeMount {
            name: "tmp".to_string(),
            mount_path: TMP_MOUNT_PATH.to_string(),
            read_only: Some(false),
            ..VolumeMount::default()
        },
    ];

    let volumes = vec![
        Volume {
            name: "input".to_string(),
            empty_dir: Some(EmptyDirVolumeSource::default()),
            ..Volume::default()
        },
        Volume {
            name: "output".to_string(),
            empty_dir: Some(EmptyDirVolumeSource::default()),
            ..Volume::default()
        },
        Volume {
            name: "tmp".to_string(),
            empty_dir: Some(EmptyDirVolumeSource::default()),
            ..Volume::default()
        },
    ];

    let container = Container {
        name: CONTAINER_NAME.to_string(),
        image: Some(image.to_string()),
        command: Some(request.command.clone()),
        args: None,
        env: if env_vars.is_empty() { None } else { Some(env_vars) },
        resources: Some(resources),
        security_context: Some(container_security_context),
        volume_mounts: Some(volume_mounts),
        ..Container::default()
    };

    let spec = PodSpec {
        containers: vec![container],
        restart_policy: Some("Never".to_string()),
        active_deadline_seconds: Some(i64::from(request.ttl_seconds)),
        automount_service_account_token: Some(false),
        host_network: Some(false),
        host_pid: Some(false),
        host_ipc: Some(false),
        security_context: Some(pod_security_context),
        volumes: Some(volumes),
        runtime_class_name: runtime_class_name.map(|s| s.to_string()),
        ..PodSpec::default()
    };

    Pod {
        metadata: ObjectMeta {
            name: Some(pod_name(uuid)),
            namespace: Some(namespace.to_string()),
            labels: Some(labels),
            annotations: Some(annotations),
            ..ObjectMeta::default()
        },
        spec: Some(spec),
        status: None,
    }
}

/// Per-execution Pod name. Stable for a given uuid so the lifecycle
/// loop addresses the same Pod across apply / watch / harvest /
/// delete.
pub(crate) fn pod_name(uuid: &str) -> String {
    format!("oap-sbx-{uuid}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::sandbox::{
        IsolationTier, ResourceCeilings, SandboxRequest, DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
    };
    use std::collections::BTreeMap;

    fn baseline_request() -> SandboxRequest {
        SandboxRequest {
            command: vec!["echo".into(), "hello".into()],
            input_artifacts: vec![],
            egress_allowlist: vec![],
            ttl_seconds: DEFAULT_TTL_SECONDS,
            resource_ceilings: ResourceCeilings {
                cpu_milli_limit: 500,
                cpu_milli_request: 100,
                memory_bytes_limit: 256 * 1024 * 1024,
                memory_bytes_request: 64 * 1024 * 1024,
                pid_limit: DEFAULT_PID_LIMIT,
            },
            minimum_isolation_tier: IsolationTier::RestrictedContainer,
            env: BTreeMap::new(),
        }
    }

    fn build_default(uuid: &str) -> Pod {
        build(BuildInputs {
            request: &baseline_request(),
            namespace: "oap-sandbox",
            uuid,
            runtime_class_name: None,
            image: "docker.io/library/alpine:3.20",
        })
    }

    #[test]
    fn pod_name_is_stable_for_uuid() {
        assert_eq!(pod_name("abc"), "oap-sbx-abc");
        // Cross-check the lifecycle / metadata stay in sync.
        let pod = build_default("abc");
        assert_eq!(pod.metadata.name.as_deref(), Some("oap-sbx-abc"));
    }

    #[test]
    fn metadata_carries_uuid_and_backend_labels() {
        let pod = build_default("abc");
        let labels = pod.metadata.labels.unwrap();
        assert_eq!(labels.get(LABEL_SANDBOX_UUID), Some(&"abc".to_string()));
        assert_eq!(labels.get(LABEL_BACKEND), Some(&"k8s".to_string()));
    }

    #[test]
    fn pid_limit_annotation_records_request_value() {
        let pod = build_default("abc");
        let ann = pod.metadata.annotations.unwrap();
        assert_eq!(
            ann.get(ANNOTATION_PID_LIMIT_REQUESTED),
            Some(&DEFAULT_PID_LIMIT.to_string())
        );
    }

    #[test]
    fn restart_policy_is_never() {
        let pod = build_default("abc");
        assert_eq!(pod.spec.unwrap().restart_policy.as_deref(), Some("Never"));
    }

    #[test]
    fn ttl_drives_active_deadline_seconds() {
        let pod = build_default("abc");
        assert_eq!(
            pod.spec.unwrap().active_deadline_seconds,
            Some(i64::from(DEFAULT_TTL_SECONDS))
        );
    }

    #[test]
    fn automount_service_account_token_is_false() {
        let pod = build_default("abc");
        assert_eq!(
            pod.spec.unwrap().automount_service_account_token,
            Some(false)
        );
    }

    #[test]
    fn host_network_pid_ipc_all_false() {
        let pod = build_default("abc");
        let s = pod.spec.unwrap();
        assert_eq!(s.host_network, Some(false));
        assert_eq!(s.host_pid, Some(false));
        assert_eq!(s.host_ipc, Some(false));
    }

    #[test]
    fn pod_security_context_runs_as_non_root_nobody_with_seccomp_default() {
        let pod = build_default("abc");
        let sc = pod.spec.unwrap().security_context.unwrap();
        assert_eq!(sc.run_as_non_root, Some(true));
        assert_eq!(sc.run_as_user, Some(65534));
        let prof = sc.seccomp_profile.unwrap();
        assert_eq!(prof.type_, "RuntimeDefault");
    }

    #[test]
    fn container_security_context_drops_all_caps_read_only_root() {
        let pod = build_default("abc");
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        let sc = c.security_context.unwrap();
        assert_eq!(sc.read_only_root_filesystem, Some(true));
        assert_eq!(sc.allow_privilege_escalation, Some(false));
        assert_eq!(sc.privileged, Some(false));
        let caps = sc.capabilities.unwrap();
        assert_eq!(caps.drop, Some(vec!["ALL".to_string()]));
        assert_eq!(caps.add, None);
    }

    #[test]
    fn container_command_is_request_argv() {
        let pod = build_default("abc");
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        assert_eq!(c.command, Some(vec!["echo".into(), "hello".into()]));
        assert_eq!(c.args, None);
    }

    #[test]
    fn container_resources_use_milli_cpu_and_byte_memory() {
        let pod = build_default("abc");
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        let res = c.resources.unwrap();
        let req = res.requests.unwrap();
        let lim = res.limits.unwrap();
        assert_eq!(req.get("cpu").unwrap().0, "100m");
        assert_eq!(lim.get("cpu").unwrap().0, "500m");
        assert_eq!(req.get("memory").unwrap().0, (64 * 1024 * 1024).to_string());
        assert_eq!(lim.get("memory").unwrap().0, (256 * 1024 * 1024).to_string());
    }

    #[test]
    fn volumes_are_input_output_tmp_empty_dirs() {
        let pod = build_default("abc");
        let s = pod.spec.unwrap();
        let vols = s.volumes.unwrap();
        let names: Vec<&str> = vols.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, vec!["input", "output", "tmp"]);
        for v in &vols {
            assert!(v.empty_dir.is_some());
            assert!(v.host_path.is_none());
        }
    }

    #[test]
    fn volume_mounts_input_readonly_output_writable() {
        let pod = build_default("abc");
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        let mounts = c.volume_mounts.unwrap();
        let input_mount = mounts.iter().find(|m| m.name == "input").unwrap();
        let output_mount = mounts.iter().find(|m| m.name == "output").unwrap();
        let tmp_mount = mounts.iter().find(|m| m.name == "tmp").unwrap();
        assert_eq!(input_mount.mount_path, INPUT_MOUNT_PATH);
        assert_eq!(input_mount.read_only, Some(true));
        assert_eq!(output_mount.mount_path, OUTPUT_MOUNT_PATH);
        assert_eq!(output_mount.read_only, Some(false));
        assert_eq!(tmp_mount.mount_path, TMP_MOUNT_PATH);
        assert_eq!(tmp_mount.read_only, Some(false));
    }

    #[test]
    fn runtime_class_name_set_when_supplied() {
        let pod = build(BuildInputs {
            request: &baseline_request(),
            namespace: "oap-sandbox",
            uuid: "abc",
            runtime_class_name: Some("gvisor"),
            image: "docker.io/library/alpine:3.20",
        });
        assert_eq!(pod.spec.unwrap().runtime_class_name.as_deref(), Some("gvisor"));
    }

    #[test]
    fn runtime_class_name_omitted_when_none() {
        let pod = build_default("abc");
        assert_eq!(pod.spec.unwrap().runtime_class_name, None);
    }

    #[test]
    fn env_vars_emitted_when_request_has_them() {
        let mut req = baseline_request();
        req.env.insert("FOO".into(), "bar".into());
        req.env.insert("BAZ".into(), "qux".into());
        let pod = build(BuildInputs {
            request: &req,
            namespace: "oap-sandbox",
            uuid: "abc",
            runtime_class_name: None,
            image: "docker.io/library/alpine:3.20",
        });
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        let env = c.env.unwrap();
        assert_eq!(env.len(), 2);
        // BTreeMap iteration order ⇒ alphabetical.
        assert_eq!(env[0].name, "BAZ");
        assert_eq!(env[0].value, Some("qux".into()));
        assert_eq!(env[1].name, "FOO");
        assert_eq!(env[1].value, Some("bar".into()));
    }

    #[test]
    fn no_env_emits_none_not_empty_vec() {
        // Cleaner kube admission diff: env absent rather than `env: []`.
        let pod = build_default("abc");
        let c = pod.spec.unwrap().containers.into_iter().next().unwrap();
        assert!(c.env.is_none());
    }

    #[test]
    fn pod_is_in_requested_namespace() {
        let pod = build(BuildInputs {
            request: &baseline_request(),
            namespace: "custom-ns",
            uuid: "abc",
            runtime_class_name: None,
            image: "docker.io/library/alpine:3.20",
        });
        assert_eq!(pod.metadata.namespace.as_deref(), Some("custom-ns"));
    }

    #[test]
    fn no_host_path_volume_under_any_input() {
        // Belt-and-braces — FR-006 forbids host*. The volumes vec is
        // small enough that we can scan it directly.
        let pod = build_default("abc");
        for v in pod.spec.unwrap().volumes.unwrap() {
            assert!(v.host_path.is_none(), "host_path leaked: {:?}", v);
        }
    }
}
