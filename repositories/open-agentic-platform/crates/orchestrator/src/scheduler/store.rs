// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 079: Schedule data model and store trait.

use crate::OrchestratorError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Session context for scheduled agent runs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionContext {
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
}

/// Trigger type: cron-based or event-based, never both.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ScheduleTrigger {
    /// POSIX cron expression (e.g. "0 9 * * 1-5").
    Cron { expr: String },
    /// Lifecycle event name from spec 069 (e.g. "SessionStop", "FileChanged").
    Event { event_type: String },
}

/// A persisted schedule definition.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub session_context: Option<SessionContext>,
    pub trigger: ScheduleTrigger,
    pub enabled: bool,
    /// Last execution time as Unix epoch seconds.
    pub last_run_at: Option<i64>,
    /// Creation time as Unix epoch seconds.
    pub created_at: i64,
}

/// Input for creating a new schedule.
#[derive(Clone, Debug, Deserialize)]
pub struct CreateScheduleRequest {
    pub name: String,
    pub prompt: String,
    pub session_context: Option<SessionContext>,
    pub trigger: ScheduleTrigger,
}

/// Backend-agnostic persistence for schedules.
#[async_trait]
pub trait SchedulerStore: Send + Sync {
    /// Creates a new schedule and returns it with a generated ID.
    async fn create_schedule(
        &self,
        req: CreateScheduleRequest,
    ) -> Result<Schedule, OrchestratorError>;

    /// Returns a schedule by ID, or `None` if not found.
    async fn get_schedule(&self, id: &str) -> Result<Option<Schedule>, OrchestratorError>;

    /// Lists all schedules.
    async fn list_schedules(&self) -> Result<Vec<Schedule>, OrchestratorError>;

    /// Deletes a schedule by ID.  Returns true if it existed.
    async fn delete_schedule(&self, id: &str) -> Result<bool, OrchestratorError>;

    /// Enables or disables a schedule.
    async fn toggle_schedule(&self, id: &str, enabled: bool) -> Result<(), OrchestratorError>;

    /// Updates the `last_run_at` timestamp after a scheduled run fires.
    async fn update_last_run(&self, id: &str, timestamp: i64) -> Result<(), OrchestratorError>;

    /// Returns all enabled schedules with a cron trigger.
    async fn list_enabled_cron_schedules(&self) -> Result<Vec<Schedule>, OrchestratorError>;

    /// Returns all enabled schedules whose event trigger matches `event_type`.
    async fn list_enabled_event_schedules(
        &self,
        event_type: &str,
    ) -> Result<Vec<Schedule>, OrchestratorError>;
}
