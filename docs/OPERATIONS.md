# Operations

## Responsibilities

This project owns Nginx, the outbound Cloudflare Tunnel, and the HTTP policy for `lab.destaben.dev`. The Signal Relay project owns the `ghcr.io/destaben/signal-relay:latest` image, Reticulum configuration, persistent LXMF identity, application data, and all application environment variables.

The shared external Docker network is `destaben-edge`. It is intentionally created outside either Compose project so `docker compose down` in one project cannot remove connectivity for the other.

## Clean Host Setup

On a replacement host, restore the Signal Relay private environment, Reticulum
material, and persistent data from their approved backup before starting the
relay. This edge repository does not contain those private assets; do not copy
them into this repository. The steps below install the edge from scratch.

```sh
docker network create destaben-edge
git clone https://github.com/destaben/lab-inverse-proxy.git /opt/src/lab-inverse-proxy
mkdir -p /opt/lab-inverse-proxy
cp /opt/src/lab-inverse-proxy/.env.example /opt/lab-inverse-proxy/.env
chmod 600 /opt/lab-inverse-proxy/.env
docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# First start only: preflight.sh requires the running lab-edge container and the
# lab-inverse-proxy_tunnel_ingress network, which `up` creates, so start directly.
install -m 0644 /opt/src/lab-inverse-proxy/compose.yaml /opt/lab-inverse-proxy/compose.yaml
install -D -m 0644 /opt/src/lab-inverse-proxy/nginx/nginx.conf /opt/lab-inverse-proxy/nginx/nginx.conf
docker compose -f /opt/lab-inverse-proxy/compose.yaml --env-file /opt/lab-inverse-proxy/.env up -d
# Later updates:
/opt/src/lab-inverse-proxy/scripts/preflight.sh
/opt/src/lab-inverse-proxy/scripts/deploy.sh
```

Configure the Signal Relay deployment so its `signal-relay` service joins
`destaben-edge`; it must retain no `ports` section. Start the relay project,
then run the acceptance checks below. Restore the existing Cloudflare hostname,
DNS record, and tunnel mapping from their approved operational record rather
than creating an alternative public path.

The edge reserves `172.30.250.0/29` for an internal-only network between Cloudflared and Nginx. Before starting the edge, confirm that the command above does not list that subnet and that it does not overlap a LAN or VPN route. If it does, select an unused private `/29` and update the subnet and both fixed addresses in `compose.yaml` and the Cloudflared address in `set_real_ip_from` in `nginx/nginx.conf` together. Do not add Cloudflared to `destaben-edge`.

## Update

The repository scripts run from `/opt/src/lab-inverse-proxy` and deploy to `/opt/lab-inverse-proxy`. They expect a user in the `docker` group with `docker context show` set to `default` but do not check it; a missing permission only fails at the first `docker` call, so run `docker context show` before the first run. They validate the private deployment `.env` without printing it, preserve `destaben-edge`, and never run `docker compose down`.

```sh
./scripts/preflight.sh
./scripts/deploy.sh
./scripts/verify.sh
```

To deploy an earlier Git revision, first ensure the deployment checkout is clean, then run:

```sh
./scripts/rollback.sh --confirm <git-ref>
```

The rollback changes only the tracked Nginx and Compose configuration. It does not replace `.env`, recreate the Cloudflare Tunnel, change DNS, or remove either Docker network.

Pushes to `main` that change `nginx/**`, `compose.yaml`, `scripts/**`, or the workflow run these steps automatically through `.github/workflows/deploy-edge.yml` on the host's self-hosted runner. Docs-only commits do not redeploy. Each qualifying push recreates Nginx, so expect a short public outage. For the runner's host prerequisites, security model (docker group is host root; branch protection and the `edge-production` environment), test gate, automatic restore on failure, and `pull_policy: always` behavior, see [README.md](../README.md#automatic-deployment), which is the source of truth. `scripts/deploy.sh` itself recreates Nginx (`up -d --force-recreate --no-deps --wait`), so the manual path and `scripts/rollback.sh` also apply an Nginx policy change.

The `/v1/lab/meshtastic-status` payload is produced by Signal Relay (`destaben.github.io`), whose contract in [docs/SIGNAL-RELAY.md](https://github.com/destaben/destaben.github.io/blob/main/docs/SIGNAL-RELAY.md) allows only a fixed whitelist; no entity IDs or topology are exposed. `scripts/verify.sh` probes it and accepts `200`, or `503` only when the body contains `meshtastic_status_unavailable`.

For a manual update, the equivalent commands are:

```sh
cd /opt/src/lab-inverse-proxy
git pull --ff-only
./scripts/preflight.sh
./scripts/deploy.sh
./scripts/verify.sh
```

Do not replace `.env`. To roll back an edge revision, check out the prior Git commit in `/opt/src/lab-inverse-proxy`, then run `./scripts/rollback.sh --confirm <git-ref>` from that checkout.

## Acceptance Checks

```sh
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/v1/contact
curl -i http://127.0.0.1:8080/v1/lab/meshtastic
curl -i http://127.0.0.1:8080/v1/lab/meshtastic-status   # 200, or 503 meshtastic_status_unavailable; 404 means the route is missing
curl -i -X POST http://127.0.0.1:8080/v1/lab/meshtastic/messages
curl -i http://127.0.0.1:8080/not-allowed
curl -i -X PUT http://127.0.0.1:8080/v1/contact
docker compose ps
```

The status request should be served by Signal Relay. The message request without its required payload and bot-abuse proof must be rejected by Signal Relay; Nginx only permits the route and applies its outer request limit. The unlisted route must return `404`; the `PUT` request must return `405`. Also confirm externally that `https://lab.destaben.dev` serves only documented routes and that no host ports expose Signal Relay (`8787`), Home Assistant (`8123`), or Reticulum TCP. A short burst from one client may receive `429`; this is the intended local bot-abuse control.

Signal Relay reaches Home Assistant through Nginx's private listener. It can read the Meshtastic state inventory to select one complete non-gateway neighbor automatically, read documented state entities, and call only `script.meshtastic_public_broadcast`; attempts to reach a different Home Assistant service, history, events, logbook, or configuration route must return `404` or `405`. The private listener has no host port or Cloudflare ingress. Keep the Signal Relay Turnstile secret and Home Assistant access token only in its private deployment environment.
