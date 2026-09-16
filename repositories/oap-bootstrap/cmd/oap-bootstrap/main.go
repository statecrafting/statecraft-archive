// Command oap-bootstrap stands up an open-agentic-platform instance in a new
// GitHub org and brings its Hetzner K3s estate online. See the oap-bootstrap
// spec 001 for the design.
package main

import (
	"os"

	"github.com/bartekus/oap-bootstrap/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:]))
}
