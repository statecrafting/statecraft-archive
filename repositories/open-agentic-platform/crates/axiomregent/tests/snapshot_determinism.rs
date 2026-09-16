// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

// NOTE: The snapshot determinism test covered WorkspaceTools "snapshot" mode which has been
// removed in favour of the checkpoint module. This test now verifies that the deprecated
// "snapshot" mode returns a clear error.

use anyhow::Result;
use axiomregent::workspace::WorkspaceTools;

mod test_helpers;

#[tokio::test]
async fn test_snapshot_mode_deprecated() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let (_, lease_store) = test_helpers::make_client_and_lease_store(dir.path()).await;
    let workspace_tools = WorkspaceTools::new(lease_store);

    let res = workspace_tools
        .apply_patch(
            std::path::Path::new("/tmp"),
            "",
            "snapshot",
            None,
            None,
            None,
            false,
            false,
        )
        .await;

    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("deprecated"));

    Ok(())
}
