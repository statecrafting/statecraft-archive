package cluster

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bartekus/oap-bootstrap/internal/config"
)

// trickyValues exercise the shell-escaping contract: a value setup.sh sources
// must come back byte-for-byte regardless of spaces, base64 padding, shell
// metacharacters, or an embedded single quote.
var trickyValues = map[string]string{
	"K_SIMPLE": "abc123",
	"K_SPACES": "tok with spaces",
	"K_EQUALS": "Zm9vYmFy==",                           // base64 padding
	"K_META":   "a$b`c;d|e&f",                          // shell metacharacters
	"K_QUOTE":  "it's a 'quoted' val",                  // embedded single quotes
	"K_SLASH":  "a/b+c=d_e-f",                          // base64url-ish
	"K_PEM":    "LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t", // one-line PEM b64
}

func bridgeConfig() *config.Config {
	c := config.New()
	for k, v := range trickyValues {
		c.Set(k, v)
	}
	return c
}

func TestWriteBridgeEnvPermsAndShred(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	shred, err := WriteBridgeEnv(path, bridgeConfig())
	if err != nil {
		t.Fatalf("WriteBridgeEnv: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat bridge: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("bridge perms = %o, want 600", perm)
	}
	// Every line must be an `export KEY='...'` form.
	body, _ := os.ReadFile(path)
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		if !strings.HasPrefix(line, "export ") || !strings.Contains(line, "='") {
			t.Errorf("bridge line is not export-quoted: %q", line)
		}
	}
	// Shred removes the file, and a second shred is a no-op (defer may double-fire).
	if err := shred(); err != nil {
		t.Fatalf("shred: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("bridge still present after shred: %v", err)
	}
	if err := shred(); err != nil {
		t.Errorf("second shred should be a no-op, got %v", err)
	}
}

// TestBridgeShellRoundTrip is the load-bearing escaping test: it writes the
// bridge, sources it in a real bash, and asserts every value comes back
// verbatim. This is what guarantees setup.sh's `source` sees the exact secret
// bytes oap.env holds.
func TestBridgeShellRoundTrip(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash not on PATH")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if _, err := WriteBridgeEnv(path, bridgeConfig()); err != nil {
		t.Fatalf("WriteBridgeEnv: %v", err)
	}

	// Deterministic key order so we can match output lines to expected values.
	keys := []string{"K_SIMPLE", "K_SPACES", "K_EQUALS", "K_META", "K_QUOTE", "K_SLASH", "K_PEM"}
	var script strings.Builder
	script.WriteString("set -u\nsource " + path + "\n")
	for _, k := range keys {
		// A unique sentinel delimiter avoids ambiguity if a value spans odd chars.
		script.WriteString("printf '<<%s>>\\n' \"$" + k + "\"\n")
	}
	out, err := exec.Command(bash, "-c", script.String()).Output()
	if err != nil {
		t.Fatalf("bash source: %v", err)
	}
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) != len(keys) {
		t.Fatalf("got %d output lines, want %d: %q", len(lines), len(keys), lines)
	}
	for i, k := range keys {
		want := "<<" + trickyValues[k] + ">>"
		if lines[i] != want {
			t.Errorf("%s round-trip: bash saw %q, want %q", k, lines[i], want)
		}
	}
}

func TestPathHelpers(t *testing.T) {
	repo := "/tmp/fork"
	if got, want := HetznerDir(repo), "/tmp/fork/platform/infra/hetzner"; got != want {
		t.Errorf("HetznerDir = %q, want %q", got, want)
	}
	if got, want := BridgeEnvPath(repo), "/tmp/fork/platform/infra/hetzner/.env"; got != want {
		t.Errorf("BridgeEnvPath = %q, want %q", got, want)
	}
	if got, want := KubeconfigPath(repo), "/tmp/fork/platform/infra/hetzner/kubeconfig"; got != want {
		t.Errorf("KubeconfigPath = %q, want %q", got, want)
	}
}

// TestRunSetupMissingScript: both phase wrappers fail fast with a clear error
// when setup.sh is absent from the checkout, rather than handing bash a missing
// file. Covers the shared os.Stat guard behind RunSetupPhase1/RunSetupPhase2.
func TestRunSetupMissingScript(t *testing.T) {
	repoDir := t.TempDir() // no platform/infra/hetzner/setup.sh inside
	for _, tc := range []struct {
		name string
		run  func() error
	}{
		{"phase1", func() error { return RunSetupPhase1(t.Context(), repoDir, "") }},
		{"phase2", func() error { return RunSetupPhase2(t.Context(), repoDir, "") }},
	} {
		err := tc.run()
		if err == nil {
			t.Errorf("%s: expected error for missing setup.sh", tc.name)
			continue
		}
		if !strings.Contains(err.Error(), "setup.sh not found") {
			t.Errorf("%s: unexpected error: %v", tc.name, err)
		}
	}
}

func TestEnsureCheckoutRejectsNonGitDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "fork")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A non-git directory must be refused, not silently reused (it could be an
	// unrelated path the operator did not intend as the checkout).
	err := EnsureCheckout(t.Context(), dir, "acme", "open-agentic-platform")
	if err == nil {
		t.Fatal("EnsureCheckout should reject a non-git directory")
	}
	if !strings.Contains(err.Error(), "not a git checkout") {
		t.Errorf("unexpected error: %v", err)
	}
}
