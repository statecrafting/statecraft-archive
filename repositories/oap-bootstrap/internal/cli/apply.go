package cli

import (
	"flag"
	"fmt"
)

// cmdApply runs every phase in dependency order from a complete oap.env, halting
// on the first error (orchestrator Rule 4 / spec 001 J2). It is the unattended
// counterpart to running the phases by hand: each phase is detect-or-create, so a
// second `apply --yes` over an already-provisioned instance reconciles without
// duplicating cloud resources and exits 0 (SC-003).
func cmdApply(args []string) error {
	fs := flag.NewFlagSet("apply", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	repoDir := fs.String("repo-dir", "", "local checkout of the forked repo (default ./<REPO>)")
	yes := fs.Bool("yes", false, "required: run every phase unattended (non-interactive)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	// apply mutates cloud + cluster + GitHub state across every phase. Require an
	// explicit --yes so a bare `oap-bootstrap apply` cannot full-send by accident;
	// the spec's command surface always writes it as `apply --yes`.
	if !*yes {
		return fmt.Errorf("apply runs every phase and mutates cloud/cluster/GitHub state; pass --yes to confirm: oap-bootstrap apply --yes")
	}

	cfgArgs := []string{"--config", *path}
	// cluster/dns/platform/verify accept --repo-dir; thread it through when set.
	repoArgs := cfgArgs
	if *repoDir != "" {
		repoArgs = append([]string{"--repo-dir", *repoDir}, cfgArgs...)
	}

	// init runs first in --yes mode: it validates that required user-supplied keys
	// are present (a missing one halts here with the named key, J2), mints any
	// absent generated secret, recomputes derived keys (GH_REPO/FLUX_* fork seams),
	// and persists, so every later phase reads a complete config.
	steps := []struct {
		name string
		run  func() error
	}{
		{"init", func() error { return cmdInit(append([]string{"--yes"}, cfgArgs...)) }},
		{"github", func() error { return cmdGithub(cfgArgs) }},
		{"cluster", func() error { return cmdCluster(repoArgs) }},
		{"dns", func() error { return cmdDns(repoArgs) }},
		{"identity", func() error { return cmdIdentity(cfgArgs) }},
		{"platform", func() error { return cmdPlatform(repoArgs) }},
		{"verify", func() error { return cmdVerify(repoArgs) }},
	}

	for i, s := range steps {
		fmt.Printf("\n========================================\n")
		fmt.Printf("apply [%d/%d]: %s\n", i+1, len(steps), s.name)
		fmt.Printf("========================================\n")
		if err := s.run(); err != nil {
			return fmt.Errorf("halted at phase %q: %w", s.name, err)
		}
	}

	fmt.Printf("\n========================================\n")
	fmt.Printf("apply complete: all 7 phases ran. The instance is live.\n")
	fmt.Printf("========================================\n")
	return nil
}
