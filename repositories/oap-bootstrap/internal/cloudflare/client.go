// Package cloudflare is a thin REST client for the one thing the `dns` phase
// automates: upserting the platform's A records to the cluster's node IP. OAP
// itself never calls the Cloudflare API (cert-manager's DNS-01 solver handles
// ACME validation); this client only fills the "point the records at the node"
// gap setup.sh leaves to the operator. net/http + encoding/json, no SDK. See
// spec 001 section 3.4 (dns, Phase 1c).
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiBase = "https://api.cloudflare.com/client/v4"

// Client talks to the Cloudflare v4 API with a bearer token (a Zone:DNS:Edit
// scoped token is sufficient and is all the spec asks the operator to mint).
type Client struct {
	token string
	base  string
	http  *http.Client
}

// NewClient returns a client authenticated with token.
func NewClient(token string) *Client {
	return &Client{token: token, base: apiBase, http: &http.Client{Timeout: 30 * time.Second}}
}

// envelope is the Cloudflare response wrapper. Every endpoint returns it; a
// 2xx with success=false still carries actionable errors, so both are checked.
type envelope struct {
	Success bool            `json:"success"`
	Errors  []apiError      `json:"errors"`
	Result  json.RawMessage `json:"result"`
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e apiError) String() string { return fmt.Sprintf("%d %s", e.Code, e.Message) }

// do issues a request and returns the decoded `result` payload, failing on a
// non-2xx status or a success=false envelope.
func (c *Client) do(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode %s body: %w", path, err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var env envelope
	if len(data) > 0 {
		_ = json.Unmarshal(data, &env)
	}
	if resp.StatusCode >= 300 || !env.Success {
		return nil, fmt.Errorf("cloudflare %s %s: %d %s", method, path, resp.StatusCode, joinErrors(env.Errors, data))
	}
	return env.Result, nil
}

func joinErrors(errs []apiError, raw []byte) string {
	if len(errs) == 0 {
		return snippet(raw)
	}
	parts := make([]string, len(errs))
	for i, e := range errs {
		parts[i] = e.String()
	}
	return strings.Join(parts, "; ")
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 300 {
		s = s[:300] + "..."
	}
	return s
}

type zone struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ZoneID resolves the Cloudflare zone that owns host by walking up the DNS
// suffixes (auth.oap.example.com -> oap.example.com -> example.com) until a zone
// matches. This handles both an apex DOMAIN and a delegated-subdomain DOMAIN
// without the caller having to know the registrable boundary.
func (c *Client) ZoneID(ctx context.Context, host string) (string, error) {
	host = strings.TrimSuffix(strings.TrimSpace(host), ".")
	for cand := host; strings.Count(cand, ".") >= 1; cand = cand[strings.IndexByte(cand, '.')+1:] {
		zones, err := c.listZones(ctx, cand)
		if err != nil {
			return "", err
		}
		if len(zones) > 0 {
			return zones[0].ID, nil
		}
	}
	return "", fmt.Errorf("no Cloudflare zone found for %s or any parent suffix; check the token covers this zone", host)
}

func (c *Client) listZones(ctx context.Context, name string) ([]zone, error) {
	res, err := c.do(ctx, "GET", "/zones?name="+name+"&status=active", nil)
	if err != nil {
		return nil, err
	}
	var zs []zone
	if err := json.Unmarshal(res, &zs); err != nil {
		return nil, fmt.Errorf("decode zones: %w", err)
	}
	return zs, nil
}

type dnsRecord struct {
	ID      string `json:"id,omitempty"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	TTL     int    `json:"ttl"`
	Proxied bool   `json:"proxied"`
}

// UpsertA creates or updates an A record name -> ip in the zone, returning the
// action taken ("created", "updated", or "unchanged"). Records are DNS-only
// (proxied=false): the cluster terminates TLS and cert-manager's HTTP-01 solver
// needs the node directly reachable, so the Cloudflare proxy must stay off. The
// operation is idempotent, which is what makes the whole phase re-runnable.
func (c *Client) UpsertA(ctx context.Context, zoneID, name, ip string) (string, error) {
	existing, err := c.listARecords(ctx, zoneID, name)
	if err != nil {
		return "", err
	}
	body := dnsRecord{Type: "A", Name: name, Content: ip, TTL: 1, Proxied: false}
	if len(existing) > 0 {
		if existing[0].Content == ip && !existing[0].Proxied {
			return "unchanged", nil
		}
		if _, err := c.do(ctx, "PUT", "/zones/"+zoneID+"/dns_records/"+existing[0].ID, body); err != nil {
			return "", err
		}
		return "updated", nil
	}
	if _, err := c.do(ctx, "POST", "/zones/"+zoneID+"/dns_records", body); err != nil {
		return "", err
	}
	return "created", nil
}

func (c *Client) listARecords(ctx context.Context, zoneID, name string) ([]dnsRecord, error) {
	res, err := c.do(ctx, "GET", "/zones/"+zoneID+"/dns_records?type=A&name="+name, nil)
	if err != nil {
		return nil, err
	}
	var recs []dnsRecord
	if err := json.Unmarshal(res, &recs); err != nil {
		return nil, fmt.Errorf("decode dns_records: %w", err)
	}
	return recs, nil
}
