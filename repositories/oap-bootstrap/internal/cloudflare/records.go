package cloudflare

import "strings"

// PlatformARecords returns the fully-qualified hostnames the dns phase points at
// the cluster node, derived from the base DOMAIN. These mirror the ingress and
// cert-manager topology exactly: the statecraft apex, the auth (Rauthy), deploy
// (deployd-api), and minio ingresses, plus the wildcard for per-tenant app
// ingresses. The wildcard A record carries tenant traffic; the matching
// `*.tenants` TLS is issued separately by cert-manager's DNS-01 solver. Order is
// stable so the phase reports deterministically.
func PlatformARecords(domain string) []string {
	d := strings.TrimSuffix(strings.TrimSpace(domain), ".")
	if d == "" {
		return nil
	}
	return []string{
		d,                // statecraft SaaS apex
		"auth." + d,      // Rauthy OIDC
		"deploy." + d,    // deployd-api orchestrator
		"minio." + d,     // MinIO S3 object store
		"*.tenants." + d, // per-tenant app ingresses (wildcard)
	}
}
