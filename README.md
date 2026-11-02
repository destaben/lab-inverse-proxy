# Lab Inverse Proxy

Private HTTP edge for the Signal Relay laboratory. This repository deploys Nginx and an outbound Cloudflare Tunnel; the application image and its Reticulum configuration remain in [`destaben/destaben.github.io`](https://github.com/destaben/destaben.github.io).

```text
Browser -> HTTPS/WSS -> lab.destaben.dev -> Cloudflare Tunnel -> Nginx -> Signal Relay
```

Nginx binds diagnostics only to `127.0.0.1:8080`. The Tunnel is the only public path. Signal Relay has no published host port and joins the external Docker network, `destaben-edge`. Cloudflared reaches Nginx only through a separate private Docker network; it does not join the relay network.

Nginx trusts `CF-Connecting-IP` only from that private Cloudflared address, applies per-client connection and request limits, permits only the documented HTTP methods, and returns `404` for every other path. These controls bound HTTP work after traffic reaches the tunnel; they do not replace upstream volumetric DDoS protection.

## Meshtastic Lab API

The public edge permits three Meshtastic routes owned by Signal Relay:

- `GET /v1/lab/meshtastic` returns a normalized, public status document.
- `GET /v1/lab/meshtastic-status` returns the read-only Home Assistant backed Meshtastic status. Signal Relay answers `503 meshtastic_status_unavailable` when it is not configured.
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
/opt/src/lab-inverse-proxy/scripts/preflight.sh
/opt/src/lab-inverse-proxy/scripts/deploy.sh
```

Create a remotely managed Cloudflare Tunnel first, map `lab.destaben.dev` to `http://nginx:8080`, then place its token in the local `.env`. The token is never printed, committed, or shared with the Signal Relay repository.

Before the first `up`, confirm that `172.30.250.0/29` is absent from the preceding output. It is reserved for the private Cloudflared-to-Nginx ingress network. If it overlaps an existing Docker, LAN, or VPN subnet, stop and change the subnet and both fixed addresses together in `compose.yaml` and `nginx/nginx.conf` before deployment.

Start Signal Relay from its own deployment project after it has joined the same external network. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for clean-host setup, updates, rollback, and acceptance checks.

## Automatic Deployment

`.github/workflows/deploy-edge.yml` deploys on every push to `main` (and on manual `workflow_dispatch`). It runs on the self-hosted runner on the lab host (`runs-on: [self-hosted]`; no custom labels are configured), with `permissions: contents: read` and a `deploy-edge` concurrency group so deployments never overlap. It checks out the repository without persisted credentials, runs `nginx -t` in the Nginx image, runs `scripts/deploy.sh` (preflight, `docker compose config`, pull, `up -d --remove-orphans`), recreates only the Nginx container so a configuration-only change takes effect, and runs `scripts/verify.sh`. It reads no GitHub secrets. The Cloudflare token stays in `/opt/lab-inverse-proxy/.env` on the host, outside Git.

Host prerequisites, done once:

- Register the repository's self-hosted runner on the lab host and keep it running as a service.
- The runner user must be able to run `docker` without `sudo`: add it to the `docker` group (`sudo usermod -aG docker <runner-user>`), then restart the runner service so the group applies. This is the same requirement the scripts already have. If you prefer `sudo`, grant a narrowly scoped sudoers rule instead and change the workflow commands to `sudo docker ...`.
- `/opt/lab-inverse-proxy/.env` must already exist with mode `0600`, and the edge must already be running from `/opt/lab-inverse-proxy/compose.yaml` (see Deployment).

Do not add `pull_request` triggers to this workflow: a self-hosted runner must not run code from unreviewed pull requests.

## Validation

```sh
npm test
/opt/src/lab-inverse-proxy/scripts/preflight.sh
curl http://127.0.0.1:8080/healthz
```
