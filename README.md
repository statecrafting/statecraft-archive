# .github

Organisation-level community health files and the public org profile for
[**statecrafting**](https://github.com/statecrafting), the home of Statecraft.

The org landing page renders from [`profile/README.md`](profile/README.md).
Edit that file to change what visitors see at github.com/statecrafting.

## This repository is governed

Like every other repository in the family, this one is governed by
[**spec-spine**](https://github.com/statecrafting/spec-spine). The front door
argues that machine-generated change should earn passage through gates rather
than through trust; the front door had better hold itself to that.

So the corpus under [`specs/`](specs/) claims every tracked path here, and a
change to a claimed path that does not move with its owning spec is refused at
pull-request time.

```sh
make gate            # the governed loop, read-only
make refresh         # recompute the committed shard trees after a spec edit
make verify SPEC=001 # one spec's declared acceptance
```

| Spec | Owns |
| --- | --- |
| [`000-bootstrap`](specs/000-bootstrap/spec.md) | The substrate: config, standards, the standing agent rules. |
| [`001-the-profile-is-the-org-front-door`](specs/001-the-profile-is-the-org-front-door/spec.md) | This file, `profile/README.md`, and the artwork. |
| [`002-the-harness-is-governed-like-the-work`](specs/002-the-harness-is-governed-like-the-work/spec.md) | The agent harness: the session protocol, the skills, the hooks, the gate. |

Contributors and agents both start at [`AGENTS.md`](AGENTS.md). It is the
cross-agent session protocol and it holds the one definition of the gate;
`spec-spine` needs to be **0.18.0 or later**.

`.derived/` is compiler output, committed on purpose so the freshness gate has
something to compare against. Never edit it by hand: run `make refresh` and
commit what it writes.
