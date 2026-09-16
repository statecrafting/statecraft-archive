// Spec 180 §5 / FR-T8 — Tier 2 bench for the filesystem-scanning usage handler.
//
// Exercises `get_all_usage_entries` (the peer-public function the four usage
// IPC handlers delegate to) over a synthetic ~/.claude-shaped corpus of N
// session files. Each iteration runs a cold scan (fresh UsageCache) so the
// measurement reflects the full read+parse+dedup cost — the signal a parse or
// I/O-pattern regression would move — rather than FR-T5 cache hits.
//
// N is read from OPC_BENCH_N (default 200, the per-PR size per FR-T9; the
// nightly job sets N=2000). The bench asserts NO absolute latency budget
// (FR-T10 / Tier 3 exclusion); CI compares only relative regression against a
// saved baseline.

use criterion::{Criterion, criterion_group, criterion_main};
use opc_lib::commands::usage::{UsageCache, get_all_usage_entries};
use std::fs;
use std::hint::black_box;
use std::io::Write;
use tempfile::TempDir;

fn bench_n() -> usize {
    std::env::var("OPC_BENCH_N")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(200)
}

/// One usage JSONL line with unique (msg_id, req_id) so the corpus exercises
/// the full parse + dedup-set insert path (no cross-file collisions).
fn line(i: usize, j: usize) -> String {
    let ts = format!("2026-05-{:02}T{:02}:00:00Z", (i % 28) + 1, j % 24);
    format!(
        r#"{{"timestamp":"{ts}","requestId":"r{i}-{j}","cwd":"/work/proj-{i}","message":{{"id":"m{i}-{j}","model":"claude-opus-4","usage":{{"input_tokens":{},"output_tokens":7,"cache_read_input_tokens":3}}}}}}"#,
        100 + j
    )
}

/// Build a ~/.claude-shaped corpus: projects/proj-0/sess-<i>/usage.jsonl, N
/// session files of 4 entries each.
fn make_corpus(n: usize) -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let proj = dir.path().join("projects").join("proj-0");
    for i in 0..n {
        let sess = proj.join(format!("sess-{i}"));
        fs::create_dir_all(&sess).expect("create session dir");
        let mut f = fs::File::create(sess.join("usage.jsonl")).expect("create jsonl");
        for j in 0..4 {
            writeln!(f, "{}", line(i, j)).expect("write line");
        }
    }
    dir
}

fn usage_scan(c: &mut Criterion) {
    let n = bench_n();
    let corpus = make_corpus(n);
    let root = corpus.path().to_path_buf();

    c.bench_function(&format!("usage_scan_cold_n{n}"), |b| {
        b.iter(|| {
            // Fresh cache each iteration => cold scan (read + parse + dedup of
            // all N files), the workload sensitive to handler-shape regressions.
            let cache = UsageCache::default();
            let entries = get_all_usage_entries(black_box(&root), &cache);
            black_box(entries.len());
        });
    });
}

criterion_group!(benches, usage_scan);
criterion_main!(benches);
