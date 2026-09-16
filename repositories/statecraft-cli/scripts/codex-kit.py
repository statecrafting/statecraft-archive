#!/usr/bin/env python3
"""The Codex face of the governed kit (spec 118), generated from the Claude one.

Writes three trees from `.claude/`:

- `.agents/skills/<name>/SKILL.md`: a byte-identical copy of each skill (B-1).
- `.codex/agents/<name>.toml`: each agent's name, description and body, the
  body unchanged as `developer_instructions` (B-2).
- `.codex/hooks.json`: the four hooks of `.claude/settings.json` with the same
  matchers and commands, each command wrapped once (B-3): the stdin JSON is
  read into a variable, `CLAUDE_PROJECT_DIR` is exported from its `cwd`
  field (Codex delivers the project root there and exports no variable),
  and the original command runs as a function fed that same JSON. The exit
  status is the function's, so a blocking `exit 2` still blocks.

`--check` writes nothing and exits 1 naming every file that differs from
what it would write. No dependencies beyond Python 3.

Spec 123 B-4: a fourth output, `.codex/kit-manifest.json`, names every
generated file, its source and the source's SHA-256, the transform that
made it, and every source field the transform dropped (an agent's `tools`,
`model`, `safety_tier`, `mutation`, `memory`; the settings' `permissions`).
Shared text is consistency of guidance, not of enforcement, and the
manifest says exactly what did not carry. `--check` recomputes it byte for
byte, and walks directories as well as files: an empty generated directory
is a stray. `--root <dir>` points every path at another checkout, which is
what the generator's own test uses.
"""

import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def configure(root):
    """Every path the generator reads or writes, under `root`."""
    global ROOT, CLAUDE, SKILLS_OUT, AGENTS_OUT, HOOKS_OUT, MANIFEST_OUT
    ROOT = root
    CLAUDE = os.path.join(ROOT, ".claude")
    SKILLS_OUT = os.path.join(ROOT, ".agents", "skills")
    AGENTS_OUT = os.path.join(ROOT, ".codex", "agents")
    HOOKS_OUT = os.path.join(ROOT, ".codex", "hooks.json")
    MANIFEST_OUT = os.path.join(ROOT, ".codex", "kit-manifest.json")


configure(ROOT)

# The agent frontmatter keys an agent TOML carries, and the settings keys the
# hooks file carries. Everything else a source declares is dropped, and the
# manifest names it (B-4).
AGENT_CARRIED = ("name", "description")
SETTINGS_CARRIED = ("hooks",)

# The PostToolUse staleness list names the Claude kit's paths; the Codex
# kit's own join it (B-3).
STALENESS_CLAUDE = "*/.claude/agents/*.md|*/.claude/rules/*.md|*/.claude/skills/*/*.md"
STALENESS_CODEX = STALENESS_CLAUDE + "|*/.codex/agents/*.toml|*/.codex/hooks.json|*/.agents/skills/*/*.md"

WRAP_HEAD = (
    '__in=$(cat); CLAUDE_PROJECT_DIR=$(printf \'%s\' "$__in" | jq -r \'.cwd // empty\' 2>/dev/null); '
    'export CLAUDE_PROJECT_DIR; __hook() {\n'
)
WRAP_TAIL = '\n}; printf \'%s\' "$__in" | __hook\n'


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def frontmatter(text):
    """The YAML-ish frontmatter of an agent file as (fields, body)."""
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if m is None:
        raise SystemExit(f"no frontmatter in agent file")
    fields = {}
    for line in m.group(1).splitlines():
        km = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if km and not line.startswith(" ") and not line.startswith("-"):
            fields[km.group(1)] = km.group(2).strip()
    return fields, m.group(2)


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def agent_dropped(text):
    """The frontmatter keys an agent TOML does not carry, in source order."""
    fields, _body = frontmatter(text)
    return [k for k in fields if k not in AGENT_CARRIED]


def settings_dropped(settings_text):
    settings = json.loads(settings_text)
    return [k for k in settings if k not in SETTINGS_CARRIED]


def toml_string(value):
    return json.dumps(value)


def agent_toml(text):
    fields, body = frontmatter(text)
    if "'''" in body:
        raise SystemExit("an agent body contains ''' and cannot be a literal TOML string")
    body = body.strip("\n")
    return (
        f"name = {toml_string(fields['name'])}\n"
        f"description = {toml_string(fields['description'])}\n"
        f"developer_instructions = '''\n{body}\n'''\n"
    )


def hooks_json(settings_text):
    settings = json.loads(settings_text)
    hooks = settings["hooks"]
    out = {}
    for event, entries in hooks.items():
        out[event] = []
        for entry in entries:
            converted = {k: v for k, v in entry.items() if k != "hooks"}
            converted["hooks"] = []
            for hook in entry["hooks"]:
                h = dict(hook)
                command = hook["command"].replace(STALENESS_CLAUDE, STALENESS_CODEX)
                h["command"] = WRAP_HEAD + command + WRAP_TAIL
                converted["hooks"].append(h)
            out[event].append(converted)
    return json.dumps({"hooks": out}, indent=2) + "\n"


def rel(path):
    return os.path.relpath(path, ROOT)


def planned():
    """Every generated file's content, and the manifest entries behind it."""
    files = {}
    entries = []
    skills = os.path.join(CLAUDE, "skills")
    for name in sorted(os.listdir(skills)):
        src = os.path.join(skills, name, "SKILL.md")
        if os.path.isfile(src):
            text = read(src)
            target = os.path.join(SKILLS_OUT, name, "SKILL.md")
            files[target] = text
            entries.append({"target": rel(target), "source": rel(src), "sourceSha256": sha256(text), "transform": "copy", "dropped": []})
    agents = os.path.join(CLAUDE, "agents")
    for entry in sorted(os.listdir(agents)):
        if entry.endswith(".md"):
            src = os.path.join(agents, entry)
            text = read(src)
            target = os.path.join(AGENTS_OUT, entry[:-3] + ".toml")
            files[target] = agent_toml(text)
            entries.append({"target": rel(target), "source": rel(src), "sourceSha256": sha256(text), "transform": "agent-toml", "dropped": agent_dropped(text)})
    settings_src = os.path.join(CLAUDE, "settings.json")
    settings_text = read(settings_src)
    files[HOOKS_OUT] = hooks_json(settings_text)
    entries.append({"target": rel(HOOKS_OUT), "source": rel(settings_src), "sourceSha256": sha256(settings_text), "transform": "hooks-json", "dropped": settings_dropped(settings_text)})
    entries.sort(key=lambda e: e["target"])
    manifest = {"generator": "scripts/codex-kit.py", "sourceRoot": ".claude", "files": entries}
    files[MANIFEST_OUT] = json.dumps(manifest, indent=2) + "\n"
    return files


def stray(files):
    """Generated trees may hold nothing the generator did not write: no file,
    and (B-4) no directory either."""
    extra = []
    for base in (SKILLS_OUT, AGENTS_OUT):
        for dirpath, dirs, names in os.walk(base):
            for n in names:
                p = os.path.join(dirpath, n)
                if p not in files:
                    extra.append(p)
            for d in dirs:
                p = os.path.join(dirpath, d)
                if not any(f.startswith(p + os.sep) for f in files):
                    extra.append(p)
    return extra


def main(argv):
    check = "--check" in argv
    if "--root" in argv:
        configure(os.path.abspath(argv[argv.index("--root") + 1]))
    files = planned()
    drift = []
    for path, content in files.items():
        current = read(path) if os.path.isfile(path) else None
        if current != content:
            drift.append(path)
            if not check:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
    extra = stray(files)
    if check:
        for p in drift:
            print(f"codex-kit: differs: {os.path.relpath(p, ROOT)}")
        for p in extra:
            print(f"codex-kit: not generated: {os.path.relpath(p, ROOT)}")
        if drift or extra:
            return 1
        print(f"codex-kit: {len(files)} files match the Claude kit")
        return 0
    for p in extra:
        if os.path.isdir(p):
            os.rmdir(p) if not os.listdir(p) else None
        elif os.path.exists(p):
            os.remove(p)
        print(f"codex-kit: removed {os.path.relpath(p, ROOT)}")
    print(f"codex-kit: wrote {len(drift)} of {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
