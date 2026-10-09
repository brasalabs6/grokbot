FROM node:24-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git tmux bash procps openssh-client ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Grok CLI is installed during image build. Runtime egress is default-denied.
# The pinned CLI version is independently verified by the ACP smoke test.
ARG GROK_VERSION=1.0.50
RUN curl -fsSL https://x.ai/cli/install.sh | bash -s -- "$GROK_VERSION" \
    && install /root/.grok/bin/grok /usr/local/bin/grok \
    && grok --version

RUN printf 'set -g mouse on\nset -g history-limit 50000\n' > /etc/tmux.conf
RUN install -d -o node -g node -m 0750 /home/node/.grok \
    && install -d -o node -g node -m 0755 /workspace

# Dummy provider API key, NOT a secret. The HTTPS interception gateway
# discards it and invokes the Workers AI binding from trusted Worker code.
# Do not embed Cloudflare tokens, account credentials or session cookies here.
RUN printf '%s\n' \
    '[models]' \
    'default = "cf-gpt-oss"' \
    '[model.cf-gpt-oss]' \
    'model = "@cf/openai/gpt-oss-120b"' \
    'name = "Cloudflare Workers AI · GPT-OSS 120B"' \
    'description = "Cloudflare hosted model via GrokBot inference gateway"' \
    'base_url = "https://api.cloudflare.com/client/v4/accounts/a22f860070e687304a08ce46118dadf6/ai/v1"' \
    'api_backend = "chat_completions"' \
    'api_key = "grokbot-internal-placeholder"' \
    'context_window = 131072' \
    'max_completion_tokens = 8192' \
    > /home/node/.grok/config.toml \
    && chown node:node /home/node/.grok/config.toml \
    && chmod 0600 /home/node/.grok/config.toml

COPY --chown=node:node tools/acp-smoke.mjs /opt/grokbot/acp-smoke.mjs
ENV HOME=/home/node
ENV NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt
USER node
WORKDIR /workspace
CMD ["sleep","infinity"]
