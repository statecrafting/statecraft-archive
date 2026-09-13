// Spec 010: generates evidence-bytes.v1.json.
//
// Usage: node generate.mjs <out.json>
//
// The JSON file is the authority; this script is its readable source. Each
// vector's bytes are base64, so no line-ending or encoding normalization in
// git or an editor can change them, and its declared digest is SHA-256 over
// exactly those bytes.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const utf8 = (s) => Buffer.from(s, "utf8");
const deep = (n) => utf8("[".repeat(n) + "]".repeat(n));

const vectors = [
  { id: "V01-key-order", class: "key-order",
    note: "Object keys out of lexicographic order.",
    bytes: utf8('{"zeta":1,"alpha":2}') },
  { id: "V02-insignificant-whitespace", class: "whitespace",
    note: "CRLF, tab, spaces around separators, trailing newline.",
    bytes: utf8('{\r\n\t"a" : 1 ,\r\n\t"b":[ 1, 2 ]\r\n}\n') },
  { id: "V03-duplicate-key", class: "duplicate-key",
    note: "The same key twice with different values.",
    bytes: utf8('{"a":1,"a":2}') },
  { id: "V04-duplicate-envelope-id", class: "duplicate-key",
    note: "Duplicate top-level id: the ledger envelope id is metadata derived from the payload.",
    bytes: utf8('{"id":"first","id":"second","kind":"evidence"}') },
  { id: "V05-integer-beyond-u64", class: "large-number",
    note: "Integer literal wider than u64 and than an IEEE double's exact range.",
    bytes: utf8('{"big":12345678901234567890123}') },
  { id: "V06-integer-2p53-plus-1", class: "large-number",
    note: "2^53 + 1: exact in a u64, not exact in an IEEE double.",
    bytes: utf8('{"n":9007199254740993}') },
  { id: "V07-integer-2p64", class: "large-number",
    note: "2^64: one past u64::MAX.",
    bytes: utf8('{"n":18446744073709551616}') },
  { id: "V08-number-spellings", class: "number-spelling",
    note: "Equivalent numeric spellings: 1.0, 1e3, -0, 1E+2, 0.10.",
    bytes: utf8('{"f":1.0,"e":1e3,"z":-0,"x":1E+2,"d":0.10}') },
  { id: "V09-decimal-precision", class: "large-number",
    note: "A decimal literal carrying more precision than an IEEE double.",
    bytes: utf8('{"price":0.1000000000000000055511151231257827}') },
  { id: "V10-string-escapes", class: "escape-spelling",
    note: "Escaped spellings of plain characters: \\u00e9, \\/, \\u0041.",
    bytes: utf8('{"s":"\\u00e9\\/\\u0041"}') },
  { id: "V11-non-bmp-key-order", class: "key-order",
    note: "Keys U+E000 and U+1F600: UTF-8 byte order and UTF-16 code-unit order disagree.",
    bytes: utf8('{"\\ue000":1,"\\ud83d\\ude00":2}') },
  { id: "V12-lone-surrogate-escape", class: "invalid-i-json",
    note: "An escaped unpaired surrogate: valid JSON grammar, not I-JSON.",
    bytes: utf8('{"s":"\\ud800"}') },
  { id: "V13-utf8-bom", class: "encoding",
    note: "A UTF-8 byte-order mark before the document.",
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('{"a":1}')]) },
  { id: "V14-invalid-utf8", class: "encoding",
    note: "A raw 0xFF byte inside a string: not UTF-8.",
    bytes: Buffer.concat([utf8('{"a":"'), Buffer.from([0xff]), utf8('"}')]) },
  { id: "V15-deep-nesting", class: "parser-limit",
    note: "Arrays nested 200 deep.",
    bytes: deep(200) },
  { id: "V16-trailing-document", class: "parser-limit",
    note: "Two JSON documents in one body.",
    bytes: utf8('{"a":1} {"b":2}') },
  { id: "V17-integer-2p53", class: "large-number",
    note: "2^53: exact in an IEEE double, outside the JavaScript safe-integer range.",
    bytes: utf8('{"n":9007199254740992}') },
  { id: "V18-integer-2p53-minus-1", class: "large-number",
    note: "2^53 - 1: the largest JavaScript safe integer.",
    bytes: utf8('{"n":9007199254740991}') },
  { id: "V19-integer-collision-a", class: "large-number", pairWith: "V20-integer-collision-b",
    note: "A 30-digit integer (statecraft 014 section 10.3, Probe 1).",
    bytes: utf8('{"n":123456789012345678901234567890}') },
  { id: "V20-integer-collision-b", class: "large-number", pairWith: "V19-integer-collision-a",
    note: "The same integer plus one.",
    bytes: utf8('{"n":123456789012345678901234567891}') },
  { id: "C01-flat-string-envelope", class: "control",
    note: "Positive control: the flat all-string shape statecraft's live chain holds.",
    bytes: utf8('{"id":"x","kind":"stamp"}') },
  { id: "C02-typed-reference-canonical", class: "control",
    note: "Positive control: statecraft 014 D-3's typed reference, keys in UTF-8 order, members portable.",
    bytes: utf8('{"byteDigest":"' + "ab".repeat(32) + '","byteLength":1234,"digestAlg":"sha-256","producerDigest":null,"schemaVersion":1,"subject":{"commit":"' + "c0".repeat(20) + '","repo":"github.com/example/app","tree":null},"type":"statecraft-cli/receipt"}') },
  { id: "C03-typed-reference-reordered", class: "key-order", pairWith: "C02-typed-reference-canonical",
    note: "The same reference with keys in construction order, as a JavaScript object literal would emit them.",
    bytes: utf8('{"type":"statecraft-cli/receipt","schemaVersion":1,"digestAlg":"sha-256","byteDigest":"' + "ab".repeat(32) + '","byteLength":1234,"producerDigest":null,"subject":{"repo":"github.com/example/app","commit":"' + "c0".repeat(20) + '","tree":null}}') },
];

const out = {
  format: "statecrafting.evidence-bytes.vectors/v1",
  digest: "sha256 over the decoded bytes of bytesBase64; never over any re-serialization",
  vectors: vectors.map((v) => ({
    id: v.id,
    class: v.class,
    ...(v.pairWith ? { pairWith: v.pairWith } : {}),
    note: v.note,
    bytesBase64: v.bytes.toString("base64"),
    size: v.bytes.length,
    declaredDigest: "sha256:" + createHash("sha256").update(v.bytes).digest("hex"),
  })),
};

writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.vectors.length} vectors`);
