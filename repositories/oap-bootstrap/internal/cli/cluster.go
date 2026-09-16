package cli

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/bartekus/oap-bootstrap/internal/cluster"
	"github.com/bartekus/oap-bootstrap/internal/config"
	"github.com/bartekus/oap-bootstrap/internal/github"
)

func cmdCluster(args []string) error {
	fs := flag.NewFlagSet("cluster", flag.ContinueOnError)
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
	// Refresh derived keys (FLUX_OWNER/REPO/BRANCH flow from ORG/REPO and drive
	// the fork's flux bootstrap) and mint any generated secret still blank, so the
	// bridge hands setup.sh a complete .env and its auto_fill no-ops.
	if err := cfg.EnsureGenerated(); err != nil {
		return fmt.Errorf("ensure generated secrets: %w", err)
	}
	cfg.RefreshDerived()

	for _, req := range []string{"ORG", "REPO", "DOMAIN", "HCLOUD_TOKEN", "GITHUB_TOKEN", "LETSENCRYPT_EMAIL"} {
		if !cfg.Has(req) {
			return fmt.Errorf("%s is not set; run `oap-bootstrap init` (and `github`) first", req)
		}
	}
	org, repo := cfg.Get("ORG"), cfg.Get("REPO")

	dir := *repoDir
	if dir == "" {
		dir = "./" + repo
	}
	ctx := context.Background()

	// 1. Make the forked repo's setup.sh + gitops tree available locally.
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

	// 3. Run setup.sh Phase 1 (hetzner-k3s create + flux bootstrap + post-create).
	//    Idempotent: a second run over an existing cluster no-ops.
	_, sopsKeyFile, _ := config.SopsAvailable()
	fmt.Printf("cluster: running setup.sh Phase 1 in %s ...\n", cluster.HetznerDir(dir))
	if err := cluster.RunSetupPhase1(ctx, dir, sopsKeyFile); err != nil {
		return err
	}

	// 4. Capture what Phase 1 produced. Merge any value setup.sh's auto_fill wrote
	//    back into the bridge .env (it should no-op given step 2, but a value the
	//    CLI did not know about must not be lost when the bridge is shredded), then
	//    capture NODE_IP and persist immediately so a failure past here does not
	//    orphan the cluster's identity in an unsaved oap.env.
	mergeBridgeBack(bridgePath, cfg)

	nodeIP, err := cluster.CaptureNodeIP(ctx, cluster.KubeconfigPath(dir))
	if err != nil {
		return fmt.Errorf("capture NODE_IP: %w", err)
	}
	cfg.Set("NODE_IP", nodeIP)
	if err := saveConfig(*path, cfg); err != nil {
		return fmt.Errorf("persist NODE_IP: %w", err)
	}
	fmt.Printf("cluster: NODE_IP=%s captured and written to %s\n", nodeIP, *path)

	// 5. Set the deferred KUBECONFIG_HETZNER Actions secret from the kubeconfig
	//    setup.sh wrote. This is the secret the github phase intentionally skipped
	//    because no cluster existed yet.
	kubeconfig, err := os.ReadFile(cluster.KubeconfigPath(dir))
	if err != nil {
		return fmt.Errorf("read kubeconfig for KUBECONFIG_HETZNER secret: %w", err)
	}
	gh := github.NewClient(cfg.Get("GITHUB_TOKEN"))
	if err := gh.SetSecret(ctx, org, repo, "KUBECONFIG_HETZNER", string(kubeconfig)); err != nil {
		return fmt.Errorf("actions secret KUBECONFIG_HETZNER: %w", err)
	}
	fmt.Printf("actions: set secret KUBECONFIG_HETZNER (%d bytes)\n", len(kubeconfig))

	fmt.Printf("\ncluster phase complete. Point DNS at %s, then: oap-bootstrap dns\n", nodeIP)
	return nil
}

// mergeBridgeBack reads the (possibly setup.sh-mutated) bridge .env and copies
// any key the in-memory config does not already have into it. setup.sh's
// auto_fill only fills blanks, so with a complete bridge this is a no-op; it is
// the safety net that keeps a value setup.sh produced from being lost when the
// plaintext bridge is shredded. Read errors are non-fatal: the bridge having
// vanished means there is nothing to merge.
func mergeBridgeBack(bridgePath string, cfg *config.Config) {
	raw, err := os.ReadFile(bridgePath)
	if err != nil {
		return
	}
	parsed, err := config.Parse(raw)
	if err != nil {
		return
	}
	for _, name := range parsed.OrderedKeys() {
		if !cfg.Has(name) && parsed.Has(name) {
			cfg.Set(name, parsed.Get(name))
		}
	}
}
