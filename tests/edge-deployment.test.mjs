import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps the edge private, bounded, and isolates tunnel ingress from the relay network", async () => {
  const [compose, nginx] = await Promise.all([
    readRepositoryFile("compose.yaml"),
    readRepositoryFile("nginx/nginx.conf"),
  ]);

  assert.match(compose, /127\.0\.0\.1:8080:8080/);
  assert.match(compose, /external: true/);
  assert.match(compose, /name: destaben-edge/);
  assert.match(compose, /tunnel_ingress:/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /subnet: 172\.30\.250\.0\/29/);
  assert.match(compose, /ipv4_address: 172\.30\.250\.2/);
  assert.match(compose, /ipv4_address: 172\.30\.250\.3/);
  assert.match(compose, /tunnel_egress: \{\}/);
  assert.doesNotMatch(compose, /signal-relay:\n/);
  const cloudflared = compose.slice(compose.indexOf("  cloudflared:"), compose.indexOf("\nnetworks:"));
  assert.doesNotMatch(cloudflared, /^      edge:/m);
  assert.match(nginx, /server signal-relay:8787;/);
  assert.match(nginx, /server_tokens off;/);
  assert.match(nginx, /set_real_ip_from 172\.30\.250\.2\/32;/);
  assert.match(nginx, /real_ip_recursive off;/);
  assert.doesNotMatch(nginx, /set_real_ip_from 0\.0\.0\.0\/0/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=public_api:10m rate=30r\/m;/);
  assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=reticulum_lab:10m rate=5r\/m;/);
  assert.match(nginx, /limit_conn_status 429;/);
  assert.match(nginx, /location = \/v1\/lab\/reticulum-nodes/);
  assert.match(nginx, /location = \/v1\/lab\/metrics/);
  assert.match(nginx, /\^\(POST\|OPTIONS\)\$/);
  assert.match(nginx, /\^\(GET\|HEAD\|POST\|OPTIONS\)\$/);
  assert.match(nginx, /limit_req zone=reticulum_lab burst=2 nodelay/);
  assert.match(nginx, /listen 8081;/);
  assert.match(nginx, /location \/ \{ return 404; \}/);
  assert.doesNotMatch(nginx, /TCPServerInterface/);
});
