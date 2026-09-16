#!/bin/bash
set -euo pipefail

# Generate 20-char lowercase alphanumeric appId
#	•	Always expect exactly 43 characters for 32 bytes → Base64URL w/o padding.
#	•	Output alphabet is A–Z a–z 0–9 - _, no =, no +, no /.
secret="$(openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_')"
printf '%s\n' "$secret"
#printf '%s\n' "${#secret}" # displays length