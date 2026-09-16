// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::fs;
use walkdir::WalkDir;

#[test]
fn test_no_stdout_pollution() {
    let src_dir = "src";
    let mut violations = Vec::new();

    for entry in WalkDir::new(src_dir) {
        let entry = entry.unwrap();
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if let Some(ext) = path.extension() {
            if ext != "rs" {
                continue;
            }
        } else {
            continue;
        }

        let content = fs::read_to_string(path).unwrap();
        for (i, line) in content.lines().enumerate() {
            // Check for println! or print!
            // Ignore commented out code is tricky with simple grep, but minimal check is safer.
            // We ignore lines starting with whitespace + //
            if line.trim().starts_with("//") {
                continue;
            }

            if (line.contains("println!(") && !line.contains("eprintln!("))
                || (line.contains("print!(") && !line.contains("eprint!("))
            {
                // Allow exceptions?
                // Currently main.rs uses writeln! to a bound variable, not println!.
                // So strict strict check is good.
                // Except: test code inside src/ might use it.
                // We should probably allow #[cfg(test)] modules, but that's hard to parse.
                // For now, strict check.

                // Allow known safe files if checked manually?
                // Allow snapshot/tools.rs if it still exists (legacy module).
                if path.to_str().unwrap().contains("snapshot/tools.rs") {
                    continue;
                }

                violations.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
            }
        }
    }

    if !violations.is_empty() {
        panic!(
            "Found usage of stdout printing macros (println!/print!) in source code. \
             Use log::info!/error! or eprintln! instead.\nViolations:\n{}",
            violations.join("\n")
        );
    }
}
