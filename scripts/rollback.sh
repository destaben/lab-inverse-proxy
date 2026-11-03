#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 && "$1" == "--confirm" ]] || {
  printf 'Usage: %s --confirm <git-ref>\n' "$0" >&2
  exit 2
}

target_ref=$2
script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_root=${LAB_EDGE_DEPLOY_ROOT:-/opt/lab-inverse-proxy}

git -C "$deploy_root" diff --quiet || {
  printf 'ERROR: deployment checkout has changes; commit or stash them before rollback\n' >&2
  exit 1
}
git -C "$deploy_root" rev-parse --verify --quiet "$target_ref^{commit}" >/dev/null || {
  printf 'ERROR: unknown Git reference: %s\n' "$target_ref" >&2
  exit 1
}
git -C "$deploy_root" switch --detach "$target_ref"
LAB_EDGE_SOURCE_ROOT="$deploy_root" "$script_root/scripts/deploy.sh"
"$script_root/scripts/verify.sh"
printf 'Rolled back edge configuration to %s. The private .env and Docker networks were unchanged.\n' "$target_ref"