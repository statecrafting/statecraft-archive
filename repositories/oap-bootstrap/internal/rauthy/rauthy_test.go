package rauthy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func clientByID(cs []ClientPayload, id string) (ClientPayload, bool) {
	for _, c := range cs {
		if c.ID == id {
			return c, true
		}
	}
	return ClientPayload{}, false
}

func has(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

func TestDesiredClientsShapes(t *testing.T) {
	ids := ClientIDs{SPA: "spa", M2M: "m2m", Server: "srv", Sweeper: "sweep"}
	cs := DesiredClients("https://oap.example.com", ids)
	if len(cs) != 4 {
		t.Fatalf("want 4 clients, got %d", len(cs))
	}

	spa, _ := clientByID(cs, "spa")
	if spa.Confidential {
		t.Error("SPA must be public")
	}
	if !has(spa.FlowsEnabled, "authorization_code") || len(spa.FlowsEnabled) != 1 {
		t.Errorf("SPA flows = %v", spa.FlowsEnabled)
	}
	if !has(spa.RedirectURIs, "https://oap.example.com/auth/callback") {
		t.Errorf("SPA redirect = %v", spa.RedirectURIs)
	}
	if !has(spa.Challenges, "S256") {
		t.Error("SPA (public authorization_code) must require PKCE S256")
	}

	srv, _ := clientByID(cs, "srv")
	if !srv.Confidential {
		t.Error("server must be confidential")
	}
	if !has(srv.FlowsEnabled, "authorization_code") || !has(srv.FlowsEnabled, "refresh_token") {
		t.Errorf("server flows = %v", srv.FlowsEnabled)
	}
	if !has(srv.RedirectURIs, "https://oap.example.com/auth/rauthy/callback") ||
		!has(srv.RedirectURIs, "https://oap.example.com/auth/oidc/callback") {
		t.Errorf("server redirect = %v", srv.RedirectURIs)
	}

	m2m, _ := clientByID(cs, "m2m")
	if !m2m.Confidential || !has(m2m.FlowsEnabled, "client_credentials") {
		t.Errorf("m2m shape wrong: %+v", m2m)
	}
	// default_scopes is load-bearing: Rauthy 0.35 only mints it on client_credentials.
	if !has(m2m.DefaultScopes, "deployd:deploy") {
		t.Errorf("m2m default_scopes = %v, want deployd:deploy", m2m.DefaultScopes)
	}

	sweep, _ := clientByID(cs, "sweep")
	if !has(sweep.DefaultScopes, "platform:knowledge:sweep") {
		t.Errorf("sweeper default_scopes = %v", sweep.DefaultScopes)
	}

	// No client may ever enable the password grant.
	for _, c := range cs {
		if has(c.FlowsEnabled, "password") {
			t.Errorf("client %s must not enable password grant", c.ID)
		}
	}
}

func TestExtractSecret(t *testing.T) {
	cases := []struct {
		body string
		want string
	}{
		{`{"secret":"s1"}`, "s1"},
		{`{"client_secret":"s2"}`, "s2"},
		{`{"clientSecret":"s3"}`, "s3"},
		{`{"id":"x"}`, ""},
		{`not json`, ""},
	}
	for _, c := range cases {
		if got := extractSecret([]byte(c.body)); got != c.want {
			t.Errorf("extractSecret(%s) = %q, want %q", c.body, got, c.want)
		}
	}
}

func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := NewClient("test-token-name$secret", "test-token-name$secret")
	c.base = srv.URL
	return c
}

func TestAuthHeaderIsAPIKey(t *testing.T) {
	var gotAuth string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(404)
	})
	_, _, _ = c.GetClient(context.Background(), "x")
	if gotAuth != "API-Key test-token-name$secret" {
		t.Errorf("auth header = %q, want API-Key form", gotAuth)
	}
}

func TestGetClient404IsAbsent(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/present") {
			_ = json.NewEncoder(w).Encode(ClientPayload{ID: "present", Confidential: true})
			return
		}
		w.WriteHeader(404)
	})
	_, ok, err := c.GetClient(context.Background(), "absent")
	if err != nil || ok {
		t.Errorf("absent client: ok=%v err=%v, want ok=false err=nil", ok, err)
	}
	p, ok, err := c.GetClient(context.Background(), "present")
	if err != nil || !ok || p.ID != "present" {
		t.Errorf("present client: ok=%v err=%v p=%+v", ok, err, p)
	}
}

func TestCreateClientCapturesSecret(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/auth/v1/clients" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":"srv","client_secret":"the-secret"}`))
	})
	secret, err := c.CreateClient(context.Background(), ClientPayload{ID: "srv", Confidential: true})
	if err != nil {
		t.Fatalf("CreateClient: %v", err)
	}
	if secret != "the-secret" {
		t.Errorf("secret = %q, want the-secret", secret)
	}
}

func TestEnsureScopeDetectOrCreate(t *testing.T) {
	t.Run("absent->created", func(t *testing.T) {
		var posted bool
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case "GET":
				_ = json.NewEncoder(w).Encode([]scope{{ID: "1", Name: "oap"}})
			case "POST":
				posted = true
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["scope"] != "deployd:deploy" {
					t.Errorf("create scope body = %v", body)
				}
				_ = json.NewEncoder(w).Encode(scope{ID: "2", Name: "deployd:deploy"})
			}
		})
		created, err := c.EnsureScope(context.Background(), "deployd:deploy")
		if err != nil || !created || !posted {
			t.Errorf("absent scope: created=%v posted=%v err=%v", created, posted, err)
		}
	})
	t.Run("present->noop", func(t *testing.T) {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" {
				t.Error("must not POST when the scope already exists")
			}
			_ = json.NewEncoder(w).Encode([]scope{{ID: "1", Name: "deployd:deploy"}})
		})
		created, err := c.EnsureScope(context.Background(), "deployd:deploy")
		if err != nil || created {
			t.Errorf("present scope: created=%v err=%v, want created=false", created, err)
		}
	})
}
