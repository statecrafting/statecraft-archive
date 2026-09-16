package cli

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"text/tabwriter"
	"time"

	"github.com/bartekus/oap-bootstrap/internal/cluster"
	"github.com/bartekus/oap-bootstrap/internal/config"
	"github.com/bartekus/oap-bootstrap/internal/verify"
)

func cmdVerify(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	repoDir := fs.String("repo-dir", "", "forked-repo checkout holding the kubeconfig (default ./<REPO>)")
	timeout := fs.Duration("timeout", 10*time.Second, "per-endpoint HTTP timeout")
	skipCerts := fs.Bool("skip-certs", false, "skip the in-cluster cert-manager readiness snapshot")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}
	cfg.RefreshDerived()
	if !cfg.Has("DOMAIN") {
		return fmt.Errorf("DOMAIN is not set; run `oap-bootstrap init` first")
	}
	domain := cfg.Get("DOMAIN")
	ctx := context.Background()

	// 1. Probe the public endpoints. Capture the first response per endpoint rather
	//    than chasing redirects, so a 302 to the login page reads as the real
	//    status. A successful request also validates the TLS chain from outside the
	//    cluster, which is the external proof the certs are issued.
	client := &http.Client{
		Timeout:       *timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	endpoints := verify.PlatformEndpoints(domain)
	results := verify.CheckEndpoints(ctx, client, endpoints)

	fmt.Println("endpoints:")
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	for _, r := range results {
		mark := "PASS"
		if !r.OK {
			mark = "FAIL"
		}
		fmt.Fprintf(w, "  %s\t%s\t%s\n", r.Name, mark, r.Detail)
	}
	w.Flush()

	// 2. In-cluster cert-manager readiness, when the kubeconfig is on disk. This is
	//    informational: the external TLS handshakes above already prove the service
	//    certs; the wildcard tenant cert may legitimately still be Pending on DNS-01,
	//    so a pending cert warns rather than fails the phase.
	if *skipCerts {
		fmt.Println("\ncerts: skipped (--skip-certs)")
	} else {
		dir := *repoDir
		if dir == "" {
			dir = "./" + cfg.Get("REPO")
		}
		kube := cluster.KubeconfigPath(dir)
		if _, err := os.Stat(kube); err != nil {
			fmt.Fprintf(os.Stderr, "\nnote: kubeconfig not found at %s; skipping in-cluster cert snapshot (external TLS already checked above)\n", kube)
		} else {
			// timeout 0 takes a single snapshot rather than polling: verify reports
			// current state, it does not wait for issuance (that is the dns phase's job).
			statuses, err := cluster.WaitCertificatesReady(ctx, kube, 0, time.Second)
			if err != nil {
				fmt.Fprintf(os.Stderr, "\nnote: cert snapshot unavailable: %v\n", err)
			} else {
				fmt.Println("\ncerts (in-cluster):")
				cw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
				pending := 0
				for _, s := range statuses {
					mark := "Ready"
					if !s.Ready {
						mark = "PENDING (" + s.Reason + ")"
						pending++
					}
					fmt.Fprintf(cw, "  %s/%s\t%s\n", s.Namespace, s.Name, mark)
				}
				cw.Flush()
				switch {
				case len(statuses) == 0:
					fmt.Fprintln(os.Stderr, "  note: no Certificates found (cert-manager may still be reconciling)")
				case pending > 0:
					fmt.Fprintf(os.Stderr, "  note: %d Certificate(s) pending (e.g. the DNS-01 wildcard); not a verify failure\n", pending)
				}
			}
		}
	}

	// 3. The phase fails only on a hard endpoint failure (unreachable or 5xx), so a
	//    caller (apply) halts and the operator can re-run once DNS/TLS settle. A
	//    still-pending in-cluster cert is not, by itself, a failure.
	if !verify.AllOK(results) {
		var failed []string
		for _, r := range results {
			if !r.OK {
				failed = append(failed, r.Name)
			}
		}
		return fmt.Errorf("verify: %d endpoint(s) failed: %v", len(failed), failed)
	}

	fmt.Printf("\nverify: all %d endpoints healthy. Instance is live at https://%s\n", len(results), domain)
	return nil
}
