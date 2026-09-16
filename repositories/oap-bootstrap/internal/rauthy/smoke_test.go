package rauthy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// This file is the identity-phase smoke: an end-to-end exercise of the full
// admin-API sequence the `identity` phase (internal/cli/identity.go) drives,
// against a stateful in-memory fake Rauthy rather than a live 0.35 instance. It
// is the committed, `go test`-run replacement for the throwaway /tmp/oap-id-smoke
// scratch dir an earlier session used to validate the same path by hand.
//
// Unlike the per-method unit tests in rauthy_test.go, the fake here is stateful:
// created clients and scopes persist across calls, so the test can assert the
// resume contract (a second pass detects-and-skips, creating no duplicates) and
// the once-at-POST secret capture, which only mean something across a sequence.

// fakeRauthy is a minimal stateful stand-in for the Rauthy 0.35 admin API: it
// holds the clients and scopes created so far and serves the handful of endpoints
// the identity phase touches. providerOpen toggles the 0.35-vs-0.36 behaviour of
// the session-gated provider-create endpoint.
type fakeRauthy struct {
	mu           sync.Mutex
	clients      map[string]ClientPayload
	scopes       map[string]bool
	providerOpen bool // false models 0.35 (session-gated); true models 0.36+ (API open)
	createCount  int  // POST /clients calls, so the resume pass can prove no duplicates
}

func newFakeRauthy() *fakeRauthy {
	return &fakeRauthy{
		clients: map[string]ClientPayload{},
		// Seed the `oap` attribute scope the statecraft seeder makes, so the custom
		// scopes the identity phase ensures are genuinely absent on the first run.
		scopes: map[string]bool{"oap": true},
	}
}

func (f *fakeRauthy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/auth/v1/clients/"):
		id := strings.TrimPrefix(r.URL.Path, "/auth/v1/clients/")
		if c, ok := f.clients[id]; ok {
			_ = json.NewEncoder(w).Encode(c)
			return
		}
		w.WriteHeader(http.StatusNotFound)

	case r.Method == http.MethodPost && r.URL.Path == "/auth/v1/clients":
		var p ClientPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.clients[p.ID] = p
		f.createCount++
		// Rauthy mints the confidential secret once, at create, and never returns it
		// on a later GET. A public client has none.
		resp := map[string]any{"id": p.ID}
		if p.Confidential {
			resp["client_secret"] = "secret-" + p.ID
		}
		_ = json.NewEncoder(w).Encode(resp)

	case r.Method == http.MethodGet && r.URL.Path == "/auth/v1/scopes":
		out := make([]scope, 0, len(f.scopes))
		for name := range f.scopes {
			out = append(out, scope{ID: name, Name: name})
		}
		_ = json.NewEncoder(w).Encode(out)

	case r.Method == http.MethodPost && r.URL.Path == "/auth/v1/scopes":
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		name, _ := body["scope"].(string)
		f.scopes[name] = true
		_ = json.NewEncoder(w).Encode(scope{ID: name, Name: name})

	case r.Method == http.MethodPost && r.URL.Path == "/auth/v1/providers/create":
		if f.providerOpen {
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "github"})
			return
		}
		// 0.35 session-gates this endpoint for API-Key callers.
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"session required"}`))

	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// TestIdentitySmoke walks the whole identity-phase admin sequence against the
// stateful fake, then re-runs it to prove the resume/idempotency contract.
func TestIdentitySmoke(t *testing.T) {
	f := newFakeRauthy() // 0.35-style: providerOpen stays false
	srv := httptest.NewServer(f)
	defer srv.Close()

	rc := NewClient(srv.URL, "smoke-name$secret")
	ctx := context.Background()
	const appBase = "https://oap.example.com"
	ids := ClientIDs{
		SPA:     "statecraft-spa",
		M2M:     "statecraft-m2m",
		Server:  "statecraft-server",
		Sweeper: "statecraft-knowledge-sweeper-m2m-app",
	}

	// 1. Ensure the custom scopes the M2M/sweeper clients reference. Both are absent
	//    on the first run (only `oap` is seeded), so both are created.
	for _, s := range CustomScopes {
		created, err := rc.EnsureScope(ctx, s)
		if err != nil {
			t.Fatalf("EnsureScope(%s): %v", s, err)
		}
		if !created {
			t.Errorf("scope %s should be created on the first run", s)
		}
	}

	// 2. Create the four clients (each absent -> create), capturing the once-issued
	//    secret of every confidential client. The public SPA must yield no secret.
	want := DesiredClients(appBase, ids)
	secrets := map[string]string{}
	for _, p := range want {
		if _, exists, err := rc.GetClient(ctx, p.ID); err != nil {
			t.Fatalf("GetClient(%s): %v", p.ID, err)
		} else if exists {
			t.Errorf("client %s should be absent on the first run", p.ID)
		}
		secret, err := rc.CreateClient(ctx, p)
		if err != nil {
			t.Fatalf("CreateClient(%s): %v", p.ID, err)
		}
		if p.Confidential {
			if secret == "" {
				t.Errorf("confidential client %s should yield a secret at create", p.ID)
			}
			secrets[p.ID] = secret
		} else if secret != "" {
			t.Errorf("public client %s should have no secret, got %q", p.ID, secret)
		}
	}
	if len(secrets) != 3 {
		t.Errorf("want 3 captured confidential secrets, got %d", len(secrets))
	}
	// The captured secret must bind to the right client (once-at-POST, not a GET).
	if got := secrets[ids.Server]; got != "secret-"+ids.Server {
		t.Errorf("server secret = %q, want secret-%s", got, ids.Server)
	}
	if f.createCount != 4 {
		t.Errorf("first run should create 4 clients, got %d", f.createCount)
	}

	// 3. Resume: a second pass must detect everything and create nothing new.
	for _, s := range CustomScopes {
		if created, err := rc.EnsureScope(ctx, s); err != nil {
			t.Fatalf("EnsureScope(%s) on resume: %v", s, err)
		} else if created {
			t.Errorf("scope %s should already exist on resume", s)
		}
	}
	for _, p := range want {
		if _, exists, err := rc.GetClient(ctx, p.ID); err != nil {
			t.Fatalf("GetClient(%s) on resume: %v", p.ID, err)
		} else if !exists {
			t.Errorf("client %s should be detected on resume", p.ID)
		}
	}
	if f.createCount != 4 {
		t.Errorf("resume must not create clients; createCount = %d", f.createCount)
	}

	// 4. Provider leg: on a 0.35-style server it is session-gated, so the API try
	//    fails and the identity phase degrades to its guided screen.
	if ok, err := rc.TryCreateProvider(ctx, NewGitHubProvider("ghid", "ghsecret")); ok {
		t.Error("provider create should be gated (ok=false) on a 0.35-style server")
	} else if err == nil {
		t.Error("a gated provider create should return the degradation error")
	}
}

// TestIdentitySmokeProviderReprobe confirms the no-code-change re-probe: on a
// 0.36+-style server where the provider API is open, the same TryCreateProvider
// call succeeds.
func TestIdentitySmokeProviderReprobe(t *testing.T) {
	f := newFakeRauthy()
	f.providerOpen = true // 0.36+
	srv := httptest.NewServer(f)
	defer srv.Close()

	rc := NewClient(srv.URL, "smoke-name$secret")
	ok, err := rc.TryCreateProvider(context.Background(), NewGitHubProvider("ghid", "ghsecret"))
	if !ok || err != nil {
		t.Errorf("open provider API should succeed: ok=%v err=%v", ok, err)
	}
}
