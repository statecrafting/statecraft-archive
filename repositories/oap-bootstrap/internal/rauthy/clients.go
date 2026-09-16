package rauthy

import (
	"context"
	"encoding/json"
	"fmt"
)

// ClientPayload is the Rauthy 0.35 OIDC client record (the 14-field schema
// captured by the upstream spec 137 T003 smoke). PUT requires the full object,
// so every field is always sent. omitempty is avoided on slices so an empty
// allow-list is sent as [] rather than dropped.
type ClientPayload struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Enabled             bool     `json:"enabled"`
	Confidential        bool     `json:"confidential"`
	RedirectURIs        []string `json:"redirect_uris"`
	AllowedOrigins      []string `json:"allowed_origins"`
	FlowsEnabled        []string `json:"flows_enabled"`
	AccessTokenAlg      string   `json:"access_token_alg"`
	IDTokenAlg          string   `json:"id_token_alg"`
	AuthCodeLifetime    int      `json:"auth_code_lifetime"`
	AccessTokenLifetime int      `json:"access_token_lifetime"`
	Scopes              []string `json:"scopes"`
	DefaultScopes       []string `json:"default_scopes"`
	Challenges          []string `json:"challenges"`
	ForceMFA            bool     `json:"force_mfa"`
}

// ClientIDs are the chosen client ids for the four OIDC clients. They are
// operator-overridable via oap.env (so an existing deployment's ids are honoured)
// and default to the statecraft-* convention otherwise.
type ClientIDs struct {
	SPA     string
	M2M     string
	Server  string
	Sweeper string
}

// CustomScopes are the non-standard authorization scopes the M2M and sweeper
// clients carry. They are NOT created by the statecraft seeder (which only makes
// the `oap` attribute scope), so the identity phase ensures them before creating
// clients that reference them. openid/email/profile are Rauthy built-ins and
// need no creation.
var CustomScopes = []string{"deployd:deploy", "platform:knowledge:sweep"}

// DesiredClients builds the four client payloads from the canonical base URL
// (https://<domain>) and the chosen ids. Shapes follow the T003 schema plus the
// per-client divergences the upstream documents: the SPA is public with PKCE and
// the apex callback; the server is confidential with the rauthy/oidc callbacks
// and refresh_token; the M2M and sweeper are confidential client_credentials
// carrying their authorization scope as a default_scope (load-bearing: Rauthy
// 0.35 only mints default_scopes on client_credentials).
func DesiredClients(appBaseURL string, ids ClientIDs) []ClientPayload {
	const eddsa = "EdDSA"
	base := func(id, name string, confidential bool) ClientPayload {
		return ClientPayload{
			ID: id, Name: name, Enabled: true, Confidential: confidential,
			RedirectURIs: []string{}, AllowedOrigins: []string{},
			AccessTokenAlg: eddsa, IDTokenAlg: eddsa,
			AuthCodeLifetime: 60, AccessTokenLifetime: 1800,
			Scopes: []string{}, DefaultScopes: []string{}, Challenges: []string{},
		}
	}

	spa := base(ids.SPA, "statecraft SPA", false)
	spa.RedirectURIs = []string{appBaseURL + "/auth/callback"}
	spa.AllowedOrigins = []string{appBaseURL}
	spa.FlowsEnabled = []string{"authorization_code"}
	spa.Scopes = []string{"openid", "email", "profile"}
	spa.DefaultScopes = []string{"openid"}
	spa.Challenges = []string{"S256"}

	server := base(ids.Server, "statecraft server", true)
	server.RedirectURIs = []string{appBaseURL + "/auth/rauthy/callback", appBaseURL + "/auth/oidc/callback"}
	server.FlowsEnabled = []string{"authorization_code", "refresh_token"}
	server.Scopes = []string{"openid", "email", "profile"}
	server.DefaultScopes = []string{"openid"}
	server.Challenges = []string{"S256"}

	m2m := base(ids.M2M, "statecraft deployd M2M", true)
	m2m.FlowsEnabled = []string{"client_credentials"}
	m2m.Scopes = []string{"deployd:deploy"}
	m2m.DefaultScopes = []string{"deployd:deploy"}

	sweeper := base(ids.Sweeper, "statecraft knowledge sweeper M2M", true)
	sweeper.FlowsEnabled = []string{"client_credentials"}
	sweeper.Scopes = []string{"platform:knowledge:sweep"}
	sweeper.DefaultScopes = []string{"platform:knowledge:sweep"}

	return []ClientPayload{spa, server, m2m, sweeper}
}

// GetClient returns the client by id, or (nil, false, nil) when Rauthy answers
// 404 (the detect-or-skip signal).
func (c *Client) GetClient(ctx context.Context, id string) (*ClientPayload, bool, error) {
	status, body, err := c.do(ctx, "GET", "/auth/v1/clients/"+id, nil)
	if err != nil {
		return nil, false, err
	}
	if status == 404 {
		return nil, false, nil
	}
	if status >= 300 {
		return nil, false, fmt.Errorf("get client %s: %d %s", id, status, snippet(body))
	}
	var p ClientPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, false, fmt.Errorf("decode client %s: %w", id, err)
	}
	return &p, true, nil
}

// CreateClient POSTs a new client and returns the secret Rauthy mints once at
// create time (empty for a public client, which has none). The secret can be
// extracted from `secret`, `client_secret`, or `clientSecret`; the caller
// decides whether a missing secret is fatal (it is for a confidential client).
func (c *Client) CreateClient(ctx context.Context, p ClientPayload) (string, error) {
	status, body, err := c.do(ctx, "POST", "/auth/v1/clients", p)
	if err != nil {
		return "", err
	}
	if status >= 300 {
		return "", fmt.Errorf("create client %s: %d %s", p.ID, status, snippet(body))
	}
	return extractSecret(body), nil
}

func extractSecret(body []byte) string {
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return ""
	}
	for _, k := range []string{"secret", "client_secret", "clientSecret"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

type scope struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EnsureScope creates the custom authorization scope if it is absent, returning
// whether it was created. Idempotent: an existing scope is left untouched (these
// carry no attribute mappings, unlike the seeder's `oap` scope).
func (c *Client) EnsureScope(ctx context.Context, name string) (bool, error) {
	status, body, err := c.do(ctx, "GET", "/auth/v1/scopes", nil)
	if err != nil {
		return false, err
	}
	if status >= 300 {
		return false, fmt.Errorf("list scopes: %d %s", status, snippet(body))
	}
	var scopes []scope
	if err := json.Unmarshal(body, &scopes); err != nil {
		return false, fmt.Errorf("decode scopes: %w", err)
	}
	for _, s := range scopes {
		if s.Name == name {
			return false, nil
		}
	}
	createBody := map[string]any{"scope": name, "attr_include_access": []string{}, "attr_include_id": []string{}}
	cs, cb, err := c.do(ctx, "POST", "/auth/v1/scopes", createBody)
	if err != nil {
		return false, err
	}
	if cs >= 300 {
		return false, fmt.Errorf("create scope %s: %d %s", name, cs, snippet(cb))
	}
	return true, nil
}

// GitHubProvider is the upstream auth-provider payload (Rauthy 0.35 native
// github adapter, with the private-email fallback handled internally by Rauthy).
// Mirrors the upstream seeder's GITHUB_PROVIDER constant.
type GitHubProvider struct {
	Name                  string `json:"name"`
	Typ                   string `json:"typ"`
	Enabled               bool   `json:"enabled"`
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	UsePKCE               bool   `json:"use_pkce"`
	ClientSecretBasic     bool   `json:"client_secret_basic"`
	ClientSecretPost      bool   `json:"client_secret_post"`
	AutoOnboarding        bool   `json:"auto_onboarding"`
	AutoLink              bool   `json:"auto_link"`
	ClientID              string `json:"client_id"`
	ClientSecret          string `json:"client_secret"`
	Scope                 string `json:"scope"`
}

// NewGitHubProvider builds the provider payload from the upstream App's OAuth
// credentials (the same App created in the github phase, per Decision D-1).
func NewGitHubProvider(clientID, clientSecret string) GitHubProvider {
	return GitHubProvider{
		Name: "github", Typ: "github", Enabled: true,
		Issuer:                "https://github.com",
		AuthorizationEndpoint: "https://github.com/login/oauth/authorize",
		TokenEndpoint:         "https://github.com/login/oauth/access_token",
		UserinfoEndpoint:      "https://api.github.com/user",
		UsePKCE:               false,
		ClientSecretBasic:     false,
		ClientSecretPost:      true,
		AutoOnboarding:        true,
		AutoLink:              true,
		ClientID:              clientID,
		ClientSecret:          clientSecret,
		Scope:                 "read:user user:email",
	}
}

// TryCreateProvider attempts the admin-API provider create. On Rauthy 0.35 the
// provider endpoints are session-gated (not API-Key callable), so this returns
// ok=false with the status, and the caller degrades to the guided screen. On
// Rauthy 0.36+ (where the API may be open) it can succeed, re-probing the gate
// automatically without a code change.
func (c *Client) TryCreateProvider(ctx context.Context, p GitHubProvider) (bool, error) {
	status, body, err := c.do(ctx, "POST", "/auth/v1/providers/create", p)
	if err != nil {
		return false, err
	}
	if status >= 300 {
		return false, fmt.Errorf("provider create not available via API-Key: %d %s", status, snippet(body))
	}
	return true, nil
}
