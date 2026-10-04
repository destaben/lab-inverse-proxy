#!/usr/bin/env bash
set -euo pipefail

repo_root=${LAB_EDGE_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
deploy_root=${LAB_EDGE_DEPLOY_ROOT:-/opt/lab-inverse-proxy}
deploy_compose="$deploy_root/compose.yaml"

LAB_EDGE_SOURCE_ROOT="$repo_root" "$repo_root/scripts/preflight.sh"
install -m 0644 "$repo_root/compose.yaml" "$deploy_compose"
install -D -m 0644 "$repo_root/nginx/nginx.conf" "$deploy_root/nginx/nginx.conf"
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" config --quiet
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" pull
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" up -d --remove-orphans
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" ps