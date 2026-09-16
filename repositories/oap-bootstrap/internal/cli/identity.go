package cli

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/bartekus/oap-bootstrap/internal/config"
	"github.com/bartekus/oap-bootstrap/internal/rauthy"
)

func cmdIdentity(args []string) error {
	fs := flag.NewFlagSet("identity", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}
	cfg.RefreshDerived() // RAUTHY_URL + APP_BASE_URL flow from DOMAIN
	for _, req := range []string{"DOMAIN", "RAUTHY_URL", "APP_BASE_URL"} {
		if !cfg.Has(req) {
			return fmt.Errorf("%s is not set; run `oap-bootstrap init` first", req)
		}
	}
	domain := cfg.Get("DOMAIN")

	// The admin API key is operator-produced once via the Rauthy UI (Rauthy 0.35
	// bootstraps an admin user, not an API key). If absent, guide and halt.
	if !cfg.Has("RAUTHY_ADMIN_TOKEN") {
		printAdminTokenGuidance(domain, cfg.Get("RAUTHY_ADMIN_PASSWORD"))
		return fmt.Errorf("RAUTHY_ADMIN_TOKEN not set; create the API key per the steps above, add it to %s, then re-run", *path)
	}

	rc := rauthy.NewClient(cfg.Get("RAUTHY_URL"), cfg.Get("RAUTHY_ADMIN_TOKEN"))
	ctx := context.Background()

	// 1. Ensure the custom authorization scopes the M2M/sweeper clients carry
	//    exist (the seeder only makes the `oap` attribute scope).
	for _, s := range rauthy.CustomScopes {
		created, err := rc.EnsureScope(ctx, s)
		if err != nil {
			return fmt.Errorf("ensure scope %s: %w", s, err)
		}
		if created {
			fmt.Printf("identity: created scope %s\n", s)
		} else {
			fmt.Printf("identity: scope %s present\n", s)
		}
	}

	// 2. Create the four OIDC clients (detect-or-skip), capturing the
	//    once-issued secret of each confidential client into oap.env immediately.
	ids := rauthy.ClientIDs{
		SPA:     orDefault(cfg.Get("OIDC_SPA_CLIENT_ID"), "statecraft-spa"),
		M2M:     orDefault(cfg.Get("OIDC_M2M_CLIENT_ID"), "statecraft-m2m"),
		Server:  orDefault(cfg.Get("RAUTHY_CLIENT_ID"), "statecraft-server"),
		Sweeper: orDefault(cfg.Get("STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID"), "statecraft-knowledge-sweeper-m2m-app"),
	}
	keyByID := map[string][2]string{
		ids.SPA:     {"OIDC_SPA_CLIENT_ID", ""},
		ids.Server:  {"RAUTHY_CLIENT_ID", "RAUTHY_CLIENT_SECRET"},
		ids.M2M:     {"OIDC_M2M_CLIENT_ID", "OIDC_M2M_CLIENT_SECRET"},
		ids.Sweeper: {"STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID", "STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET"},
	}
	for _, p := range rauthy.DesiredClients(cfg.Get("APP_BASE_URL"), ids) {
		keys := keyByID[p.ID]
		idKey, secretKey := keys[0], keys[1]

		_, exists, err := rc.GetClient(ctx, p.ID)
		if err != nil {
			return fmt.Errorf("check client %s: %w", p.ID, err)
		}
		if exists {
			cfg.Set(idKey, p.ID)
			if secretKey != "" && !cfg.Has(secretKey) {
				fmt.Fprintf(os.Stderr, "warning: client %s exists but %s is not in %s; Rauthy issues the secret once at create. Delete the client in Rauthy and re-run to re-capture, or set %s by hand.\n", p.ID, secretKey, *path, secretKey)
			}
			fmt.Printf("identity: client %s exists; skipping\n", p.ID)
			continue
		}

		secret, err := rc.CreateClient(ctx, p)
		if err != nil {
			return fmt.Errorf("create client %s: %w", p.ID, err)
		}
		cfg.Set(idKey, p.ID)
		if p.Confidential {
			if secret == "" {
				return fmt.Errorf("created confidential client %s but Rauthy returned no secret", p.ID)
			}
			cfg.Set(secretKey, secret)
		}
		// Persist immediately: the client now exists in Rauthy and its secret is
		// unrecoverable on a later GET, so it must reach oap.env before the next step.
		if err := saveConfig(*path, cfg); err != nil {
			return fmt.Errorf("persist client %s credentials: %w", p.ID, err)
		}
		fmt.Printf("identity: created client %s\n", p.ID)
	}

	// 3. Provider leg. Try the admin API (works on Rauthy 0.36+); degrade to the
	//    one guided screen on 0.35, where the provider API is session-gated.
	ghID, ghSecret := cfg.Get("GITHUB_UPSTREAM_CLIENT_ID"), cfg.Get("GITHUB_UPSTREAM_CLIENT_SECRET")
	if ghID != "" && ghSecret != "" {
		ok, err := rc.TryCreateProvider(ctx, rauthy.NewGitHubProvider(ghID, ghSecret))
		if ok {
			fmt.Println("identity: GitHub upstream provider registered via admin API")
		} else {
			fmt.Printf("identity: provider not API-creatable (%v); register it manually:\n", err)
			printProviderGuidance(domain, ghID)
		}
	} else {
		fmt.Println("identity: GITHUB_UPSTREAM_CLIENT_* not set (run `github` first). Register the provider manually:")
		printProviderGuidance(domain, "<GITHUB_UPSTREAM_CLIENT_ID>")
	}

	fmt.Printf("\nidentity phase complete. Next: oap-bootstrap platform\n")
	return nil
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) != "" {
		return v
	}
	return def
}

func printAdminTokenGuidance(domain, adminPassword string) {
	pw := adminPassword
	if pw == "" {
		pw = "<RAUTHY_ADMIN_PASSWORD from oap.env>"
	}
	fmt.Printf(`
identity: RAUTHY_ADMIN_TOKEN is required and not set.
  Rauthy 0.35 bootstraps an admin user but not an API key, so create one once:
    1. open https://auth.%s and log in as admin@%s
       (password: %s)
    2. Admin > API Keys > New. Grant access to: Clients, Scopes, Roles, Groups, Users.
    3. copy the token in name$secret form and add it to oap.env:
         RAUTHY_ADMIN_TOKEN="<name>$<secret>"
    4. re-run: oap-bootstrap identity
`, domain, domain, pw)
}

func printProviderGuidance(domain, clientID string) {
	fmt.Printf(`  Rauthy admin UI > Providers > New (or %s/auth/v1/admin/providers):
       Type:          GitHub
       Issuer:        https://github.com
       Client ID:     %s
       Client Secret: <GITHUB_UPSTREAM_CLIENT_SECRET from oap.env>
       Scope:         read:user user:email
       Callback:      https://auth.%s/auth/v1/providers/callback
`, "https://auth."+domain, clientID, domain)
}
