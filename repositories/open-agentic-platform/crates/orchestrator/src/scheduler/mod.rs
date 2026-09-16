// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 079: Scheduling system for recurring agent execution.
//
// Provides cron-based and lifecycle-event-triggered scheduling with persistent
// storage, a tick engine, and HTTP CRUD routes.

pub mod engine;
#[cfg(feature = "local-sqlite")]
pub mod sqlite_store;
pub mod store;

pub use engine::{ScheduledRunExecutor, SchedulerEngine};
#[cfg(feature = "local-sqlite")]
pub use sqlite_store::SqliteSchedulerStore;
pub use store::{CreateScheduleRequest, Schedule, ScheduleTrigger, SchedulerStore, SessionContext};
