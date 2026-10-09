#!/bin/sh
# The Grok CLI prints its WebSocket secret at boot even when supplied by
# environment variable. Suppress daemon stdout/stderr so container logging
# providers never retain that credential.
set -eu
: "${GROK_AGENT_SECRET:?GROK_AGENT_SECRET must be configured}"
exec grok agent --no-leader --model cf-gpt-oss serve --bind 0.0.0.0:2419 >/dev/null 2>&1
