package github

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/nacl/box"
)

type actionsPublicKey struct {
	KeyID string `json:"key_id"`
	Key   string `json:"key"` // base64-encoded 32-byte NaCl public key
}

// SetSecret creates or updates a repository Actions secret. The value is sealed
// against the repo's public key with a NaCl anonymous (sealed) box, the scheme
// GitHub requires.
func (c *Client) SetSecret(ctx context.Context, owner, repo, name, value string) error {
	var pk actionsPublicKey
	if _, err := c.do(ctx, "GET", "/repos/"+owner+"/"+repo+"/actions/secrets/public-key", nil, &pk); err != nil {
		return fmt.Errorf("fetch actions public key: %w", err)
	}
	sealed, err := sealSecret(pk.Key, value)
	if err != nil {
		return err
	}
	body := map[string]string{"encrypted_value": sealed, "key_id": pk.KeyID}
	if _, err := c.do(ctx, "PUT", "/repos/"+owner+"/"+repo+"/actions/secrets/"+name, body, nil); err != nil {
		return fmt.Errorf("put secret %s: %w", name, err)
	}
	return nil
}

// SetVariable creates or updates a repository Actions variable (non-secret).
func (c *Client) SetVariable(ctx context.Context, owner, repo, name, value string) error {
	// Try create; if it already exists (409), update via PATCH.
	body := map[string]string{"name": name, "value": value}
	status, err := c.do(ctx, "POST", "/repos/"+owner+"/"+repo+"/actions/variables", body, nil)
	if status == 409 {
		_, err = c.do(ctx, "PATCH", "/repos/"+owner+"/"+repo+"/actions/variables/"+name,
			map[string]string{"value": value}, nil)
	}
	if err != nil {
		return fmt.Errorf("set variable %s: %w", name, err)
	}
	return nil
}

// sealSecret encrypts value for the GitHub Actions public key (base64, 32 bytes)
// using crypto_box_seal (NaCl sealed box), returning base64 ciphertext.
func sealSecret(pubKeyB64, value string) (string, error) {
	pub, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return "", fmt.Errorf("decode public key: %w", err)
	}
	if len(pub) != 32 {
		return "", fmt.Errorf("public key is %d bytes, want 32", len(pub))
	}
	var pk [32]byte
	copy(pk[:], pub)
	sealed, err := box.SealAnonymous(nil, []byte(value), &pk, rand.Reader)
	if err != nil {
		return "", fmt.Errorf("seal: %w", err)
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}
