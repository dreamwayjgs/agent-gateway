FROM oven/bun:latest

# Install Node.js 24 (for codex)
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex @google/gemini-cli

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

RUN mkdir -p data workspace/files

CMD ["bun", "src/index.ts"]
