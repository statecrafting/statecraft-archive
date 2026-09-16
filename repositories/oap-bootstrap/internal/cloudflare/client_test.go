package cloudflare

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlatformARecords(t *testing.T) {
	got := PlatformARecords("oap.example.com")
	want := []string{
		"oap.example.com",
		"auth.oap.example.com",
		"deploy.oap.example.com",
		"minio.oap.example.com",
		"*.tenants.oap.example.com",
	}
	if len(got) != len(want) {
		t.Fatalf("got %d records, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("record[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if PlatformARecords("  ") != nil {
		t.Error("blank domain should yield no records")
	}
}

// newTestClient points a Client at an httptest server emulating the slice of the
// Cloudflare v4 API the dns phase uses.
func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := NewClient("test-token")
	c.base = srv.URL
	return c
}

func cfOK(w http.ResponseWriter, result any) {
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "errors": []any{}, "result": result})
}

func TestZoneIDWalksSuffixes(t *testing.T) {
	// Only the registrable zone example.com exists; a delegated-subdomain DOMAIN
	// (oap.example.com) must still resolve by walking up to it.
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || !strings.HasPrefix(r.URL.Path, "/zones") {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		switch r.URL.Query().Get("name") {
		case "example.com":
			cfOK(w, []zone{{ID: "zone123", Name: "example.com"}})
		default:
			cfOK(w, []zone{})
		}
	})
	id, err := c.ZoneID(context.Background(), "auth.oap.example.com")
	if err != nil {
		t.Fatalf("ZoneID: %v", err)
	}
	if id != "zone123" {
		t.Errorf("ZoneID = %q, want zone123", id)
	}

	if _, err := c.ZoneID(context.Background(), "auth.unknown-domain.net"); err == nil {
		t.Error("ZoneID should error when no suffix matches a zone")
	}
}

func TestUpsertACreateUpdateUnchanged(t *testing.T) {
	cases := []struct {
		name       string
		existing   []dnsRecord
		wantAction string
		wantMethod string // the mutating call expected ("" = none)
	}{
		{"create", nil, "created", "POST"},
		{"update", []dnsRecord{{ID: "rec1", Type: "A", Name: "auth.example.com", Content: "9.9.9.9"}}, "updated", "PUT"},
		{"unchanged", []dnsRecord{{ID: "rec1", Type: "A", Name: "auth.example.com", Content: "1.2.3.4", Proxied: false}}, "unchanged", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var sawMethod string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == "GET":
					cfOK(w, tc.existing)
				case r.Method == "POST" || r.Method == "PUT":
					sawMethod = r.Method
					// the mutating body must carry proxied=false (DNS-only)
					var body dnsRecord
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body.Proxied {
						t.Error("A record must be DNS-only (proxied=false)")
					}
					if body.Content != "1.2.3.4" {
						t.Errorf("body content = %q, want 1.2.3.4", body.Content)
					}
					cfOK(w, dnsRecord{ID: "rec1"})
				default:
					t.Errorf("unexpected method %s", r.Method)
				}
			})
			action, err := c.UpsertA(context.Background(), "zone123", "auth.example.com", "1.2.3.4")
			if err != nil {
				t.Fatalf("UpsertA: %v", err)
			}
			if action != tc.wantAction {
				t.Errorf("action = %q, want %q", action, tc.wantAction)
			}
			if sawMethod != tc.wantMethod {
				t.Errorf("mutating call = %q, want %q", sawMethod, tc.wantMethod)
			}
		})
	}
}

func TestDoSurfacesEnvelopeErrors(t *testing.T) {
	// A 200 with success=false still carries actionable errors.
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"errors":  []apiError{{Code: 9109, Message: "Invalid access token"}},
		})
	})
	if _, err := c.ZoneID(context.Background(), "example.com"); err == nil || !strings.Contains(err.Error(), "9109") {
		t.Errorf("expected an error carrying the CF error code, got %v", err)
	}
}
