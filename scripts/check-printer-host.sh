#!/usr/bin/env bash
# Validates PRINTER_HOST in a Compose env file. compose.yaml feeds it to extra_hosts, which needs a
# literal IPv4 address: anything else (a hostname, an inline comment, whitespace, quotes) makes Docker
# refuse to recreate Nginx and fails the deployment. An empty or absent value is valid and leaves the
# printer routes failing closed. The value is never printed.
set -euo pipefail

env_file=${1:?usage: check-printer-host.sh <env-file>}
[[ -f "$env_file" ]] || { printf 'ERROR: environment file not found: %s\n' "$env_file" >&2; exit 1; }

value=
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == PRINTER_HOST=* ]] && value=${line#PRINTER_HOST=}
done <"$env_file"

[[ -z "$value" ]] && exit 0

octet='(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
if [[ ! "$value" =~ ^${octet}\.${octet}\.${octet}\.${octet}$ ]]; then
  printf 'ERROR: PRINTER_HOST must be empty or a bare IPv4 address (no hostname, quotes, spaces, or comments)\n' >&2
  exit 1
fi
