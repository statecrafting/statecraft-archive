package verify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// noFollow mirrors the client the verify command builds: capture the first
// response rather than chasing redirects, so a 302 reports as a 302.
func noFollow() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func TestPlatformEndpoints(t *testing.T) {
	eps := PlatformEndpoints("oap.example.com")
	want := []string{
		"https://oap.example.com/",
		"https://deploy.oap.example.com/",
		"https://auth.oap.example.com/",
		"https://oap.example.com/api/github/webhook",
	}
	if len(eps) != len(want) {
		t.Fatalf("got %d endpoints, want %d", len(eps), len(want))
	}
	for i, w := range want {
		if eps[i].URL != w {
			t.Errorf("endpoint %d url = %q, want %q", i, eps[i].URL, w)
		}
	}
	// A blank domain yields nothing rather than a bogus "https:///" probe.
	if got := PlatformEndpoints("  "); got != nil {
		t.Errorf("blank domain should yield no endpoints, got %v", got)
	}
	// A trailing dot (FQDN form) is trimmed so the URL is well-formed.
	if got := PlatformEndpoints("oap.example.com."); len(got) == 0 || got[0].URL != "https://oap.example.com/" {
		t.Errorf("trailing dot not trimmed: %v", got)
	}
}

// TestCheckEndpointClassification is the load-bearing health-bar test: a server
// answering below 500 (including auth-gated 4xx) passes; a 5xx fails; and the
// status code is always surfaced in Detail.
func TestCheckEndpointClassification(t *testing.T) {
	cases := []struct {
		name   string
		status int
		wantOK bool
	}{
		{"ok", 200, true},
		{"redirect", 302, true},
		{"unauthorized", 401, true},
		{"notfound", 404, true},
		{"method-not-allowed", 405, true}, // webhook GET rejected by contract
		{"server-error", 500, false},
		{"bad-gateway", 502, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(c.status)
			}))
			defer srv.Close()
			r := CheckEndpoint(context.Background(), noFollow(), Endpoint{Name: c.name, URL: srv.URL})
			if r.OK != c.wantOK {
				t.Errorf("status %d: OK = %v, want %v (detail %q)", c.status, r.OK, c.wantOK, r.Detail)
			}
			if !strings.Contains(r.Detail, "HTTP") {
				t.Errorf("detail should surface the status code: %q", r.Detail)
			}
		})
	}
}

// TestCheckEndpointUnreachable: a transport failure (nothing listening) always
// fails, distinct from a server-up-but-erroring 5xx.
func TestCheckEndpointUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing listens at url now
	r := CheckEndpoint(context.Background(), noFollow(), Endpoint{Name: "down", URL: url})
	if r.OK {
		t.Errorf("a closed server should fail, got OK (detail %q)", r.Detail)
	}
	if !strings.Contains(r.Detail, "unreachable") {
		t.Errorf("detail should mark unreachable: %q", r.Detail)
	}
}

func TestAllOK(t *testing.T) {
	if AllOK(nil) {
		t.Error("empty results should not be AllOK (nothing was verified)")
	}
	if !AllOK([]Result{{OK: true}, {OK: true}}) {
		t.Error("all-pass should be AllOK")
	}
	if AllOK([]Result{{OK: true}, {OK: false}}) {
		t.Error("a single failure should break AllOK")
	}
}
