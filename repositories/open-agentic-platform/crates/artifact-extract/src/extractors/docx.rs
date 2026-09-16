// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-005, FR-006, FR-009

//! Deterministic DOCX extractor. Mirrors statecraft's
//! `deterministic-docx.ts`.
//!
//! DOCX is OOXML: a ZIP archive with `word/document.xml` as the main
//! content stream. We collect text per paragraph and lift `Heading{N}`
//! styles into the typed outline.

use crate::{ExtractError, check_size};
use factory_contracts::knowledge::{ExtractionOutlineEntry, ExtractionOutput, Extractor};
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use serde_json::json;
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

pub const KIND: &str = "deterministic-docx";
pub const VERSION: &str = "1";
pub const MAX_BYTES: u64 = 100 * 1024 * 1024;

pub fn extract(path: &Path) -> Result<ExtractionOutput, ExtractError> {
    check_size(path, MAX_BYTES)?;
    let file = File::open(path).map_err(|e| ExtractError::io(path, e))?;
    let mut archive = ::zip::ZipArchive::new(file)
        .map_err(|e| ExtractError::parse(KIND, format!("not a docx archive: {e}")))?;
    let xml = super::ooxml_text::read_entry_bytes(&mut archive, "word/document.xml")
        .map_err(|e| ExtractError::parse(KIND, e.to_string()))?;

    let parsed = render(&xml).map_err(|e| ExtractError::parse(KIND, e.to_string()))?;

    let word_count = parsed
        .text
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .count() as u64;

    let mut metadata = HashMap::new();
    metadata.insert("wordCount".into(), json!(word_count));

    Ok(ExtractionOutput {
        text: parsed.text,
        pages: None,
        language: None,
        outline: Some(parsed.outline),
        metadata,
        extractor: Extractor {
            kind: KIND.into(),
            version: VERSION.into(),
            agent_run: None,
        },
    })
}

struct Parsed {
    text: String,
    outline: Vec<ExtractionOutlineEntry>,
}

fn render(xml: &[u8]) -> Result<Parsed, quick_xml::Error> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    let mut paragraphs: Vec<String> = Vec::new();
    let mut outline: Vec<ExtractionOutlineEntry> = Vec::new();

    let mut p_style: Option<String> = None;
    let mut p_text = String::new();
    let mut in_t = false;
    let mut t_buf = String::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(ref e) => match e.local_name().as_ref() {
                b"p" => {
                    p_style = None;
                    p_text.clear();
                }
                b"pStyle" => {
                    if let Some(v) = attr_val(e, b"val") {
                        p_style = Some(v);
                    }
                }
                b"t" => {
                    in_t = true;
                    t_buf.clear();
                }
                _ => {}
            },
            Event::Empty(ref e) => {
                if e.local_name().as_ref() == b"pStyle"
                    && let Some(v) = attr_val(e, b"val")
                {
                    p_style = Some(v);
                }
            }
            Event::End(ref e) => match e.local_name().as_ref() {
                b"t" => {
                    in_t = false;
                    p_text.push_str(&t_buf);
                    t_buf.clear();
                }
                b"p" => {
                    let trimmed = p_text.trim_end().to_string();
                    if let Some(level) = heading_level(p_style.as_deref())
                        && !trimmed.is_empty()
                    {
                        outline.push(ExtractionOutlineEntry {
                            level: level as u64,
                            text: trimmed.clone(),
                            page_index: None,
                        });
                    }
                    paragraphs.push(trimmed);
                    p_style = None;
                    p_text.clear();
                }
                _ => {}
            },
            Event::Text(ref t) if in_t => {
                let chunk = t
                    .unescape()
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| String::from_utf8_lossy(t.as_ref()).into_owned());
                t_buf.push_str(&chunk);
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(Parsed {
        text: paragraphs.join("\n"),
        outline,
    })
}

fn heading_level(style: Option<&str>) -> Option<u32> {
    let s = style?;
    let rest = s.strip_prefix("Heading")?;
    rest.chars().next()?.to_digit(10)
}

fn attr_val(e: &BytesStart, name: &[u8]) -> Option<String> {
    for attr in e.attributes().flatten() {
        if attr.key.local_name().as_ref() == name {
            let s = attr
                .unescape_value()
                .unwrap_or_else(|_| String::from_utf8_lossy(&attr.value).into_owned().into())
                .to_string();
            return Some(s);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC_XML: &[u8] = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Overview</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Intro paragraph.</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Details</w:t></w:r>
    </w:p>
  </w:body>
</w:document>"#;

    #[test]
    fn renders_paragraphs_and_outline() {
        let parsed = render(DOC_XML).unwrap();
        assert!(parsed.text.contains("Overview"));
        assert!(parsed.text.contains("Intro paragraph."));
        assert_eq!(parsed.outline.len(), 2);
        assert_eq!(parsed.outline[0].level, 1);
        assert_eq!(parsed.outline[0].text, "Overview");
        assert_eq!(parsed.outline[1].level, 2);
        assert_eq!(parsed.outline[1].text, "Details");
    }
}
