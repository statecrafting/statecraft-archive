//! NF-002: compile latency for a 50-file policy source tree (root + `.claude/policies/*.md`).

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use open_agentic_policy_compiler::compile;
use std::fs;
use tempfile::TempDir;

fn write_rule(id: &str) -> String {
    format!("```policy\nid: {id}\ndescription: bench\nmode: enforce\nscope: global\n```\n")
}

fn setup_50_sources(tmp: &TempDir) {
    fs::write(tmp.path().join("CLAUDE.md"), write_rule("ROOT")).expect("root");
    let policies = tmp.path().join(".claude/policies");
    fs::create_dir_all(&policies).expect("policies");
    for i in 0..49 {
        fs::write(
            policies.join(format!("p{i}.md")),
            write_rule(&format!("P{i}")),
        )
        .expect("policy file");
    }
}

fn compile_50(c: &mut Criterion) {
    let tmp = TempDir::new().expect("tmp");
    setup_50_sources(&tmp);
    let root = tmp.path().to_path_buf();
    c.bench_function("compile_50_policy_sources", |b| {
        b.iter(|| {
            black_box(compile(black_box(&root)).expect("compile"));
        });
    });
}

criterion_group!(benches, compile_50);
criterion_main!(benches);
