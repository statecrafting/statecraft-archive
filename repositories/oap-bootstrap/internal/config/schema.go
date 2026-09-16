// Package config defines the oap-bootstrap configuration model: every key the
// CLI needs, classified by provenance (who produces it), plus the load/generate/
// persist round-trip over the oap.env file. The registry here is the single
// source of truth for what `init` prompts, what it generates, and what it
// derives. See spec 001 section 3.1 (Configuration model).
package config

import "strings"

// Provenance is how a config value comes into existence.
type Provenance int

const (
	// UserSupplied: the operator provides it (tokens, domain, API keys).
	UserSupplied Provenance = iota
	// Generated: the CLI mints it with crypto/rand if absent.
	Generated
	// ProviderProduced: a provider hands it back (GitHub App manifest, Rauthy
	// OIDC client creation). Never prompted, never generated locally; populated
	// by the github/identity phases.
	ProviderProduced
	// Derived: computed from another value (every service URL from DOMAIN).
	Derived
)

func (p Provenance) String() string {
	switch p {
	case UserSupplied:
		return "user-supplied"
	case Generated:
		return "generated"
	case ProviderProduced:
		return "provider-produced"
	case Derived:
		return "derived"
	default:
		return "unknown"
	}
}

// GenKind selects how a Generated key is minted. The shapes mirror the upstream
// setup.sh generators so values are interchangeable with a hand-run setup.
type GenKind int

const (
	GenNone          GenKind = iota
	GenHex32                 // 32 random bytes, hex (64 chars). General secrets.
	GenHex8                  // 8 random bytes, hex (16 chars). Key ids.
	GenHex6                  // 6 random bytes, hex (12 chars). Short handles.
	GenBase64Std32           // 32 random bytes, standard base64. Encryption keys.
	GenPassword              // base64url password (no padding). Admin password.
	GenEd25519PEMB64         // ed25519 PKCS#8 PEM, base64'd to one line. Factory signing.
	GenKID                   // "fk-" + 8 hex chars. A stable, non-secret key id.
)

// Key is one entry in the configuration model.
type Key struct {
	Name     string
	Prov     Provenance
	Secret   bool   // credential/key/token: encrypted at rest, masked in output.
	Required bool   // a run cannot proceed without it (unless Optional group).
	Prompt   string // shown by `init` for UserSupplied keys.
	Gen      GenKind
	// Derive computes a Derived value from the rest of the config. get returns
	// the current value of any key by name (empty string if unset).
	Derive func(get func(string) string) string
	// Group ties optional keys together: a group is all-or-nothing. Empty for
	// keys that stand alone.
	Group string
}

// httpsHost builds https://<sub>.<domain> (or https://<domain> when sub is "").
func httpsHost(sub, domain string) string {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return ""
	}
	if sub == "" {
		return "https://" + domain
	}
	return "https://" + sub + "." + domain
}

// Registry is the ordered list of every config key. Order is the serialization
// order of oap.env, so it is grouped by provenance for human readability.
var Registry = []Key{
	// ---- User-supplied: the operator provides these (prompted by `init`). ----
	{Name: "ORG", Prov: UserSupplied, Required: true,
		Prompt: "Target GitHub org to fork into (e.g. acme-inc)"},
	{Name: "REPO", Prov: UserSupplied, Required: true,
		Prompt: "Target repo name"},
	{Name: "DOMAIN", Prov: UserSupplied, Required: true,
		Prompt: "Base domain (apex host for statecraft, e.g. oap.example.com)"},
	{Name: "LETSENCRYPT_EMAIL", Prov: UserSupplied, Required: true,
		Prompt: "Email for Let's Encrypt registration"},
	{Name: "HCLOUD_TOKEN", Prov: UserSupplied, Secret: true, Required: true,
		Prompt: "Hetzner Cloud API token (read+write on the target project)"},
	{Name: "GITHUB_TOKEN", Prov: UserSupplied, Secret: true, Required: true,
		Prompt: "GitHub token with admin:org + repo (fork, App, Actions secrets)"},
	{Name: "CLOUDFLARE_DNS_API_TOKEN", Prov: UserSupplied, Secret: true,
		Prompt: "Cloudflare API token with Zone:Edit (DNS A records); blank to enter records by hand"},
	{Name: "GHCR_PAT", Prov: UserSupplied, Secret: true, Required: true,
		Prompt: "GitHub PAT with read:packages (GHCR image pulls)"},
	{Name: "ANTHROPIC_API_KEY", Prov: UserSupplied, Secret: true, Required: true,
		Prompt: "Anthropic API key (knowledge extraction)"},
	// Optional SMTP group (all-or-nothing).
	{Name: "SMTP_URL", Prov: UserSupplied, Group: "smtp",
		Prompt: "SMTP host (blank to skip email); Hetzner blocks 465, use 587/STARTTLS"},
	{Name: "SMTP_USERNAME", Prov: UserSupplied, Group: "smtp", Prompt: "SMTP username"},
	{Name: "SMTP_PASSWORD", Prov: UserSupplied, Secret: true, Group: "smtp", Prompt: "SMTP password"},

	// ---- Generated: the CLI mints these with crypto/rand if absent. ----
	{Name: "POSTGRES_PASSWORD", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "SESSION_SECRET", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "RAUTHY_RAFT_SECRET", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "RAUTHY_API_SECRET", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "RAUTHY_ADMIN_PASSWORD", Prov: Generated, Secret: true, Required: true, Gen: GenPassword},
	{Name: "RAUTHY_ENC_KEY_ID", Prov: Generated, Required: true, Gen: GenHex8},
	{Name: "RAUTHY_ENC_KEY", Prov: Generated, Secret: true, Required: true, Gen: GenBase64Std32},
	{Name: "HIQLITE_SECRET_RAFT", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "HIQLITE_SECRET_API", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "MINIO_ROOT_USER", Prov: Generated, Required: true, Gen: GenHex6},
	{Name: "MINIO_ROOT_PASSWORD", Prov: Generated, Secret: true, Required: true, Gen: GenHex32},
	{Name: "PAT_ENCRYPTION_KEY", Prov: Generated, Secret: true, Required: true, Gen: GenBase64Std32},
	{Name: "FACTORY_SIGNING_PRIVATE_KEY_B64", Prov: Generated, Secret: true, Required: true, Gen: GenEd25519PEMB64},
	{Name: "FACTORY_SIGNING_KID", Prov: Generated, Required: true, Gen: GenKID},

	// ---- Provider-produced: populated by the github / identity phases. ----
	{Name: "GITHUB_APP_ID", Prov: ProviderProduced, Required: true},
	{Name: "GITHUB_APP_PRIVATE_KEY_B64", Prov: ProviderProduced, Secret: true, Required: true},
	// GitHub generates the webhook secret during the manifest flow and returns it
	// in the conversion response; it is not supplied by the CLI.
	{Name: "GITHUB_WEBHOOK_SECRET", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "GITHUB_UPSTREAM_CLIENT_ID", Prov: ProviderProduced, Required: true},
	{Name: "GITHUB_UPSTREAM_CLIENT_SECRET", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "OIDC_SPA_CLIENT_ID", Prov: ProviderProduced, Required: true},
	{Name: "OIDC_M2M_CLIENT_ID", Prov: ProviderProduced, Required: true},
	{Name: "OIDC_M2M_CLIENT_SECRET", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "RAUTHY_CLIENT_ID", Prov: ProviderProduced, Required: true},
	{Name: "RAUTHY_CLIENT_SECRET", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "RAUTHY_ADMIN_TOKEN", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID", Prov: ProviderProduced, Required: true},
	{Name: "STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET", Prov: ProviderProduced, Secret: true, Required: true},
	{Name: "NODE_IP", Prov: ProviderProduced, Required: true}, // captured by the cluster phase

	// ---- Derived: computed from another value (never prompted, never generated). ----
	// FLUX_OWNER/REPO/BRANCH point the forked repo's `flux bootstrap` at its own
	// repo so the GitOps loop reconciles from the fork, not upstream. They are the
	// .env half of the upstream's FR-040 seam (setup.sh defaults them to the
	// upstream owner/repo/branch, so an unset .env behaves exactly as before);
	// driving them from ORG/REPO is what makes a fork need zero source edits.
	{Name: "FLUX_OWNER", Prov: Derived,
		Derive: func(g func(string) string) string { return strings.TrimSpace(g("ORG")) }},
	{Name: "FLUX_REPO", Prov: Derived,
		Derive: func(g func(string) string) string { return strings.TrimSpace(g("REPO")) }},
	{Name: "FLUX_BRANCH", Prov: Derived,
		Derive: func(g func(string) string) string { return "main" }},
	// GH_REPO is the second fork seam (the sibling of FLUX_*): setup.sh's Phase-2
	// `gh secret set` block (platform/infra/hetzner/setup.sh:596) defaults GH_REPO
	// to the upstream `statecrafting/open-agentic-platform` and syncs
	// KUBECONFIG_HETZNER / WEBHOOK_SECRET / GHCR_PAT to it. Unset, a fork's
	// platform phase would push the fork's own cluster kubeconfig at the UPSTREAM
	// repo (a cross-repo secret leak, or a hard failure if the operator lacks
	// upstream admin). Driving GH_REPO from ORG/REPO points that sync at the fork,
	// exactly as FLUX_OWNER/REPO point `flux bootstrap` at the fork.
	{Name: "GH_REPO", Prov: Derived,
		Derive: func(g func(string) string) string {
			org, repo := strings.TrimSpace(g("ORG")), strings.TrimSpace(g("REPO"))
			if org == "" || repo == "" {
				return ""
			}
			return org + "/" + repo
		}},
	{Name: "APP_BASE_URL", Prov: Derived,
		Derive: func(g func(string) string) string { return httpsHost("", g("DOMAIN")) }},
	{Name: "RAUTHY_URL", Prov: Derived,
		Derive: func(g func(string) string) string { return httpsHost("auth", g("DOMAIN")) }},
	{Name: "OIDC_ENDPOINT", Prov: Derived,
		Derive: func(g func(string) string) string { return httpsHost("auth", g("DOMAIN")) }},
	{Name: "DEPLOYD_AUDIENCE", Prov: Derived,
		Derive: func(g func(string) string) string { return httpsHost("deploy", g("DOMAIN")) }},
	{Name: "TENANTS_BASE_DOMAIN", Prov: Derived,
		Derive: func(g func(string) string) string {
			d := strings.TrimSpace(g("DOMAIN"))
			if d == "" {
				return ""
			}
			return "tenants." + d
		}},
}

// byName indexes the registry for O(1) lookup.
var byName = func() map[string]Key {
	m := make(map[string]Key, len(Registry))
	for _, k := range Registry {
		m[k.Name] = k
	}
	return m
}()

// Lookup returns the Key definition for name, if known.
func Lookup(name string) (Key, bool) {
	k, ok := byName[name]
	return k, ok
}
