# Aligned fixture Makefile — every workflow token has a local mirror.
ci-axiomregent:
	cargo test --manifest-path crates/axiomregent/Cargo.toml

factory-schema-lockstep:
	./tools/oap/factory-schema-lockstep/target/release/factory-schema-lockstep --oap-dir standards/schemas/factory --factory-dir .factory/contract/schemas

ci-statecraft-encore:
	node scripts/encore-test-lane.mjs list > /tmp/encore-lane-files.txt
	node scripts/encore-test-lane.mjs check --report /tmp/encore-test-report.json
