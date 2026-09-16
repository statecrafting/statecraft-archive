package cli

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/bartekus/oap-bootstrap/internal/cloudflare"
	"github.com/bartekus/oap-bootstrap/internal/cluster"
	"github.com/bartekus/oap-bootstrap/internal/config"
)

func cmdDns(args []string) error {
	fs := flag.NewFlagSet("dns", flag.ContinueOnError)
	path := fs.String("config", "oap.env", "path to the oap.env config file")
	repoDir := fs.String("repo-dir", "", "forked-repo checkout holding the kubeconfig (default ./<REPO>)")
	dnsTimeout := fs.Duration("dns-timeout", 10*time.Minute, "max wait for hand-set records to resolve (no-token path)")
	certTimeout := fs.Duration("cert-timeout", 10*time.Minute, "max wait for cert-manager Certificates to go Ready")
	skipCerts := fs.Bool("skip-certs", false, "skip the cert-manager readiness poll")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load(*path)
	if err != nil {
		return err
	}
	for _, req := range []string{"DOMAIN", "NODE_IP"} {
		if !cfg.Has(req) {
			return fmt.Errorf("%s is not set; run `oap-bootstrap cluster` first", req)
		}
	}
	domain, nodeIP := cfg.Get("DOMAIN"), cfg.Get("NODE_IP")
	records := cloudflare.PlatformARecords(domain)
	ctx := context.Background()

	// 1. Point the records at the node: programmatically with a token, else hand
	//    the operator the exact records and block until they resolve.
	if token := cfg.Get("CLOUDFLARE_DNS_API_TOKEN"); token != "" {
		cf := cloudflare.NewClient(token)
		zoneID, err := cf.ZoneID(ctx, domain)
		if err != nil {
			return fmt.Errorf("resolve cloudflare zone: %w", err)
		}
		for _, name := range records {
			action, err := cf.UpsertA(ctx, zoneID, name, nodeIP)
			if err != nil {
				return fmt.Errorf("upsert A %s: %w", name, err)
			}
			fmt.Printf("dns: %-28s -> %s (%s)\n", name, nodeIP, action)
		}
	} else {
		fmt.Println("dns: CLOUDFLARE_DNS_API_TOKEN not set. Create these A records by hand:")
		for _, name := range records {
			fmt.Printf("       %-28s A  %s\n", name, nodeIP)
		}
		fmt.Printf("dns: waiting up to %s for the records to resolve to %s ...\n", *dnsTimeout, nodeIP)
		if err := waitDNSResolves(ctx, records, nodeIP, *dnsTimeout); err != nil {
			return err
		}
		fmt.Println("dns: records resolve correctly")
	}

	// 2. Poll cert-manager readiness so the phase only completes once TLS is
	//    actually issued for what exists now (rauthy + the wildcard tenant cert).
	if *skipCerts {
		fmt.Println("dns: skipping cert-manager poll (--skip-certs)")
	} else {
		dir := *repoDir
		if dir == "" {
			dir = "./" + cfg.Get("REPO")
		}
		kube := cluster.KubeconfigPath(dir)
		if _, err := os.Stat(kube); err != nil {
			fmt.Fprintf(os.Stderr, "warning: kubeconfig not found at %s; skipping cert poll (run `cluster` or pass --repo-dir)\n", kube)
		} else {
			fmt.Printf("dns: polling cert-manager Certificates (up to %s) ...\n", *certTimeout)
			statuses, err := cluster.WaitCertificatesReady(ctx, kube, *certTimeout, 10*time.Second)
			if err != nil {
				return fmt.Errorf("cert poll: %w", err)
			}
			pending := 0
			for _, s := range statuses {
				mark := "ready"
				if !s.Ready {
					mark = "PENDING (" + s.Reason + ")"
					pending++
				}
				fmt.Printf("  cert %s/%s: %s\n", s.Namespace, s.Name, mark)
			}
			switch {
			case len(statuses) == 0:
				fmt.Fprintln(os.Stderr, "warning: no Certificates found yet (cert-manager may still be reconciling)")
			case pending > 0:
				fmt.Fprintf(os.Stderr, "warning: %d Certificate(s) still pending after %s; later phases issue the rest\n", pending, *certTimeout)
			}
		}
	}

	fmt.Printf("\ndns phase complete. Next: oap-bootstrap identity\n")
	return nil
}

// waitDNSResolves blocks until every record resolves to wantIP or the timeout
// elapses, never hanging. A wildcard record is checked through a synthetic probe
// label (a `*.tenants.<d>` record answers any `<x>.tenants.<d>` query).
func waitDNSResolves(ctx context.Context, records []string, wantIP string, timeout time.Duration) error {
	probes := make([]string, len(records))
	for i, r := range records {
		probes[i] = strings.Replace(r, "*", "oap-bootstrap-probe", 1)
	}
	deadline := time.Now().Add(timeout)
	for {
		var unresolved []string
		for _, host := range probes {
			if !resolvesTo(ctx, host, wantIP) {
				unresolved = append(unresolved, host)
			}
		}
		if len(unresolved) == 0 {
			return nil
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("DNS for %s does not resolve to %s after %s", strings.Join(unresolved, ", "), wantIP, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Second):
		}
	}
}

func resolvesTo(ctx context.Context, host, wantIP string) bool {
	ips, err := net.DefaultResolver.LookupHost(ctx, host)
	if err != nil {
		return false
	}
	for _, ip := range ips {
		if ip == wantIP {
			return true
		}
	}
	return false
}
