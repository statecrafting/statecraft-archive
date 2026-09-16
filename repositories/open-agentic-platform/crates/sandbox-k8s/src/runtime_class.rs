// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.4, §3 FR-005

//! RuntimeClass selection.
//!
//! Spec 186 §2.4 pins the deterministic selection algorithm: list
//! installed `RuntimeClass` resources, pick the strongest match
//! against the §2.4 table (alphabetical tie-break inside a tier),
//! record the realised tier on the `SandboxExecution`. This module
//! holds the pure selection function (cluster-independent, fully
//! unit-testable); `runtime.rs` is the cluster-aware wrapper that
//! calls `kube::Api::<RuntimeClass>::all().list(...)` and hands the
//! resulting name list to [`select`].

use factory_contracts::sandbox::IsolationTier;

/// Tier 1 RuntimeClass names per spec 186 §2.4. Case-insensitive
/// comparison. Sorted alphabetically so the tie-break in [`select`]
/// is stable.
pub(crate) const TIER1_RUNTIME_CLASSES: &[&str] = &[
    "firecracker",
    "firecracker-runc",
    "gvisor",
    "gvisor-runsc",
    "kata",
    "kata-clh",
    "kata-fc",
    "kata-qemu",
    "runsc",
];

/// Sentinel name reported in the `runtime_descriptor` when no
/// RuntimeClass is selected. Spec 186 §2.7 binds this exact string so
/// the certificate's descriptor field is stable under default runc.
pub const DEFAULT_RUNC_DESCRIPTOR_NAME: &str = "default-runc";

/// Outcome of a [`select`] call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Selection {
    /// The RuntimeClass to set on the Pod's `spec.runtimeClassName`, or
    /// `None` to leave the field unset (default runc).
    pub runtime_class_name: Option<String>,
    /// The realised tier the backend reports on the
    /// `SandboxExecution`. Per §2.4: Tier 1 when a sandbox runtime is
    /// matched, Tier 2 otherwise.
    pub realised_tier: IsolationTier,
    /// The name to embed in the descriptor — either the selected
    /// RuntimeClass name or [`DEFAULT_RUNC_DESCRIPTOR_NAME`].
    pub descriptor_name: String,
}

/// Pure selection function: given the list of `RuntimeClass`
/// `metadata.name` values installed in the cluster, pick the strongest
/// Tier 1 match (alphabetical tie-break inside the tier). If none
/// match, return the Tier 2 default-runc selection.
///
/// Case-insensitive comparison; whitespace is not trimmed (callers
/// pass the names as kube-rs returns them, and RuntimeClass names are
/// DNS-1123 labels which already forbid whitespace).
pub(crate) fn select(installed: &[String]) -> Selection {
    let mut tier1: Vec<&str> = installed
        .iter()
        .map(|s| s.as_str())
        .filter(|name| {
            let lc = name.to_lowercase();
            TIER1_RUNTIME_CLASSES
                .iter()
                .any(|candidate| *candidate == lc)
        })
        .collect();
    tier1.sort();
    if let Some(picked) = tier1.first() {
        return Selection {
            runtime_class_name: Some((*picked).to_string()),
            realised_tier: IsolationTier::SandboxRuntime,
            descriptor_name: (*picked).to_string(),
        };
    }
    Selection {
        runtime_class_name: None,
        realised_tier: IsolationTier::RestrictedContainer,
        descriptor_name: DEFAULT_RUNC_DESCRIPTOR_NAME.to_string(),
    }
}

/// FR-A3 — reject admission when the request requires `SandboxRuntime`
/// (Tier 1) but no Tier 1 RuntimeClass is installed. Pure (no kube-rs
/// call); the caller hands the result of [`select`] in.
pub(crate) fn admission_for_tier1_requirement(
    min_tier: IsolationTier,
    selection: &Selection,
) -> Result<(), String> {
    if matches!(min_tier, IsolationTier::SandboxRuntime)
        && !matches!(selection.realised_tier, IsolationTier::SandboxRuntime)
    {
        return Err(format!(
            "spec 186 FR-A3: minimum_isolation_tier=SandboxRuntime requires a Tier 1 \
             RuntimeClass installed in the cluster; none of {names:?} are present \
             (selection landed on default-runc / Tier 2)",
            names = TIER1_RUNTIME_CLASSES,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_list_yields_default_runc_tier_2() {
        let s = select(&[]);
        assert_eq!(s.runtime_class_name, None);
        assert_eq!(s.realised_tier, IsolationTier::RestrictedContainer);
        assert_eq!(s.descriptor_name, "default-runc");
    }

    #[test]
    fn only_unknown_classes_yields_default_runc() {
        let s = select(&["my-custom-runtime".into(), "other".into()]);
        assert_eq!(s.runtime_class_name, None);
        assert_eq!(s.realised_tier, IsolationTier::RestrictedContainer);
    }

    #[test]
    fn gvisor_selected_when_present_alone() {
        let s = select(&["gvisor".into()]);
        assert_eq!(s.runtime_class_name, Some("gvisor".into()));
        assert_eq!(s.realised_tier, IsolationTier::SandboxRuntime);
        assert_eq!(s.descriptor_name, "gvisor");
    }

    #[test]
    fn kata_selected_when_present_alone() {
        let s = select(&["kata-qemu".into()]);
        assert_eq!(s.runtime_class_name, Some("kata-qemu".into()));
        assert_eq!(s.realised_tier, IsolationTier::SandboxRuntime);
    }

    #[test]
    fn case_insensitive_match() {
        let s = select(&["GVisor".into()]);
        assert_eq!(s.realised_tier, IsolationTier::SandboxRuntime);
        // The descriptor_name uses the as-installed casing — Pod
        // spec.runtimeClassName must match the actual resource name.
        assert_eq!(s.runtime_class_name, Some("GVisor".into()));
        assert_eq!(s.descriptor_name, "GVisor");
    }

    #[test]
    fn alphabetical_tie_break_inside_tier_1() {
        // Three Tier 1 classes installed; selection lands on the
        // alphabetically-first to keep the choice deterministic.
        let s = select(&["kata".into(), "gvisor".into(), "firecracker".into()]);
        assert_eq!(s.runtime_class_name, Some("firecracker".into()));
        assert_eq!(s.realised_tier, IsolationTier::SandboxRuntime);
    }

    #[test]
    fn tier_1_picked_over_unknown_classes() {
        let s = select(&[
            "my-custom-runtime".into(),
            "kata-clh".into(),
            "other".into(),
        ]);
        assert_eq!(s.runtime_class_name, Some("kata-clh".into()));
        assert_eq!(s.realised_tier, IsolationTier::SandboxRuntime);
    }

    #[test]
    fn admission_passes_when_tier_2_acceptable() {
        let s = select(&[]);
        assert!(
            admission_for_tier1_requirement(IsolationTier::RestrictedContainer, &s).is_ok()
        );
    }

    #[test]
    fn admission_passes_when_tier_1_required_and_available() {
        let s = select(&["gvisor".into()]);
        assert!(admission_for_tier1_requirement(IsolationTier::SandboxRuntime, &s).is_ok());
    }

    #[test]
    fn admission_rejects_when_tier_1_required_but_absent() {
        let s = select(&["my-custom-runtime".into()]);
        let err = admission_for_tier1_requirement(IsolationTier::SandboxRuntime, &s)
            .unwrap_err();
        assert!(err.contains("FR-A3"));
        assert!(err.contains("gvisor"));
        assert!(err.contains("default-runc"));
    }

    #[test]
    fn tier1_set_is_sorted_and_lowercase() {
        // Invariant on TIER1_RUNTIME_CLASSES — required because the
        // matcher lower-cases inputs and the documented set in spec
        // 186 §2.4 is presented sorted. A test on the constant catches
        // accidental edits that would silently change selection.
        let mut sorted = TIER1_RUNTIME_CLASSES.to_vec();
        sorted.sort();
        assert_eq!(sorted, TIER1_RUNTIME_CLASSES);
        for name in TIER1_RUNTIME_CLASSES {
            assert_eq!(*name, name.to_lowercase());
        }
    }
}
