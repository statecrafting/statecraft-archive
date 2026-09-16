package github

import (
	"crypto/rand"
	"encoding/base64"
	"testing"

	"golang.org/x/crypto/nacl/box"
)

func TestDefaultManifest(t *testing.T) {
	m := DefaultManifest("acme-inc", "oap.example.com", "http://localhost:5000/callback")
	if m.Name != "oap-acme-inc" {
		t.Errorf("name = %q", m.Name)
	}
	if m.HookAttributes.URL != "https://oap.example.com/api/github/webhook" {
		t.Errorf("hook url = %q", m.HookAttributes.URL)
	}
	if len(m.CallbackURLs) != 1 || m.CallbackURLs[0] != "https://auth.oap.example.com/auth/v1/providers/callback" {
		t.Errorf("callback urls = %v", m.CallbackURLs)
	}
	if m.DefaultPermissions["email_addresses"] != "read" {
		t.Error("manifest must request email_addresses:read for the Rauthy provider (D-1)")
	}
	if m.DefaultPermissions["contents"] != "read" || m.DefaultPermissions["members"] != "read" {
		t.Error("missing expected webhook permissions")
	}
	wantEvents := map[string]bool{"installation": false, "repository": false, "pull_request": false, "push": false, "workflow_run": false, "organization": false}
	for _, e := range m.DefaultEvents {
		if _, ok := wantEvents[e]; ok {
			wantEvents[e] = true
		}
	}
	for e, seen := range wantEvents {
		if !seen {
			t.Errorf("manifest missing event %q", e)
		}
	}
}

func TestSealSecretRoundTrip(t *testing.T) {
	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubB64 := base64.StdEncoding.EncodeToString(pub[:])
	const msg = "s3cret-value=="
	sealedB64, err := sealSecret(pubB64, msg)
	if err != nil {
		t.Fatalf("sealSecret: %v", err)
	}
	sealed, err := base64.StdEncoding.DecodeString(sealedB64)
	if err != nil {
		t.Fatalf("decode sealed: %v", err)
	}
	out, ok := box.OpenAnonymous(nil, sealed, pub, priv)
	if !ok {
		t.Fatal("OpenAnonymous failed")
	}
	if string(out) != msg {
		t.Errorf("decrypted = %q, want %q", out, msg)
	}
}

func TestSealSecretRejectsBadKey(t *testing.T) {
	if _, err := sealSecret("not-base64!!", "x"); err == nil {
		t.Error("expected error on invalid base64 public key")
	}
	if _, err := sealSecret(base64.StdEncoding.EncodeToString([]byte("short")), "x"); err == nil {
		t.Error("expected error on wrong-length public key")
	}
}
