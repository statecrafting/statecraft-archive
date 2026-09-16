package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestGenerateShapes(t *testing.T) {
	cases := []struct {
		kind  GenKind
		check func(string) bool
	}{
		{GenHex32, func(s string) bool { return len(s) == 64 }},
		{GenHex8, func(s string) bool { return len(s) == 16 }},
		{GenHex6, func(s string) bool { return len(s) == 12 }},
		{GenBase64Std32, func(s string) bool { _, err := base64.StdEncoding.DecodeString(s); return err == nil }},
		{GenPassword, func(s string) bool { _, err := base64.RawURLEncoding.DecodeString(s); return err == nil }},
		{GenKID, func(s string) bool { return strings.HasPrefix(s, "fk-") }},
		{GenEd25519PEMB64, func(s string) bool {
			der, err := base64.StdEncoding.DecodeString(s)
			return err == nil && strings.Contains(string(der), "BEGIN PRIVATE KEY")
		}},
	}
	for _, c := range cases {
		v, err := Generate(c.kind)
		if err != nil {
			t.Fatalf("Generate(%d): %v", c.kind, err)
		}
		if v == "" || !c.check(v) {
			t.Errorf("Generate(%d) returned unexpected shape: %q", c.kind, v)
		}
	}
	// two calls must differ (real randomness)
	a, _ := Generate(GenHex32)
	b, _ := Generate(GenHex32)
	if a == b {
		t.Error("GenHex32 produced identical values twice")
	}
}

func TestDeriveFromDomain(t *testing.T) {
	c := New()
	c.Set("DOMAIN", "oap.example.com")
	c.RefreshDerived()
	want := map[string]string{
		"APP_BASE_URL":        "https://oap.example.com",
		"RAUTHY_URL":          "https://auth.oap.example.com",
		"OIDC_ENDPOINT":       "https://auth.oap.example.com",
		"DEPLOYD_AUDIENCE":    "https://deploy.oap.example.com",
		"TENANTS_BASE_DOMAIN": "tenants.oap.example.com",
	}
	for k, v := range want {
		if got := c.Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestDeriveFluxFromOrgRepo(t *testing.T) {
	c := New()
	c.Set("ORG", "acme-inc")
	c.Set("REPO", "open-agentic-platform")
	c.RefreshDerived()
	want := map[string]string{
		"FLUX_OWNER":  "acme-inc",
		"FLUX_REPO":   "open-agentic-platform",
		"FLUX_BRANCH": "main",
		"GH_REPO":     "acme-inc/open-agentic-platform",
	}
	for k, v := range want {
		if got := c.Get(k); got != v {
			t.Errorf("%s = %q, want %q (FR-040: the fork's flux bootstrap + gh-sync target its own repo)", k, got, v)
		}
	}
}

func TestParseSerializeRoundTrip(t *testing.T) {
	c := New()
	c.Set("DOMAIN", "oap.example.com")
	c.Set("RAUTHY_ENC_KEY", "abc123==") // base64 padding: value contains '='
	c.Set("HCLOUD_TOKEN", "tok with spaces")
	doc := c.Serialize()
	got, err := Parse(doc)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	for _, k := range []string{"DOMAIN", "RAUTHY_ENC_KEY", "HCLOUD_TOKEN"} {
		if got.Get(k) != c.Get(k) {
			t.Errorf("round-trip %s: got %q want %q", k, got.Get(k), c.Get(k))
		}
	}
}

func TestParseTolerates(t *testing.T) {
	in := "# comment\n\nexport DOMAIN=oap.example.com\nQUOTED=\"q\"\nSINGLE='s'\n"
	c, err := Parse([]byte(in))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if c.Get("DOMAIN") != "oap.example.com" || c.Get("QUOTED") != "q" || c.Get("SINGLE") != "s" {
		t.Errorf("tolerant parse failed: %q %q %q", c.Get("DOMAIN"), c.Get("QUOTED"), c.Get("SINGLE"))
	}
}

func TestEnsureGeneratedIdempotent(t *testing.T) {
	c := New()
	c.Set("POSTGRES_PASSWORD", "preset-value")
	if err := c.EnsureGenerated(); err != nil {
		t.Fatalf("EnsureGenerated: %v", err)
	}
	if c.Get("POSTGRES_PASSWORD") != "preset-value" {
		t.Error("EnsureGenerated overwrote an existing value")
	}
	if !c.Has("SESSION_SECRET") {
		t.Error("EnsureGenerated did not mint a missing generated key")
	}
	// a second pass must not change anything
	first := c.Get("SESSION_SECRET")
	if err := c.EnsureGenerated(); err != nil {
		t.Fatal(err)
	}
	if c.Get("SESSION_SECRET") != first {
		t.Error("EnsureGenerated regenerated an existing key on the second pass")
	}
}

func TestMissingRequired(t *testing.T) {
	c := New()
	missing := indexSet(c.MissingRequired())
	for _, k := range []string{"ORG", "DOMAIN", "GITHUB_APP_ID"} {
		if !missing[k] {
			t.Errorf("empty config should report %s missing", k)
		}
	}
	// fill user-supplied + generated; only provider-produced should remain
	for _, k := range Registry {
		if k.Prov == UserSupplied && k.Required {
			c.Set(k.Name, "x")
		}
	}
	if err := c.EnsureGenerated(); err != nil {
		t.Fatal(err)
	}
	for _, name := range c.MissingRequired() {
		k, _ := Lookup(name)
		if k.Prov != ProviderProduced {
			t.Errorf("after init, unexpected missing key %s (prov %s)", name, k.Prov)
		}
	}
}

func TestOptionalGroupAllOrNothing(t *testing.T) {
	c := New()
	// no SMTP set: group inactive, nothing required from it
	for _, name := range c.MissingRequired() {
		if k, _ := Lookup(name); k.Group == "smtp" {
			t.Errorf("inactive smtp group should not require %s", name)
		}
	}
	// set one SMTP member: the rest of the group becomes required
	c.Set("SMTP_URL", "smtp.example.com:587")
	missing := indexSet(c.MissingRequired())
	if !missing["SMTP_USERNAME"] || !missing["SMTP_PASSWORD"] {
		t.Error("a partially-filled smtp group should require its other members")
	}
}

func indexSet(ss []string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}
