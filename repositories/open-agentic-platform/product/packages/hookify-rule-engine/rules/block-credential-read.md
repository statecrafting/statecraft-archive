---
id: block-credential-read
event: PreToolUse
matcher:
  tool: Read
conditions:
  any:
    - field: input.file_path
      matches: "(\\.env(\\.|$)|/\\.env|id_rsa|id_ed25519|credentials|\\.aws/)"
    - field: input.path
      matches: "(\\.env(\\.|$)|/\\.env|id_rsa|id_ed25519|credentials|\\.aws/)"
action:
  type: block
priority: 20
---

Reading credential or environment files from the repo or home can expose secrets.
Confirm access is intentional and use a scoped secret manager instead.
