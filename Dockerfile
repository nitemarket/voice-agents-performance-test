FROM oven/bun:1

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "src/index.ts"]
