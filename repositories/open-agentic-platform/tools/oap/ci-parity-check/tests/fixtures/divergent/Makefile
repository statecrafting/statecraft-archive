# Divergent fixture Makefile (spec 104 paragraph 5.2 fixture).
# The sibling workflow runs cargo test against a different manifest path
# from the recipe below. check_parity MUST detect the drift.
ci-something-else:
	cargo test --manifest-path crates/orchestrator/Cargo.toml
