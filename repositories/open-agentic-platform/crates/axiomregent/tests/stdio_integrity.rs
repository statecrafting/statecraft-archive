// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn test_stdio_integrity() {
    // 1. Locate the binary — CARGO_BIN_EXE_axiomregent is set at compile time
    //    by cargo for integration tests in a package that defines a [[bin]] target.
    let bin_path = env!("CARGO_BIN_EXE_axiomregent");
    let tmp_dir = tempfile::tempdir().expect("Failed to create temp dir");
    // 2. Spawn the process
    let mut child = ChildGuard(
        Command::new(bin_path)
            .env("RUST_LOG", "info") // Force info logging
            .env("AXIOMREGENT_DATA_DIR", tmp_dir.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Failed to spawn mcp"),
    );

    let mut stdin = child.0.stdin.take().expect("Failed to open stdin");
    let mut stdout = BufReader::new(child.0.stdout.take().expect("Failed to open stdout"));
    let stderr = BufReader::new(child.0.stderr.take().expect("Failed to open stderr"));

    // 3. Setup Stderr Reader Thread (Prevents Deadlock)
    // We want to verify logs appear, but we shouldn't block main thread reading them.
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in stderr.lines() {
            if let Ok(l) = line {
                if l.contains("mcp starting") {
                    let _ = tx.send(true);
                    return; // Found it
                }
            } else {
                break;
            }
        }
    });

    // 4. Send Initialize Request
    // Proper Content-Length framing required by main.rs
    let request_body = r#"{"jsonrpc": "2.0", "method": "initialize", "params": {"clientInfo": {"name": "test-client", "version": "1.0"}, "protocolVersion": "2024-11-05", "capabilities": {}}, "id": 1}"#;
    let request = format!(
        "Content-Length: {}\r\n\r\n{}",
        request_body.len(),
        request_body
    );

    stdin
        .write_all(request.as_bytes())
        .expect("Failed to write to stdin");
    stdin.flush().expect("Failed to flush stdin");

    // 5. Verify Stdout Cleanliness & Framing
    // We expect properly framed "Content-Length: N\r\n\r\nJSON"

    // Read Header Line 1
    let mut header_line = String::new();
    stdout
        .read_line(&mut header_line)
        .expect("Failed to read header line");

    // Strict Assertion: First bytes MUST be Content-Length header.
    assert!(
        header_line
            .to_ascii_lowercase()
            .starts_with("content-length:"),
        "Stdout contaminated! Expected 'Content-Length:', got: {:?}",
        header_line
    );

    let len_str = header_line
        .trim()
        .split(':')
        .nth(1)
        .expect("Missing length value")
        .trim();
    let content_len: usize = len_str.parse().expect("Invalid content length");

    // Read Header Line 2 (Empty)
    let mut empty_line = String::new();
    stdout
        .read_line(&mut empty_line)
        .expect("Failed to read empty line");
    assert_eq!(empty_line, "\r\n", "Expected empty line after header");

    // Read Body
    let mut body_buf = vec![0u8; content_len];
    stdout
        .read_exact(&mut body_buf)
        .expect("Failed to read body");
    let body_str = String::from_utf8(body_buf).expect("Body was not UTF-8");

    // Verify JSON
    let response: serde_json::Value =
        serde_json::from_str(&body_str).expect("Stdout contained invalid JSON");
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 1);

    // 6. Verify Stderr Logging (Non-blocking check)
    // Wait for the thread to confirm startup log, with timeout
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(_) => { /* check passed */ }
        Err(_) => {
            panic!("Timed out waiting for startup log on stderr. Is logging configured correctly?")
        }
    }
}
