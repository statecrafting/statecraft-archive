package cli

import (
	"flag"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/bartekus/oap-bootstrap/internal/config"
	"github.com/bartekus/oap-bootstrap/internal/doctor"
)

func cmdDoctor(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	if err := fs.Parse(args); err != nil {
		return err
	}

	// 1. Required tools on PATH.
	fmt.Println("tools:")
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	missingRequired := 0
	for _, r := range doctor.CheckAll() {
		status := "ok"
		switch {
		case r.Found:
			status = "ok"
		case r.Tool.Required:
			status = "MISSING"
			missingRequired++
		default:
			status = "missing (optional)"
		}
		ver := r.Version
		if ver == "" && r.Found {
			ver = "(present)"
		}
		fmt.Fprintf(w, "  %s\t%s\t%s\t%s\n", r.Tool.Name, status, ver, r.Tool.Why)
	}
	w.Flush()

	// 2. Secrets-at-rest posture.
	vault, warn := config.SelectVault()
	fmt.Printf("\nsecrets at rest: %s\n", vault.Name())
	if warn != "" {
		fmt.Printf("  warning: %s\n", warn)
	}

	// 3. Config readiness (if oap.env exists).
	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Printf("\nconfig: cannot read %s: %v\n", *path, err)
	} else {
		reportConfig(cfg, *path)
	}

	if missingRequired > 0 {
		return fmt.Errorf("%d required tool(s) missing; install them before provisioning", missingRequired)
	}
	return nil
}

func reportConfig(cfg *config.Config, path string) {
	var userMissing, pending []string
	for _, k := range config.Registry {
		if cfg.Has(k.Name) {
			continue
		}
		switch {
		case k.Prov == config.UserSupplied && k.Required:
			userMissing = append(userMissing, k.Name)
		case k.Prov == config.ProviderProduced:
			pending = append(pending, k.Name)
		}
	}
	fmt.Printf("\nconfig (%s):\n", path)
	if len(userMissing) == 0 {
		fmt.Println("  user-supplied: complete")
	} else {
		fmt.Printf("  user-supplied: MISSING %d (run init): %v\n", len(userMissing), sortedStrings(userMissing))
	}
	fmt.Printf("  provider-produced pending: %d (filled by github/identity phases)\n", len(pending))
}
