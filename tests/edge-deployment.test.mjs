import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps the edge private, bounded, and connected only through the shared network", async () => {
  const [compose, nginx] = await Promise.all([
    readRepositoryFile("compose.yaml"),
    readRepositoryFile("nginx/nginx.conf"),
  ]);

  assert.match(compose, /127\.0\.0\.1:8080:8080/);
  assert.match(compose, /external: true/);
  assert.match(compose, /name: destaben-edge/);
  assert.doesNotMatch(compose, /signal-relay:\n/);
  assert.match(nginx, /server signal-relay:8787;/);
  assert.match(nginx, /location = \/v1\/lab\/reticulum-nodes/);
  assert.match(nginx, /limit_req zone=reticulum_lab burst=2 nodelay/);
  assert.match(nginx, /listen 8081;/);
  assert.match(nginx, /location \/ \{ return 404; \}/);
  assert.doesNotMatch(nginx, /TCPServerInterface/);
});
