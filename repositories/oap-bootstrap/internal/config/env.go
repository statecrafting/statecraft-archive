package config

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Config holds resolved key/value state. It is the in-memory form of oap.env.
type Config struct {
	vals  map[string]string
	order []string // insertion order for keys not in Registry (forward-compat)
}

// New returns an empty Config.
func New() *Config { return &Config{vals: map[string]string{}} }

// Get returns the value for name, or "" if unset.
func (c *Config) Get(name string) string { return c.vals[name] }

// Has reports whether name is set to a non-empty value.
func (c *Config) Has(name string) bool { return strings.TrimSpace(c.vals[name]) != "" }

// Set stores a value, tracking order for unknown (non-Registry) keys.
func (c *Config) Set(name, val string) {
	if _, known := c.vals[name]; !known {
		if _, inReg := Lookup(name); !inReg {
			c.order = append(c.order, name)
		}
	}
	c.vals[name] = val
}

// EnsureGenerated mints any Generated key that is currently empty.
func (c *Config) EnsureGenerated() error {
	for _, k := range Registry {
		if k.Prov != Generated || c.Has(k.Name) {
			continue
		}
		v, err := Generate(k.Gen)
		if err != nil {
			return fmt.Errorf("generate %s: %w", k.Name, err)
		}
		c.Set(k.Name, v)
	}
	return nil
}

// RefreshDerived recomputes every Derived key from current inputs.
func (c *Config) RefreshDerived() {
	for _, k := range Registry {
		if k.Prov != Derived || k.Derive == nil {
			continue
		}
		c.Set(k.Name, k.Derive(c.Get))
	}
}

// MissingRequired returns the names of required keys that are unset. A key in an
// optional group is required only once any member of its group is set.
func (c *Config) MissingRequired() []string {
	groupActive := map[string]bool{}
	for _, k := range Registry {
		if k.Group != "" && c.Has(k.Name) {
			groupActive[k.Group] = true
		}
	}
	var missing []string
	for _, k := range Registry {
		switch {
		case c.Has(k.Name):
			continue
		case k.Required:
			missing = append(missing, k.Name)
		case k.Group != "" && groupActive[k.Group]:
			// a partially-filled optional group is incomplete
			missing = append(missing, k.Name)
		}
	}
	return missing
}

// SecretKeyNames returns the names of every secret-classed key, used to scope
// SOPS encryption (encrypted_regex).
func SecretKeyNames() []string {
	var out []string
	for _, k := range Registry {
		if k.Secret {
			out = append(out, k.Name)
		}
	}
	sort.Strings(out)
	return out
}

// --- dotenv serialization (SOPS-dotenv compatible: plain KEY=VALUE, one line) ---
//
// oap.env at rest is stored in the simple dotenv form SOPS understands: one
// `KEY=VALUE` per line, the value taken verbatim to end of line, no quoting and
// no multi-line values (the one PEM secret is base64'd to a single line). bash
// `source` quoting is applied only by the future setup.sh temp-file bridge, not
// here, so it never collides with SOPS's parser.

// OrderedKeys returns the names of every set key in serialization order
// (Registry order first, then any forward-compat keys in insertion order). It
// lets a consumer iterate the config without reaching into its internals; the
// setup.sh temp-file bridge uses it to emit shell-quoted lines.
func (c *Config) OrderedKeys() []string {
	var out []string
	for _, k := range Registry {
		if _, ok := c.vals[k.Name]; ok {
			out = append(out, k.Name)
		}
	}
	out = append(out, c.order...)
	return out
}

// Serialize renders the config as a plain dotenv document in Registry order.
func (c *Config) Serialize() []byte {
	var b bytes.Buffer
	for _, k := range Registry {
		if v, ok := c.vals[k.Name]; ok {
			fmt.Fprintf(&b, "%s=%s\n", k.Name, v)
		}
	}
	for _, name := range c.order {
		fmt.Fprintf(&b, "%s=%s\n", name, c.vals[name])
	}
	return b.Bytes()
}

// Parse reads a dotenv document. Blank lines and `#` comments are skipped; an
// optional `export ` prefix and surrounding quotes on a value are tolerated so
// hand-authored seeds parse cleanly.
func Parse(data []byte) (*Config, error) {
	c := New()
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := stripMatchingQuotes(line[eq+1:])
		if key != "" {
			c.Set(key, val)
		}
	}
	return c, nil
}

func stripMatchingQuotes(v string) string {
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			return v[1 : len(v)-1]
		}
	}
	return v
}

// --- vaults: how oap.env is stored at rest ---

// Vault encrypts/decrypts the oap.env document at rest.
type Vault interface {
	Name() string
	Decrypt(raw []byte) ([]byte, error)
	Encrypt(plaintext []byte, secretKeys []string) ([]byte, error)
}

// PlainVault stores the document in cleartext. Used only when SOPS+age are
// unavailable; the CLI warns when it falls back to this.
type PlainVault struct{}

func (PlainVault) Name() string                       { return "plaintext" }
func (PlainVault) Decrypt(raw []byte) ([]byte, error) { return raw, nil }
func (PlainVault) Encrypt(pt []byte, _ []string) ([]byte, error) {
	return pt, nil
}

// SopsVault shells out to the `sops` binary, encrypting only secret-classed keys
// with the operator's age key (Decision D-2). It matches the upstream
// prerequisite of sops + age on PATH.
type SopsVault struct {
	AgeRecipient string // public age key (age1...), used to encrypt
	KeyFile      string // path to the age private key file, used to decrypt
}

func (SopsVault) Name() string { return "sops+age" }

// env points sops at the resolved age key file regardless of the OS default
// location (macOS sops defaults to ~/Library/Application Support, while the
// operator key and upstream convention live at ~/.config/sops/age/keys.txt).
func (v SopsVault) env() []string {
	if v.KeyFile == "" {
		return os.Environ()
	}
	return append(os.Environ(), "SOPS_AGE_KEY_FILE="+v.KeyFile)
}

func (v SopsVault) Decrypt(raw []byte) ([]byte, error) {
	cmd := exec.Command("sops", "-d", "--input-type", "dotenv", "--output-type", "dotenv", "/dev/stdin")
	cmd.Stdin = bytes.NewReader(raw)
	cmd.Env = v.env()
	out, err := cmd.Output()
	if err != nil {
		return nil, sopsErr("decrypt", err)
	}
	return out, nil
}

func (v SopsVault) Encrypt(pt []byte, secretKeys []string) ([]byte, error) {
	regex := "^(" + strings.Join(secretKeys, "|") + ")$"
	args := []string{"-e", "--input-type", "dotenv", "--output-type", "dotenv",
		"--age", v.AgeRecipient, "--encrypted-regex", regex, "/dev/stdin"}
	cmd := exec.Command("sops", args...)
	cmd.Stdin = bytes.NewReader(pt)
	cmd.Env = v.env()
	out, err := cmd.Output()
	if err != nil {
		return nil, sopsErr("encrypt", err)
	}
	return out, nil
}

func sopsErr(op string, err error) error {
	if ee, ok := err.(*exec.ExitError); ok {
		return fmt.Errorf("sops %s failed: %s", op, strings.TrimSpace(string(ee.Stderr)))
	}
	return fmt.Errorf("sops %s: %w", op, err)
}

// SopsAvailable reports whether `sops` is on PATH and an age key is resolvable,
// returning the derived public recipient and the private key file path when so.
func SopsAvailable() (recipient, keyFile string, ok bool) {
	if _, err := exec.LookPath("sops"); err != nil {
		return "", "", false
	}
	keyFile = os.Getenv("SOPS_AGE_KEY_FILE")
	if keyFile == "" {
		home, _ := os.UserHomeDir()
		keyFile = filepath.Join(home, ".config", "sops", "age", "keys.txt")
	}
	if _, err := os.Stat(keyFile); err != nil {
		return "", "", false
	}
	if _, err := exec.LookPath("age-keygen"); err != nil {
		return "", "", false
	}
	out, err := exec.Command("age-keygen", "-y", keyFile).Output()
	if err != nil {
		return "", "", false
	}
	return strings.TrimSpace(string(out)), keyFile, true
}

// isEncrypted reports whether a stored document carries SOPS metadata.
func isEncrypted(raw []byte) bool {
	return bytes.Contains(raw, []byte("sops_version")) || bytes.Contains(raw, []byte("sops_mac"))
}

// Load reads oap.env from path, decrypting if it is SOPS-encrypted. A missing
// file yields an empty Config (not an error).
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return New(), nil
	}
	if err != nil {
		return nil, err
	}
	if isEncrypted(raw) {
		recip, keyFile, ok := SopsAvailable()
		if !ok {
			return nil, fmt.Errorf("%s is SOPS-encrypted but sops/age are unavailable to decrypt it", path)
		}
		plain, derr := SopsVault{AgeRecipient: recip, KeyFile: keyFile}.Decrypt(raw)
		if derr != nil {
			return nil, derr
		}
		return Parse(plain)
	}
	return Parse(raw)
}

// Save writes oap.env to path through the given vault, with 0600 permissions.
func Save(path string, c *Config, v Vault) error {
	doc := c.Serialize()
	enc, err := v.Encrypt(doc, SecretKeyNames())
	if err != nil {
		return err
	}
	return os.WriteFile(path, enc, 0o600)
}

// SelectVault returns the SOPS vault when available, else the plaintext vault
// plus a human warning describing the downgrade.
func SelectVault() (Vault, string) {
	if recip, keyFile, ok := SopsAvailable(); ok {
		return SopsVault{AgeRecipient: recip, KeyFile: keyFile}, ""
	}
	return PlainVault{}, "sops/age unavailable: oap.env secrets will be stored in CLEARTEXT (install sops + age, or set SOPS_AGE_KEY_FILE)"
}
