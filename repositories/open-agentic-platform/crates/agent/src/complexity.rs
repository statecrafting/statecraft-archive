// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 043-agent-organizer — deterministic complexity scoring (specs/043-agent-organizer/spec.md § Architecture)

use crate::plan::{ComplexityBreakdown, band_from_score};
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::LazyLock;

/// Signal keys aligned to the Architecture table (stable for JSON audit fields).
pub const SIGNAL_PROMPT_LENGTH: &str = "prompt_length";
pub const SIGNAL_ACTION_VERBS: &str = "action_verbs";
pub const SIGNAL_MULTI_STEP_CONNECTORS: &str = "multi_step_connectors";
pub const SIGNAL_TECHNOLOGY_BREADTH: &str = "technology_breadth";
pub const SIGNAL_SCOPE_INDICATORS: &str = "scope_indicators";
pub const SIGNAL_FILE_PATH_REFERENCES: &str = "file_path_references";

static VERB_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)\b(?:",
        "create|build|implement|refactor|fix|add|remove|update|migrate|deploy|",
        "test|review|analyze|design|optimize",
        r")\b"
    ))
    .expect("verb regex")
});

static CONNECTOR_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)\bfollowed\s+by\b").expect("followed by"),
        Regex::new(r"(?i)\b(?:then|after|next|finally|first|also|additionally|once|before)\b")
            .expect("connectors"),
    ]
});

static TECH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)\b(?:",
        "frontend|backend|database|\\bapi\\b|infrastructure|testing|security|ci/cd",
        r")\b"
    ))
    .expect("tech regex")
});

static SCOPE_RES: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)across\s+all").expect("across all"),
        Regex::new(r"(?i)entire\s+codebase").expect("entire codebase"),
        Regex::new(r"(?i)end-to-end").expect("end-to-end"),
        Regex::new(r"(?i)full-stack").expect("full-stack"),
        Regex::new(r"(?i)comprehensive").expect("comprehensive"),
    ]
});

/// Path-like segments: slash/backslash paths, common globs, `file.ext` tokens.
static PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)(?:",
        r"\*\*|\*\.\w+|[\w.-]+(?:/|\\)[\w./\\-]+",
        r"|\b[\w-]+\.(?:rs|ts|tsx|js|mjs|cjs|json|md|toml|yaml|yml|lock)\b",
        r")"
    ))
    .expect("path regex")
});

fn prompt_length_signal(len: usize) -> f64 {
    if len <= 50 {
        0.0
    } else if len >= 2000 {
        20.0
    } else {
        20.0 * (len - 50) as f64 / (2000 - 50) as f64
    }
}

fn action_verb_signal(prompt: &str) -> f64 {
    let n = VERB_RE.find_iter(prompt).count();
    match n {
        0 => 0.0,
        1 => 5.0,
        2 => 10.0,
        3 => 15.0,
        _ => 20.0,
    }
}

fn connector_signal(prompt: &str) -> f64 {
    let mut n = 0usize;
    for re in CONNECTOR_RES.iter() {
        n += re.find_iter(prompt).count();
    }
    (n as f64 * 5.0).min(20.0)
}

fn technology_breadth_signal(prompt: &str) -> f64 {
    let mut seen = std::collections::BTreeSet::new();
    for m in TECH_RE.find_iter(prompt) {
        seen.insert(m.as_str().to_ascii_lowercase());
    }
    let distinct = seen.len();
    (distinct as f64 * 5.0).min(15.0)
}

fn scope_signal(prompt: &str) -> f64 {
    let mut total = 0.0f64;
    for re in SCOPE_RES.iter() {
        if re.is_match(prompt) {
            total += 5.0;
        }
    }
    total.min(15.0)
}

fn file_path_signal(prompt: &str) -> f64 {
    let n = PATH_RE.find_iter(prompt).count();
    match n {
        0 => 0.0,
        1 | 2 => 3.0,
        3..=5 => 6.0,
        _ => 10.0,
    }
}

fn round_score(sum: f64) -> u8 {
    let s = sum.round();
    if s < 0.0 {
        0
    } else if s > 100.0 {
        100
    } else {
        s as u8
    }
}

/// Deterministic complexity heuristic: same `prompt` always yields the same breakdown (NF-002, SC-005).
pub fn score_complexity(prompt: &str) -> ComplexityBreakdown {
    let len = prompt.chars().count();
    let s_len = prompt_length_signal(len);
    let s_verbs = action_verb_signal(prompt);
    let s_conn = connector_signal(prompt);
    let s_tech = technology_breadth_signal(prompt);
    let s_scope = scope_signal(prompt);
    let s_paths = file_path_signal(prompt);

    let sum = s_len + s_verbs + s_conn + s_tech + s_scope + s_paths;
    let score = round_score(sum);
    let band = band_from_score(score);

    let signals = BTreeMap::from([
        (SIGNAL_PROMPT_LENGTH.to_string(), s_len),
        (SIGNAL_ACTION_VERBS.to_string(), s_verbs),
        (SIGNAL_MULTI_STEP_CONNECTORS.to_string(), s_conn),
        (SIGNAL_TECHNOLOGY_BREADTH.to_string(), s_tech),
        (SIGNAL_SCOPE_INDICATORS.to_string(), s_scope),
        (SIGNAL_FILE_PATH_REFERENCES.to_string(), s_paths),
    ]);

    ComplexityBreakdown {
        score,
        band,
        signals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::ComplexityBand;

    #[test]
    fn sc005_identical_prompts_identical_breakdown() {
        let p = "Create a module, then add tests, then deploy to staging.";
        let a = score_complexity(p);
        let b = score_complexity(p);
        assert_eq!(a, b);
    }

    #[test]
    fn nf002_scoring_is_pure_no_side_effects() {
        let p = "fix typo";
        assert_eq!(score_complexity(p), score_complexity(p));
    }

    #[test]
    fn cap_prompt_length_max_20() {
        let p = "x".repeat(2500);
        let b = score_complexity(&p);
        assert!(
            b.signals[SIGNAL_PROMPT_LENGTH] <= 20.0 + f64::EPSILON,
            "got {}",
            b.signals[SIGNAL_PROMPT_LENGTH]
        );
    }

    #[test]
    fn cap_action_verbs_max_20() {
        let p = "create build implement refactor fix add remove update migrate deploy test review analyze design optimize extra";
        let b = score_complexity(p);
        assert_eq!(b.signals[SIGNAL_ACTION_VERBS], 20.0);
    }

    #[test]
    fn cap_connectors_max_20() {
        let p = "then after next finally first also additionally followed by once before \
                 then after next finally first also additionally followed by once before";
        let b = score_complexity(p);
        assert_eq!(b.signals[SIGNAL_MULTI_STEP_CONNECTORS], 20.0);
    }

    #[test]
    fn cap_technology_breadth_max_15() {
        let p = "frontend backend database API infrastructure testing security CI/CD";
        let b = score_complexity(p);
        assert_eq!(b.signals[SIGNAL_TECHNOLOGY_BREADTH], 15.0);
    }

    #[test]
    fn cap_scope_max_15() {
        let p = "across all entire codebase end-to-end full-stack comprehensive";
        let b = score_complexity(p);
        assert_eq!(b.signals[SIGNAL_SCOPE_INDICATORS], 15.0);
    }

    #[test]
    fn cap_file_paths_max_10() {
        let p = "a/b/c.rs d/e/f.ts g/h/i.js j/k/l.md m/n/o.json p/q/r.toml";
        let b = score_complexity(p);
        assert_eq!(b.signals[SIGNAL_FILE_PATH_REFERENCES], 10.0);
    }

    #[test]
    fn band_boundary_scores_via_constructed_totals() {
        // Directly exercise band mapping for documented thresholds (plan F-006).
        assert_eq!(band_from_score(25), ComplexityBand::Simple);
        assert_eq!(band_from_score(26), ComplexityBand::Moderate);
        assert_eq!(band_from_score(50), ComplexityBand::Moderate);
        assert_eq!(band_from_score(51), ComplexityBand::Complex);
        assert_eq!(band_from_score(75), ComplexityBand::Complex);
        assert_eq!(band_from_score(76), ComplexityBand::HighlyComplex);
    }

    #[test]
    fn score_fits_band_from_breakdown() {
        let p = "hello";
        let b = score_complexity(p);
        assert_eq!(b.band, band_from_score(b.score));
    }
}
