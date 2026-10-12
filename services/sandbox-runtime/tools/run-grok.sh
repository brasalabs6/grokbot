#!/bin/sh
# Cloudflare's outbound HTTPS interception has an ephemeral per-container CA.
# Install it into Debian's trust store at container startup. This must happen
# after the container begins, never in the Docker build.
set -eu
: "${GROK_AGENT_SECRET:?GROK_AGENT_SECRET must be configured}"
umask 077
ca="/etc/cloudflare/certs/cloudflare-containers-ca.crt"
bundle="/home/node/.grok/ca-bundle.crt"

if [ "$(id -u)" -ne 0 ]; then
  echo "GROKBOT_ENTRYPOINT_REQUIRES_STARTUP_ROOT" >&2
  exit 1
fi

# The intercept is installed before start(), but the mounted CA can take a
# moment to become available. Wait without ever weakening TLS validation.
if [ "${GROKBOT_EXPECT_PROXY_CA:-0}" = "1" ]; then
  attempts=0
  until [ -s "$ca" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 50 ]; then
      echo "GROKBOT_PROXY_CA_UNAVAILABLE" >&2
      exit 1
    fi
    sleep 0.2
  done
fi
if [ -s "$ca" ]; then
  cp "$ca" /usr/local/share/ca-certificates/grokbot-cloudflare.crt
  update-ca-certificates >/dev/null 2>&1
fi

# Existing system roots remain trusted. Keep the refreshed PEM bundle available
# to Node/OpenSSL and to Rust HTTP clients; no root privilege is retained by Grok.
cp /etc/ssl/certs/ca-certificates.crt "$bundle"
chown node:node "$bundle"
chmod 0600 "$bundle"

if [ "${GROKBOT_BOOT_DIAGNOSTICS:-0}" = "1" ]; then
  exec gosu node sh -c 'umask 077; exec grok --no-auto-update agent --no-leader --model cf-qwen3.8-27b serve --bind 0.0.0.0:2419 >/tmp/grokbot-boot-diagnostics.log 2>&1'
fi
exec gosu node sh -c 'exec grok --no-auto-update agent --no-leader --model cf-qwen3.8-27b serve --bind 0.0.0.0:2419 >/dev/null 2>&1'
