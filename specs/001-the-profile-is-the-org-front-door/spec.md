---
id: "001-the-profile-is-the-org-front-door"
title: "The profile is the org front door"
status: approved
implementation: complete
created: "2026-09-11"
summary: >
  The statecrafting organisation presents itself through exactly two rendered
  surfaces: `profile/README.md`, which GitHub renders at
  github.com/statecrafting, and the repository's own `README.md`, which tells a
  contributor which file to edit. The profile states the thesis, draws the
  two-plane shape of the family, and lists every repository with its license
  and its one-paragraph reason to exist. A repository that is not listed is not
  part of the family's public story.
origin:
  retroactive: true   # the profile was live before the corpus existed
depends_on:
  - "000-bootstrap"
establishes:
  - { kind: file, path: "README.md" }
  - { kind: file, path: "profile/README.md" }
  - { kind: directory, path: "profile/artifacts/" }
---

# 001: The profile is the org front door

## 1. Purpose

github.com/statecrafting is the first thing anyone sees, and for most visitors
it is the only thing they read. It is not a link farm. It has to carry the
thesis (the trust boundary moves upstream, from reviewing output to
constraining intent), the shape of the system, and enough per-repository
context that a reader can tell which door is theirs.

That makes the profile a deliverable, not decoration, and a deliverable is
governed like any other: it has an owning spec, its edits move with that spec,
and a change to it that the spec does not describe is drift.

## 2. Territory

| Unit | What it is |
| --- | --- |
| `profile/README.md` | The org landing page. GitHub renders this file, and only this file, at github.com/statecrafting. |
| `README.md` | The repository's own README: what this repo is (the org `.github` repo), which file to edit to change the landing page, and how the repository is governed. |
| `profile/artifacts/` | The images the landing page references: the banner and the logo. Binary, referenced by relative path from `profile/README.md`. |

GitHub's community health files (`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `SUPPORT.md`, issue and pull-request templates) are inherited
org-wide from this repository. None exist yet. Each is a spec of its own when
it is written, because each is a promise to a contributor and a promise is the
kind of thing that wants an owner.

## 3. Behavior

### 3.1 The landing page carries four things, in this order

1. **The thesis.** AI can write the code; the unsolved problem is trusting what
   it wrote. Stop reviewing output, start constraining intent.
2. **The shape.** A mermaid diagram of the two-plane system: the control plane
   as one EnRaHiTu app, every tenant app it stamps as another, independent one,
   with `spec-spine` governing every repository in the picture.
3. **The projects**, grouped by role (the platform, the template, the
   interface, the spine, the tenant toolkit, the primitives, the packages).
   Each entry carries a license badge, a language badge, and one paragraph
   saying what the thing is and why it exists.
4. **The license rationale.** The control plane is AGPL-3.0 on purpose; every
   building block a stamped app consumes is Apache-2.0.

### 3.2 A listed repository is a real repository

Every link under "Projects" resolves to a repository that exists under the
statecrafting organisation, and the license badge next to it names that
repository's actual license. A badge is a factual claim about a file on disk in
another repository, so it is checked against that repository, never inferred
from the group it was filed under.

### 3.3 The repository README points, it does not duplicate

`README.md` says what this repository is, names `profile/README.md` as the file
that renders, and orients a contributor who has just noticed the `specs/`
directory: the three specs and what each owns, the three `make` targets, the
`spec-spine` version floor, and the warning that `.derived/` is compiler output.

It does **not** restate the thesis or the project list. Two copies of the same
prose drift, and the copy nobody renders drifts first.

### 3.4 Owned imagery is referenced relatively

Artwork this organisation owns (the banner, the logo) lives in
`profile/artifacts/` and is referenced as `artifacts/<name>`, relative to
`profile/`, which is how GitHub resolves paths for an org profile. Hosting the
banner anywhere else would put the front door's availability outside this
repository's control.

Shields.io badges are the deliberate exception. They are absolute by nature,
they are not artwork this organisation owns, and a badge that fails to load
degrades to alt text rather than to a broken page.

## 4. Out of scope

- statecraft.ing, the marketing site: a different property, not this corpus.
- The content of any linked repository's own README.
- Community health files, until the spec that writes one exists (2).

## Verification

```verify:cli
test -f README.md
test -f profile/README.md
test -d profile/artifacts
# 3.1: the thesis, the shape, the projects, the licenses.
grep -qF 'AI can write the code' profile/README.md
grep -q '```mermaid' profile/README.md
grep -qF '## Projects' profile/README.md
grep -qF '## Why these licenses' profile/README.md
# 3.3: the repository README names the file that renders, and does not restate the thesis.
grep -qF 'profile/README.md' README.md
! grep -qF '## Projects' README.md
# 3.3: the README orients a contributor at the corpus and the gate.
grep -qF 'make gate' README.md
grep -qF 'AGENTS.md' README.md
grep -qF '0.18.0' README.md
# 3.4: the banner is referenced relatively, and the file it names is on disk.
grep -qF '](artifacts/statecraft-github-banner.jpg)' profile/README.md
test -f profile/artifacts/statecraft-github-banner.jpg
```
