// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §3 FR-008

//! Resource peak polling — track the maximum CPU / memory / PID
//! utilisation observed during a single container's lifetime.
//!
//! The Docker Engine `/containers/<name>/stats` endpoint streams one
//! sample per second by default; bollard exposes that as
//! `Stream<Item = Result<Stats, _>>`. We spawn a Tokio task that
//! drains the stream into a shared `Mutex<ResourcePeak>` for the
//! lifetime of the container.
//!
//! CPU peak is reported in **milli-CPU** (matching spec 162's
//! `ResourceCeilings.cpu_milli_limit` units) and computed from the
//! Docker convention: `(cpu_delta / system_delta) * online_cpus *
//! 1000`. When the runtime omits a field, that sample is skipped.

use std::sync::Arc;

use bollard::Docker;
use bollard::container::{Stats, StatsOptions};
use factory_contracts::sandbox::ResourcePeak;
use futures_util::StreamExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Shared peak tracker. Owned by the polling task; read by the
/// lifecycle once polling has stopped.
pub(crate) struct PeakTracker {
    inner: Arc<Mutex<ResourcePeak>>,
    handle: Option<JoinHandle<()>>,
}

impl PeakTracker {
    /// Spawn a polling task that drains `docker.stats(name, …)` into a
    /// shared peak tracker. Returns immediately.
    pub(crate) fn spawn(docker: Docker, container_name: String) -> Self {
        let inner = Arc::new(Mutex::new(ResourcePeak::default()));
        let handle = tokio::spawn(poll_loop(docker, container_name, Arc::clone(&inner)));
        Self {
            inner,
            handle: Some(handle),
        }
    }

    /// Stop the polling task and return the observed peak.
    /// Aborts the spawned task; safe to call multiple times.
    pub(crate) async fn finish(mut self) -> ResourcePeak {
        if let Some(h) = self.handle.take() {
            h.abort();
            // We do not await the JoinHandle to completion — abort is
            // cooperative and the stats stream may take a moment to
            // drop. Waiting is not necessary because we already hold
            // the only Arc clone the poll loop needs.
        }
        *self.inner.lock().await
    }
}

async fn poll_loop(
    docker: Docker,
    container_name: String,
    peak: Arc<Mutex<ResourcePeak>>,
) {
    let mut stream = docker.stats(
        &container_name,
        Some(StatsOptions {
            stream: true,
            one_shot: false,
        }),
    );
    while let Some(item) = stream.next().await {
        let stats = match item {
            Ok(s) => s,
            // Stream errors (container gone, daemon disconnect) end
            // polling. The peak observed so far is still the truth.
            Err(_) => return,
        };
        let observed = sample_to_peak(&stats);
        let mut p = peak.lock().await;
        merge_peak(&mut p, observed);
    }
}

/// Pure projection of a single Stats sample into a ResourcePeak.
/// Extracted for unit testing without a live runtime.
pub(crate) fn sample_to_peak(stats: &Stats) -> ResourcePeak {
    let memory_bytes_peak = stats.memory_stats.usage.unwrap_or(0);
    let pid_peak = stats
        .pids_stats
        .current
        .map(|c| c.min(u32::MAX as u64) as u32)
        .unwrap_or(0);
    let cpu_milli_peak = compute_cpu_milli(stats);
    ResourcePeak {
        cpu_milli_peak,
        memory_bytes_peak,
        pid_peak,
    }
}

/// Standard Docker `docker stats` CPU calculation, normalised into
/// milli-CPU. `precpu_stats` is the previous sample shipped in the
/// same response (so we get a delta without keeping state ourselves).
fn compute_cpu_milli(stats: &Stats) -> u32 {
    let cpu_total = stats.cpu_stats.cpu_usage.total_usage;
    let pre_total = stats.precpu_stats.cpu_usage.total_usage;
    if cpu_total <= pre_total {
        return 0;
    }
    let cpu_delta = cpu_total - pre_total;

    let (system_total, system_pre) = match (
        stats.cpu_stats.system_cpu_usage,
        stats.precpu_stats.system_cpu_usage,
    ) {
        (Some(s), Some(p)) if s > p => (s, p),
        _ => return 0,
    };
    let system_delta = system_total - system_pre;
    if system_delta == 0 {
        return 0;
    }

    let online_cpus = stats
        .cpu_stats
        .online_cpus
        .or(stats
            .cpu_stats
            .cpu_usage
            .percpu_usage
            .as_ref()
            .map(|v| v.len() as u64))
        .unwrap_or(1)
        .max(1);

    // (cpu_delta / system_delta) * online_cpus * 1000 milli-CPU.
    // Done in u128 to avoid overflow on large samples.
    let numerator: u128 = (cpu_delta as u128) * (online_cpus as u128) * 1000;
    let denominator: u128 = system_delta as u128;
    (numerator / denominator).min(u32::MAX as u128) as u32
}

/// Take the per-axis maximum.
pub(crate) fn merge_peak(into: &mut ResourcePeak, sample: ResourcePeak) {
    into.cpu_milli_peak = into.cpu_milli_peak.max(sample.cpu_milli_peak);
    into.memory_bytes_peak = into.memory_bytes_peak.max(sample.memory_bytes_peak);
    into.pid_peak = into.pid_peak.max(sample.pid_peak);
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::container::{
        BlkioStats, CPUStats, CPUUsage, MemoryStats, PidsStats, Stats, StorageStats, ThrottlingData,
    };

    fn empty_stats() -> Stats {
        Stats {
            read: "1970-01-01T00:00:00Z".into(),
            preread: "1970-01-01T00:00:00Z".into(),
            num_procs: 0,
            pids_stats: PidsStats {
                current: None,
                limit: None,
            },
            network: None,
            networks: None,
            memory_stats: MemoryStats {
                stats: None,
                max_usage: None,
                usage: None,
                failcnt: None,
                limit: None,
                commit: None,
                commit_peak: None,
                commitbytes: None,
                commitpeakbytes: None,
                privateworkingset: None,
            },
            blkio_stats: BlkioStats {
                io_service_bytes_recursive: None,
                io_serviced_recursive: None,
                io_queue_recursive: None,
                io_service_time_recursive: None,
                io_wait_time_recursive: None,
                io_merged_recursive: None,
                io_time_recursive: None,
                sectors_recursive: None,
            },
            cpu_stats: CPUStats {
                cpu_usage: CPUUsage {
                    percpu_usage: None,
                    usage_in_usermode: 0,
                    total_usage: 0,
                    usage_in_kernelmode: 0,
                },
                system_cpu_usage: None,
                online_cpus: None,
                throttling_data: ThrottlingData {
                    periods: 0,
                    throttled_periods: 0,
                    throttled_time: 0,
                },
            },
            precpu_stats: CPUStats {
                cpu_usage: CPUUsage {
                    percpu_usage: None,
                    usage_in_usermode: 0,
                    total_usage: 0,
                    usage_in_kernelmode: 0,
                },
                system_cpu_usage: None,
                online_cpus: None,
                throttling_data: ThrottlingData {
                    periods: 0,
                    throttled_periods: 0,
                    throttled_time: 0,
                },
            },
            storage_stats: StorageStats {
                read_count_normalized: None,
                read_size_bytes: None,
                write_count_normalized: None,
                write_size_bytes: None,
            },
            name: String::new(),
            id: String::new(),
        }
    }

    #[test]
    fn missing_fields_yield_zero_peak() {
        let peak = sample_to_peak(&empty_stats());
        assert_eq!(peak, ResourcePeak::default());
    }

    #[test]
    fn memory_and_pid_pass_through() {
        let mut s = empty_stats();
        s.memory_stats.usage = Some(128 * 1024 * 1024);
        s.pids_stats.current = Some(42);
        let peak = sample_to_peak(&s);
        assert_eq!(peak.memory_bytes_peak, 128 * 1024 * 1024);
        assert_eq!(peak.pid_peak, 42);
    }

    #[test]
    fn cpu_milli_zero_when_no_delta() {
        let mut s = empty_stats();
        s.cpu_stats.cpu_usage.total_usage = 1_000_000_000;
        s.precpu_stats.cpu_usage.total_usage = 1_000_000_000;
        assert_eq!(compute_cpu_milli(&s), 0);
    }

    #[test]
    fn cpu_milli_uses_online_cpu_count() {
        let mut s = empty_stats();
        // 50 ms of CPU time over a 100 ms system window, on 4 CPUs.
        // Expected: (50ms / 100ms) * 4 cpus * 1000 = 2000 milli-CPU.
        s.cpu_stats.cpu_usage.total_usage = 50_000_000;
        s.precpu_stats.cpu_usage.total_usage = 0;
        s.cpu_stats.system_cpu_usage = Some(400_000_000);
        s.precpu_stats.system_cpu_usage = Some(300_000_000);
        s.cpu_stats.online_cpus = Some(4);
        let milli = compute_cpu_milli(&s);
        assert_eq!(milli, 2000);
    }

    #[test]
    fn cpu_milli_falls_back_to_percpu_length() {
        let mut s = empty_stats();
        s.cpu_stats.cpu_usage.total_usage = 100_000_000;
        s.precpu_stats.cpu_usage.total_usage = 0;
        s.cpu_stats.system_cpu_usage = Some(200_000_000);
        s.precpu_stats.system_cpu_usage = Some(100_000_000);
        s.cpu_stats.cpu_usage.percpu_usage = Some(vec![0; 8]); // 8-core system
        let milli = compute_cpu_milli(&s);
        // (100/100) * 8 * 1000 = 8000 milli-CPU.
        assert_eq!(milli, 8000);
    }

    #[test]
    fn merge_peak_takes_per_axis_max() {
        let mut acc = ResourcePeak {
            cpu_milli_peak: 100,
            memory_bytes_peak: 1024,
            pid_peak: 5,
        };
        merge_peak(
            &mut acc,
            ResourcePeak {
                cpu_milli_peak: 200,
                memory_bytes_peak: 512,
                pid_peak: 8,
            },
        );
        assert_eq!(acc.cpu_milli_peak, 200);
        assert_eq!(acc.memory_bytes_peak, 1024);
        assert_eq!(acc.pid_peak, 8);
    }
}
