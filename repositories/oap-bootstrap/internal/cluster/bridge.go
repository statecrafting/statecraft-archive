// Package cluster wraps the forked repo's setup.sh Phase 1 (hetzner-k3s create,
// flux bootstrap, post-create infra). It does NOT reimplement any of that bash
// in Go (spec 001 SC-005); it bridges oap.env into the form setup.sh sources,
// runs the script, and captures back the values Phase 1 produces (NODE_IP, the
// kubeconfig). See spec 001 section 3.4 (cluster, Phase 1b).
package cluster

import (
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/bartekus/oap-bootstrap/internal/config"
)

// WriteBridgeEnv writes cfg to a 0600 plaintext .env at path for setup.sh to
// `source`. This is the decrypt-to-0600 half of the spec 001 D-2 bridge: oap.env
// is SOPS-encrypted at rest, but setup.sh sources a cleartext .env, so the CLI
// materialises one with owner-only permissions for the duration of the phase.
//
// Every value is single-quote-escaped and `export`ed: single-quoting is the only
// shell quoting that is safe for arbitrary bytes (tokens, base64 with =/+/, the
// one-line PEM), and exporting is required so the subprocesses setup.sh spawns
// (hetzner-k3s, flux, kubectl) inherit the values from their environment, not
// just setup.sh's shell.
//
// It returns a Shred closure the caller MUST defer: it securely removes the
// plaintext file (the decrypt-to-0600-then-shred path) so the cleartext secrets
// do not outlive the phase.
func WriteBridgeEnv(path string, cfg *config.Config) (shred func() error, err error) {
	var b strings.Builder
	for _, name := range cfg.OrderedKeys() {
		b.WriteString("export ")
		b.WriteString(name)
		b.WriteByte('=')
		b.WriteString(shellSingleQuote(cfg.Get(name)))
		b.WriteByte('\n')
	}
	// O_EXCL is deliberately NOT used: the bridge is idempotent across re-runs of
	// the cluster phase and a stale .env from a crashed prior run must be
	// overwritten, not refused. 0600 is enforced even if the file pre-existed.
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		return nil, fmt.Errorf("write bridge env %s: %w", path, err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, fmt.Errorf("chmod bridge env %s: %w", path, err)
	}
	return func() error { return shredFile(path) }, nil
}

// shellSingleQuote wraps s in single quotes, escaping any embedded single quote
// as the standard '\” idiom, so the result is a single shell word that
// reproduces s verbatim under `source`.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// shredFile overwrites a file's bytes with random data before unlinking it, so
// the cleartext secrets are not trivially recoverable from the freed blocks.
// This is a portable best effort (no `shred(1)` on macOS); on a copy-on-write or
// log-structured filesystem the overwrite may not hit the original blocks, but
// it removes the file from the namespace and clears the most obvious recovery
// path. A missing file is not an error (the phase may shred twice via defer).
func shredFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Mode().IsRegular() && info.Size() > 0 {
		if f, err := os.OpenFile(path, os.O_WRONLY, 0o600); err == nil {
			_, _ = io.CopyN(f, rand.Reader, info.Size())
			_ = f.Sync()
			_ = f.Close()
		}
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove bridge env %s: %w", path, err)
	}
	return nil
}
