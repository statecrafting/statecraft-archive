//! Append one record to a chain: `append <dir> <kind> <payload json>`. The
//! parity test uses it to extend a TypeScript-written chain from Rust.

use std::path::Path;

use statecraft_journal::chain::Chain;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, kind, payload] = args.as_slice() else {
        eprintln!("usage: append <dir> <kind> <payload json>");
        std::process::exit(3);
    };
    let payload: serde_json::Value = serde_json::from_str(payload).expect("payload is JSON");
    let mut chain = Chain::open(Path::new(dir), None).expect("open");
    let record = chain.append(kind, payload).expect("append");
    println!("{}", record.record_hash);
}
