// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::Result;
use std::io::Write;
use std::process::Command;

/// Verify that agent.propose, agent.execute, and agent.verify are advertised in tools/list.
#[test]
fn test_agent_tools_in_tools_list() -> Result<()> {
    let bin = env!("CARGO_BIN_EXE_axiomregent");

    let tmp_dir = tempfile::tempdir()?;
    let mut child = Command::new(bin)
        .env("AXIOMREGENT_DATA_DIR", tmp_dir.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    {
        let stdin = child.stdin.as_mut().unwrap();

        let init_req = r#"{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}},"id":1}"#;
        write!(
            stdin,
            "Content-Length: {}\r\n\r\n{}",
            init_req.len(),
            init_req
        )?;

        let list_req = r#"{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}"#;
        write!(
            stdin,
            "Content-Length: {}\r\n\r\n{}",
            list_req.len(),
            list_req
        )?;
        stdin.flush()?;
    }
    child.stdin.take(); // EOF so the binary exits after processing

    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    assert!(
        stdout.contains("agent.propose"),
        "Missing agent.propose in tools/list"
    );
    assert!(
        stdout.contains("agent.execute"),
        "Missing agent.execute in tools/list"
    );
    assert!(
        stdout.contains("agent.verify"),
        "Missing agent.verify in tools/list"
    );

    Ok(())
}
