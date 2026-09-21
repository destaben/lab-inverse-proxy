---
name: release-validation
description: "Use before completing or reviewing Nginx, Docker Compose, Cloudflare Tunnel, proxy routes, deployment documentation, reverse-proxy tests, or AI customization changes."
argument-hint: "Provide the paths changed or ask to validate the current diff"
---

# Release Validation

## Select Checks By Scope

| Changed area | Required checks |
| --- | --- |
| Nginx, Compose, Cloudflare Tunnel, Docker networking, or `.env.example` | `npm test` and `sudo docker compose config` with an ignored local `.env` |
| Reverse-proxy tests | `npm test` |
| README or operations documentation | `npm test` if documented behavior or commands change; otherwise review the affected commands against `compose.yaml` and `nginx/nginx.conf` |
| AI instructions, skills, or agents | Verify frontmatter, scope, and referenced commands manually; then run `npm test` |

## Manual Acceptance Checks

For public-edge changes, run the documented local checks after deployment:

```sh
curl -i http://127.0.0.1:8080/healthz
curl -i http://127.0.0.1:8080/v1/contact
curl -i http://127.0.0.1:8080/not-allowed
curl -i -X PUT http://127.0.0.1:8080/v1/contact
sudo docker compose ps
```

Confirm the two documented routes are served, an unlisted route returns `404`, and an unsupported method returns `405`. Confirm externally that the public hostname exposes only documented routes and that Signal Relay has no host port.

## Reporting

Report each command run, its result, checks not run, and any manual verification. A local check never replaces deployment acceptance checks.