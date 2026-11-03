# Operations

## Responsibilities

This project owns Nginx, the outbound Cloudflare Tunnel, and the HTTP policy for `lab.destaben.dev`. The Signal Relay project owns the `ghcr.io/destaben/signal-relay:latest` image, Reticulum configuration, persistent LXMF identity, application data, and all application environment variables.

The shared external Docker network is `destaben-edge`. It is intentionally created outside either Compose project so `docker compose down` in one project cannot remove connectivity for the other.

The printer laboratory's Moonraker API is reached only through the internal `:8082` listener. Its address is a private deployment value, `PRINTER_HOST`, owned by this host and never recorded in Git or in the Signal Relay repository.

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

## Printer Laboratory

Set `PRINTER_HOST` in the private `.env` to the LAN address of the host that serves Moonraker on HTTP port 80. Keep the value out of Git and out of any shared output. An empty value leaves the printer routes failing closed with `502`.

`extra_hosts` is applied only when the container is created, so recreate the Nginx service after changing it:

```sh
cd /opt/lab-inverse-proxy
sudo docker compose config
sudo docker compose up -d --force-recreate nginx
```

## Acceptance Checks

```sh
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/v1/contact
curl -i http://127.0.0.1:8080/not-allowed
curl -i -X PUT http://127.0.0.1:8080/v1/contact
sudo docker compose ps
```

The first two requests should be served by Signal Relay. The unlisted route must return `404`; the `PUT` request must return `405`. Also confirm externally that `https://lab.destaben.dev` serves only documented routes and that no host ports expose Signal Relay (`8787`), the printer listener (`8082`), Home Assistant (`8123`), or Reticulum TCP. A short burst from one client may receive `429`; this is the intended local bot-abuse control.

Printer listener checks run on the edge host. They are read-only: the only upstream request is the job-status query, and no check downloads G-code or sends a command to the printer.

```sh
# Must fail to connect: the listener publishes no host port.
curl -sS --max-time 3 http://127.0.0.1:8082/ || echo "not published (expected)"
# Inside the edge container, which is on destaben-edge.
sudo docker compose exec nginx wget -S -O /dev/null http://127.0.0.1:8082/printer/info
sudo docker compose exec nginx wget -S -O /dev/null --post-data=x "http://127.0.0.1:8082/printer/objects/query?print_stats&virtual_sdcard"
sudo docker compose exec nginx wget -S -O /dev/null "http://127.0.0.1:8082/printer/objects/query?print_stats&virtual_sdcard"
```

The `/printer/info` request must return `404`; the `POST` must return `405`; the exact query must return `200` once `PRINTER_HOST` is set. A `502` on the last request means `PRINTER_HOST` is empty or the printer is unreachable. Any other query string must return `404`, and `wget` prints the response headers on stderr for non-2xx replies.
