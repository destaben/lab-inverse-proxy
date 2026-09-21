# Project Instructions

## Context

This repository owns the private HTTP edge for the Signal Relay laboratory. It deploys Nginx and an outbound Cloudflare Tunnel; it does not build, configure, or contain the Signal Relay application.

## Structure

- `compose.yaml` runs the Nginx edge and Cloudflare Tunnel on the shared Docker network.
- `nginx/nginx.conf` is the sole HTTP policy point for the public laboratory API.
- `.env.example` documents the only deployment variable owned here; a populated `.env` remains private.
- `docs/OPERATIONS.md` defines host installation, updates, rollback, and acceptance checks.

## Working Rules

- Keep Nginx bound only to `127.0.0.1:8080` for host diagnostics. Cloudflare Tunnel is the only public HTTP path.
- Keep the shared Docker network external and named `destaben-edge`. The Signal Relay joins it from its own Compose project; do not publish its port or create a host network path to it.
- Allowlist public routes explicitly and return `404` for everything else. Preserve body, connection, request, and laboratory POST limits.
- Never commit Cloudflare tokens, credentials, private topology, Reticulum identities, Home Assistant details, Telegram values, or deployment `.env` files.
- Run `docker compose config` with an ignored local `.env` and `npm test` after changes to Compose, Nginx, or tests.

## AI Assistance

- Use `.github/instructions/edge-proxy.instructions.md` for Nginx, Compose, Cloudflare, documentation, and deployment changes.
- Use `edge-boundary-reviewer` for public exposure, proxy routes, headers, Docker ports, and tunnel-boundary reviews.
