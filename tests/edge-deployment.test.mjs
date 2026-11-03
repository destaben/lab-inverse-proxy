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

const serverBlock = (nginx, listenPort) => {
  const listen = nginx.match(new RegExp(`^\\s*listen ${listenPort};`, "m"));
  assert.ok(listen, `no server listens on ${listenPort}`);
  const open = nginx.lastIndexOf("server {", listen.index);
  let depth = 0;
  for (let index = nginx.indexOf("{", open); index < nginx.length; index += 1) {
    if (nginx[index] === "{") depth += 1;
    if (nginx[index] === "}" && --depth === 0) return nginx.slice(open, index + 1);
  }
  throw new Error(`unterminated server block for ${listenPort}`);
};

// Greedy up to the last " {" on the line, so regex quantifiers such as {2,4} stay inside the pattern.
const locationsOf = (block) => [...block.matchAll(/^\s*location\s+(.+) \{(?=\s|$)/gm)].map((match) => match[1]);

// One location, from its header line to its closing brace.
const locationBlock = (block, header) => {
  const start = block.indexOf(`location ${header} {`);
  assert.notEqual(start, -1, `missing location ${header}`);
  return block.slice(start, block.indexOf("\n    }", start));
};

// Decoded $uri carries a literal space (never %20); PCRE "$" would also accept a trailing newline, so use \z.
const SAFE_NAME = String.raw`(?:[-A-Za-z0-9_+ ]|\.(?!\.))+`;
const SAFE_ARG_NAME = String.raw`(?:[-A-Za-z0-9_+]|%20|\.(?!\.))+`;

test("exposes the printer laboratory through a bounded, GET-only internal listener", async () => {
  const [compose, nginx, envExample] = await Promise.all([
    readRepositoryFile("compose.yaml"),
    readRepositoryFile("nginx/nginx.conf"),
    readRepositoryFile(".env.example"),
  ]);
  const printer = serverBlock(nginx, 8082);

  assert.match(nginx, /upstream printer \{\s*server printer\.internal:80;\s*\}/);
  assert.doesNotMatch(compose, /8082/, "the printer listener must publish no host port");
  assert.match(compose, /"printer\.internal:\$\{PRINTER_HOST:-127\.0\.0\.1\}"/);
  assert.match(envExample, /^PRINTER_HOST=$/m);

  // Moonraker trusts the LAN: it can run G-code, e-stop and delete files, so only these reads may pass.
  const thumbnails = String.raw`~ "^/server/files/gcodes/\.thumbs/${SAFE_NAME}-[0-9]{2,4}x[0-9]{2,4}\.png\z"`;
  const downloads = String.raw`~ "^/server/files/gcodes/${SAFE_NAME}\.gcode\z"`;
  assert.deepEqual(locationsOf(printer), ["= /printer/objects/query", "= /server/files/metadata", thumbnails, downloads, "/"]);
  assert.doesNotMatch(printer, /%20.*\{\s*$/m, "location regexes match the decoded URI, so %20 never appears there");
  assert.doesNotMatch(printer, /\$"/, "end anchors must be \\z, not $");

  for (const header of ["= /printer/objects/query", "= /server/files/metadata", thumbnails, downloads]) {
    const location = locationBlock(printer, header);
    assert.match(location, /if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405; \}/, `${header}: method guard`);
    assert.match(location, /proxy_pass http:\/\/printer;/, `${header}: must proxy to the printer upstream only`);
    assert.doesNotMatch(location, /signal_relay|home_assistant/);
  }
  assert.ok(
    locationBlock(printer, "= /printer/objects/query").includes('if ($args != "print_stats&virtual_sdcard") { return 404; }'),
  );
  assert.ok(
    locationBlock(printer, "= /server/files/metadata").includes(String.raw`if ($args !~ "^filename=${SAFE_ARG_NAME}\.gcode\z") { return 404; }`),
  );
  for (const header of [thumbnails, downloads]) {
    assert.ok(locationBlock(printer, header).includes('if ($args != "") { return 404; }'), "no query string allowed");
  }
  assert.match(printer, /location \/ \{ return 404; \}/);
  assert.doesNotMatch(printer, /gcode\/script|emergency_stop|firmware_restart|machine\/|access\/|websocket|\bPOST\b|\bDELETE\b|Upgrade/);

  // Validation runs on the normalised URI but the raw URI is forwarded: keep slashes unmerged,
  // fix the Host (Traefik routes on it), and never forward client credentials.
  assert.match(printer, /merge_slashes off;/);
  assert.match(printer, /proxy_set_header Host printer\.internal;/);
  assert.doesNotMatch(printer, /proxy_set_header Host \$host;/);
  assert.match(printer, /proxy_set_header Authorization "";/);
  assert.match(printer, /proxy_set_header Cookie "";/);

  // The printer host is resource-constrained: serialise and throttle G-code downloads, and drop idle clients.
  assert.match(nginx, /limit_conn_zone \$server_name zone=printer_download:1m;/);
  assert.match(locationBlock(printer, downloads), /limit_conn printer_download 1;/);
  assert.match(locationBlock(printer, downloads), /limit_rate 1m;/);
  assert.match(printer, /proxy_max_temp_file_size 0;/);
  assert.match(printer, /client_max_body_size 1k;/);
  assert.match(printer, /keepalive_timeout 5s;/);
  assert.match(printer, /client_header_timeout 5s;/);
  assert.match(printer, /client_body_timeout 5s;/);
});

test("publishes only the documented printer routes on the public listener", async () => {
  const nginx = await readRepositoryFile("nginx/nginx.conf");
  const publicBlock = serverBlock(nginx, 8080);
  const model = String.raw`~ "^/v1/lab/printer/model/[a-f0-9]{32}\z"`;

  for (const header of ["= /v1/lab/printer", "= /v1/lab/printer/thumbnail", model]) {
    const location = locationBlock(publicBlock, header);
    assert.match(location, /if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405; \}/, `${header}: method guard`);
    assert.match(location, /proxy_pass http:\/\/signal_relay;/, `${header}: relay upstream`);
  }
  assert.doesNotMatch(publicBlock, /proxy_pass http:\/\/printer/, "the public listener never reaches Moonraker");
});

test("keeps the printer address and host details out of tracked files", async () => {
  const files = await Promise.all(
    ["compose.yaml", "nginx/nginx.conf", ".env.example", "README.md", "docs/OPERATIONS.md", "AGENTS.md"].map(readRepositoryFile),
  );
  // Any RFC 1918 address, except the documented 172.30.250.0/29 edge-internal network.
  const privateAddress = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?!250\.)\d{1,3}\.\d{1,3})\b/;
  for (const content of files) {
    assert.doesNotMatch(content, privateAddress);
    assert.doesNotMatch(content, /Raspberry|\bPi\b/);
  }
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
