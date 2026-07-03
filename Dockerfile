FROM oven/bun:latest

# Install Node.js 24 (for agent CLIs)
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex @google/gemini-cli opencode-ai

WORKDIR /app

COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY --chown=bun:bun . .

RUN mkdir -p /home/bun/data /home/bun/workspace/files && \
    chown -R bun:bun /home/bun

USER bun

CMD ["bun", "src/index.ts"]
