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
  assert.match(nginx, /proxy_hide_header Access-Control-Allow-Origin;/);
  assert.match(nginx, /add_header Access-Control-Allow-Origin "https:\/\/info\.destaben\.dev" always;/);
  assert.match(nginx, /set_real_ip_from 172\.30\.250\.2\/32;/);
  assert.match(nginx, /real_ip_recursive off;/);
  assert.doesNotMatch(nginx, /set_real_ip_from 0\.0\.0\.0\/0/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=public_api:10m rate=120r\/m;/);
  assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=reticulum_lab:10m rate=5r\/m;/);
  assert.match(nginx, /limit_req_zone \$binary_remote_addr zone=meshtastic_message:10m rate=1r\/m;/);
  assert.match(nginx, /limit_conn_status 429;/);
  assert.match(nginx, /location = \/v1\/lab\/reticulum-nodes/);
  assert.match(nginx, /location = \/v1\/lab\/metrics/);
  assert.match(nginx, /location = \/v1\/lab\/meshtastic \{/);
  assert.match(nginx, /location = \/v1\/lab\/meshtastic\/messages \{/);
  assert.match(nginx, /location = \/v1\/lab\/meshtastic-status \{\s+if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405; \}\s+proxy_pass http:\/\/signal_relay;/);
  assert.match(nginx, /client_max_body_size 1k;/);
  assert.match(nginx, /limit_req zone=meshtastic_message burst=1 nodelay;/);
  assert.match(nginx, /\^\(POST\|OPTIONS\)\$/);
  assert.match(nginx, /\^\(GET\|HEAD\|POST\|OPTIONS\)\$/);
  assert.match(nginx, /limit_req zone=reticulum_lab burst=2 nodelay/);
  assert.match(nginx, /listen 8081;/);
  assert.match(nginx, /proxy_set_header Host host\.docker\.internal;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For "";/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Host "";/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto "";/);
  assert.match(nginx, /proxy_set_header X-Real-IP "";/);
  assert.match(nginx, /location = \/api\/services\/script\/meshtastic_public_broadcast/);
  assert.match(nginx, /location = \/api\/services\/script\/meshtastic_public_broadcast \{\s+if \(\$request_method !~ \^POST\$\) \{ return 405; \}\s+proxy_pass http:\/\/home_assistant;/);
  assert.match(nginx, /input_text\\\.meshtastic_public_recent_activity_\[1-5\]/);
  assert.match(nginx, /sensor\\\.meshtastic_d3st_2661074868_/);
  assert.doesNotMatch(nginx, /location ~ \^\/api\/states\/\[-_a-zA-Z0-9\.\]\+\$/);
  assert.match(nginx, /location \/ \{ return 404; \}/);
  assert.doesNotMatch(nginx, /TCPServerInterface/);
});

test("deploys automatically from main on the self-hosted runner with least privilege", async () => {
  const workflow = await readRepositoryFile(".github/workflows/deploy-edge.yml");

  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: \[self-hosted\]/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^ {4,}permissions:/m);
  assert.match(workflow, /environment: edge-production/);
  assert.match(workflow, /paths:\n +- "nginx\/\*\*"\n +- "compose\.yaml"\n +- "scripts\/\*\*"\n +- "\.github\/workflows\/deploy-edge\.yml"\n/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /deploy:\n    needs: test/);
  assert.match(workflow, /test:\n    runs-on: ubuntu-latest[\s\S]*run: npm test/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v4/);
  assert.doesNotMatch(workflow, /actions\/checkout@v/);
  assert.match(workflow, /name: Validate Nginx configuration[\s\S]*config --images nginx[\s\S]*nginx -t/);
  assert.doesNotMatch(workflow, /nginxinc\/nginx-unprivileged:/);
  assert.match(workflow, /name: Deploy\n[\s\S]*run: \.\/scripts\/deploy\.sh/);
  assert.match(workflow, /name: Verify\n\s+run: \.\/scripts\/verify\.sh/);
  assert.match(workflow, /if: failure\(\) && steps\.backup\.outcome == 'success'[\s\S]*up -d --force-recreate --no-deps --wait --wait-timeout 90 nginx/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test("deploy.sh recreates Nginx and verify.sh probes the status route strictly", async () => {
  const [deploy, verify] = await Promise.all([
    readRepositoryFile("scripts/deploy.sh"),
    readRepositoryFile("scripts/verify.sh"),
  ]);

  assert.match(deploy, /up -d --force-recreate --no-deps --wait --wait-timeout 90 nginx/);
  assert.match(verify, /require_meshtastic_status http:\/\/127\.0\.0\.1:8080\/v1\/lab\/meshtastic-status/);
  assert.match(verify, /"503" \]\] && grep -q 'meshtastic_status_unavailable'/);
});
