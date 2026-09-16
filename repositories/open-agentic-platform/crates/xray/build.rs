// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

fn main() {
    #[cfg(feature = "analysis-structure")]
    {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let grammars_dir = manifest_dir.join("../../tools/vendor/grammars");

        let dirs: Vec<PathBuf> = [
            "tree-sitter-rust",
            "tree-sitter-python",
            "tree-sitter-javascript",
        ]
        .iter()
        .map(|name| grammars_dir.join(name).join("src"))
        .collect();

        let mut cc_build = cc::Build::new();
        cc_build
            .warnings(false)
            .flag_if_supported("-Wno-unused-parameter");
        for dir in dirs {
            cc_build
                .include(&dir)
                .file(dir.join("parser.c"))
                .file(dir.join("scanner.c"));
        }
        cc_build.compile("tree-sitter-languages");
    }
}
