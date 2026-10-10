#!/bin/sh
# Grok prints the ACP WebSocket secret on boot. Never send raw stdout/stderr
# to Cloudflare logs; staging diagnostics are isolated to a private temporary
# file and must be disabled for any production release.
set -eu
: "${GROK_AGENT_SECRET:?GROK_AGENT_SECRET must be configured}"
if [ "${GROKBOT_BOOT_DIAGNOSTICS:-0}" = "1" ]; then
  umask 077
  exec grok --no-auto-update agent --no-leader --model cf-gpt-oss serve --bind 0.0.0.0:2419 \
    >/tmp/grokbot-boot-diagnostics.log 2>&1
fi
exec grok --no-auto-update agent --no-leader --model cf-gpt-oss serve --bind 0.0.0.0:2419 >/dev/null 2>&1
