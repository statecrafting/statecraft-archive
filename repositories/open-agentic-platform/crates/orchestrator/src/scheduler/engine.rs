// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 079: Cron tick engine and lifecycle event dispatcher.

use super::store::{Schedule, ScheduleTrigger, SchedulerStore};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Callback trait for executing a scheduled prompt.
///
/// The Tauri desktop layer and CLI layer provide different implementations
/// (Tauri spawns via managed state + event emission; CLI uses simpler stdio).
/// Using a trait keeps the engine testable with mock executors.
#[async_trait]
pub trait ScheduledRunExecutor: Send + Sync {
    /// Execute the given schedule's prompt.  Implementations should spawn
    /// asynchronously and return quickly.
    async fn execute_scheduled_run(&self, schedule: &Schedule) -> Result<(), String>;
}

/// The scheduler engine evaluates cron schedules on a 60-second tick and
/// dispatches event-triggered schedules when notified of lifecycle events.
pub struct SchedulerEngine {
    store: Arc<dyn SchedulerStore>,
    executor: Arc<dyn ScheduledRunExecutor>,
    shutdown: tokio::sync::watch::Receiver<bool>,
}

impl SchedulerEngine {
    pub fn new(
        store: Arc<dyn SchedulerStore>,
        executor: Arc<dyn ScheduledRunExecutor>,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Self {
        Self {
            store,
            executor,
            shutdown,
        }
    }

    /// Runs the cron evaluation loop.  Call via `tokio::spawn`.
    ///
    /// The loop ticks every 60 seconds, queries all enabled cron schedules,
    /// and fires any that are due.
    pub async fn run(&mut self) {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.evaluate_cron_schedules().await;
                }
                _ = self.shutdown.changed() => {
                    break;
                }
            }
        }
    }

    /// Called by the lifecycle hook runtime when a lifecycle event fires.
    ///
    /// Queries for enabled event schedules matching `event_type` and fires
    /// each one asynchronously.
    pub async fn on_lifecycle_event(&self, event_type: &str) {
        let schedules = match self.store.list_enabled_event_schedules(event_type).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[scheduler] error loading event schedules for {event_type}: {e}");
                return;
            }
        };
        let now = now_epoch();
        for schedule in schedules {
            let _ = self.store.update_last_run(&schedule.id, now).await;
            let executor = Arc::clone(&self.executor);
            let schedule_clone = schedule.clone();
            tokio::spawn(async move {
                if let Err(e) = executor.execute_scheduled_run(&schedule_clone).await {
                    eprintln!(
                        "[scheduler] error executing event schedule '{}': {e}",
                        schedule_clone.name
                    );
                }
            });
        }
    }

    async fn evaluate_cron_schedules(&self) {
        let schedules = match self.store.list_enabled_cron_schedules().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[scheduler] error loading cron schedules: {e}");
                return;
            }
        };
        let now = now_epoch();
        for schedule in schedules {
            if let ScheduleTrigger::Cron { ref expr } = schedule.trigger
                && should_fire(expr, schedule.last_run_at, now)
            {
                let _ = self.store.update_last_run(&schedule.id, now).await;
                let executor = Arc::clone(&self.executor);
                let schedule_clone = schedule.clone();
                tokio::spawn(async move {
                    if let Err(e) = executor.execute_scheduled_run(&schedule_clone).await {
                        eprintln!(
                            "[scheduler] error executing cron schedule '{}': {e}",
                            schedule_clone.name
                        );
                    }
                });
            }
        }
    }
}

/// Determines whether a cron schedule should fire now.
///
/// Uses the `cron` crate to parse the expression and find the most recent
/// scheduled time.  Returns true if `last_run_at` is before that time.
pub fn should_fire(cron_expr: &str, last_run_at: Option<i64>, now_epoch_secs: i64) -> bool {
    use cron::Schedule;
    use std::str::FromStr;

    let Ok(schedule) = Schedule::from_str(cron_expr) else {
        eprintln!("[scheduler] invalid cron expression: {cron_expr}");
        return false;
    };

    let now_dt = chrono::DateTime::from_timestamp(now_epoch_secs, 0);
    let Some(now_dt) = now_dt else {
        return false;
    };
    let now_utc: chrono::DateTime<chrono::Utc> = now_dt;

    // Find the last scheduled time before now.
    // We check the schedule's `after` iterator starting from (now - 2 minutes)
    // and look for the most recent event <= now.
    let window_start = now_utc - chrono::Duration::seconds(120);
    let mut last_due: Option<chrono::DateTime<chrono::Utc>> = None;
    for dt in schedule.after(&window_start) {
        if dt > now_utc {
            break;
        }
        last_due = Some(dt);
    }

    let Some(last_due) = last_due else {
        return false;
    };
    let last_due_epoch = last_due.timestamp();

    match last_run_at {
        Some(lr) => lr < last_due_epoch,
        None => true, // Never run before — fire immediately.
    }
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_fire_returns_true_when_never_run() {
        // Every-minute cron, never run before, now = some fixed time.
        assert!(should_fire("0 * * * * *", None, 1712345700));
    }

    #[test]
    fn should_fire_returns_true_when_cron_is_due() {
        // Every-minute cron, last run 120 seconds ago.
        let now = 1712345700i64;
        let last = now - 120;
        assert!(should_fire("0 * * * * *", Some(last), now));
    }

    #[test]
    fn should_fire_returns_false_when_recently_fired() {
        // Every-minute cron (at second 0), last run = the exact scheduled time.
        // The "now" is 10 seconds after the scheduled time.  Since last_run_at
        // equals the scheduled time, it should NOT fire again.
        let scheduled_time = 1712345700i64; // divisible by 60
        let now = scheduled_time + 10;
        assert!(!should_fire("0 * * * * *", Some(scheduled_time), now));
    }

    #[test]
    fn should_fire_returns_false_for_invalid_cron() {
        assert!(!should_fire("not-a-cron", None, 1712345700));
    }

    #[tokio::test]
    async fn on_lifecycle_event_fires_matching_schedules() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let counter = Arc::new(AtomicUsize::new(0));

        // Mock executor that increments a counter.
        struct MockExecutor(Arc<AtomicUsize>);

        #[async_trait]
        impl ScheduledRunExecutor for MockExecutor {
            async fn execute_scheduled_run(&self, _schedule: &Schedule) -> Result<(), String> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        }

        // Set up an in-memory store.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("sched.sqlite");
        let store =
            Arc::new(super::super::sqlite_store::SqliteSchedulerStore::open(&db_path).unwrap());

        // Create a SessionStop event schedule.
        store
            .create_schedule(super::super::store::CreateScheduleRequest {
                name: "on-stop".into(),
                prompt: "summarize".into(),
                session_context: None,
                trigger: ScheduleTrigger::Event {
                    event_type: "SessionStop".into(),
                },
            })
            .await
            .unwrap();

        let executor = Arc::new(MockExecutor(Arc::clone(&counter)));
        let (_tx, rx) = tokio::sync::watch::channel(false);
        let engine = SchedulerEngine::new(store, executor, rx);

        // Fire a SessionStop event — should match.
        engine.on_lifecycle_event("SessionStop").await;
        // Give the spawned task a moment to execute.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Fire a different event — should not match.
        engine.on_lifecycle_event("SessionStart").await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }
}
