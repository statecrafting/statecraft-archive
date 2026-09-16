package cli

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/bartekus/oap-bootstrap/internal/config"
)

func cmdInit(args []string) error {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	yes := fs.Bool("yes", false, "non-interactive: do not prompt; fail if a required value is missing")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}

	// 1. User-supplied keys: prompt for missing ones (unless --yes).
	in := bufio.NewReader(os.Stdin)
	for _, k := range config.Registry {
		if k.Prov != config.UserSupplied || cfg.Has(k.Name) {
			continue
		}
		if *yes {
			continue // validated below
		}
		v, err := prompt(in, k)
		if err != nil {
			return err
		}
		if v != "" {
			cfg.Set(k.Name, v)
		}
	}

	// 2. Generated keys: mint any that are absent. 3. Derived: recompute.
	if err := cfg.EnsureGenerated(); err != nil {
		return err
	}
	cfg.RefreshDerived()

	// 4. Validate required user-supplied keys are present.
	var missingUser []string
	for _, name := range cfg.MissingRequired() {
		k, _ := config.Lookup(name)
		if k.Prov == config.UserSupplied {
			missingUser = append(missingUser, name)
		}
	}
	if len(missingUser) > 0 {
		return fmt.Errorf("missing required user-supplied keys: %s", strings.Join(sortedStrings(missingUser), ", "))
	}

	// 5. Persist through the best available vault.
	vault, warn := config.SelectVault()
	if warn != "" {
		fmt.Fprintf(os.Stderr, "warning: %s\n", warn)
	}
	if err := config.Save(*path, cfg, vault); err != nil {
		return err
	}

	report(cfg, *path, vault.Name())
	return nil
}

// prompt asks for one user-supplied key. Optional keys may be left blank.
func prompt(in *bufio.Reader, k config.Key) (string, error) {
	tag := "required"
	if !k.Required {
		tag = "optional, blank to skip"
	}
	if k.Secret {
		// M1 reads secrets with terminal echo on; a later milestone adds
		// no-echo input. Flag it so the operator is not surprised.
		fmt.Printf("%s [%s, INPUT VISIBLE]\n  %s: ", k.Name, tag, k.Prompt)
	} else {
		fmt.Printf("%s [%s]\n  %s: ", k.Name, tag, k.Prompt)
	}
	line, err := in.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimSpace(line), nil
}

// report prints a provenance-grouped summary after a successful init.
func report(cfg *config.Config, path, vault string) {
	var user, gen, pending, derived int
	for _, k := range config.Registry {
		set := cfg.Has(k.Name)
		switch k.Prov {
		case config.UserSupplied:
			if set {
				user++
			}
		case config.Generated:
			if set {
				gen++
			}
		case config.Derived:
			if set {
				derived++
			}
		case config.ProviderProduced:
			if !set {
				pending++
			}
		}
	}
	fmt.Printf("\nwrote %s (vault: %s)\n", path, vault)
	fmt.Printf("  user-supplied: %d set\n", user)
	fmt.Printf("  generated:     %d minted\n", gen)
	fmt.Printf("  derived:       %d computed (DOMAIN + ORG/REPO)\n", derived)
	fmt.Printf("  pending:       %d provider-produced (filled by github/identity phases)\n", pending)
	fmt.Println("\nnext: oap-bootstrap doctor")
}
