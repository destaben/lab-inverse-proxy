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

# The route is served by Signal Relay: 200 when configured, or 503 with the code
# meshtastic_status_unavailable when it is not. Any other status, or a 503 with a
# different body, means the route or the edge is broken.
require_meshtastic_status() {
  local url=$1 body_file status
  body_file=$(mktemp)
  status=$(curl --connect-timeout 5 --max-time 10 --silent --output "$body_file" --write-out '%{http_code}' "$url" || true)
  if [[ "$status" == "200" ]] || { [[ "$status" == "503" ]] && grep -q 'meshtastic_status_unavailable' "$body_file"; }; then
    rm -f "$body_file"
    return 0
  fi
  rm -f "$body_file"
  printf 'ERROR: unexpected HTTP %s (or a 503 without meshtastic_status_unavailable) for %s\n' "$status" "$url" >&2
  exit 1
}

require_status 200 http://127.0.0.1:8080/healthz
require_status 404 http://127.0.0.1:8080/not-allowed
require_status 405 -X PUT http://127.0.0.1:8080/v1/contact
require_meshtastic_status http://127.0.0.1:8080/v1/lab/meshtastic-status
docker compose -f "$deploy_compose" --env-file "$deploy_root/.env" ps
printf 'Edge verification passed. Confirm the external hostname separately after tunnel changes.\n'