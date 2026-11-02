#!/usr/bin/env bash
set -euo pipefail

deploy_root=${LAB_EDGE_DEPLOY_ROOT:-/opt/lab-inverse-proxy}
deploy_compose="$deploy_root/compose.yaml"

for service in lab-edge reticulum-tunnel; do
  [[ $(docker inspect --format '{{.State.Running}}' "$service") == "true" ]] || {
    printf 'ERROR: %s is not running\n' "$service" >&2
    exit 1
  }
done

[[ $(docker inspect --format '{{.State.Health.Status}}' lab-edge) == "healthy" ]] || {
  printf 'ERROR: lab-edge is not healthy\n' >&2
  exit 1
}

require_status() {
  local expected=$1
  shift
  local actual
  actual=$(curl --connect-timeout 5 --max-time 10 --silent --output /dev/null --write-out '%{http_code}' "$@" || true)
  [[ "$actual" == "$expected" ]] || {
    printf 'ERROR: expected HTTP %s, got %s for %s\n' "$expected" "$actual" "$*" >&2
    exit 1
  }
}

# Accept either of two statuses (e.g. an upstream that may answer 503).
require_status_in() {
  local allowed=$1
  shift
  local actual
  actual=$(curl --connect-timeout 5 --max-time 10 --silent --output /dev/null --write-out '%{http_code}' "$@" || true)
  [[ " $allowed " == *" $actual "* ]] || {
    printf 'ERROR: expected HTTP %s, got %s for %s\n' "$allowed" "$actual" "$*" >&2
    exit 1
  }
}

require_status 200 http://127.0.0.1:8080/healthz
require_status 404 http://127.0.0.1:8080/not-allowed
require_status 405 -X PUT http://127.0.0.1:8080/v1/contact
# Served by Signal Relay: 200 when healthy, 503 when its upstream is degraded.
# 404 or anything else means the route is missing or the edge is broken.
require_status_in "200 503" http://127.0.0.1:8080/v1/lab/meshtastic-status
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" ps
printf 'Edge verification passed. Confirm the external hostname separately after tunnel changes.\n'