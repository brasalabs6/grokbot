# The installer downloads its own release artifacts; keep those out of the final image.
FROM node:24-trixie-slim AS grok-installer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG GROK_VERSION=1.0.50
RUN curl -fsSL https://x.ai/cli/install.sh | bash -s -- "$GROK_VERSION" \
    && test -x /root/.grok/bin/grok

FROM node:24-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git tmux bash procps openssh-client ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Grok CLI is installed during image build. Runtime egress is default-denied.
# The pinned CLI version is independently verified by the ACP smoke test.
COPY --from=grok-installer /root/.grok/bin/grok /usr/local/bin/grok
RUN grok --version

RUN printf 'set -g mouse on\nset -g history-limit 50000\n' > /etc/tmux.conf
RUN install -d -o node -g node -m 0750 /home/node/.grok \
    && install -d -o node -g node -m 0755 /workspace

# No provider credentials are included in this image. The Grok profile uses
# a deliberate placeholder; the trusted Worker injects the real proxy secret.
COPY --chown=node:node config/grok-models.toml /home/node/.grok/config.toml
RUN chmod 0600 /home/node/.grok/config.toml

COPY --chown=node:node tools/acp-smoke.mjs /opt/grokbot/acp-smoke.mjs
ENV HOME=/home/node
ENV NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt
ENV SSL_CERT_FILE=/home/node/.grok/ca-bundle.crt
ENV CURL_CA_BUNDLE=/home/node/.grok/ca-bundle.crt
ENV NODE_OPTIONS=--use-openssl-ca
USER node
WORKDIR /workspace
# Each container serves ACP locally. The token is randomly generated per
# Durable Object and passed through container.start(). No public port binding.
EXPOSE 2419
COPY --chown=node:node tools/workspace.mjs /opt/grokbot/workspace.mjs
COPY --chown=node:node tools/run-grok.sh /opt/grokbot/run-grok.sh
CMD ["sh","/opt/grokbot/run-grok.sh"]
