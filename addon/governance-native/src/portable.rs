//! The portable admission rule (spec 010 A-3), additive beside the lenient
//! functions.
//!
//! [`canonicalize`] and [`append`] refuse, by JSON pointer and reason code,
//! the inputs the lenient pair would silently rewrite: a duplicate member at
//! any depth, a number token with a fraction or exponent, an integer outside
//! -(2^53 - 1) through 2^53 - 1, and an escape that is not valid Unicode.
//! Everything they admit goes to [`crate::canon::canonicalize`] and
//! [`crate::ledger::append`] unchanged, so an admitted input's output,
//! record hash included, is exactly the lenient function's, and portable and
//! lenient records share one chain and one `ledgerVerify`.
//!
//! The rule is judged on the tokens as submitted, not on a parsed `Value`:
//! by the time `serde_json` has parsed `12345678901234567890123` it is an
//! `f64`, and `{"a":1,"a":2}` is `{"a":2}`. [`scan`] is therefore its own
//! RFC 8259 scanner. It decides portability and nothing else: a document it
//! finds malformed is handed to the lenient function so the refusal is the
//! one callers get today, and it never admits anything `serde_json` would
//! not parse.

use std::collections::HashSet;
use std::fmt;
use std::path::Path;

use crate::canon::Canonical;
use crate::ledger::Appended;

/// The largest integer every runtime in the family represents exactly
/// (`Number.MAX_SAFE_INTEGER`; spec 010 D-5).
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Why an input is not portable. The code is the stable part of a refusal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    DuplicateMember,
    NonIntegerNumber,
    UnsafeInteger,
    InvalidUnicode,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Reason::DuplicateMember => "duplicate-member",
            Reason::NonIntegerNumber => "non-integer-number",
            Reason::UnsafeInteger => "unsafe-integer",
            Reason::InvalidUnicode => "invalid-unicode",
        }
    }

    fn explanation(self) -> &'static str {
        match self {
            Reason::DuplicateMember => "an object member name appears twice",
            Reason::NonIntegerNumber => "a number with a fraction or exponent, or -0, is not an integer",
            Reason::UnsafeInteger => "an integer outside -(2^53 - 1) through 2^53 - 1",
            Reason::InvalidUnicode => "a \\u escape is an unpaired surrogate",
        }
    }
}

/// The first non-portable token in document order, and where it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub reason: Reason,
    /// RFC 6901 JSON pointer; the empty string is the whole document.
    pub pointer: String,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pointer = serde_json::to_string(&self.pointer).map_err(|_| fmt::Error)?;
        write!(
            f,
            "{} at JSON pointer {pointer}: {}",
            self.reason.code(),
            self.reason.explanation()
        )
    }
}

/// A portable call's failure: a refusal of this rule, or the lenient
/// function's own error, unchanged.
#[derive(Debug, PartialEq, Eq)]
pub enum PortableError {
    Refused(Refusal),
    Lenient(String),
}

/// What [`scan`] decided.
#[derive(Debug, PartialEq, Eq)]
pub enum Scan {
    Portable,
    Refused(Refusal),
    Malformed,
}

/// Raised if the scanner calls a document malformed that `serde_json`
/// parses. Nothing is admitted on that path; a test holds it unreachable.
const DISAGREEMENT: &str =
    "portable: the admission scanner and serde_json disagree about this document; refused";

/// [`crate::canon::canonicalize`] for portable input only.
pub fn canonicalize(json: &str) -> Result<Canonical, PortableError> {
    match scan(json) {
        Scan::Portable => crate::canon::canonicalize(json).map_err(PortableError::Lenient),
        Scan::Refused(refusal) => Err(PortableError::Refused(refusal)),
        Scan::Malformed => match crate::canon::canonicalize(json) {
            Err(err) => Err(PortableError::Lenient(err)),
            Ok(_) => Err(PortableError::Lenient(DISAGREEMENT.to_string())),
        },
    }
}

/// [`crate::ledger::append`] for portable input only. A refusal touches no
/// file under `dir`.
pub fn append(dir: &Path, record_json: &str) -> Result<Appended, PortableError> {
    match scan(record_json) {
        Scan::Portable => crate::ledger::append(dir, record_json).map_err(PortableError::Lenient),
        Scan::Refused(refusal) => Err(PortableError::Refused(refusal)),
        Scan::Malformed => {
            // Check before delegating: the lenient append writes on success.
            if serde_json::from_str::<serde_json::Value>(record_json).is_ok() {
                return Err(PortableError::Lenient(DISAGREEMENT.to_string()));
            }
            crate::ledger::append(dir, record_json).map_err(PortableError::Lenient)
        }
    }
}

/// Scan a whole document: the first refusal in document order if it is
/// well-formed and not portable, `Malformed` if it is not RFC 8259 JSON.
pub fn scan(json: &str) -> Scan {
    let mut scanner = Scanner {
        text: json,
        bytes: json.as_bytes(),
        pos: 0,
        pointer: String::new(),
        first: None,
    };
    match scanner.document() {
        Ok(()) => match scanner.first {
            Some(refusal) => Scan::Refused(refusal),
            None => Scan::Portable,
        },
        Err(Malformed) => Scan::Malformed,
    }
}

struct Malformed;

enum Container {
    /// Member names seen so far, decoded.
    Object(HashSet<String>),
    /// Index of the current element.
    Array(usize),
}

struct Scanner<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
    /// Pointer of the value being scanned.
    pointer: String,
    first: Option<Refusal>,
}

impl Scanner<'_> {
    fn document(&mut self) -> Result<(), Malformed> {
        // Each entry: the container, and the pointer length of the container
        // itself, to which the pointer is truncated between members.
        let mut stack: Vec<(Container, usize)> = Vec::new();
        'value: loop {
            self.skip_ws();
            match self.peek() {
                Some(b'{') => {
                    self.pos += 1;
                    self.skip_ws();
                    if self.peek() == Some(b'}') {
                        self.pos += 1;
                    } else {
                        let mut names = HashSet::new();
                        let base = self.pointer.len();
                        self.member_name(&mut names)?;
                        stack.push((Container::Object(names), base));
                        continue 'value;
                    }
                }
                Some(b'[') => {
                    self.pos += 1;
                    self.skip_ws();
                    if self.peek() == Some(b']') {
                        self.pos += 1;
                    } else {
                        stack.push((Container::Array(0), self.pointer.len()));
                        self.pointer.push_str("/0");
                        continue 'value;
                    }
                }
                Some(b'"') => {
                    if !self.string(None)? {
                        let pointer = self.pointer.clone();
                        self.refuse(Reason::InvalidUnicode, pointer);
                    }
                }
                Some(b'-' | b'0'..=b'9') => self.number()?,
                Some(b't') => self.literal(b"true")?,
                Some(b'f') => self.literal(b"false")?,
                Some(b'n') => self.literal(b"null")?,
                _ => return Err(Malformed),
            }

            // A value is complete: close containers until one continues.
            loop {
                self.skip_ws();
                let Some((container, base)) = stack.last_mut() else {
                    return if self.pos == self.bytes.len() { Ok(()) } else { Err(Malformed) };
                };
                self.pointer.truncate(*base);
                match (container, self.peek()) {
                    (Container::Object(names), Some(b',')) => {
                        self.pos += 1;
                        self.skip_ws();
                        self.member_name(names)?;
                        continue 'value;
                    }
                    (Container::Array(index), Some(b',')) => {
                        self.pos += 1;
                        *index += 1;
                        self.pointer.push('/');
                        self.pointer.push_str(&index.to_string());
                        continue 'value;
                    }
                    (Container::Object(_), Some(b'}')) | (Container::Array(_), Some(b']')) => {
                        self.pos += 1;
                        stack.pop();
                    }
                    _ => return Err(Malformed),
                }
            }
        }
    }

    /// A member name and its colon. Leaves the pointer at the member.
    fn member_name(&mut self, names: &mut HashSet<String>) -> Result<(), Malformed> {
        if self.peek() != Some(b'"') {
            return Err(Malformed);
        }
        let mut name = String::new();
        let valid = self.string(Some(&mut name))?;
        self.pointer.push('/');
        self.pointer.push_str(&name.replace('~', "~0").replace('/', "~1"));
        if !valid {
            let pointer = self.pointer.clone();
            self.refuse(Reason::InvalidUnicode, pointer);
        }
        if !names.insert(name) {
            let pointer = self.pointer.clone();
            self.refuse(Reason::DuplicateMember, pointer);
        }
        self.skip_ws();
        if self.peek() != Some(b':') {
            return Err(Malformed);
        }
        self.pos += 1;
        Ok(())
    }

    /// A string starting at its opening quote. Decodes into `out` when given
    /// (an unpaired surrogate becomes U+FFFD there). Returns whether every
    /// escape was valid Unicode.
    fn string(&mut self, mut out: Option<&mut String>) -> Result<bool, Malformed> {
        self.pos += 1;
        let mut valid = true;
        let mut run = self.pos;
        loop {
            let Some(byte) = self.peek() else {
                return Err(Malformed);
            };
            match byte {
                b'"' => {
                    if let Some(out) = out.as_deref_mut() {
                        out.push_str(&self.text[run..self.pos]);
                    }
                    self.pos += 1;
                    return Ok(valid);
                }
                b'\\' => {
                    if let Some(out) = out.as_deref_mut() {
                        out.push_str(&self.text[run..self.pos]);
                    }
                    self.pos += 1;
                    let escape = self.peek().ok_or(Malformed)?;
                    self.pos += 1;
                    let decoded = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let unit = self.hex4()?;
                            self.unicode_escape(unit)?.unwrap_or_else(|| {
                                valid = false;
                                char::REPLACEMENT_CHARACTER
                            })
                        }
                        _ => return Err(Malformed),
                    };
                    if let Some(out) = out.as_deref_mut() {
                        out.push(decoded);
                    }
                    run = self.pos;
                }
                0x00..=0x1f => return Err(Malformed),
                _ => self.pos += 1,
            }
        }
    }

    /// The code point of a `\u` escape whose four hex digits were just read,
    /// consuming a following low-surrogate escape when this one is high.
    /// `None` is an unpaired surrogate.
    fn unicode_escape(&mut self, unit: u32) -> Result<Option<char>, Malformed> {
        match unit {
            0xD800..=0xDBFF => {
                if self.bytes[self.pos..].starts_with(b"\\u") {
                    let resume = self.pos;
                    self.pos += 2;
                    let low = self.hex4()?;
                    if (0xDC00..=0xDFFF).contains(&low) {
                        let code = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                        return Ok(char::from_u32(code));
                    }
                    // Not a low surrogate: that escape is read on its own.
                    self.pos = resume;
                }
                Ok(None)
            }
            0xDC00..=0xDFFF => Ok(None),
            _ => Ok(char::from_u32(unit)),
        }
    }

    fn hex4(&mut self) -> Result<u32, Malformed> {
        let digits = self.bytes.get(self.pos..self.pos + 4).ok_or(Malformed)?;
        let mut value = 0;
        for &digit in digits {
            value = value * 16 + (digit as char).to_digit(16).ok_or(Malformed)?;
        }
        self.pos += 4;
        Ok(value)
    }

    fn number(&mut self) -> Result<(), Malformed> {
        let negative = self.peek() == Some(b'-');
        if negative {
            self.pos += 1;
        }
        let integer_start = self.pos;
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(Malformed),
        }
        let integer = &self.text[integer_start..self.pos];

        let mut integral = true;
        if self.peek() == Some(b'.') {
            self.pos += 1;
            self.required_digits()?;
            integral = false;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            self.required_digits()?;
            integral = false;
        }

        let reason = if !integral || (negative && integer == "0") {
            // -0 is an integer token that serde_json holds as the float -0.0.
            Some(Reason::NonIntegerNumber)
        } else if integer.parse::<u64>().map_or(true, |n| n > MAX_SAFE_INTEGER) {
            Some(Reason::UnsafeInteger)
        } else {
            None
        };
        if let Some(reason) = reason {
            let pointer = self.pointer.clone();
            self.refuse(reason, pointer);
        }
        Ok(())
    }

    fn digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
    }

    fn required_digits(&mut self) -> Result<(), Malformed> {
        if !matches!(self.peek(), Some(b'0'..=b'9')) {
            return Err(Malformed);
        }
        self.digits();
        Ok(())
    }

    fn literal(&mut self, word: &[u8]) -> Result<(), Malformed> {
        if !self.bytes[self.pos..].starts_with(word) {
            return Err(Malformed);
        }
        self.pos += word.len();
        Ok(())
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn refuse(&mut self, reason: Reason, pointer: String) {
        if self.first.is_none() {
            self.first = Some(Refusal { reason, pointer });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::fs;
    use std::path::PathBuf;
    use Reason::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gov-native-portable-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn refused(reason: Reason, pointer: &str) -> Scan {
        Scan::Refused(Refusal { reason, pointer: pointer.to_string() })
    }

    // Spec 010 section 4.2's table, over the committed vectors.
    enum Expect {
        Refuse(Reason, &'static str),
        Admit,
        RefusedAsToday,
        NotAString,
    }

    const EXPECTED: &[(&str, Expect)] = &[
        ("V01-key-order", Expect::Admit),
        ("V02-insignificant-whitespace", Expect::Admit),
        ("V03-duplicate-key", Expect::Refuse(DuplicateMember, "/a")),
        ("V04-duplicate-envelope-id", Expect::Refuse(DuplicateMember, "/id")),
        ("V05-integer-beyond-u64", Expect::Refuse(UnsafeInteger, "/big")),
        ("V06-integer-2p53-plus-1", Expect::Refuse(UnsafeInteger, "/n")),
        ("V07-integer-2p64", Expect::Refuse(UnsafeInteger, "/n")),
        ("V08-number-spellings", Expect::Refuse(NonIntegerNumber, "/f")),
        ("V09-decimal-precision", Expect::Refuse(NonIntegerNumber, "/price")),
        ("V10-string-escapes", Expect::Admit),
        ("V11-non-bmp-key-order", Expect::Admit),
        ("V12-lone-surrogate-escape", Expect::Refuse(InvalidUnicode, "/s")),
        ("V13-utf8-bom", Expect::RefusedAsToday),
        ("V14-invalid-utf8", Expect::NotAString),
        ("V15-deep-nesting", Expect::RefusedAsToday),
        ("V16-trailing-document", Expect::RefusedAsToday),
        ("V17-integer-2p53", Expect::Refuse(UnsafeInteger, "/n")),
        ("V18-integer-2p53-minus-1", Expect::Admit),
        ("V19-integer-collision-a", Expect::Refuse(UnsafeInteger, "/n")),
        ("V20-integer-collision-b", Expect::Refuse(UnsafeInteger, "/n")),
        ("C01-flat-string-envelope", Expect::Admit),
        ("C02-typed-reference-canonical", Expect::Admit),
        ("C03-typed-reference-reordered", Expect::Admit),
    ];

    const VECTORS: &str =
        include_str!("../../../specs/010-evidence-byte-seam/vectors/evidence-bytes.v1.json");

    #[test]
    fn the_committed_vectors_meet_section_4_2() {
        let file: serde_json::Value = serde_json::from_str(VECTORS).unwrap();
        let vectors = file["vectors"].as_array().unwrap();
        let ids: Vec<&str> = vectors.iter().map(|v| v["id"].as_str().unwrap()).collect();
        let expected_ids: Vec<&str> = EXPECTED.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, expected_ids, "every vector is classified, in file order");

        for (vector, (id, expect)) in vectors.iter().zip(EXPECTED) {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(vector["bytesBase64"].as_str().unwrap())
                .unwrap();
            if let Expect::NotAString = expect {
                assert!(std::str::from_utf8(&bytes).is_err(), "{id}");
                continue;
            }
            let text = std::str::from_utf8(&bytes).unwrap();
            let lenient_dir = scratch(&format!("{id}-lenient"));
            let portable_dir = scratch(&format!("{id}-portable"));

            match expect {
                Expect::Refuse(reason, pointer) => {
                    let refusal = Refusal { reason: *reason, pointer: pointer.to_string() };
                    assert_eq!(scan(text), Scan::Refused(refusal.clone()), "{id}");
                    assert_eq!(
                        canonicalize(text).err(),
                        Some(PortableError::Refused(refusal.clone())),
                        "{id}"
                    );
                    assert_eq!(
                        append(&portable_dir, text).err(),
                        Some(PortableError::Refused(refusal)),
                        "{id}"
                    );
                    assert!(!portable_dir.exists(), "{id}: a refusal touches no file");
                }
                Expect::RefusedAsToday => {
                    let lenient = crate::canon::canonicalize(text).err().expect(id);
                    assert_eq!(canonicalize(text).err(), Some(PortableError::Lenient(lenient)), "{id}");
                    let lenient = crate::ledger::append(&lenient_dir, text).err().expect(id);
                    assert_eq!(
                        append(&portable_dir, text).err(),
                        Some(PortableError::Lenient(lenient)),
                        "{id}"
                    );
                }
                Expect::Admit => {
                    let lenient = crate::canon::canonicalize(text).unwrap();
                    let portable = canonicalize(text).unwrap();
                    assert_eq!(portable.canonical, lenient.canonical, "{id}");
                    assert_eq!(portable.sha256, lenient.sha256, "{id}");

                    let lenient = crate::ledger::append(&lenient_dir, text).unwrap();
                    let portable = append(&portable_dir, text).unwrap();
                    assert_eq!(portable.seq, lenient.seq, "{id}");
                    assert_eq!(portable.record_hash, lenient.record_hash, "{id}");
                    assert_eq!(portable.chain_hash, lenient.chain_hash, "{id}");
                    for file in ["records.jsonl", "anchor.json"] {
                        assert_eq!(
                            fs::read(portable_dir.join(file)).unwrap(),
                            fs::read(lenient_dir.join(file)).unwrap(),
                            "{id}: {file}"
                        );
                    }
                }
                Expect::NotAString => unreachable!(),
            }
        }
    }

    #[test]
    fn the_integer_boundary_is_symmetric_and_excludes_2p53() {
        assert_eq!(scan("9007199254740991"), Scan::Portable);
        assert_eq!(scan("-9007199254740991"), Scan::Portable);
        assert_eq!(scan("[0,-1,1]"), Scan::Portable);
        assert_eq!(scan("9007199254740992"), refused(UnsafeInteger, ""));
        assert_eq!(scan("-9007199254740992"), refused(UnsafeInteger, ""));
        assert_eq!(scan("[99999999999999999999999]"), refused(UnsafeInteger, "/0"));
    }

    #[test]
    fn a_fraction_an_exponent_and_negative_zero_are_not_integers() {
        assert_eq!(scan("1.0"), refused(NonIntegerNumber, ""));
        assert_eq!(scan("[1e3]"), refused(NonIntegerNumber, "/0"));
        assert_eq!(scan(r#"{"z":-0}"#), refused(NonIntegerNumber, "/z"));
        assert_eq!(scan(r#"{"x":1E+2}"#), refused(NonIntegerNumber, "/x"));
    }

    #[test]
    fn duplicates_are_found_after_unescaping_at_any_depth() {
        assert_eq!(scan(r#"{"a":1,"\u0061":2}"#), refused(DuplicateMember, "/a"));
        assert_eq!(scan(r#"{"a":[{"b":1,"b":1}]}"#), refused(DuplicateMember, "/a/0/b"));
        assert_eq!(scan(r#"{"a":{"b":1},"c":{"b":2}}"#), Scan::Portable);
    }

    #[test]
    fn pointers_escape_tilde_and_slash_and_the_first_refusal_wins() {
        assert_eq!(scan(r#"{"x":[{"k~/":1.5}]}"#), refused(NonIntegerNumber, "/x/0/k~0~1"));
        assert_eq!(scan(r#"{"a":1.5,"b":1,"b":2}"#), refused(NonIntegerNumber, "/a"));
        assert_eq!(scan(r#"[[],[],{"":{"n":9007199254740992}}]"#), refused(UnsafeInteger, "/2//n"));
    }

    #[test]
    fn unpaired_surrogate_escapes_are_invalid_unicode() {
        assert_eq!(scan(r#""\ud83d\ude00""#), Scan::Portable);
        assert_eq!(scan(r#""\udc00""#), refused(InvalidUnicode, ""));
        assert_eq!(scan(r#""\ud800x""#), refused(InvalidUnicode, ""));
        assert_eq!(scan(r#"["\ud800\ud83d\ude00"]"#), refused(InvalidUnicode, "/0"));
        assert_eq!(scan(r#"{"\ud800":1}"#), refused(InvalidUnicode, "/\u{fffd}"));
    }

    #[test]
    fn the_scanner_calls_malformed_exactly_what_serde_json_refuses() {
        let malformed = [
            "", " ", "{", "}", "[1,]", "[,1]", r#"{"a"}"#, r#"{"a":}"#, r#"{"a":1,}"#, "{1:2}",
            "01", "-", "-01", "1.", ".5", "1e", "1e+", "+1", "tru", "nul", "[1 2]",
            r#"{"a":1 "b":2}"#, "\"abc", r#""\x""#, r#""\u12""#, r#""\u12G4""#, "\"a\u{1}b\"",
            "\u{feff}{}", "{} {}", "[1]x", "[\"\\ud800\\u12\"]",
        ];
        for doc in malformed {
            assert_eq!(scan(doc), Scan::Malformed, "{doc:?}");
            assert!(serde_json::from_str::<serde_json::Value>(doc).is_err(), "{doc:?}");
        }
        let well_formed = [
            "[]", "{}", "[[]]", "\"\"", "0", "-1", "true", "null", " {\"a\" : [ true , false , null ] } \n",
            r#""\u0000\b\f\n\r\t\"\\\/""#, "\"\u{7f}\u{2028}\u{1f600}\"", "1.5e-3", r#"{"a":{"a":{}}}"#,
        ];
        for doc in well_formed {
            assert_ne!(scan(doc), Scan::Malformed, "{doc:?}");
            assert!(serde_json::from_str::<serde_json::Value>(doc).is_ok(), "{doc:?}");
        }
    }

    #[test]
    fn a_refusal_names_its_code_and_pointer() {
        let refusal = Refusal { reason: UnsafeInteger, pointer: "/n".to_string() };
        assert_eq!(
            refusal.to_string(),
            r#"unsafe-integer at JSON pointer "/n": an integer outside -(2^53 - 1) through 2^53 - 1"#
        );
    }

    #[test]
    fn portable_and_lenient_records_share_one_chain() {
        let dir = scratch("shared-chain");
        crate::ledger::append(&dir, r#"{"id":"a","big":1.5}"#).unwrap();
        let portable = append(&dir, r#"{"id":"b","kind":"stamp"}"#).unwrap();
        assert_eq!(portable.seq, 1);
        assert_eq!(
            append(&dir, r#"{"id":"c","n":1.5}"#).err(),
            Some(PortableError::Refused(Refusal { reason: NonIntegerNumber, pointer: "/n".to_string() }))
        );
        let verified = crate::ledger::verify(&dir).unwrap();
        assert!(verified.ok, "{:?}", verified.error);
        assert_eq!(verified.seq, 2);
    }
}
