#!/bin/bash
set -euo pipefail

# Generate 32-char mixed case alphanumeric appSecret
generate_app_secret() {
    LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32
    echo
}

secret=$(generate_app_secret)
printf '%s\n' "$secret"
#printf '%s\n' "${#secret}" # displays length