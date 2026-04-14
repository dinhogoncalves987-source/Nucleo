#!/bin/bash
# ============================================================
# check-env.sh — Valida variáveis de ambiente antes do deploy
# Uso: bash check-env.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

check_required() {
  local var_name=$1
  local var_value=${!var_name}
  if [ -z "$var_value" ]; then
    echo -e "  ${RED}✗ $var_name — NÃO DEFINIDA${NC}"
    ERRORS=$((ERRORS + 1))
  else
    local masked="${var_value:0:8}..."
    echo -e "  ${GREEN}✓ $var_name${NC} = $masked"
  fi
}

check_optional() {
  local var_name=$1
  local var_value=${!var_name}
  if [ -z "$var_value" ]; then
    echo -e "  ${YELLOW}⚠ $var_name — não definida (opcional)${NC}"
    WARNINGS=$((WARNINGS + 1))
  else
    local masked="${var_value:0:8}..."
    echo -e "  ${GREEN}✓ $var_name${NC} = $masked"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🔐 Validação de Variáveis de Ambiente — O Núcleo"
echo "═══════════════════════════════════════════════════════"
echo ""

# Carrega .env se existir
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo -e "  ${GREEN}📄 .env carregado${NC}"
  echo ""
fi

echo "── Obrigatórias ─────────────────────────────────────"
check_required "OPENAI_API_KEY"
check_required "SUPABASE_URL"
check_required "SUPABASE_SERVICE_KEY"
check_required "EVOLUTION_API_KEY"
check_required "REDIS_URL"

echo ""
echo "── Opcionais (recomendadas) ────────────────────────"
check_optional "API_SECRET"
check_optional "EDSON_PHONE"
check_optional "GOOGLE_API_KEY"
check_optional "GOOGLE_SEARCH_ENGINE_ID"

echo ""
echo "── Configuração ─────────────────────────────────────"
check_optional "PORT"
check_optional "NODE_ENV"
check_optional "SCHEDULER_START_HOUR"
check_optional "SCHEDULER_END_HOUR"
check_optional "MAX_CHIPS"
check_optional "EVOLUTION_API_URL"

echo ""
echo "═══════════════════════════════════════════════════════"
if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}❌ $ERRORS variáveis obrigatórias faltando!${NC}"
  echo -e "  ${RED}   Deploy BLOQUEADO. Corrija antes de continuar.${NC}"
  echo "═══════════════════════════════════════════════════════"
  exit 1
else
  echo -e "  ${GREEN}✅ Todas as variáveis obrigatórias OK${NC}"
  if [ $WARNINGS -gt 0 ]; then
    echo -e "  ${YELLOW}⚠ $WARNINGS variáveis opcionais não definidas${NC}"
  fi
  echo -e "  ${GREEN}   Deploy LIBERADO!${NC}"
  echo "═══════════════════════════════════════════════════════"
  exit 0
fi
