#!/usr/bin/env bash
set -euo pipefail

repo_root=${LAB_EDGE_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
deploy_root=${LAB_EDGE_DEPLOY_ROOT:-/opt/lab-inverse-proxy}
deploy_compose="$deploy_root/compose.yaml"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -f "$repo_root/compose.yaml" ]] || fail "source Compose file not found"
[[ -f "$repo_root/nginx/nginx.conf" ]] || fail "source Nginx configuration not found"
[[ -f "$deploy_compose" ]] || fail "deployment Compose file not found: $deploy_compose"
[[ -f "$deploy_root/.env" ]] || fail "deployment environment file not found: $deploy_root/.env"
[[ $(stat -c '%a' "$deploy_root/.env") == "600" ]] || fail "deployment environment file must have mode 0600"

docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" config --quiet
docker network inspect destaben-edge >/dev/null
docker network inspect lab-inverse-proxy_tunnel_ingress >/dev/null

active_config=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' lab-edge 2>/dev/null || true)
[[ "$active_config" == "$deploy_compose" ]] || fail "Nginx uses ${active_config:-no Compose file}, not $deploy_compose"

printf 'Preflight passed for %s. No services were changed.\n' "$deploy_root"