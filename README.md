# Lab Inverse Proxy

Private HTTP edge for the Signal Relay laboratory. This repository deploys Nginx and an outbound Cloudflare Tunnel; the application image and its Reticulum configuration remain in [`destaben/destaben.github.io`](https://github.com/destaben/destaben.github.io).

```text
Browser -> HTTPS/WSS -> lab.destaben.dev -> Cloudflare Tunnel -> Nginx -> Signal Relay
```

Nginx binds diagnostics only to `127.0.0.1:8080`. The Tunnel is the only public path. Signal Relay has no published host port and joins the external Docker network, `destaben-edge`. Cloudflared reaches Nginx only through a separate private Docker network; it does not join the relay network.

Nginx trusts `CF-Connecting-IP` only from that private Cloudflared address, applies per-client connection and request limits, permits only the documented HTTP methods, and returns `404` for every other path. These controls bound HTTP work after traffic reaches the tunnel; they do not replace upstream volumetric DDoS protection.

## Deployment

Use a private deployment directory, such as `/opt/lab-inverse-proxy`. Do not commit or copy a populated `.env` into this repository.

```sh
git clone https://github.com/destaben/lab-inverse-proxy.git /opt/lab-inverse-proxy
cd /opt/lab-inverse-proxy
cp .env.example .env
chmod 600 .env
sudo docker network create destaben-edge
sudo docker network inspect $(sudo docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
sudo docker compose config
sudo docker compose pull
sudo docker compose up -d
```

Create a remotely managed Cloudflare Tunnel first, map `lab.destaben.dev` to `http://nginx:8080`, then place its token in the local `.env`. The token is never printed, committed, or shared with the Signal Relay repository.

Before the first `up`, confirm that `172.30.250.0/29` is absent from the preceding output. It is reserved for the private Cloudflared-to-Nginx ingress network. If it overlaps an existing Docker, LAN, or VPN subnet, stop and change the subnet and both fixed addresses together in `compose.yaml` and `nginx/nginx.conf` before deployment.

Start Signal Relay from its own deployment project after it has joined the same external network. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for migration, updates, rollback, and acceptance checks.

## Validation

```sh
npm test
sudo docker compose config
curl http://127.0.0.1:8080/healthz
```
