#!/bin/bash
set -euo pipefail

# Generate 20-char lowercase alphanumeric appId
generate_app_id() {
    LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 20
    echo
}

id=$(generate_app_id)
printf '%s\n' "$id"
#printf '%s\n' "${#id}" # displays length
