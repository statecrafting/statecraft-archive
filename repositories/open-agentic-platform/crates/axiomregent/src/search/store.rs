// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::Result;
use hiqlite::{Client, Param};
use serde::Deserialize;
use std::borrow::Cow;

use super::embeddings::{CodeVector, VECTOR_SIZE};

pub struct SearchStore {
    client: Client,
}

impl SearchStore {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Access the underlying hiqlite client for event emission.
    pub fn client(&self) -> &Client {
        &self.client
    }

    /// Store embeddings for a project. Clears existing entries first.
    pub async fn index_project(
        &self,
        project_name: &str,
        entries: Vec<IndexEntry>,
    ) -> Result<usize> {
        // Clear existing index for this project
        self.client
            .execute(
                Cow::Borrowed("DELETE FROM embeddings WHERE project_name = $1"),
                vec![Param::Text(project_name.to_string())],
            )
            .await?;

        let now = chrono::Utc::now().to_rfc3339();
        let count = entries.len();

        for entry in entries {
            let vector_blob: Vec<u8> = entry.vector.iter().flat_map(|f| f.to_le_bytes()).collect();

            self.client
                .execute(
                    Cow::Borrowed(
                        "INSERT INTO embeddings \
                         (project_name, file_path, block_type, function_name, \
                          code_content, vector, call_edges, indexed_at) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                    ),
                    vec![
                        Param::Text(project_name.to_string()),
                        Param::Text(entry.file_path),
                        Param::Text(entry.block_type),
                        entry.function_name.map(Param::Text).unwrap_or(Param::Null),
                        Param::Text(entry.code_content),
                        Param::Blob(vector_blob),
                        entry.call_edges.map(Param::Text).unwrap_or(Param::Null),
                        Param::Text(now.clone()),
                    ],
                )
                .await?;
        }

        Ok(count)
    }

    /// Load all vectors for a project as CodeVectors for kd-tree search.
    pub async fn load_vectors(&self, project_name: &str) -> Result<Vec<CodeVector>> {
        #[derive(Deserialize)]
        struct Row {
            file_path: String,
            block_type: String,
            function_name: Option<String>,
            code_content: String,
            vector: Vec<u8>,
        }

        let rows: Vec<Row> = self
            .client
            .query_as(
                "SELECT file_path, block_type, function_name, code_content, vector \
                 FROM embeddings WHERE project_name = $1",
                vec![Param::Text(project_name.to_string())],
            )
            .await?;

        let mut vectors = Vec::with_capacity(rows.len());
        for row in rows {
            if row.vector.len() != VECTOR_SIZE * 4 {
                // Skip malformed entries rather than failing the whole load
                continue;
            }
            let mut point = [0f32; VECTOR_SIZE];
            for (i, chunk) in row.vector.chunks_exact(4).enumerate() {
                point[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            }
            vectors.push(CodeVector {
                point,
                code: row.code_content,
                file_path: row.file_path,
                function_name: row.function_name,
                block_type: row.block_type,
            });
        }
        Ok(vectors)
    }

    /// Get indexed project stats.
    pub async fn project_stats(&self, project_name: &str) -> Result<Option<ProjectStats>> {
        #[derive(Deserialize)]
        struct StatsRow {
            count: i64,
        }

        let rows: Vec<StatsRow> = self
            .client
            .query_as(
                "SELECT COUNT(*) as count FROM embeddings WHERE project_name = $1",
                vec![Param::Text(project_name.to_string())],
            )
            .await?;

        match rows.into_iter().next() {
            Some(r) if r.count > 0 => Ok(Some(ProjectStats {
                project_name: project_name.to_string(),
                block_count: r.count as usize,
            })),
            _ => Ok(None),
        }
    }
}

pub struct IndexEntry {
    pub file_path: String,
    pub block_type: String,
    pub function_name: Option<String>,
    pub code_content: String,
    pub vector: [f32; VECTOR_SIZE],
    pub call_edges: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ProjectStats {
    pub project_name: String,
    pub block_count: usize,
}
