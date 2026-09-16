package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// CertStatus is the readiness of one cert-manager Certificate.
type CertStatus struct {
	Namespace string
	Name      string
	Ready     bool
	Reason    string
}

// WaitCertificatesReady polls every cert-manager Certificate in the cluster
// until all report Ready=True or the timeout elapses, returning the final
// per-Certificate status either way. It never hangs (the spec's bounded-poll
// requirement) and does not treat a still-pending cert as a hard error: at the
// dns phase only the rauthy and wildcard certs exist, while statecraft/deployd
// certs are issued later, so the caller reports rather than fails. A kubectl
// invocation error (no cluster, bad kubeconfig) IS returned as an error.
func WaitCertificatesReady(ctx context.Context, kubeconfigPath string, timeout, interval time.Duration) ([]CertStatus, error) {
	deadline := time.Now().Add(timeout)
	for {
		statuses, err := certStatuses(ctx, kubeconfigPath)
		if err != nil {
			return nil, err
		}
		allReady := len(statuses) > 0
		for _, s := range statuses {
			if !s.Ready {
				allReady = false
			}
		}
		if allReady || !time.Now().Before(deadline) {
			return statuses, nil
		}
		select {
		case <-ctx.Done():
			return statuses, ctx.Err()
		case <-time.After(interval):
		}
	}
}

// certManagerList is the slice of the `kubectl get certificate -A -o json`
// shape this package reads: name/namespace and the Ready condition.
type certManagerList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Status struct {
			Conditions []struct {
				Type    string `json:"type"`
				Status  string `json:"status"`
				Reason  string `json:"reason"`
				Message string `json:"message"`
			} `json:"conditions"`
		} `json:"status"`
	} `json:"items"`
}

func certStatuses(ctx context.Context, kubeconfigPath string) ([]CertStatus, error) {
	cmd := exec.CommandContext(ctx, "kubectl", "--kubeconfig", kubeconfigPath,
		"get", "certificate", "--all-namespaces", "-o", "json")
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("kubectl get certificate: %w", err)
	}
	return parseCertStatuses(out)
}

// parseCertStatuses extracts readiness from a kubectl certificate list. Split
// out so the JSON-shape handling is unit-testable without a live cluster.
func parseCertStatuses(raw []byte) ([]CertStatus, error) {
	var list certManagerList
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("decode certificate list: %w", err)
	}
	out := make([]CertStatus, 0, len(list.Items))
	for _, it := range list.Items {
		s := CertStatus{Namespace: it.Metadata.Namespace, Name: it.Metadata.Name, Reason: "Pending"}
		for _, c := range it.Status.Conditions {
			if c.Type == "Ready" {
				s.Ready = c.Status == "True"
				if c.Reason != "" {
					s.Reason = c.Reason
				}
			}
		}
		out = append(out, s)
	}
	return out, nil
}
