// Package github is a thin REST client for the operations the `github` phase
// needs: fork the upstream repo, register a GitHub App via the manifest flow,
// and set Actions secrets/variables. It is intentionally small (net/http +
// encoding/json) rather than a full SDK; only Actions secret sealing pulls a
// dependency (golang.org/x/crypto/nacl/box). See spec 001 section 3.4 (github).
package github

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

const apiBase = "https://api.github.com"

// Client talks to the GitHub REST API with a bearer token.
type Client struct {
	token string
	base  string
	http  *http.Client
}

// NewClient returns a client authenticated with token.
func NewClient(token string) *Client {
	return &Client{
		token: token,
		base:  apiBase,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

// do issues a request, JSON-encoding body and decoding into out (when non-nil).
// It returns the HTTP status and a descriptive error on a non-2xx response.
func (c *Client) do(ctx context.Context, method, path string, body, out any) (int, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, fmt.Errorf("encode %s body: %w", path, err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return 0, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("github %s %s: %d %s", method, path, resp.StatusCode, snippet(data))
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return resp.StatusCode, fmt.Errorf("decode %s response: %w", path, err)
		}
	}
	return resp.StatusCode, nil
}

// snippet trims an error body to a single readable line.
func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 300 {
		s = s[:300] + "..."
	}
	return s
}
