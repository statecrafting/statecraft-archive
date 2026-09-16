// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Line-level diff computation using the `similar` crate.

use similar::{ChangeTag, TextDiff};

use super::types::{DiffHunk, FileDiff};

/// Compute a [`FileDiff`] between two raw byte buffers.
///
/// If either buffer contains null bytes it is treated as binary and an empty
/// hunk list is returned.
pub fn create_file_diff(path: &str, old_content: &[u8], new_content: &[u8]) -> FileDiff {
    if is_binary(old_content) || is_binary(new_content) {
        return FileDiff {
            path: path.to_string(),
            hunks: vec![],
            lines_added: 0,
            lines_deleted: 0,
        };
    }

    let old = String::from_utf8_lossy(old_content);
    let new = String::from_utf8_lossy(new_content);

    let diff = TextDiff::from_lines(old.as_ref(), new.as_ref());
    let mut hunks: Vec<DiffHunk> = Vec::new();

    for hunk in diff.unified_diff().context_radius(3).iter_hunks() {
        // Derive start lines from the first DiffOp in the hunk (0-based → 1-based).
        let ops = hunk.ops();
        let from_line = ops.first().map(|op| op.old_range().start + 1).unwrap_or(1);
        let to_line = ops.first().map(|op| op.new_range().start + 1).unwrap_or(1);

        let mut lines: Vec<String> = Vec::new();
        for change in hunk.iter_changes() {
            let prefix = match change.tag() {
                ChangeTag::Insert => "+",
                ChangeTag::Delete => "-",
                ChangeTag::Equal => " ",
            };
            // Trim the trailing newline that `similar` includes in change values.
            let value = change.value().trim_end_matches('\n');
            lines.push(format!("{}{}", prefix, value));
        }
        hunks.push(DiffHunk {
            from_line,
            to_line,
            lines,
        });
    }

    let lines_added = hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.starts_with('+'))
        .count();
    let lines_deleted = hunks
        .iter()
        .flat_map(|h| &h.lines)
        .filter(|l| l.starts_with('-'))
        .count();

    FileDiff {
        path: path.to_string(),
        hunks,
        lines_added,
        lines_deleted,
    }
}

/// Return `true` if `content` looks like binary data (contains a null byte in
/// the first 8 KiB).
pub fn is_binary(content: &[u8]) -> bool {
    content.iter().take(8192).any(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_text_diff() {
        let old = b"line1\nline2\nline3\n";
        let new = b"line1\nchanged\nline3\n";
        let fd = create_file_diff("foo.txt", old, new);
        assert_eq!(fd.lines_added, 1);
        assert_eq!(fd.lines_deleted, 1);
        assert!(!fd.hunks.is_empty());
    }

    #[test]
    fn binary_returns_empty() {
        let old = b"hello\x00world";
        let new = b"hello\x00changed";
        let fd = create_file_diff("img.bin", old, new);
        assert!(fd.hunks.is_empty());
        assert_eq!(fd.lines_added, 0);
        assert_eq!(fd.lines_deleted, 0);
    }

    #[test]
    fn identical_files_no_hunks() {
        let content = b"same\nsame\n";
        let fd = create_file_diff("same.txt", content, content);
        assert!(fd.hunks.is_empty());
    }
}
