FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git tmux bash procps openssh-client && rm -rf /var/lib/apt/lists/*
RUN printf 'set -g mouse on\nset -g history-limit 50000\n' > /etc/tmux.conf
RUN mkdir -p /workspace && chmod 1777 /workspace
# Pin released Grok Build CLI. Update deliberately with a tested image digest.
ARG GROK_VERSION=1.0.50
RUN curl -fsSL https://x.ai/cli/install.sh | bash -s -- "$GROK_VERSION" \
    && install /root/.grok/bin/grok /usr/local/bin/grok \
    && grok --version
WORKDIR /workspace
CMD ["sleep", "infinity"]
