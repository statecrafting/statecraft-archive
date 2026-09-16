package cli

import (
	"context"
	"encoding/base64"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/bartekus/oap-bootstrap/internal/config"
	"github.com/bartekus/oap-bootstrap/internal/github"
)

func cmdGithub(args []string) error {
	fs := flag.NewFlagSet("github", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	upstreamOwner := fs.String("upstream-owner", "statecrafting", "upstream org to fork from")
	upstreamRepo := fs.String("upstream-repo", "open-agentic-platform", "upstream repo to fork")
	timeout := fs.Duration("timeout", 5*time.Minute, "max wait for the GitHub App consent")
	skipFork := fs.Bool("skip-fork", false, "assume the fork already exists; skip the fork step")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}
	for _, req := range []string{"GITHUB_TOKEN", "ORG", "REPO", "DOMAIN"} {
		if !cfg.Has(req) {
			return fmt.Errorf("%s is not set; run `oap-bootstrap init` first", req)
		}
	}
	org, repo, domain := cfg.Get("ORG"), cfg.Get("REPO"), cfg.Get("DOMAIN")
	gh := github.NewClient(cfg.Get("GITHUB_TOKEN"))
	ctx := context.Background()

	save := func() error { return saveConfig(*path, cfg) }

	// 1. Fork the upstream repo into the target org (detect-or-skip).
	if *skipFork {
		fmt.Printf("fork: skipped (--skip-fork)\n")
	} else {
		fmt.Printf("fork: %s/%s -> %s/%s ...\n", *upstreamOwner, *upstreamRepo, org, repo)
		r, err := gh.EnsureFork(ctx, *upstreamOwner, *upstreamRepo, org, repo)
		if err != nil {
			return fmt.Errorf("fork: %w", err)
		}
		fmt.Printf("fork: ready (%s, default branch %s)\n", r.FullName, r.DefaultBranch)
	}

	// 2. Register the GitHub App via the manifest flow (detect-or-skip).
	if cfg.Has("GITHUB_APP_ID") {
		fmt.Printf("app: already registered (GITHUB_APP_ID=%s); skipping manifest flow\n", cfg.Get("GITHUB_APP_ID"))
	} else {
		creds, err := gh.RunManifestFlow(ctx, org, domain, *timeout)
		if err != nil {
			return fmt.Errorf("app manifest flow: %w", err)
		}
		cfg.Set("GITHUB_APP_ID", strconv.FormatInt(creds.ID, 10))
		cfg.Set("GITHUB_APP_PRIVATE_KEY_B64", base64.StdEncoding.EncodeToString([]byte(creds.PEM)))
		cfg.Set("GITHUB_WEBHOOK_SECRET", creds.WebhookSecret)
		cfg.Set("GITHUB_UPSTREAM_CLIENT_ID", creds.ClientID)
		cfg.Set("GITHUB_UPSTREAM_CLIENT_SECRET", creds.ClientSecret)
		// Persist immediately: the App now exists on GitHub, so its identity must
		// land in oap.env even if a later step fails (FR-004, detect-or-skip).
		if err := save(); err != nil {
			return fmt.Errorf("persist app credentials: %w", err)
		}
		fmt.Printf("app: registered %q (id %d); credentials written to %s\n", creds.Slug, creds.ID, *path)
	}

	// 3. Set the fork's Actions secrets and variables for CD.
	//    KUBECONFIG_HETZNER is deferred to the cluster phase (no kubeconfig yet).
	secrets := []struct{ name, val string }{
		{"GHCR_PAT", cfg.Get("GHCR_PAT")},
		{"DB_PASSWORD", cfg.Get("POSTGRES_PASSWORD")},
	}
	for _, s := range secrets {
		if s.val == "" {
			fmt.Printf("actions: skip secret %s (value not set)\n", s.name)
			continue
		}
		if err := gh.SetSecret(ctx, org, repo, s.name, s.val); err != nil {
			return fmt.Errorf("actions secret %s: %w", s.name, err)
		}
		fmt.Printf("actions: set secret %s\n", s.name)
	}
	if err := gh.SetVariable(ctx, org, repo, "DOMAIN", domain); err != nil {
		return fmt.Errorf("actions variable DOMAIN: %w", err)
	}
	fmt.Printf("actions: set variable DOMAIN=%s\n", domain)

	if err := save(); err != nil {
		return err
	}
	fmt.Printf("\ngithub phase complete. Install the App on %s, then: oap-bootstrap cluster\n", org)
	return nil
}

// saveConfig persists cfg to path through the best available vault, warning on a
// plaintext downgrade.
func saveConfig(path string, cfg *config.Config) error {
	vault, warn := config.SelectVault()
	if warn != "" {
		fmt.Fprintf(os.Stderr, "warning: %s\n", warn)
	}
	return config.Save(path, cfg, vault)
}
