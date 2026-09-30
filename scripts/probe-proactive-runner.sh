#!/bin/sh
# Step 10a — proactive runner isolation probes.
# Secret via env PROACTIVE_RUNNER_SECRET only. Never printed.
# Usage: PROACTIVE_RUNNER_SECRET=<secret> sh scripts/probe-proactive-runner.sh
set -u

RUNNER=agent-gateway-proactive-runner-1
PROXY=agent-gateway-egress-proxy-1
INT_NET=agent-gateway_proactive-internal
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

[ -n "${PROACTIVE_RUNNER_SECRET:-}" ] || { echo "PROACTIVE_RUNNER_SECRET required"; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl required"; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "docker required"; exit 2; }
MI_FILE="${TMPDIR:-/tmp}/probe-mi.$$"

echo "== P1 workspace read =="
docker exec "$RUNNER" sh -c 'cat /workspace/AGENTS.md > /dev/null' \
  && ok "workspace read" || bad "workspace read"

echo "== P2 workspace write must fail =="
docker exec "$RUNNER" sh -c 'touch /workspace/PROBE_W' 2>/dev/null \
  && bad "workspace touch blocked" || ok "workspace touch blocked"
docker exec "$RUNNER" sh -c 'echo x >> /workspace/AGENTS.md' 2>/dev/null \
  && bad "workspace append blocked" || ok "workspace append blocked"

echo "== P3 forbidden mounts absent =="
for p in /home/bun/data /home/bun/workspace /exchange/contributions /var/run/docker.sock; do
  docker exec "$RUNNER" sh -c "ls $p" >/dev/null 2>&1 \
    && bad "absent: $p" || ok "absent: $p"
done
docker exec "$RUNNER" cat /proc/self/mountinfo > "$MI_FILE"
if grep -qE " /home/bun/data | /home/bun/workspace | /exchange/|docker.sock" "$MI_FILE"; then
  bad "mountinfo clean"
else
  ok "mountinfo clean"
fi
grep " /workspace " "$MI_FILE" | grep -q "\bro\b" \
  && ok "workspace ro in mountinfo" || bad "workspace ro in mountinfo"
rm -f "$MI_FILE"

echo "== P4 auth RO + state writable (content never printed) =="
docker exec "$RUNNER" sh -c 'test -f /home/bun/.codex-w/auth.json' \
  && ok "auth.json present" || bad "auth.json present"
docker exec "$RUNNER" sh -c 'touch /home/bun/.codex-w/auth.json' 2>/dev/null \
  && bad "auth.json RO" || ok "auth.json RO"
docker exec "$RUNNER" sh -c 'touch /home/bun/.codex-w/PROBE_STATE && rm /home/bun/.codex-w/PROBE_STATE' \
  && ok "CODEX_HOME state writable" || bad "CODEX_HOME state writable"

echo "== P5 env allowlist =="
docker exec "$RUNNER" env | grep -qE 'TELEGRAM|DISCORD|DB_FILE|GURO|TMAP|GEMINI|ANTHROPIC' \
  && bad "no secret env" || ok "no secret env"

echo "== P6 rootfs RO + tmpfs =="
docker exec "$RUNNER" sh -c 'touch /PROBE_ROOT' 2>/dev/null \
  && bad "rootfs RO" || ok "rootfs RO"
docker exec "$RUNNER" sh -c 'touch /tmp/PROBE_T && rm /tmp/PROBE_T' \
  && ok "tmpfs writable" || bad "tmpfs writable"

echo "== P7 API auth =="
CODE=$(docker run --rm --network "$INT_NET" oven/bun:latest bun -e "console.log((await fetch('http://proactive-runner:8787/run', {method:'POST', headers:{'content-type':'application/json'}, body:'{\"prompt\":\"hi\"}'})).status)" 2>/dev/null)
[ "$CODE" = "401" ] && ok "no-auth 401" || bad "no-auth 401 (got $CODE)"
CODE=$(docker run --rm --network "$INT_NET" oven/bun:latest bun -e "console.log((await fetch('http://proactive-runner:8787/run', {method:'POST', headers:{authorization:'Bearer wrong','content-type':'application/json'}, body:'{\"prompt\":\"hi\"}'})).status)" 2>/dev/null)
[ "$CODE" = "401" ] && ok "wrong-auth 401" || bad "wrong-auth 401 (got $CODE)"

echo "== P7b e2e model call =="
RESP=$(docker run --rm --network "$INT_NET" -e S="$PROACTIVE_RUNNER_SECRET" oven/bun:latest bun -e "
const r = await fetch('http://proactive-runner:8787/run', {method:'POST', headers:{authorization: \`Bearer \${process.env.S}\`, 'content-type':'application/json'}, body: JSON.stringify({prompt:'1+1은? 한 단어로.'})});
const t = await r.text();
console.log(r.status);
console.log(t.slice(0,120));" 2>/dev/null)
echo "$RESP" | head -n 1 | grep -q "^200$" && ok "model e2e 200" || bad "model e2e (got $(echo "$RESP" | head -n 1))"
echo "$RESP" | sed -n 2p | grep -q '"text"' && ok "model text non-empty" || bad "model text"

echo "== P8 network isolation =="
docker inspect "$RUNNER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | grep -q "proactive-internal" \
  && ok "runner on internal net" || bad "runner on internal net"
NETS=$(docker inspect "$RUNNER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
echo "runner networks: $NETS"
echo "$NETS" | grep -qv "default" && ok "runner not on egress net" || bad "runner not on egress net"
RIP=$(docker inspect "$RUNNER" --format '{{(index .NetworkSettings.Networks "agent-gateway_proactive-internal").IPAddress}}')
echo "runner internal IP: $RIP"
docker run --rm --network agent-gateway_default oven/bun:latest bun -e "
try { await fetch('http://$RIP:8787/run', {method:'POST', headers:{'content-type':'application/json'}, body:'{}', signal: AbortSignal.timeout(10000)}); console.log('REACHABLE'); }
catch (e) { console.log('UNREACHABLE'); }" 2>/dev/null | grep -q "UNREACHABLE" \
  && ok "egress-net IP-direct blocked" || bad "egress-net IP-direct blocked"
curl -s -m 5 -o /dev/null http://127.0.0.1:8787/run 2>/dev/null \
  && bad "host port closed" || ok "host port closed"

echo "== P9 egress enforcement =="
docker exec "$RUNNER" sh -c 'export HTTPS_PROXY=http://egress-proxy:3128 HTTP_PROXY=http://egress-proxy:3128; bun -e "console.log((await fetch(\"https://example.com/\", {signal: AbortSignal.timeout(15000)})).status)"' 2>/dev/null | grep -q "^403$" \
  && ok "example.com denied via proxy" || bad "example.com denied via proxy"
docker exec "$RUNNER" sh -c 'unset HTTPS_PROXY HTTP_PROXY; bun -e "try { await fetch(\"https://example.com/\", {signal: AbortSignal.timeout(15000)}); console.log(\"OPEN\"); } catch { console.log(\"NOROUTE\"); }"' 2>/dev/null | grep -q "NOROUTE" \
  && ok "no direct egress route" || bad "no direct egress route"

echo "== P10 concurrency 429 (one live call + one parallel) =="
docker run --rm --network "$INT_NET" -e S="$PROACTIVE_RUNNER_SECRET" oven/bun:latest bun -e "
const h = {authorization: \`Bearer \${process.env.S}\`, 'content-type':'application/json'};
const b = JSON.stringify({prompt:'천천히 답해. 3문장으로.'});
const [a, c] = await Promise.all([
  fetch('http://proactive-runner:8787/run', {method:'POST', headers:h, body:b}).then(r=>r.status),
  new Promise(res => setTimeout(() => fetch('http://proactive-runner:8787/run', {method:'POST', headers:h, body:b}).then(r=>res(r.status)).catch(()=>res('err')), 3000)),
]);
console.log([a,c].sort().join(','));" 2>/dev/null | grep -q "200,429" \
  && ok "concurrent 429" || bad "concurrent 429"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
