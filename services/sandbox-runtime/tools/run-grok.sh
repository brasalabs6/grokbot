#!/bin/sh
# Grok prints the ACP WebSocket secret on boot. Never send raw stdout/stderr
# to Cloudflare logs; staging diagnostics are isolated to a private temporary
# file and must be disabled for any production release.
set -eu
: "${GROK_AGENT_SECRET:?GROK_AGENT_SECRET must be configured}"
# The outbound HTTPS proxy uses an ephemeral Cloudflare CA created at runtime.
# Build a user-owned CA bundle without elevating the shell's privileges.
# NODE_OPTIONS=--use-openssl-ca and SSL_CERT_FILE are baked into image ENV so
# one-off container.exec processes and Grok use the same trust policy.
umask 077
bundle="/home/node/.grok/ca-bundle.crt"
if [ -s /etc/cloudflare/certs/cloudflare-containers-ca.crt ]; then
  cat /etc/ssl/certs/ca-certificates.crt \
      /etc/cloudflare/certs/cloudflare-containers-ca.crt > "$bundle"
else
  cp /etc/ssl/certs/ca-certificates.crt "$bundle"
fi

if [ "${GROKBOT_BOOT_DIAGNOSTICS:-0}" = "1" ]; then
  umask 077
  exec grok --no-auto-update agent --no-leader --model cf-qwen3.8-27b serve --bind 0.0.0.0:2419 \
    >/tmp/grokbot-boot-diagnostics.log 2>&1
fi
exec grok --no-auto-update agent --no-leader --model cf-qwen3.8-27b serve --bind 0.0.0.0:2419 >/dev/null 2>&1
