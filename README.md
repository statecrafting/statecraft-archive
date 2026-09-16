# Statecraft historical archive

Consolidated source snapshots and unchanged Git histories. This is historical material, not an active product or an instruction to execute archived tooling.

Each repository's default-branch snapshot is under `repositories/<name>/`. Original branch tips are under `history/<name>/<branch>`, tags under `history/<name>/<tag>`, and other advertised refs under `source-refs/<name>/...` tags. The `.github` repository uses `statecrafting-profile` as its ref namespace because Git forbids ref path components starting with a dot. Original commit and tag object IDs are unchanged. The initial archive commit has each source default-branch tip as a parent.

`manifest.json` records the source identities, ref mappings and verified reachable object counts. `github-records/` contains API snapshots of repositories, issues, pull requests, comments, reviews, release metadata, labels and milestones. Those records are preserved evidence, not migrated GitHub UI objects.

`release-assets/` preserves the 15 published CLI v0.1.0 assets, with sizes and SHA-256 digests in its manifest. No Git LFS pointers were found across the imported histories. No accessible wiki Git repositories were found for the selected sources with wikis enabled.

Source licenses remain with their respective files. No umbrella relicensing is applied.

## Preservation limits

This archive captures remote Git refs advertised at collection time. Local uncommitted work and unpushed refs are outside that scope. Discussions, Actions logs/artifacts, packages, deployment state, secrets and external issue attachments are not included. Their retention needs must be resolved before deleting sources. GitHub review snapshots do not recreate native review threads or all timeline events. Source repositories have not been deleted by the archive builder.
