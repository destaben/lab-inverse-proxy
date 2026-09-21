---
description: "Use when editing Nginx, Docker Compose, Cloudflare Tunnel, edge deployment documentation, or reverse-proxy tests."
applyTo: "compose.yaml,nginx/**,docs/**,README.md,tests/**,.env.example"
---
# Edge Proxy Guidelines

- Nginx is the only public HTTP policy point. Preserve its loopback-only host binding and the outbound Cloudflare Tunnel; do not add public host ports.
- The edge reaches Signal Relay only through the external `destaben-edge` Docker network. Do not make it a generic proxy or give it access to arbitrary backends.
- Allowlist fixed public API routes, retain the default `404`, and preserve rate, connection, body-size, and timeout bounds.
- Trust `CF-Connecting-IP` only because Nginx has no public host binding and Cloudflare Tunnel is the sole public ingress.
- The internal `8081` listener has no host port or Cloudflare ingress and may proxy only the fixed Home Assistant API reads needed by Signal Relay.
- Keep containers unprivileged, read-only, capability-dropped, and compatible with the supported Signal Relay image on `linux/amd64` and `linux/arm64`.
- Never commit a populated `.env`, tunnel token, identities, private topology, Home Assistant settings, Telegram values, or other credentials.
- Validate Compose with an ignored local `.env` and run `npm test` after edge configuration changes.
