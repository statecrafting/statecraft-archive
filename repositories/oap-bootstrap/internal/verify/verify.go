// Package verify is the post-deploy smoke check for a provisioned OAP instance:
// the three public service ingresses (statecraft, deployd-api, Rauthy) plus the
// GitHub webhook receiver must answer over a valid TLS chain. A successful
// `client.Do` validates the server certificate, so a reachable endpoint also
// proves cert-manager issued and the chain is trusted from outside the cluster.
// See spec 001 section 3.4 (verify).
package verify

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Result is the outcome of one verify check.
type Result struct {
	Name   string
	OK     bool
	Detail string
}

// Endpoint is one public HTTP target the verify phase probes.
type Endpoint struct {
	Name string
	URL  string
}

// PlatformEndpoints returns the public targets derived from DOMAIN, mirroring the
// ingress topology setup.sh prints at the end of a Phase-2 deploy: the statecraft
// apex, the deployd-api orchestrator, the Rauthy OIDC provider, and the GitHub
// webhook receiver (https://<domain>/api/github/webhook, setup.sh:466). Order is
// stable so the report is deterministic.
func PlatformEndpoints(domain string) []Endpoint {
	d := strings.TrimSuffix(strings.TrimSpace(domain), ".")
	if d == "" {
		return nil
	}
	return []Endpoint{
		{Name: "statecraft", URL: "https://" + d + "/"},
		{Name: "deployd-api", URL: "https://deploy." + d + "/"},
		{Name: "rauthy", URL: "https://auth." + d + "/"},
		{Name: "github-webhook", URL: "https://" + d + "/api/github/webhook"},
	}
}

// CheckEndpoint probes one endpoint with a GET and classifies the result.
//
// A transport error (DNS failure, connection refused, TLS chain not yet trusted,
// timeout) always fails: the endpoint is unreachable or its certificate is not
// issued. Otherwise the bar is status < 500: the server answered over valid TLS.
// A 2xx/3xx is plainly healthy; a 4xx is still a healthy server (the apex may
// gate behind auth, and the webhook receiver rejects an unsigned GET by
// contract) so it passes, while the status code is surfaced in Detail so a
// surprising 404 is visible to the operator. A 5xx means the backend is up but
// erroring, which fails. The classifier deliberately does not assert specific
// health-path bodies it cannot guarantee across services.
func CheckEndpoint(ctx context.Context, client *http.Client, ep Endpoint) Result {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep.URL, nil)
	if err != nil {
		return Result{Name: ep.Name, OK: false, Detail: "bad URL: " + err.Error()}
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{Name: ep.Name, OK: false, Detail: unreachable(ep.URL, err)}
	}
	defer resp.Body.Close()
	// Drain a bounded prefix so a kept-alive connection can be reused cleanly.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	ok := resp.StatusCode < 500
	return Result{Name: ep.Name, OK: ok, Detail: fmt.Sprintf("HTTP %d %s", resp.StatusCode, ep.URL)}
}

// CheckEndpoints probes every endpoint in order and returns the per-endpoint
// results. It never short-circuits: an early failure does not hide a later one,
// so the operator sees the whole picture in one report.
func CheckEndpoints(ctx context.Context, client *http.Client, eps []Endpoint) []Result {
	out := make([]Result, 0, len(eps))
	for _, ep := range eps {
		out = append(out, CheckEndpoint(ctx, client, ep))
	}
	return out
}

// AllOK reports whether every result passed. An empty slice is not OK: verify
// with nothing checked has not verified anything.
func AllOK(results []Result) bool {
	if len(results) == 0 {
		return false
	}
	for _, r := range results {
		if !r.OK {
			return false
		}
	}
	return true
}

// unreachable renders a transport error as an operator-facing one-liner that
// names the URL, so a TLS-not-yet-issued failure reads differently from a
// flat-out connection refusal.
func unreachable(url string, err error) string {
	return fmt.Sprintf("unreachable %s: %v", url, err)
}
