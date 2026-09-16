// Post-035 hardening — NF-001 latency gate
// Asserts that the governed dispatch overhead (permission check + audit) adds < 50ms per call.
// This measures the permission enforcement overhead only, NOT tool execution or subprocess startup.

use axiomregent::lease::{Fingerprint, Lease, PermissionGrants};
use axiomregent::router::permissions;
use std::collections::HashSet;
use std::time::Instant;

fn lease_with(grants: PermissionGrants) -> Lease {
    Lease {
        id: "bench-lease".into(),
        fingerprint: Fingerprint {
            head_oid: "abc123".into(),
            index_oid: "def456".into(),
            status_hash: "aaa".into(),
        },
        touched_files: HashSet::new(),
        grants,
    }
}

#[test]
fn permission_check_under_50ms() {
    let lease = lease_with(PermissionGrants {
        enable_file_read: true,
        enable_file_write: true,
        enable_network: true,
        max_tier: 3,
    });

    let tools = [
        "gov.preflight",
        "gov.drift",
        "features.impact",
        "xray.scan",
        "checkpoint.create",
        "checkpoint.info",
        "workspace.write_file",
        "workspace.apply_patch",
        "run.execute",
        "agent.execute",
    ];

    // Warm up
    for tool in &tools {
        let _ = permissions::check_grants(tool, &lease.grants, None);
    }

    let iterations = 1000;
    let start = Instant::now();
    for _ in 0..iterations {
        for tool in &tools {
            let _ = permissions::check_grants(tool, &lease.grants, None);
        }
    }
    let elapsed = start.elapsed();
    let total_calls = iterations * tools.len();
    let per_call_us = elapsed.as_micros() as f64 / total_calls as f64;

    eprintln!(
        "NF-001: {} permission checks in {:.1}ms ({:.2}µs/call)",
        total_calls,
        elapsed.as_secs_f64() * 1000.0,
        per_call_us
    );

    // 50ms budget is generous — permission check should be < 1ms.
    // We assert < 1ms (1000µs) here for tighter signal, well within the 50ms NF-001 budget.
    assert!(
        per_call_us < 1000.0,
        "NF-001 FAIL: permission check took {per_call_us:.2}µs/call (limit: 1000µs)"
    );
}

#[test]
fn permission_check_grants_fallback_under_50ms() {
    let grants = PermissionGrants {
        enable_file_read: true,
        enable_file_write: true,
        enable_network: false,
        max_tier: 2,
    };

    let tools = [
        "gov.preflight",
        "features.impact",
        "checkpoint.info",
        "workspace.write_file",
    ];

    let iterations = 1000;
    let start = Instant::now();
    for _ in 0..iterations {
        for tool in &tools {
            let _ = permissions::check_grants(tool, &grants, None);
        }
    }
    let elapsed = start.elapsed();
    let total_calls = iterations * tools.len();
    let per_call_us = elapsed.as_micros() as f64 / total_calls as f64;

    eprintln!(
        "NF-001 (no-lease fallback): {} grant checks in {:.1}ms ({:.2}µs/call)",
        total_calls,
        elapsed.as_secs_f64() * 1000.0,
        per_call_us
    );

    assert!(
        per_call_us < 1000.0,
        "NF-001 FAIL: grant check took {per_call_us:.2}µs/call (limit: 1000µs)"
    );
}

#[test]
fn permission_denial_works() {
    // Verify that restricted grants correctly deny tools
    let grants = PermissionGrants {
        enable_file_read: true,
        enable_file_write: false,
        enable_network: false,
        max_tier: 1,
    };

    // Tier 1 read tool: should pass
    assert!(permissions::check_grants("gov.preflight", &grants, None).is_ok());

    // Write tool with write disabled: should deny
    assert!(permissions::check_grants("workspace.write_file", &grants, None).is_err());

    // Network tool with network disabled: should deny
    assert!(permissions::check_grants("run.execute", &grants, None).is_err());

    // Tier 2 tool with max_tier=1: should deny
    assert!(permissions::check_grants("checkpoint.create", &grants, None).is_err());
}
