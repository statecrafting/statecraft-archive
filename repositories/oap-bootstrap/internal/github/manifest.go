package github

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"time"
)

// HookAttributes configures the App's webhook in the manifest.
type HookAttributes struct {
	URL    string `json:"url"`
	Active bool   `json:"active"`
}

// Manifest is a GitHub App creation manifest. See spec 001 Decision D-1: one App
// carries both the webhook automation and the OAuth login provider, so it
// requests email_addresses and an OAuth callback_url alongside the webhook set.
type Manifest struct {
	Name                  string            `json:"name"`
	URL                   string            `json:"url"`
	HookAttributes        HookAttributes    `json:"hook_attributes"`
	RedirectURL           string            `json:"redirect_url"`
	CallbackURLs          []string          `json:"callback_urls"`
	Public                bool              `json:"public"`
	DefaultPermissions    map[string]string `json:"default_permissions"`
	DefaultEvents         []string          `json:"default_events"`
	RequestOAuthOnInstall bool              `json:"request_oauth_on_install"`
}

// AppCredentials is the subset of the manifest-conversion response we persist.
// GitHub generates the webhook secret and OAuth client credentials and returns
// them here (they are not supplied in the manifest).
type AppCredentials struct {
	ID            int64  `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	ClientID      string `json:"client_id"`
	ClientSecret  string `json:"client_secret"`
	WebhookSecret string `json:"webhook_secret"`
	PEM           string `json:"pem"`
}

// DefaultManifest builds the App manifest for a given org/domain. The webhook
// permission/event set matches the upstream webhook handler contract; the
// email + OAuth callback make the same App serve as Rauthy's upstream provider.
func DefaultManifest(org, domain, redirectURL string) Manifest {
	return Manifest{
		Name: "oap-" + org,
		URL:  "https://" + domain,
		HookAttributes: HookAttributes{
			URL:    "https://" + domain + "/api/github/webhook",
			Active: true,
		},
		RedirectURL:  redirectURL,
		CallbackURLs: []string{"https://auth." + domain + "/auth/v1/providers/callback"},
		Public:       false,
		DefaultPermissions: map[string]string{
			"contents":        "read",
			"pull_requests":   "write",
			"checks":          "write",
			"actions":         "read",
			"members":         "read",
			"email_addresses": "read",
		},
		DefaultEvents:         []string{"installation", "repository", "pull_request", "push", "workflow_run", "organization"},
		RequestOAuthOnInstall: false,
	}
}

var formPage = template.Must(template.New("form").Parse(`<!doctype html>
<html><head><title>oap-bootstrap: create GitHub App</title></head>
<body style="font-family:system-ui;margin:3rem">
<h2>Creating the GitHub App for {{.Org}}...</h2>
<p>Submitting the app manifest to GitHub. If nothing happens, click Continue.</p>
<form id="f" action="{{.Action}}" method="post">
  <input type="hidden" name="manifest" value="{{.Manifest}}">
  <button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`))

// RunManifestFlow drives the GitHub App Manifest flow: it serves a local
// auto-submitting form, opens the operator's browser to GitHub, captures the
// redirect code, and exchanges it for the App credentials. timeout bounds the
// human step.
func (c *Client) RunManifestFlow(ctx context.Context, org, domain string, timeout time.Duration) (AppCredentials, error) {
	state, err := randState()
	if err != nil {
		return AppCredentials{}, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return AppCredentials{}, fmt.Errorf("start local callback server: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	redirect := fmt.Sprintf("http://localhost:%d/callback", port)
	manifest := DefaultManifest(org, domain, redirect)
	mjson, err := json.Marshal(manifest)
	if err != nil {
		return AppCredentials{}, err
	}
	action := fmt.Sprintf("https://github.com/organizations/%s/settings/apps/new?state=%s", org, url.QueryEscape(state))

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = formPage.Execute(w, map[string]any{
			"Org": org, "Action": action, "Manifest": string(mjson),
		})
	})
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("state") != state {
			http.Error(w, "state mismatch", http.StatusBadRequest)
			errCh <- fmt.Errorf("oauth state mismatch (possible CSRF)")
			return
		}
		code := q.Get("code")
		if code == "" {
			http.Error(w, "no code", http.StatusBadRequest)
			errCh <- fmt.Errorf("no code in GitHub redirect")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><body style="font-family:system-ui;margin:3rem">`+
			`<h2>App created. You can close this tab and return to the terminal.</h2></body>`)
		codeCh <- code
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer func() {
		shutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
	}()

	local := fmt.Sprintf("http://localhost:%d/", port)
	fmt.Printf("Opening your browser to create the GitHub App in org %q.\n", org)
	fmt.Printf("If it does not open, visit: %s\n", local)
	_ = openBrowser(local)

	select {
	case code := <-codeCh:
		var creds AppCredentials
		status, err := c.do(ctx, "POST", "/app-manifests/"+code+"/conversions", nil, &creds)
		if err != nil {
			return AppCredentials{}, fmt.Errorf("convert manifest code (status %d): %w", status, err)
		}
		return creds, nil
	case err := <-errCh:
		return AppCredentials{}, err
	case <-time.After(timeout):
		return AppCredentials{}, fmt.Errorf("timed out waiting for GitHub App creation after %s", timeout)
	case <-ctx.Done():
		return AppCredentials{}, ctx.Err()
	}
}

func randState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func openBrowser(target string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", target).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", target).Start()
	default:
		return exec.Command("xdg-open", target).Start()
	}
}
