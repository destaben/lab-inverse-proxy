# Operations

## Responsibilities

This project owns Nginx, the outbound Cloudflare Tunnel, and the HTTP policy for `lab.destaben.dev`. The Signal Relay project owns the `ghcr.io/destaben/signal-relay:latest` image, Reticulum configuration, persistent LXMF identity, application data, and all application environment variables.

The shared external Docker network is `destaben-edge`. It is intentionally created outside either Compose project so `docker compose down` in one project cannot remove connectivity for the other.

## First Migration

On the mini PC, preserve the existing `/opt/signal-relay/.env`, `reticulum/`, `lab-sender-reticulum/`, and the `signal-relay-data` volume. Do not copy any of these into this repository.

```sh
sudo docker network create destaben-edge
git clone https://github.com/destaben/lab-inverse-proxy.git /opt/lab-inverse-proxy
cd /opt/lab-inverse-proxy
cp .env.example .env
chmod 600 .env
sudo docker network inspect $(sudo docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
sudo docker compose config
sudo docker compose pull
sudo docker compose up -d
```

Apply the corresponding Signal Relay Compose update so its `signal-relay` service joins `destaben-edge`; it must retain no `ports` section. Restart the relay project, then run the acceptance checks below. Do not change the Cloudflare hostname, DNS record, or tunnel mapping during this first extraction.

The edge reserves `172.30.250.0/29` for an internal-only network between Cloudflared and Nginx. Before starting the edge, confirm that the command above does not list that subnet and that it does not overlap a LAN or VPN route. If it does, select an unused private `/29` and update the Cloudflared address, Nginx address, and `set_real_ip_from` together. Do not add Cloudflared to `destaben-edge`.

## Update

```sh
cd /opt/lab-inverse-proxy
git pull --ff-only
sudo docker compose config
sudo docker compose pull
sudo docker compose up -d --remove-orphans
sudo docker compose ps
```

Do not replace `.env`. To roll back an edge revision, check out the prior Git commit, rerun `sudo docker compose config`, and recreate the services with `sudo docker compose up -d --remove-orphans`.

## Acceptance Checks

```sh
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/v1/contact
curl -i http://127.0.0.1:8080/not-allowed
curl -i -X PUT http://127.0.0.1:8080/v1/contact
sudo docker compose ps
```

The first two requests should be served by Signal Relay. The unlisted route must return `404`; the `PUT` request must return `405`. Also confirm externally that `https://lab.destaben.dev` serves only documented routes and that no host ports expose Signal Relay (`8787`), Home Assistant (`8123`), or Reticulum TCP. A short burst from one client may receive `429`; this is the intended local bot-abuse control.
