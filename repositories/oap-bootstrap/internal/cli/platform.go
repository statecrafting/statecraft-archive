package cli

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/bartekus/oap-bootstrap/internal/cluster"
	"github.com/bartekus/oap-bootstrap/internal/config"
)

// phase2GateKeys is the provider-produced set setup.sh checks before it crosses
// its "Phase 1 Complete" gate into the full platform deploy
// (platform/infra/hetzner/setup.sh:412-416). The platform phase requires the
// same set up front so a missing value fails loudly here with the named key,
// rather than letting setup.sh silently exit 0 at Phase 1 and leaving the
// operator to wonder why nothing deployed.
var phase2GateKeys = []string{
	"GITHUB_UPSTREAM_CLIENT_ID", "GITHUB_UPSTREAM_CLIENT_SECRET",
	"GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY_B64",
	"OIDC_SPA_CLIENT_ID", "OIDC_M2M_CLIENT_ID", "OIDC_M2M_CLIENT_SECRET",
	"RAUTHY_CLIENT_ID", "RAUTHY_CLIENT_SECRET", "RAUTHY_ADMIN_TOKEN",
	"STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID", "STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET",
}

func cmdPlatform(args []string) error {
	fs := flag.NewFlagSet("platform", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	repoDir := fs.String("repo-dir", "", "local checkout of the forked repo (default ./<REPO>)")
	skipClone := fs.Bool("skip-clone", false, "assume the forked repo is already checked out at --repo-dir; skip clone/pull")
	keepBridge := fs.Bool("keep-bridge", false, "do NOT shred the plaintext .env bridge after the phase (debug only)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}
	// Mint any still-blank generated secret and refresh derived keys (FLUX_* and
	// GH_REPO point setup.sh's flux bootstrap + Phase-2 gh-sync at the fork) so the
	// bridge hands setup.sh a complete .env and its auto_fill no-ops.
	if err := cfg.EnsureGenerated(); err != nil {
		return fmt.Errorf("ensure generated secrets: %w", err)
	}
	cfg.RefreshDerived()

	// Cluster + DNS must have run: NODE_IP is captured by cluster, and the cluster
	// prereqs gate the wrapped setup.sh's Phase-1 steps it re-runs idempotently.
	for _, req := range []string{"ORG", "REPO", "DOMAIN", "HCLOUD_TOKEN", "GITHUB_TOKEN", "LETSENCRYPT_EMAIL", "NODE_IP"} {
		if !cfg.Has(req) {
			return fmt.Errorf("%s is not set; run `oap-bootstrap init`, `github`, and `cluster` first", req)
		}
	}
	// The Phase-2 deploy needs every provider-produced credential the github and
	// identity phases capture. Report all that are missing at once.
	var missingGate []string
	for _, k := range phase2GateKeys {
		if !cfg.Has(k) {
			missingGate = append(missingGate, k)
		}
	}
	if len(missingGate) > 0 {
		return fmt.Errorf("platform deploy needs provider-produced keys still absent (run `github` then `identity`): %v", missingGate)
	}
	org, repo := cfg.Get("ORG"), cfg.Get("REPO")

	dir := *repoDir
	if dir == "" {
		dir = "./" + repo
	}
	ctx := context.Background()

	// 1. Make the forked repo's setup.sh + gitops tree available locally (same
	//    checkout the cluster phase used).
	if *skipClone {
		if _, err := os.Stat(cluster.HetznerDir(dir)); err != nil {
			return fmt.Errorf("--skip-clone set but %s is missing: %w", cluster.HetznerDir(dir), err)
		}
		fmt.Printf("checkout: skipped (--skip-clone); using %s\n", dir)
	} else {
		fmt.Printf("checkout: %s/%s -> %s ...\n", org, repo, dir)
		if err := cluster.EnsureCheckout(ctx, dir, org, repo); err != nil {
			return fmt.Errorf("checkout: %w", err)
		}
		fmt.Printf("checkout: ready (%s)\n", dir)
	}

	// 2. Bridge oap.env into the 0600 cleartext .env setup.sh sources, deferring a
	//    secure shred so the plaintext secrets do not outlive the phase.
	bridgePath := cluster.BridgeEnvPath(dir)
	shred, err := cluster.WriteBridgeEnv(bridgePath, cfg)
	if err != nil {
		return fmt.Errorf("bridge: %w", err)
	}
	if *keepBridge {
		fmt.Fprintf(os.Stderr, "warning: --keep-bridge set; plaintext secrets remain at %s\n", bridgePath)
	} else {
		defer func() {
			if err := shred(); err != nil {
				fmt.Fprintf(os.Stderr, "warning: shred bridge env: %v\n", err)
			}
		}()
	}

	// 3. Run setup.sh Phase 2: with the full provider key set present in the bridge,
	//    the script crosses its Phase-1 gate, materialises the statecraft/deployd
	//    secrets, and rolls the deployments. Idempotent: a re-run re-applies the
	//    same secrets and restarts the pods, ending in the same state.
	_, sopsKeyFile, _ := config.SopsAvailable()
	fmt.Printf("platform: running setup.sh Phase 2 in %s ...\n", cluster.HetznerDir(dir))
	if err := cluster.RunSetupPhase2(ctx, dir, sopsKeyFile); err != nil {
		return err
	}

	// 4. Capture back anything setup.sh's auto_fill produced. With a complete bridge
	//    this no-ops, but a value the CLI did not know about must not be lost when
	//    the plaintext bridge is shredded, so merge then persist.
	mergeBridgeBack(bridgePath, cfg)
	if err := saveConfig(*path, cfg); err != nil {
		return fmt.Errorf("persist config after platform deploy: %w", err)
	}

	domain := cfg.Get("DOMAIN")
	fmt.Printf("\nplatform phase complete. The instance is deploying:\n")
	fmt.Printf("  Statecraft:  https://%s\n", domain)
	fmt.Printf("  Deployd API: https://deploy.%s\n", domain)
	fmt.Printf("  Rauthy OIDC: https://auth.%s\n", domain)
	fmt.Printf("\nNext: oap-bootstrap verify\n")
	return nil
}
