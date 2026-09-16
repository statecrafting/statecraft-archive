//! The Statecraft member contract (spec 111): one definition of what a member
//! is to the umbrella that calls it and to the engine that drives it.
//!
//! Every type here has exactly one wire form, the one the TypeScript members
//! already read and write: the manifest a member answers `--member-manifest`
//! with (spec 042 B-3), the reserved dispatch-layer exit range and the
//! members' declared taxonomy (spec 108 §7, 023 D-4), the family envelope
//! (spec 104 §5.2, 023 B-3), and the driver seam's request, event stream and
//! session result (spec 043 B-1, B-2). Field names are camelCase on the
//! wire; nulls are explicit where the TypeScript codecs write them.
//!
//! The crate's tests write each type as a JSON fixture under `fixtures/`, and
//! a members test parses every fixture through the TypeScript codecs, so a
//! shape cannot move on one side without the other noticing (B-5).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// --- the manifest (042 B-3, 108 §3) -----------------------------------------

/// The member binaries carry this prefix; the umbrella strips it and nothing
/// else to obtain the dispatch key (108 D-1).
pub const MEMBER_PREFIX: &str = "statecraft-";

/// The reserved flag every member answers before any other parsing (042 D-1).
pub const MANIFEST_FLAG: &str = "--member-manifest";

/// The member-contract version this crate defines: the id of the spec that
/// fixed the manifest. A member states which contract it implements rather
/// than leaving the umbrella to infer it from a version number.
pub const CONTRACT: &str = "042";

/// The manifest schema version (042 B-3).
pub const MANIFEST_SCHEMA_VERSION: &str = "1";

/// Declared, never probed (042 B-8): the richest driver is `reference`.
/// Since spec 120 the tier is a summary derived from the capability tokens
/// (`CapabilityTier::for_capabilities`), never consulted for a decision the
/// tokens can make.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityTier {
    Reference,
    Basic,
}

impl CapabilityTier {
    /// The wire token.
    pub fn as_str(self) -> &'static str {
        match self {
            CapabilityTier::Reference => "reference",
            CapabilityTier::Basic => "basic",
        }
    }

    /// Spec 120 B-2: `reference` when the four request tokens are all
    /// supported, `basic` otherwise. The two boundary tokens are claims
    /// about confinement and enforcement that no tier summarizes (doc 04 D46).
    pub fn for_capabilities(capabilities: &[Capability]) -> CapabilityTier {
        if Capability::REQUEST.iter().all(|c| capabilities.contains(c)) {
            CapabilityTier::Reference
        } else {
            CapabilityTier::Basic
        }
    }
}

/// Spec 120 B-1 (doc 04 D44): the closed vocabulary a run states its needs
/// in and a driver states its support in. A token is added by a spec that
/// names its enforcement, never by a driver that wants to advertise one.
///
/// - `tool-allowlist`: the request's tool lists are enforced.
/// - `max-turns`: the turn cap is enforced.
/// - `mcp-config`: an MCP server set is hosted.
/// - `cost`: the provider reports cost.
/// - `workspace-write`: the provider confines writes to the repository.
/// - `hook-enforcement`: the project's hooks run.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    ToolAllowlist,
    MaxTurns,
    McpConfig,
    Cost,
    WorkspaceWrite,
    HookEnforcement,
}

impl Capability {
    /// Every token, in wire order. Lists derived from this set (`applied`,
    /// `degraded`) keep this order.
    pub const ALL: [Capability; 6] = [
        Capability::ToolAllowlist,
        Capability::MaxTurns,
        Capability::McpConfig,
        Capability::Cost,
        Capability::WorkspaceWrite,
        Capability::HookEnforcement,
    ];
    /// The four request tokens the tier summarizes (B-2).
    pub const REQUEST: [Capability; 4] = [
        Capability::ToolAllowlist,
        Capability::MaxTurns,
        Capability::McpConfig,
        Capability::Cost,
    ];

    /// The wire token.
    pub fn as_str(self) -> &'static str {
        match self {
            Capability::ToolAllowlist => "tool-allowlist",
            Capability::MaxTurns => "max-turns",
            Capability::McpConfig => "mcp-config",
            Capability::Cost => "cost",
            Capability::WorkspaceWrite => "workspace-write",
            Capability::HookEnforcement => "hook-enforcement",
        }
    }

    /// The tokens of `ALL` that `set` contains, in wire order and without
    /// duplicates.
    pub fn ordered(set: &[Capability]) -> Vec<Capability> {
        Capability::ALL
            .iter()
            .copied()
            .filter(|c| set.contains(c))
            .collect()
    }
}

/// Spec 120 B-3: what a run needs. A required token the driver lacks
/// refuses the session before a process exists; a preferred one it lacks
/// is journaled as degraded and the session runs (doc 04 D45).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Requirements {
    #[serde(default)]
    pub required: Vec<Capability>,
    #[serde(default)]
    pub preferred: Vec<Capability>,
}

/// The manifest as 042 B-3 declares it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: String,
    /// The dispatch key: the umbrella reaches this member as
    /// `statecraft <name minus prefix> ...`, never by one of its verbs.
    pub name: String,
    pub version: String,
    pub contract: String,
    /// The subverb set the member accepts under its own name. Two members
    /// may both offer a `status`; the name is what keeps them apart.
    pub verbs: Vec<String>,
    pub capability_tier: CapabilityTier,
    /// Spec 120 B-2: the tokens this member supports. Absent on the wire is
    /// an older member and is not checked against the tier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<Capability>>,
    /// 042 B-6: declared, never remapped. The umbrella reports a member's
    /// taxonomy rather than guessing it, and returns the code verbatim.
    pub exit_codes: BTreeMap<String, String>,
    pub envelope: String,
}

impl Manifest {
    /// Parse one manifest from a member's stdout with the validation 108 §3
    /// applies. The message names the field, because `members list` shows
    /// it (108 §5).
    pub fn parse(bytes: &[u8]) -> Result<Manifest, String> {
        let manifest: Manifest =
            serde_json::from_slice(bytes).map_err(|e| format!("manifest does not parse: {e}"))?;
        if manifest.name.is_empty() {
            return Err("manifest is missing a required field: name".to_string());
        }
        if manifest.contract.is_empty() {
            return Err("manifest is missing a required field: contract".to_string());
        }
        if manifest.verbs.is_empty() {
            return Err("manifest declares no verbs".to_string());
        }
        if let Some(capabilities) = &manifest.capabilities {
            let derived = CapabilityTier::for_capabilities(capabilities);
            if derived != manifest.capability_tier {
                return Err(format!(
                    "manifest declares capabilityTier {} but its capabilities derive {}",
                    manifest.capability_tier.as_str(),
                    derived.as_str()
                ));
            }
        }
        Ok(manifest)
    }

    /// The declared tokens, none for an older member.
    pub fn capabilities(&self) -> &[Capability] {
        self.capabilities.as_deref().unwrap_or(&[])
    }

    /// The dispatch key: the name with the member prefix stripped, or the
    /// whole name when it carries none.
    pub fn dispatch_key(&self) -> &str {
        self.name.strip_prefix(MEMBER_PREFIX).unwrap_or(&self.name)
    }
}

// --- exit codes (108 §7, 023 D-4, 042 B-6) ----------------------------------

/// The dispatch layer's reserved range and the members' declared taxonomy.
pub mod exit {
    use std::collections::BTreeMap;

    /// No member emits a code at or above this line (042 B-6); the values
    /// below it are the framework speaking rather than the program (108 D-4).
    pub const FLOOR: u8 = 64;
    /// `statecraft-<name>` is in neither the managed directory nor `PATH`.
    pub const MEMBER_NOT_FOUND: u8 = 64;
    /// The manifest did not parse, or a required field is missing.
    pub const MANIFEST_REFUSED: u8 = 65;
    /// The member's `contract` is outside the umbrella's supported range.
    pub const CONTRACT_SKEW: u8 = 66;
    /// The first positional token is not in the member's declared `verbs`.
    pub const UNKNOWN_SUBVERB: u8 = 67;

    /// The taxonomy the engine and driver members declare verbatim (023
    /// D-4, 042 B-6): 0 ok, 1 operational, 2 unreachable daemon, 3 usage.
    pub fn d4_taxonomy() -> BTreeMap<String, String> {
        [
            ("0", "ok"),
            ("1", "operational"),
            ("2", "unreachable"),
            ("3", "usage"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    /// The sensor's taxonomy as 042 declares it: its dispatcher has always
    /// answered an unknown verb with the same code as an operational failure.
    pub fn sensor_taxonomy() -> BTreeMap<String, String> {
        [("0", "ok"), ("1", "operational or usage")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }
}

// --- the envelope (104 §5.2, 023 B-3) ----------------------------------------

/// The `error` arm: a taxonomy kind, a message, and the HTTP status when a
/// control-plane call produced it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct EnvelopeError {
    pub kind: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

/// `{ok: true, data}` or `{ok: false, error}`: the one shape both faces of
/// the umbrella and every member emit under `--json`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Envelope<T> {
    Ok { ok: True, data: T },
    Err { ok: False, error: EnvelopeError },
}

impl<T> Envelope<T> {
    pub fn ok(data: T) -> Self {
        Envelope::Ok { ok: True, data }
    }

    pub fn err(kind: impl Into<String>, message: impl Into<String>, status: Option<u16>) -> Self {
        Envelope::Err {
            ok: False,
            error: EnvelopeError {
                kind: kind.into(),
                message: message.into(),
                status,
            },
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Envelope::Ok { .. })
    }
}

/// The literal `true`, so the `ok` discriminant is checked on the way in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct True;

/// The literal `false`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct False;

impl Serialize for True {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for True {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match bool::deserialize(d)? {
            true => Ok(True),
            false => Err(serde::de::Error::custom("expected `ok: true`")),
        }
    }
}

impl Serialize for False {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(false)
    }
}

impl<'de> Deserialize<'de> for False {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match bool::deserialize(d)? {
            false => Ok(False),
            true => Err(serde::de::Error::custom("expected `ok: false`")),
        }
    }
}

// --- the driver seam (043 B-1, B-2; 014's shapes) -----------------------------

/// Spec 121 B-3: what a driven session never inherits. The engine's
/// `candidate.ts` carries the same list; the fixture `child-env-deny.json`
/// is what both sides assert against. Spec 122 adds the GitHub tokens.
/// Spec 122 B-7 added the GitHub tokens: the engine publishes, the
/// candidate does not. Spec 125 B-4 adds the ssh agent: a repository whose
/// origin is an ssh URL is pushed to from the agent socket, which no token
/// name reaches.
///
/// This list is the subtractive half of the credential fence and can only
/// remove what it names. The additive half (a PATH whose `gh` and `ssh`
/// refuse, git redirected away from every inherited credential helper)
/// lives engine-side in `fence.ts`, because it is per-candidate state.
pub const CHILD_ENV_DENY: [&str; 6] = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
];

/// The driver protocol's request schema version.
pub const SESSION_REQUEST_SCHEMA_VERSION: &str = "1";

/// A model tier (040 B-2): a role the driver resolves to an id.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    Strong,
    Fast,
}

/// The request as it crosses the process boundary (043 B-1): the engine's
/// callbacks removed, nulls explicit, the profile serialized the way the
/// journal already does (032 B-5).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub schema_version: String,
    pub repo: String,
    pub prompt: String,
    pub tier: Option<ModelTier>,
    pub model: Option<String>,
    pub max_turns: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub mcp_config_path: Option<String>,
    pub profile: Option<Value>,
    pub kill_grace_ms: Option<u64>,
    /// Spec 120 B-3. Absent on the wire reads as empty (D-4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requirements: Option<Requirements>,
}

/// How a session ended (014 B-4, classified, never guessed).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminationKind {
    Completed,
    Auth,
    Quota,
    HookBlocked,
    Transient,
    Timeout,
    Killed,
    MaxTurns,
    Crashed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub kind: TerminationKind,
    /// Epoch ms when a quota reset is expected; null when no hint was
    /// present (014 FR-002: never a guess).
    pub reset_at_ms: Option<u64>,
    pub detail: String,
}

/// Unparseable provider stdout, kept verbatim and bounded (014 B-3).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverflowInfo {
    pub lines: Vec<String>,
    pub truncated_count: u64,
}

/// The result of one driven session (014 B-6), as 043 forwards it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionResult {
    pub classification: Classification,
    pub exit_code: Option<i64>,
    pub duration_ms: u64,
    pub num_turns: Option<u64>,
    /// Millionths of a dollar, so the journaled value stays an integer.
    pub cost_micro_usd: Option<u64>,
    pub usage: Option<BTreeMap<String, u64>>,
    pub session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub overflow: OverflowInfo,
    pub stderr_tail: String,
    /// Spec 119 B-5 (doc 04 D41): the refusals the harness reported, read
    /// from its structured event for a refused tool call. Independent of the
    /// classification. Absent on the wire reads as none (`default`).
    #[serde(default)]
    pub denials: u64,
    #[serde(default)]
    pub denial_samples: Vec<String>,
}

/// One line of the driver's stdout (043 B-2). The result variant grew two
/// fields in spec 119; one event per line, so the size gap is immaterial.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "event", rename_all = "lowercase")]
#[allow(clippy::large_enum_variant)]
pub enum DriverEvent {
    /// One append spec 014 would have made in-process, kind and payload
    /// verbatim; the engine journals it (043 B-3).
    Journal { kind: String, payload: Value },
    /// A provider event, verbatim, for the engine's sink.
    Stream { raw: Value },
    /// The last line.
    Result { result: SessionResult },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_parses_and_refuses_the_108_cases() {
        let json = r#"{"schemaVersion":"1","name":"statecraft-engine","version":"0.1.0","contract":"042","verbs":["orchestrator"],"capabilityTier":"basic","exitCodes":{"0":"ok"},"envelope":"ok-data"}"#;
        let m = Manifest::parse(json.as_bytes()).expect("parses");
        assert_eq!(m.dispatch_key(), "engine");
        assert_eq!(m.capability_tier, CapabilityTier::Basic);
        assert!(Manifest::parse(b"nope")
            .unwrap_err()
            .contains("does not parse"));
        let empty = json.replace(r#"["orchestrator"]"#, "[]");
        assert!(Manifest::parse(empty.as_bytes())
            .unwrap_err()
            .contains("no verbs"));
    }

    #[test]
    fn envelope_round_trips_both_arms() {
        let ok: Envelope<Value> = Envelope::ok(serde_json::json!({"n": 1}));
        let text = serde_json::to_string(&ok).unwrap();
        assert_eq!(text, r#"{"ok":true,"data":{"n":1}}"#);
        let back: Envelope<Value> = serde_json::from_str(&text).unwrap();
        assert!(back.is_ok());
        let err: Envelope<Value> = Envelope::err("unreachable", "no daemon", None);
        let text = serde_json::to_string(&err).unwrap();
        assert_eq!(
            text,
            r#"{"ok":false,"error":{"kind":"unreachable","message":"no daemon"}}"#
        );
        let back: Envelope<Value> = serde_json::from_str(&text).unwrap();
        assert!(!back.is_ok());
        let wrong: Result<Envelope<Value>, _> =
            serde_json::from_str(r#"{"ok":true,"error":{"kind":"x","message":"y"}}"#);
        assert!(wrong.is_err());
    }

    #[test]
    fn driver_event_is_tagged_on_event() {
        let line = r#"{"event":"stream","raw":{"type":"assistant"}}"#;
        let event: DriverEvent = serde_json::from_str(line).unwrap();
        assert!(matches!(event, DriverEvent::Stream { .. }));
        let kind = serde_json::to_string(&TerminationKind::HookBlocked).unwrap();
        assert_eq!(kind, r#""hook-blocked""#);
    }

    #[test]
    fn reserved_codes_sit_at_or_above_the_floor_and_the_taxonomy_below() {
        for code in [
            exit::MEMBER_NOT_FOUND,
            exit::MANIFEST_REFUSED,
            exit::CONTRACT_SKEW,
            exit::UNKNOWN_SUBVERB,
        ] {
            assert!(code >= exit::FLOOR);
        }
        for code in exit::d4_taxonomy().keys() {
            assert!(code.parse::<u8>().unwrap() < exit::FLOOR);
        }
    }
}
