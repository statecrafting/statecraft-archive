// Package doctor runs preflight checks before any provisioning happens: required
// tools on PATH and their versions, plus a readiness summary. Credential scope
// probing (GitHub admin:org, Cloudflare Zone:Edit, Hetzner write) needs live API
// calls and lands in a later milestone; M1 checks tool presence and config
// completeness. See spec 001 section 3.4 (doctor).
package doctor

import (
	"os/exec"
	"strings"
)

// Tool is an external dependency the CLI shells out to.
type Tool struct {
	Name        string
	VersionArgs []string
	Required    bool
	Why         string
}

// Tools is the dependency set the phases rely on.
var Tools = []Tool{
	{"git", []string{"--version"}, true, "fork + clone the upstream"},
	{"gh", []string{"--version"}, true, "GitHub App + Actions secrets"},
	{"hetzner-k3s", []string{"version"}, true, "create the K3s cluster"},
	{"flux", []string{"--version"}, true, "bootstrap GitOps"},
	{"kubectl", []string{"version", "--client", "--output=yaml"}, true, "apply manifests + read state"},
	{"helm", []string{"version", "--short"}, true, "deploy charts"},
	{"sops", []string{"--version"}, true, "encrypt oap.env at rest"},
	{"age", []string{"--version"}, true, "age key backend for sops"},
	{"age-keygen", []string{"--version"}, false, "derive the age recipient"},
	{"spec-spine", []string{"--version"}, false, "govern the fork's own specs"},
}

// Result is the outcome of checking one tool.
type Result struct {
	Tool    Tool
	Found   bool
	Version string
}

// OK reports whether the result is acceptable (present, or not required).
func (r Result) OK() bool { return r.Found || !r.Tool.Required }

// Check probes one tool.
func Check(t Tool) Result {
	path, err := exec.LookPath(t.Name)
	if err != nil || path == "" {
		return Result{Tool: t, Found: false}
	}
	r := Result{Tool: t, Found: true}
	if len(t.VersionArgs) > 0 {
		if out, err := exec.Command(t.Name, t.VersionArgs...).Output(); err == nil {
			r.Version = firstLine(string(out))
		}
	}
	return r
}

// CheckAll probes every tool in dependency order.
func CheckAll() []Result {
	out := make([]Result, 0, len(Tools))
	for _, t := range Tools {
		out = append(out, Check(t))
	}
	return out
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}
