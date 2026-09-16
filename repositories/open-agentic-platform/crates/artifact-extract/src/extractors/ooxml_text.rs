// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Shared OOXML helpers used by the DOCX extractor.
//!
//! DOCX is a ZIP archive of XML files. These helpers read a file out of a
//! zip and scan for text nodes (`<w:t>`).

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::io::{Read, Seek};

#[derive(Debug, thiserror::Error)]
pub enum OoxmlError {
    #[error("archive entry missing: {0}")]
    MissingEntry(String),
    #[error("read archive entry {0}: {1}")]
    Io(String, #[source] std::io::Error),
    #[error("zip error: {0}")]
    Zip(#[from] ::zip::result::ZipError),
    #[error("xml parse error: {0}")]
    Xml(#[from] quick_xml::Error),
}

/// Read the full bytes of an archive entry into memory.
pub fn read_entry_bytes<R: Read + Seek>(
    archive: &mut ::zip::ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, OoxmlError> {
    let mut file = archive
        .by_name(name)
        .map_err(|_| OoxmlError::MissingEntry(name.into()))?;
    let mut buf = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut buf)
        .map_err(|e| OoxmlError::Io(name.into(), e))?;
    Ok(buf)
}

/// Collect all `<w:t>`/`<a:t>`-style text nodes into a vector of plain
/// strings. Ignores empty strings.
#[allow(dead_code)]
pub fn collect_text_nodes(xml: &[u8]) -> Result<Vec<String>, OoxmlError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out: Vec<String> = Vec::new();
    let mut in_text = false;
    let mut current = String::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(ref e) if is_text_element(e.local_name().as_ref()) => {
                in_text = true;
                current.clear();
            }
            Event::End(ref e) if is_text_element(e.local_name().as_ref()) => {
                if in_text && !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
                in_text = false;
            }
            Event::Empty(ref e) if is_text_element(e.local_name().as_ref()) => {
                // Some producers emit self-closed empty <w:t/> — nothing to collect.
            }
            Event::Text(ref t) if in_text => {
                let chunk = t
                    .unescape()
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| String::from_utf8_lossy(t.as_ref()).into_owned());
                current.push_str(&chunk);
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(out)
}

fn is_text_element(local: &[u8]) -> bool {
    // DOCX uses `w:t`; PPTX uses `a:t`. We match by local name only.
    local == b"t"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_docx_style_text_runs() {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> World</w:t></w:r></w:p></w:body>
        </w:document>"#;
        let out = collect_text_nodes(xml).unwrap();
        assert_eq!(out, vec!["Hello".to_string(), " World".to_string()]);
    }

    #[test]
    fn ignores_non_t_elements() {
        let xml = br#"<root><x>skip</x><w:t xmlns:w="w">keep</w:t></root>"#;
        let out = collect_text_nodes(xml).unwrap();
        assert_eq!(out, vec!["keep".to_string()]);
    }

    #[test]
    fn survives_self_closed_empty_text() {
        let xml = br#"<root><w:t xmlns:w="w"/><w:t xmlns:w="w">after</w:t></root>"#;
        let out = collect_text_nodes(xml).unwrap();
        assert_eq!(out, vec!["after".to_string()]);
    }
}
