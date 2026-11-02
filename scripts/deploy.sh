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
# install replaces nginx.conf with a new file, which the single-file bind mount does
# not follow, and `up -d` does not recreate Nginx for a config-only change. Recreate
# it (a brief public outage) and wait for its healthcheck so verify.sh cannot race it.
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" up -d --force-recreate --no-deps --wait --wait-timeout 90 nginx
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" ps
