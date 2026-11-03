# Lab Inverse Proxy

Private HTTP edge for the Signal Relay laboratory. This repository deploys Nginx and an outbound Cloudflare Tunnel; the application image and its Reticulum configuration remain in [`destaben/destaben.github.io`](https://github.com/destaben/destaben.github.io).

```text
Browser -> HTTPS/WSS -> lab.destaben.dev -> Cloudflare Tunnel -> Nginx -> Signal Relay
Signal Relay -> destaben-edge -> Nginx :8082 (internal) -> printer Moonraker (GET/HEAD reads only)
```

Nginx binds diagnostics only to `127.0.0.1:8080`. The Tunnel is the only public path. Signal Relay has no published host port and joins the external Docker network, `destaben-edge`. Cloudflared reaches Nginx only through a separate private Docker network; it does not join the relay network.

The internal `:8082` listener is the only path from Signal Relay to the printer's Moonraker API. It has no host port and no Cloudflare ingress, and it proxies only exact `GET`/`HEAD` reads: the job-status query `print_stats&virtual_sdcard`, G-code metadata, thumbnails, and a single throttled G-code download at a time. Moonraker trusts its whole LAN, so every other method or path returns `405` or `404`, and client credentials are dropped. The printer address comes from the private `PRINTER_HOST` variable; unset, the printer routes fail closed with `502`. The public printer routes `/v1/lab/printer`, `/v1/lab/printer/thumbnail`, and `/v1/lab/printer/model/<32 lowercase hex>` are proxied to Signal Relay, which owns their content and must send exactly `print_stats&virtual_sdcard` as the query.

Nginx trusts `CF-Connecting-IP` only from that private Cloudflared address, applies per-client connection and request limits, permits only the documented HTTP methods, and returns `404` for every other path. These controls bound HTTP work after traffic reaches the tunnel; they do not replace upstream volumetric DDoS protection.

## Meshtastic Lab API

The public edge permits three Meshtastic routes owned by Signal Relay:

- `GET /v1/lab/meshtastic` returns a normalized, public status document.
- `GET` and `HEAD /v1/lab/meshtastic-status` return the read-only Home Assistant backed Meshtastic status. Signal Relay answers `503 meshtastic_status_unavailable` when it is not configured.
- `POST /v1/lab/meshtastic/messages` submits a short message for the fixed MediumFast channel.

The message route has a separate per-client limit and a 1 KiB body limit. Signal Relay must validate Turnstile, enforce its own cooldown and queue limits, and call Home Assistant only through the private Nginx listener. It must invoke only `script.meshtastic_public_broadcast`; Home Assistant, its general service API, history, events, configuration, and credentials are never public routes.

Turnstile credentials and the Home Assistant access token belong exclusively to the private Signal Relay deployment. They are not variables owned by this edge repository and must not be added to `.env` here.

## Deployment

Use `/opt/src/lab-inverse-proxy` for the versioned source checkout and `/opt/lab-inverse-proxy` for the private runtime directory. Do not commit or copy a populated `.env` into this repository.

```sh
git clone https://github.com/destaben/lab-inverse-proxy.git /opt/src/lab-inverse-proxy
mkdir -p /opt/lab-inverse-proxy
cp /opt/src/lab-inverse-proxy/.env.example /opt/lab-inverse-proxy/.env
chmod 600 /opt/lab-inverse-proxy/.env
docker network create destaben-edge
docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# First start only: preflight.sh needs the running edge, so bring it up directly.
install -m 0644 /opt/src/lab-inverse-proxy/compose.yaml /opt/lab-inverse-proxy/compose.yaml
install -D -m 0644 /opt/src/lab-inverse-proxy/nginx/nginx.conf /opt/lab-inverse-proxy/nginx/nginx.conf
docker compose -f /opt/lab-inverse-proxy/compose.yaml --env-file /opt/lab-inverse-proxy/.env up -d
# Later updates:
/opt/src/lab-inverse-proxy/scripts/preflight.sh
/opt/src/lab-inverse-proxy/scripts/deploy.sh
```

Create a remotely managed Cloudflare Tunnel first, map `lab.destaben.dev` to `http://nginx:8080`, then place its token in the local `.env`. The token is never printed, committed, or shared with the Signal Relay repository.

Before the first `up`, confirm that `172.30.250.0/29` is absent from the preceding output. It is reserved for the private Cloudflared-to-Nginx ingress network. If it overlaps an existing Docker, LAN, or VPN subnet, stop and change the subnet and both fixed addresses in `compose.yaml` and the Cloudflared address in `set_real_ip_from` in `nginx/nginx.conf` together before deployment.

Start Signal Relay from its own deployment project after it has joined the same external network. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for clean-host setup, updates, rollback, and acceptance checks.

## Automatic Deployment

`.github/workflows/deploy-edge.yml` deploys on pushes to `main` that touch `nginx/**`, `compose.yaml`, `scripts/**`, or the workflow file (docs-only commits do not redeploy), and on manual `workflow_dispatch`. The job targets the `edge-production` GitHub environment. It runs on the self-hosted runner on the lab host (`runs-on: [self-hosted]`; no custom labels are configured), with `permissions: contents: read` and a `deploy-edge` concurrency group so deployments never overlap. It checks out the repository without persisted credentials, runs `nginx -t` in the Nginx image, runs `scripts/deploy.sh` (preflight, `docker compose config`, pull, `up -d --remove-orphans`, then a recreate of only the Nginx container, waiting up to 90 seconds for its healthcheck, so a configuration-only change takes effect), and runs `scripts/verify.sh`. A `test` job (`npm test`, GitHub-hosted runner) must pass first, and the deploy job runs only for `refs/heads/main`, so `workflow_dispatch` on another branch deploys nothing. Each qualifying push recreates Nginx, causing a short public outage (seconds, up to the 90-second healthcheck wait). If Deploy or Verify fails, a final step restores the previous `compose.yaml` and `nginx.conf` from a snapshot taken before Deploy and recreates Nginx; the run still ends failed. This is best effort: a job timeout (20 minutes) cancels the job and skips it, in which case use `scripts/rollback.sh`. The `nginx -t` step uses the Nginx image reference read from `compose.yaml`, pulled fresh. Because both images use `pull_policy: always` on floating or pinned tags, every deployment pulls whatever those tags currently resolve to; pin digests if reproducible deployments matter. It reads no GitHub secrets. The Cloudflare token stays in `/opt/lab-inverse-proxy/.env` on the host, outside Git.

Host prerequisites, done once:

- Register the repository's self-hosted runner on the lab host and keep it running as a service.
- The runner user must be able to run `docker` without `sudo`: add it to the `docker` group (`sudo usermod -aG docker <runner-user>`), then restart the runner service so the group applies. The scripts expect this (and `docker context show` to print `default`) but do not check it; a missing permission only fails at the first `docker` call, so verify with `docker context show` and `docker ps` as the runner user. If you prefer `sudo`, grant a narrowly scoped sudoers rule instead and change the workflow commands to `sudo docker ...`.
- `/opt/lab-inverse-proxy/.env` must already exist with mode `0600` and be readable by the runner user (own it as the runner user; a root-owned `0600` file passes preflight but fails at `docker compose`). The edge must already be running from `/opt/lab-inverse-proxy/compose.yaml` (see Deployment), because preflight inspects the running `lab-edge` container and the `lab-inverse-proxy_tunnel_ingress` network.

Security model: membership of the `docker` group is equivalent to root on the host, and every qualifying push to `main` runs workflow code as that user. Merging to `main` is therefore a trust decision. The owner should enable branch protection on `main` (required pull-request review, no force-push, no bypass) and configure the `edge-production` environment with required reviewers and a deployment-branch restriction to `main`. These are repository settings; they are not enforced by this repository's files.

The public `/v1/lab/meshtastic-status` payload is produced by Signal Relay (`destaben.github.io`), whose contract in `docs/SIGNAL-RELAY.md` in that repository (https://github.com/destaben/destaben.github.io/blob/main/docs/SIGNAL-RELAY.md) allows only a fixed whitelist of fields; no entity IDs or topology are exposed. Nginx only allowlists the route.

Do not add `pull_request` triggers to this workflow: a self-hosted runner must not run code from unreviewed pull requests.

## Validation

```sh
npm test
/opt/src/lab-inverse-proxy/scripts/preflight.sh
curl http://127.0.0.1:8080/healthz
```
