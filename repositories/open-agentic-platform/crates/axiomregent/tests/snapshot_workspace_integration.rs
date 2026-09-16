// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::Result;
use std::io::{BufRead, BufReader, Write};
use std::process::Command;

/// Read a single MCP stdio-framed message (Content-Length header + body).
fn read_mcp_message(reader: &mut BufReader<impl std::io::Read>) -> Result<String> {
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        anyhow::ensure!(n > 0, "EOF while reading MCP headers");
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = val.trim().parse()?;
        }
    }
    anyhow::ensure!(content_length > 0, "No Content-Length header");
    let mut buf = vec![0u8; content_length];
    std::io::Read::read_exact(reader, &mut buf)?;
    Ok(String::from_utf8(buf)?)
}

fn send_mcp_message(stdin: &mut impl Write, body: &str) -> Result<()> {
    write!(stdin, "Content-Length: {}\r\n\r\n{}", body.len(), body)?;
    stdin.flush()?;
    Ok(())
}

#[test]
fn test_agent_tools_exist() -> Result<()> {
    // Use an isolated temp directory so hiqlite doesn't collide with other tests.
    let tmp = tempfile::tempdir()?;

    let bin = env!("CARGO_BIN_EXE_axiomregent");

    let mut child = Command::new(bin)
        .env("AXIOMREGENT_DATA_DIR", tmp.path().join("data"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout);

    // Send initialize
    let init_req = r#"{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}},"id":1}"#;
    send_mcp_message(&mut stdin, init_req)?;

    // Read initialize response
    let _init_resp = read_mcp_message(&mut reader)?;

    // Send tools/list
    let list_req = r#"{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}"#;
    send_mcp_message(&mut stdin, list_req)?;

    // Read tools/list response
    let tools_resp = read_mcp_message(&mut reader)?;

    // Close stdin so child exits cleanly
    drop(stdin);
    let status = child.wait()?;

    assert!(
        tools_resp.contains("workspace.write_file"),
        "Missing workspace.write_file in tools/list. Exit status: {status}. Response: {tools_resp}"
    );
    assert!(
        tools_resp.contains("checkpoint.create") || tools_resp.contains("workspace.apply_patch"),
        "Missing expected tools in tools/list"
    );

    Ok(())
}
