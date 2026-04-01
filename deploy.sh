#!/bin/bash
# ============================================================
# deploy.sh — Script de Deploy Automatizado na VPS Hostinger
# Execute: chmod +x deploy.sh && ./deploy.sh
# ============================================================
set -e

echo "🚀 The Beauty Hub OS — Deploy na VPS"
echo "======================================"

# ── 1. Verifica pré-requisitos ─────────────────────────────
echo "📋 Verificando dependências..."
command -v docker >/dev/null 2>&1 || { echo "❌ Docker não instalado. Rode: apt install docker.io"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || command -v docker compose >/dev/null 2>&1 || { echo "❌ docker-compose não encontrado. Instalando..."; apt install docker-compose-plugin -y; }
command -v nginx >/dev/null 2>&1 || { echo "📦 Instalando Nginx..."; apt install nginx -y; }

# ── 2. Cria arquivo .env se não existir ────────────────────
if [ ! -f .env ]; then
  echo "⚙️  Criando .env a partir do template..."
  cp backend/.env.example .env
  echo "⚠️  IMPORTANTE: Edite o arquivo .env com suas credenciais antes de continuar!"
  echo "   nano .env"
  read -p "Pressione ENTER após editar o .env..."
fi

# ── 3. Instala dependências e compila o Frontend ───────────
echo "🎨 Compilando Frontend..."
npm install
VITE_BACKEND_URL=http://$(hostname -I | awk '{print $1}'):3001 npm run build

# Copia build para diretório do Nginx
echo "📁 Copiando build para /var/www/bhub/dist..."
mkdir -p /var/www/bhub
cp -r dist/ /var/www/bhub/

# ── 4. Configura Nginx ─────────────────────────────────────
echo "🔧 Configurando Nginx..."
cp nginx.conf /etc/nginx/sites-available/bhub
ln -sf /etc/nginx/sites-available/bhub /etc/nginx/sites-enabled/bhub
rm -f /etc/nginx/sites-enabled/default  # remove config padrão
nginx -t && systemctl reload nginx

# ── 5. Para serviços Docker existentes ─────────────────────
echo "⏹️  Parando serviços existentes..."
docker-compose down --remove-orphans 2>/dev/null || docker compose down --remove-orphans 2>/dev/null || true

# ── 6. Sobe o stack Docker completo ────────────────────────
echo "🐳 Subindo stack Docker (Redis + Evolution + Backend)..."
docker-compose up -d --build || docker compose up -d --build

# ── 7. Aguarda serviços ficarem saudáveis ──────────────────
echo "⏳ Aguardando serviços (30s)..."
sleep 30

# ── 8. Verifica saúde ──────────────────────────────────────
echo "🏥 Verificando saúde dos serviços..."
echo ""

if curl -sf http://localhost:3001/health > /dev/null; then
  echo "  ✅ Backend: OK"
else
  echo "  ❌ Backend: FALHOU — docker-compose logs backend"
fi

if curl -sf http://localhost:8080 > /dev/null 2>&1; then
  echo "  ✅ Evolution API: OK"
else
  echo "  ⚠️  Evolution API: verificando..."
fi

if curl -sf http://localhost:80 > /dev/null 2>&1; then
  echo "  ✅ Nginx (Frontend): OK"
else
  echo "  ⚠️  Nginx: verificar 'systemctl status nginx'"
fi

docker-compose ps 2>/dev/null || docker compose ps 2>/dev/null || true

VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "======================================"
echo "🎉 Deploy concluído!"
echo ""
echo "📌 Acesso:"
echo "  🌐 Frontend:  http://${VPS_IP}"
echo "  🤖 Backend:   http://${VPS_IP}:3001/health"
echo "  📡 Evolution: http://${VPS_IP}:8080"
echo ""
echo "📌 Próximos passos:"
echo "  1. Acesse http://${VPS_IP} e faça login"
echo "  2. Vá em Chip Control → crie chips"
echo "  3. Escaneie QR code de cada chip"
echo "  4. Aguarde warmup (7 dias) → inicie campanhas!"
echo ""
echo "📊 Monitoramento:"
echo "  - Health:    curl http://${VPS_IP}:3001/health"
echo "  - Chips:     curl http://${VPS_IP}:3001/api/chips"
echo "  - Filas:     curl http://${VPS_IP}:3001/api/queue/stats"
echo "  - Scheduler: curl http://${VPS_IP}:3001/api/scheduler/status"
echo "  - Logs:      docker-compose logs -f backend"
