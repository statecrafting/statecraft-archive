#!/usr/bin/env python3
"""Spec 123 FR-004: the generator over a fixture kit in a temp directory.

The manifest lists every generated file with the right transform and
drops; `--check` fails on a drifted manifest, a drifted file, a stray file
and a stray empty directory, and passes after a write. No dependencies
beyond Python 3; run as `python3 scripts/codex-kit.test.py`.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATOR = os.path.join(HERE, "codex-kit.py")

AGENT = """---
name: reviewer
description: Reviews a change
tools:
  - Read
  - Grep
model: sonnet
safety_tier: tier1
mutation: read-only
---
Review the diff and report.
"""

SETTINGS = {
    "permissions": {"allow": ["Bash(git:*)"]},
    "hooks": {
        "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo gate"}]}],
    },
}


def fixture():
    root = tempfile.mkdtemp(prefix="codex-kit-test-")
    os.makedirs(os.path.join(root, ".claude", "skills", "ship"))
    with open(os.path.join(root, ".claude", "skills", "ship", "SKILL.md"), "w") as f:
        f.write("# ship\n\nRun the gate.\n")
    os.makedirs(os.path.join(root, ".claude", "agents"))
    with open(os.path.join(root, ".claude", "agents", "reviewer.md"), "w") as f:
        f.write(AGENT)
    with open(os.path.join(root, ".claude", "settings.json"), "w") as f:
        json.dump(SETTINGS, f, indent=2)
    return root


def run(root, *args):
    proc = subprocess.run([sys.executable, GENERATOR, "--root", root, *args], capture_output=True, text=True)
    return proc.returncode, proc.stdout


def check(condition, message):
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)


def main():
    root = fixture()
    try:
        # A fresh fixture drifts on every file, the manifest included.
        code, out = run(root, "--check")
        check(code == 1, "check on an ungenerated kit must fail")
        check(".codex/kit-manifest.json" in out, "the manifest is named as differing")

        code, out = run(root)
        check(code == 0, f"write must succeed: {out}")
        code, out = run(root, "--check")
        check(code == 0, f"check after write must pass: {out}")
        check("4 files match" in out, f"four files (a skill, an agent, hooks, the manifest): {out}")

        with open(os.path.join(root, ".codex", "kit-manifest.json")) as f:
            manifest = json.load(f)
        check(manifest["generator"] == "scripts/codex-kit.py", "generator named")
        check(manifest["sourceRoot"] == ".claude", "source root named")
        by_target = {e["target"]: e for e in manifest["files"]}
        check(list(by_target) == sorted(by_target), "entries sorted by target")
        skill = by_target[".agents/skills/ship/SKILL.md"]
        check(skill["transform"] == "copy" and skill["dropped"] == [], "a skill is a copy with no drops")
        check(skill["source"] == ".claude/skills/ship/SKILL.md" and len(skill["sourceSha256"]) == 64, "a skill names its source and hash")
        agent = by_target[".codex/agents/reviewer.toml"]
        check(agent["transform"] == "agent-toml", "an agent is agent-toml")
        check(agent["dropped"] == ["tools", "model", "safety_tier", "mutation"], f"an agent's drops are declared in source order: {agent['dropped']}")
        hooks = by_target[".codex/hooks.json"]
        check(hooks["transform"] == "hooks-json" and hooks["dropped"] == ["permissions"], "the hooks file declares the dropped permissions")

        # A drifted source drifts the manifest (its hash) and the file.
        with open(os.path.join(root, ".claude", "skills", "ship", "SKILL.md"), "a") as f:
            f.write("More.\n")
        code, out = run(root, "--check")
        check(code == 1, "a drifted source fails the check")
        check(".agents/skills/ship/SKILL.md" in out and ".codex/kit-manifest.json" in out, f"both the file and the manifest are named: {out}")
        run(root)

        # A hand-edited manifest drifts on its own.
        with open(os.path.join(root, ".codex", "kit-manifest.json"), "a") as f:
            f.write("\n")
        code, out = run(root, "--check")
        check(code == 1 and ".codex/kit-manifest.json" in out, "a drifted manifest fails the check")
        run(root)

        # A stray file and a stray empty directory both fail the check.
        with open(os.path.join(root, ".agents", "skills", "ship", "extra.md"), "w") as f:
            f.write("x")
        os.makedirs(os.path.join(root, ".agents", "skills", "init"))
        code, out = run(root, "--check")
        check(code == 1, "strays fail the check")
        check(".agents/skills/ship/extra.md" in out, f"the stray file is named: {out}")
        check(".agents/skills/init" in out, f"the stray empty directory is named: {out}")
        code, out = run(root)
        check(code == 0 and not os.path.exists(os.path.join(root, ".agents", "skills", "init")), "a write removes the strays")
        code, out = run(root, "--check")
        check(code == 0, "clean after the write")
        print("codex-kit.test: ok")
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
