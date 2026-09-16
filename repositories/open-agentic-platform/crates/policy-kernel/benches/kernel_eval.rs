//! SC-010: synthetic evaluation throughput (native kernel; excludes I/O per NF-001).

use criterion::{Criterion, criterion_group, criterion_main};
use open_agentic_policy_kernel::{
    PolicyBundle, PolicyOutcome, PolicyRule, ToolCallContext, evaluate,
};
use std::collections::BTreeMap;
use std::hint::black_box;

fn sample_bundle() -> PolicyBundle {
    PolicyBundle {
        constitution: vec![
            PolicyRule {
                id: "T-allow".into(),
                description: "bench allowlist".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("tool_allowlist".into()),
                source_path: "CLAUDE.md".into(),
                allow_destructive: None,
                allowed_tools: Some(vec!["xray.scan".into(), "features.impact".into()]),
                max_diff_lines: None,
                max_diff_bytes: None,
            },
            PolicyRule {
                id: "S-001".into(),
                description: "secrets".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("secrets_scanner".into()),
                source_path: "CLAUDE.md".into(),
                allow_destructive: None,
                allowed_tools: None,
                max_diff_lines: None,
                max_diff_bytes: None,
            },
        ],
        shards: BTreeMap::new(),
    }
}

fn sample_ctx() -> ToolCallContext {
    ToolCallContext {
        tool_name: "xray.scan".into(),
        arguments_summary: r#"{"repo_root":"/tmp/r","path":"src"}"#.into(),
        proposed_file_content: None,
        diff_lines: None,
        diff_bytes: None,
        active_shard_scopes: vec![],
        feature_ids: vec![],
        max_spec_risk: None,
        spec_statuses: vec![],
        spec_impl_statuses: vec![],
    }
}

fn kernel_eval_1000(c: &mut Criterion) {
    let bundle = sample_bundle();
    let ctx = sample_ctx();
    c.bench_function("evaluate_x1000_allow_path", |b| {
        b.iter(|| {
            for _ in 0..1000 {
                let d = evaluate(black_box(&ctx), black_box(&bundle));
                assert_eq!(d.outcome, PolicyOutcome::Allow);
            }
        });
    });
}

criterion_group!(benches, kernel_eval_1000);
criterion_main!(benches);
