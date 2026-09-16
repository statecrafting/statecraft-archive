package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
)

// Generate mints a value for a Generated key per its GenKind. It uses
// crypto/rand throughout; the shapes mirror the upstream setup.sh generators so
// a CLI-generated oap.env is interchangeable with a hand-run setup.
func Generate(kind GenKind) (string, error) {
	switch kind {
	case GenHex32:
		return randHex(32)
	case GenHex8:
		return randHex(8)
	case GenHex6:
		return randHex(6)
	case GenBase64Std32:
		b, err := randBytes(32)
		if err != nil {
			return "", err
		}
		return base64.StdEncoding.EncodeToString(b), nil
	case GenPassword:
		// base64url, no padding: URL/JSON-safe, no shell-quoting hazards.
		b, err := randBytes(24)
		if err != nil {
			return "", err
		}
		return base64.RawURLEncoding.EncodeToString(b), nil
	case GenEd25519PEMB64:
		pemStr, err := ed25519PEM()
		if err != nil {
			return "", err
		}
		// base64 the whole PEM to a single line so the value is safe in a
		// dotenv file (SOPS dotenv and bash `source` both reject embedded
		// newlines). The platform-phase bridge base64-decodes it for setup.sh.
		return base64.StdEncoding.EncodeToString([]byte(pemStr)), nil
	case GenKID:
		h, err := randHex(4)
		if err != nil {
			return "", err
		}
		return "fk-" + h, nil
	case GenNone:
		return "", fmt.Errorf("key has no generator")
	default:
		return "", fmt.Errorf("unknown GenKind %d", kind)
	}
}

func randBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("crypto/rand: %w", err)
	}
	return b, nil
}

func randHex(n int) (string, error) {
	b, err := randBytes(n)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ed25519PEM generates an ed25519 private key as a PKCS#8 PEM block, the shape
// the factory signing authority expects.
func ed25519PEM() (string, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("ed25519: %w", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", fmt.Errorf("pkcs8: %w", err)
	}
	block := &pem.Block{Type: "PRIVATE KEY", Bytes: der}
	return string(pem.EncodeToMemory(block)), nil
}
