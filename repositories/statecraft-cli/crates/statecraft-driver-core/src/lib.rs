//! The provider-neutral half of a Statecraft driver (spec 114).
//!
//! Spec 014's session driver with the provider removed: read the 043
//! request, spawn whatever the [`Provider`] names with argv only, deliver
//! the prompt on stdin, stream the child's stdout through the provider's
//! parser, enforce the deadline and the shutdown kill, classify the
//! termination through the provider's rule table, and emit the `journal`,
//! `stream` and `result` events the engine consumes. Nothing in this crate
//! names a provider.

pub mod classify;
pub mod protocol;
pub mod session;

use std::collections::BTreeMap;

use serde_json::Value;

pub use classify::{Rule, TerminationKind};
pub use statecraft_contract::{
    Capability, CapabilityTier, ModelTier, Requirements, SessionRequest, SessionResult,
};

/// What the core learned from one line of the provider's stdout.
#[derive(Clone, Debug, PartialEq)]
pub enum ProviderEvent {
    /// The provider announced its session id.
    Init { session_id: Option<String> },
    /// The provider's final report.
    Result(ResultEvent),
    /// Anything else the provider said, kept verbatim for the sink.
    Other,
}

/// The subset of a provider's result event the core reads.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResultEvent {
    pub is_error: bool,
    pub subtype: Option<String>,
    pub result_text: Option<String>,
    pub session_id: Option<String>,
    pub total_cost_usd: Option<f64>,
    pub usage: Option<Value>,
    pub num_turns: Option<u64>,
}

/// The execution posture a session runs under (032), as the request carries
/// it: the provider turns it into flags.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Profile {
    pub mode: String,
    pub allowed_tools: Option<Vec<String>>,
    pub disallowed_tools: Option<Vec<String>>,
    pub models: Option<(String, String)>,
    /// The driver the project's sessions run on (spec 117 B-5), carried so
    /// the journal a Rust driver writes matches the TypeScript one's.
    pub driver: Option<String>,
    /// Spec 120 B-4: the tokens the project requires of every session.
    pub require: Option<Vec<Capability>>,
}

impl Profile {
    /// 032 B-5's payload: mode, both lists and the pair, explicit nulls.
    pub fn payload(&self) -> Value {
        serde_json::json!({
            "mode": self.mode,
            "allowedTools": self.allowed_tools,
            "disallowedTools": self.disallowed_tools,
            "models": self.models.as_ref().map(|(s, f)| serde_json::json!({"strong": s, "fast": f})),
            "driver": self.driver,
            "require": self.require,
        })
    }

    pub fn from_payload(value: &Value) -> Result<Profile, String> {
        let obj = value.as_object().ok_or("profile: expected a JSON object")?;
        let mode = obj
            .get("mode")
            .and_then(Value::as_str)
            .filter(|m| *m == "bypass" || *m == "guarded")
            .ok_or("profile: expected mode \"bypass\" or \"guarded\"")?
            .to_string();
        let list = |key: &str| -> Result<Option<Vec<String>>, String> {
            match obj.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::Array(items)) => items
                    .iter()
                    .map(|i| {
                        i.as_str()
                            .map(String::from)
                            .ok_or_else(|| format!("profile: {key} must be strings"))
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map(Some),
                Some(_) => Err(format!("profile: {key} must be an array")),
            }
        };
        let models = match obj.get("models") {
            None | Some(Value::Null) => None,
            Some(m) => {
                let strong = m
                    .get("strong")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty());
                let fast = m
                    .get("fast")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty());
                match (strong, fast) {
                    (Some(s), Some(f)) => Some((s.to_string(), f.to_string())),
                    _ => {
                        return Err(
                            "profile: models must carry a non-empty strong and fast pair"
                                .to_string(),
                        )
                    }
                }
            }
        };
        let driver = match obj.get("driver") {
            None | Some(Value::Null) => None,
            Some(Value::String(name)) if !name.trim().is_empty() => Some(name.clone()),
            Some(_) => return Err("profile: driver must be a name or null".to_string()),
        };
        let require = match obj.get("require") {
            None | Some(Value::Null) => None,
            Some(v @ Value::Array(_)) => Some(
                serde_json::from_value::<Vec<Capability>>(v.clone())
                    .map_err(|e| format!("profile: require must name capability tokens: {e}"))?,
            ),
            Some(_) => return Err("profile: require must be an array or null".to_string()),
        };
        Ok(Profile {
            mode,
            allowed_tools: list("allowedTools")?,
            disallowed_tools: list("disallowedTools")?,
            models,
            driver,
            require,
        })
    }
}

/// The first line of `<bin> --version`, bounded: a binary that does not
/// answer within `limit` is killed and reads as no version (spec 124 B-6).
pub fn probe_version(bin: &str, limit: std::time::Duration) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut child = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        buf
    });
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < limit => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            _ => {
                // A binary that will not answer is killed and reads as no
                // version. The reader thread is not joined: a descendant the
                // kill did not reach may hold the pipe open, and waiting on
                // it would be the hang this bound exists to prevent.
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let text = reader.join().ok()?;
    if !status.success() {
        return None;
    }
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_string())
}

/// What the core hands a provider to build its argv.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec<'a> {
    pub profile: &'a Profile,
    pub model: Option<&'a str>,
    pub max_turns: Option<u64>,
    pub mcp_config_path: Option<&'a str>,
    /// Spec 120 B-3: what the request requires and prefers.
    pub requirements: &'a Requirements,
}

impl SpawnSpec<'_> {
    /// Spec 120 B-6: the tokens this request uses, whether or not it named
    /// them: the four request tokens by what the spec carries, plus every
    /// token `requirements` names. Wire order.
    pub fn requested(&self) -> Vec<Capability> {
        let mut set = Vec::new();
        let lists = self
            .profile
            .allowed_tools
            .as_ref()
            .is_some_and(|l| !l.is_empty())
            || self
                .profile
                .disallowed_tools
                .as_ref()
                .is_some_and(|l| !l.is_empty());
        if lists || self.profile.mode == "guarded" {
            set.push(Capability::ToolAllowlist);
        }
        if self.max_turns.is_some() {
            set.push(Capability::MaxTurns);
        }
        if self.mcp_config_path.is_some() {
            set.push(Capability::McpConfig);
        }
        set.push(Capability::Cost);
        set.extend(self.requirements.required.iter().copied());
        set.extend(self.requirements.preferred.iter().copied());
        Capability::ordered(&set)
    }

    /// Of the request tokens this request uses, those in `supported`, in
    /// wire order: the shape a provider's `applied` answers with when it
    /// enforces what it declares.
    pub fn applied_of(&self, supported: &[Capability]) -> Vec<Capability> {
        let requested = self.requested();
        Capability::ordered(
            &requested
                .into_iter()
                .filter(|c| supported.contains(c))
                .collect::<Vec<_>>(),
        )
    }
}

/// The thin crate's contract (spec 114 B-1).
pub trait Provider: Send + Sync {
    /// The member's dispatch name, for the manifest and diagnostics.
    fn name(&self) -> &'static str;
    /// The provider binary, and the env var that overrides it.
    fn default_bin(&self) -> &'static str;
    fn bin_env_var(&self) -> &'static str;
    /// The argv after the binary. The prompt is never here (014 B-1).
    fn argv(&self, spec: &SpawnSpec<'_>) -> Vec<String>;
    /// The child's environment from the parent's.
    fn child_env(&self, parent: &BTreeMap<String, String>) -> BTreeMap<String, String>;
    /// One parsed stdout line.
    fn parse_event(&self, event: &Value) -> ProviderEvent;
    /// Where the provider writes its own transcript for a session id.
    fn transcript_path(&self, repo: &str, session_id: &str) -> Option<String>;
    /// The default model pair (040 B-3): `(strong, fast)`.
    fn default_models(&self) -> (&'static str, &'static str);
    /// 014 B-4's rule table, in priority order.
    fn termination_rules(&self) -> &[Rule];
    /// The provider's own fields in `session.init` (its binary under its own key,
    /// D-2), given the resolved binary.
    fn init_extras(&self, bin: &str) -> Value;
    /// Spec 124 B-6: the binary's version, journaled in `session.init` as
    /// `binaryVersion` so a qualification record can be matched to the run.
    /// Default: the first line of `<bin> --version`, or None when it does
    /// not answer.
    fn binary_version(&self, bin: &str) -> Option<String> {
        probe_version(bin, std::time::Duration::from_millis(1500))
    }
    /// The result subtype that means the turn cap was hit, when the provider
    /// has a turn cap (spec 116 B-1). None: `max-turns` is never classified.
    fn max_turns_subtype(&self) -> Option<&'static str> {
        None
    }
    /// Spec 120 B-2, B-7: the tokens this provider supports. The manifest's
    /// tier is derived from them (`CapabilityTier::for_capabilities`).
    /// Default: the four request tokens and hook enforcement.
    fn capabilities(&self) -> &'static [Capability] {
        &[
            Capability::ToolAllowlist,
            Capability::MaxTurns,
            Capability::McpConfig,
            Capability::Cost,
            Capability::HookEnforcement,
        ]
    }
    /// Spec 120 B-6: the tokens this provider applied to this request. The
    /// core journals them in `session.init` as `applied`, and what the
    /// request used minus this list as `degraded` (doc 01 D22, 116 B-8).
    /// Default: every requested token the provider supports, plus hook
    /// enforcement when supported.
    fn applied(&self, spec: &SpawnSpec<'_>) -> Vec<Capability> {
        let supported = self.capabilities();
        let mut applied = spec.applied_of(supported);
        if supported.contains(&Capability::HookEnforcement) {
            applied.push(Capability::HookEnforcement);
        }
        Capability::ordered(&applied)
    }
    /// The tier the manifest declares (042 B-3), derived (spec 120 B-7).
    fn capability_tier(&self) -> CapabilityTier {
        CapabilityTier::for_capabilities(self.capabilities())
    }
    /// Spec 119 B-5 (doc 04 D41): the text of a refused tool call when this
    /// stdout line is the harness's structured event for one, else None.
    /// Never the model's prose: a quotation of "blocked" is not a denial.
    fn denial_in_event(&self, _event: &Value) -> Option<String> {
        None
    }
    /// Spec 119 D-6: the refusals a harness reports on its own stderr rather
    /// than on the stream (a tool router that logs one line per blocked
    /// command). Read once over the bounded stderr tail at session end.
    fn denials_in_stderr(&self, _stderr_tail: &str) -> Vec<String> {
        Vec::new()
    }
}

/// The model an explicit id, the project's pair or the default pair resolves
/// to for a tier (040 B-1).
pub fn resolve_model(
    provider: &dyn Provider,
    tier: Option<ModelTier>,
    explicit: Option<&str>,
    profile: &Profile,
) -> Option<String> {
    if let Some(m) = explicit {
        return Some(m.to_string());
    }
    let tier = tier?;
    let (strong, fast) = match &profile.models {
        Some((s, f)) => (s.as_str(), f.as_str()),
        None => provider.default_models(),
    };
    Some(match tier {
        ModelTier::Strong => strong.to_string(),
        ModelTier::Fast => fast.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_round_trips_its_payload() {
        let p = Profile {
            mode: "guarded".into(),
            allowed_tools: Some(vec!["Read".into()]),
            disallowed_tools: None,
            models: Some(("s".into(), "f".into())),
            driver: Some("other".into()),
            require: Some(vec![Capability::WorkspaceWrite]),
        };
        let back = Profile::from_payload(&p.payload()).unwrap();
        assert_eq!(back, p);
        assert_eq!(p.payload()["driver"], serde_json::json!("other"));
        // Spec 120 B-4: the require list rides the profile; an unknown
        // token refuses.
        assert_eq!(
            p.payload()["require"],
            serde_json::json!(["workspace-write"])
        );
        assert!(
            Profile::from_payload(&serde_json::json!({"mode": "bypass", "require": ["nope"]}))
                .is_err()
        );
        // Spec 117 B-5: absent and null both read as no driver, and the
        // payload says null out loud.
        let none = Profile::from_payload(&serde_json::json!({"mode": "bypass"})).unwrap();
        assert_eq!(none.driver, None);
        assert_eq!(none.payload()["driver"], Value::Null);
        assert!(
            Profile::from_payload(&serde_json::json!({"mode": "bypass", "driver": 3})).is_err()
        );
        assert!(Profile::from_payload(&serde_json::json!({"mode": "x"})).is_err());
        assert!(Profile::from_payload(
            &serde_json::json!({"mode": "bypass", "models": {"strong": "a"}})
        )
        .is_err());
    }

    #[test]
    fn the_core_names_no_provider() {
        // FR-005, the way spec 112's core checks itself.
        let words = [["cl", "aude"].concat(), ["co", "dex"].concat()];
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for entry in std::fs::read_dir(&src).unwrap() {
            let path = entry.unwrap().path();
            let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
            for word in &words {
                assert_eq!(
                    text.matches(word.as_str()).count(),
                    0,
                    "{} names a provider",
                    path.display()
                );
            }
        }
    }
}
