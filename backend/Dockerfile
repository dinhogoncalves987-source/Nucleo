# ============================================================
# The Beauty Hub OS — Backend Multi-Stage Build
# Stage 1: compila TypeScript → JavaScript
# Stage 2: imagem leve só com build final
# ============================================================

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
COPY shared/ /app/shared/
RUN npx tsc

# ── Stage 2: Production ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app/backend

# Só dependências de produção
COPY backend/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copia build compilado
COPY --from=builder /app/backend/dist/ ./dist/
COPY --from=builder /app/shared/ /app/shared/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001
CMD ["node", "dist/server.js"]
