# ============================================================
# The Beauty Hub OS — Backend Multi-Stage Build
# Stage 1: compila TypeScript → JavaScript
# Stage 2: imagem leve só com build final
# ============================================================

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Só dependências de produção
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copia build compilado
COPY --from=builder /app/dist/ ./dist/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001
CMD ["node", "dist/server.js"]
