# Operations

## Responsibilities

This project owns Nginx, the outbound Cloudflare Tunnel, and the HTTP policy for `lab.destaben.dev`. The Signal Relay project owns the `ghcr.io/destaben/signal-relay:latest` image, Reticulum configuration, persistent LXMF identity, application data, and all application environment variables.

The shared external Docker network is `destaben-edge`. It is intentionally created outside either Compose project so `docker compose down` in one project cannot remove connectivity for the other.

## First Migration

On the mini PC, preserve the existing `/opt/signal-relay/.env`, `reticulum/`, `lab-sender-reticulum/`, and the `signal-relay-data` volume. Do not copy any of these into this repository.

```sh
docker network create destaben-edge
git clone https://github.com/destaben/lab-inverse-proxy.git /opt/src/lab-inverse-proxy
mkdir -p /opt/lab-inverse-proxy
cp /opt/src/lab-inverse-proxy/.env.example /opt/lab-inverse-proxy/.env
chmod 600 /opt/lab-inverse-proxy/.env
docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
/opt/src/lab-inverse-proxy/scripts/preflight.sh
/opt/src/lab-inverse-proxy/scripts/deploy.sh
```

Apply the corresponding Signal Relay Compose update so its `signal-relay` service joins `destaben-edge`; it must retain no `ports` section. Restart the relay project, then run the acceptance checks below. Do not change the Cloudflare hostname, DNS record, or tunnel mapping during this first extraction.

The edge reserves `172.30.250.0/29` for an internal-only network between Cloudflared and Nginx. Before starting the edge, confirm that the command above does not list that subnet and that it does not overlap a LAN or VPN route. If it does, select an unused private `/29` and update the Cloudflared address, Nginx address, and `set_real_ip_from` together. Do not add Cloudflared to `destaben-edge`.

## Update

The repository scripts run from `/opt/src/lab-inverse-proxy` and deploy to `/opt/lab-inverse-proxy`. They require a user in the `docker` group with `docker context show` set to `default`, validate the private deployment `.env` without printing it, preserve `destaben-edge`, and never run `docker compose down`.

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
curl -i -X POST http://127.0.0.1:8080/v1/lab/meshtastic/messages
curl -i http://127.0.0.1:8080/not-allowed
curl -i -X PUT http://127.0.0.1:8080/v1/contact
docker compose ps
```

The status request should be served by Signal Relay. The message request without its required payload and bot-abuse proof must be rejected by Signal Relay; Nginx only permits the route and applies its outer request limit. The unlisted route must return `404`; the `PUT` request must return `405`. Also confirm externally that `https://lab.destaben.dev` serves only documented routes and that no host ports expose Signal Relay (`8787`), Home Assistant (`8123`), or Reticulum TCP. A short burst from one client may receive `429`; this is the intended local bot-abuse control.

Signal Relay reaches Home Assistant through Nginx's private listener. It can read the Meshtastic state inventory to select one complete non-gateway neighbor automatically, read documented state entities, and call only `script.meshtastic_public_broadcast`; attempts to reach a different Home Assistant service, history, events, logbook, or configuration route must return `404` or `405`. The private listener has no host port or Cloudflare ingress. Keep the Signal Relay Turnstile secret and Home Assistant access token only in its private deployment environment.
