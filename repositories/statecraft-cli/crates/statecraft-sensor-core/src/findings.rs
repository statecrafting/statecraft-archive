//! The FINDINGS reader (`explain`): sections whose headings are path
//! patterns, matched against a relative path, longest pattern first.

use regex::Regex;

pub struct Section {
    pub pattern: String,
    pub re: Regex,
    pub body: String,
}

/// FINDINGS sections start with a heading of the form ``## `path/pattern` ``.
/// Placeholders like `<slug>` or `<uuid>` match one path segment; a pattern
/// for a directory also matches everything beneath it.
pub fn load_sections(text: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut parts = split_headings(text);
    if !parts.is_empty() {
        parts.remove(0);
    }
    let heading_re = Regex::new(r"^`([^`]+)`").unwrap();
    let placeholder = Regex::new(r"<[^>]+>").unwrap();
    for part in parts {
        let nl = part.find('\n').unwrap_or(part.len());
        let heading = part[..nl].trim();
        let Some(m) = heading_re.captures(heading) else {
            continue;
        };
        let pattern = m[1].to_string();
        let mut src = regex::escape(&pattern);
        // regex::escape escapes `<` and `>`? It does not, but the placeholder
        // is matched on the escaped text, where `-` and `.` may be escaped.
        src = placeholder.replace_all(&src, "[^/]+").into_owned();
        if pattern.ends_with('/') {
            src.push_str(".*");
        }
        let Ok(re) = Regex::new(&format!("^{src}$")) else {
            continue;
        };
        let body = if nl < part.len() {
            part[nl + 1..].trim()
        } else {
            ""
        }
        .to_string();
        sections.push(Section { pattern, re, body });
    }
    sections
}

/// `text.split(/^## /m)`: the pieces between level-two headings, the
/// preamble first.
fn split_headings(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let at_line_start = i == 0 || bytes[i - 1] == b'\n';
        if at_line_start && &bytes[i..i + 3] == b"## " {
            parts.push(&text[start..i]);
            start = i + 3;
            i += 3;
            continue;
        }
        i += 1;
    }
    parts.push(&text[start..]);
    parts
}

/// The best section for a path: an exact match, longest pattern first;
/// else the longest directory pattern the path sits under.
pub fn best_match<'a>(sections: &'a [Section], rel_path: &str) -> Option<&'a Section> {
    let placeholder = Regex::new(r"<[^>]+>").unwrap();
    let mut exact: Vec<&Section> = sections
        .iter()
        .filter(|s| s.re.is_match(rel_path))
        .collect();
    exact.sort_by_key(|s| std::cmp::Reverse(s.pattern.len()));
    if let Some(best) = exact.first() {
        return Some(best);
    }
    let with_slash = format!("{rel_path}/");
    let mut under: Vec<&Section> = sections
        .iter()
        .filter(|s| {
            s.pattern.ends_with('/')
                && with_slash.starts_with(&placeholder.replace_all(&s.pattern, "?").into_owned())
                && s.re.is_match(&format!("{rel_path}/x"))
        })
        .collect();
    under.sort_by_key(|s| std::cmp::Reverse(s.pattern.len()));
    under.first().copied()
}

/// The first paragraph block of a body: everything before its first `### `.
pub fn lead(body: &str) -> &str {
    match body.find("\n### ") {
        Some(i) => body[..i].trim(),
        None => body.trim(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "# Findings\n\nintro\n\n## `projects/<slug>/<uuid>.jsonl`\n\nA transcript.\n\n### detail\n\nmore\n\n## `projects/`\n\nThe projects tree.\n";

    #[test]
    fn sections_match_placeholders_and_directory_patterns() {
        let sections = load_sections(TEXT);
        assert_eq!(sections.len(), 2);
        let best = best_match(
            &sections,
            "projects/x/0123abcd-0000-0000-0000-000000000000.jsonl",
        )
        .unwrap();
        assert_eq!(best.pattern, "projects/<slug>/<uuid>.jsonl");
        assert_eq!(lead(&best.body), "A transcript.");
        let dir = best_match(&sections, "projects/x/memory").unwrap();
        assert_eq!(dir.pattern, "projects/");
        assert!(best_match(&sections, "elsewhere").is_none());
    }
}
