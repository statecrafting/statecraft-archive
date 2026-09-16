// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

// NOTE: The persistence tests previously tested the legacy snapshot Store (store.rs) which
// has been removed as part of the snapshot → checkpoint consolidation. Blob and snapshot
// persistence is now handled by the checkpoint module (CheckpointStore + CheckpointBlobStore).
