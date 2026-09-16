# Statecraft historical archive

Consolidated source snapshots and unchanged Git histories. This is historical material, not an active product or an instruction to execute archived tooling.

Each repository's default-branch snapshot is under `repositories/<name>/`. Original branch tips are under `history/<name>/<branch>`, tags under `history/<name>/<tag>`, and other advertised refs under `source-refs/<name>/...` tags. Original commit and tag object IDs are unchanged. The initial archive commit has each source default-branch tip as a parent.

`manifest.json` records the source identities, ref mappings and verified reachable object counts. `github-records/` contains API snapshots of repositories, issues, pull requests, comments, reviews, release metadata, labels and milestones. Those records are preserved evidence, not migrated GitHub UI objects.

Source licenses remain with their respective files. No umbrella relicensing is applied.

## Preservation limits

This archive captures remote Git refs advertised at collection time. Local uncommitted work and unpushed refs are outside that scope. Release asset binaries, Git LFS payloads, wiki repositories, discussions, Actions logs/artifacts, packages, deployment state, secrets and external issue attachments need separate verification or export before deleting sources. Source repositories have not been deleted by the archive builder.
