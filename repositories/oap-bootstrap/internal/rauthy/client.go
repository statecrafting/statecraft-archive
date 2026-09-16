// Package rauthy is a thin admin-API client for the `identity` phase: it creates
// the OIDC clients the operator otherwise hand-builds in the Rauthy admin UI
// before the statecraft seeder can grant them scopes. It mirrors the upstream
// statecraft admin-client wrapper (api/auth/rauthyAdminClients.ts) and the
// T003-validated Rauthy 0.35 client schema. net/http + encoding/json, no SDK.
// See spec 001 section 3.4 (identity, Phase 2a).
package rauthy

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

// Client talks to the Rauthy admin API. Auth is an API key, NOT a bearer token:
// Rauthy expects `Authorization: API-Key <name>$<secret>`. The admin token is
// already in `name$secret` form (the name is the prefix before `$`), so it is
// used verbatim, matching the upstream seeder's buildAdminAuthHeader.
type Client struct {
	base string
	auth string
	http *http.Client
}

// NewClient returns a client for baseURL (e.g. https://auth.example.com) using
// adminToken in `name$secret` form.
func NewClient(baseURL, adminToken string) *Client {
	return &Client{
		base: strings.TrimRight(baseURL, "/"),
		auth: "API-Key " + strings.TrimSpace(adminToken),
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// do issues a request and returns the HTTP status and raw body. Transport and
// encode failures are errors; HTTP status (including 404, which callers treat as
// "absent") is conveyed via the returned status so detect-or-skip can branch.
func (c *Client) do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode %s body: %w", path, err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", c.auth)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data, nil
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 300 {
		s = s[:300] + "..."
	}
	return s
}
