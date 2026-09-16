// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use crate::canonical::validate_invariants;
use crate::schema::XrayIndex;
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;

pub struct DocsGenerator<'a> {
    index: &'a XrayIndex,
    out_dir: &'a Path,
}

impl<'a> DocsGenerator<'a> {
    pub fn new(index: &'a XrayIndex, out_dir: &'a Path) -> Self {
        Self { index, out_dir }
    }

    pub fn generate(&self) -> Result<()> {
        // Enforce invariants before rendering.
        // We refuse to document a corrupted index.
        validate_invariants(self.index)
            .context("Index validation failed before docs generation")?;

        fs::create_dir_all(self.out_dir).context("Failed to create output directory")?;

        self.render_index()?;
        self.render_files()?;
        self.render_modules()?;

        Ok(())
    }

    fn render_index(&self) -> Result<()> {
        let mut b = String::new();

        b.push_str(&render_header(1, "Context Index"));

        // Summary Stats
        b.push_str(&render_header(2, "Summary"));
        b.push_str(&format!("- **Root**: `{}`\n", self.index.root));
        b.push_str(&format!("- **Target**: `{}`\n", self.index.target));
        b.push_str(&format!("- **Digest**: `{}`\n", self.index.digest));
        b.push_str(&format!("- **Files**: {}\n", self.index.stats.file_count));
        b.push_str(&format!(
            "- **Total Size**: {} bytes\n",
            self.index.stats.total_size
        ));
        b.push('\n');

        // Languages
        b.push_str(&render_header(2, "Languages"));
        // Languages BTreeMap is already sorted by key.
        let rows: Vec<Vec<String>> = self
            .index
            .languages
            .iter()
            .map(|(k, v)| vec![k.clone(), v.to_string()])
            .collect();
        b.push_str(&render_table(
            vec!["Language".to_string(), "Files".to_string()],
            rows,
        ));
        b.push('\n');

        // Top Directories
        b.push_str(&render_header(2, "Top Directories"));
        let rows: Vec<Vec<String>> = self
            .index
            .top_dirs
            .iter()
            .map(|(k, v)| vec![k.clone(), v.to_string()])
            .collect();
        b.push_str(&render_table(
            vec!["Directory".to_string(), "Files".to_string()],
            rows,
        ));
        // b.push_str("\n"); // Trailing newline handled by table or atomic write? atomic write just dumps bytes.

        crate::write::write_atomic(&self.out_dir.join("index.md"), b.as_bytes())
    }

    fn render_files(&self) -> Result<()> {
        let mut b = String::new();
        b.push_str(&render_header(1, "File Inventory"));

        // Table: Path, Size, Language, LOC
        let headers = vec![
            "Path".to_string(),
            "Size".to_string(),
            "Language".to_string(),
            "LOC".to_string(),
        ];

        // Files are already strictly sorted by path
        let rows: Vec<Vec<String>> = self
            .index
            .files
            .iter()
            .map(|f| {
                vec![
                    f.path.clone(),
                    f.size.to_string(),
                    f.lang.clone(),
                    f.loc.to_string(),
                ]
            })
            .collect();

        b.push_str(&render_table(headers, rows));

        crate::write::write_atomic(&self.out_dir.join("files.md"), b.as_bytes())
    }

    fn render_modules(&self) -> Result<()> {
        let mut b = String::new();
        b.push_str(&render_header(1, "Module Files"));
        b.push_str("Key configuration files defining modules or dependencies.\n\n");

        b.push_str(&render_list(&self.index.module_files));

        crate::write::write_atomic(&self.out_dir.join("modules.md"), b.as_bytes())
    }
}

// --- Markdown Helpers ---

fn render_header(level: usize, text: &str) -> String {
    format!("{} {}\n\n", "#".repeat(level), text)
}

fn render_table(headers: Vec<String>, rows: Vec<Vec<String>>) -> String {
    let mut b = String::new();

    // Escape headers
    let escaped_headers: Vec<String> = headers.iter().map(|h| escape_table_cell(h)).collect();

    // Header Row
    b.push('|');
    for h in &escaped_headers {
        b.push_str(&format!(" {} |", h));
    }
    b.push('\n');

    // Separator Row
    b.push('|');
    for _ in &headers {
        b.push_str(" --- |");
    }
    b.push('\n');

    // Data Rows
    for row in rows {
        b.push('|');
        for cell in row {
            b.push_str(&format!(" {} |", escape_table_cell(&cell)));
        }
        b.push('\n');
    }

    b
}

fn render_list(items: &[String]) -> String {
    let mut b = String::new();
    for item in items {
        b.push_str(&format!("- `{}`\n", item));
    }
    b
}

fn escape_table_cell(s: &str) -> String {
    // Escape pipes | to \|
    // Escape newlines to \n to avoid breaking table rows
    s.replace("|", "\\|").replace("\n", "\\n")
}
