// ════════════════════════════════════════════════════════════════════════════
// GlobalJames.tsx — James global: visível em TODAS as páginas
// Detecta contexto pela rota e injeta dados relevantes automaticamente
// Oculto em /james (onde o James core já está)
// ════════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import IntelJames, { type JamesContext } from './IntelJames'

// ── Route → Context mapper ───────────────────────────────────────────────
function buildContextForRoute(pathname: string): JamesContext {
  // /intel/chips/:id/:metric
  const chipMetricMatch = pathname.match(/^\/intel\/chips\/(CHI-\d+)\/(\w+)$/)
  if (chipMetricMatch) {
    return {
      page: 'chipDetail',
      data: {
        chip: { id: chipMetricMatch[1] },
        metricaAtual: chipMetricMatch[2],
        hint: `Usuário está explorando a métrica "${chipMetricMatch[2]}" do chip ${chipMetricMatch[1]}`,
      },
    }
  }

  // /intel/chips/:id
  const chipDetailMatch = pathname.match(/^\/intel\/chips\/(CHI-\d+)$/)
  if (chipDetailMatch) {
    return {
      page: 'chipDetail',
      data: { chip: { id: chipDetailMatch[1] }, hint: `Usuário está no detalhe do chip ${chipDetailMatch[1]}` },
    }
  }

  // /intel/chips
  if (pathname === '/intel/chips') {
    return { page: 'chips', data: { hint: 'Usuário está na listagem dos 100 chips' } }
  }

  // /intel/analytics
  if (pathname === '/intel/analytics') {
    return { page: 'analytics', data: { hint: 'Usuário está nos analytics de aprendizado' } }
  }

  // /intel/memory
  if (pathname === '/intel/memory') {
    return { page: 'memory', data: { hint: 'Usuário está no gerenciamento de memórias' } }
  }

  // /intel/inbox
  if (pathname === '/intel/inbox') {
    return { page: 'inbox', data: { hint: 'Usuário está no inbox multicanal' } }
  }

  // /intel (overview)
  if (pathname === '/intel') {
    return { page: 'overview', data: { hint: 'Usuário está na visão geral da Intel' } }
  }

  // All other pages — generic context
  const pageName = pathname.replace(/^\//, '').replace(/-/g, ' ') || 'dashboard'
  return {
    page: 'overview',
    data: {
      paginaAtual: pageName,
      hint: `Usuário está na página "${pageName}". Responda perguntas gerais sobre a plataforma O Núcleo.`,
    },
  }
}

// ── Pages where James should be hidden ────────────────────────────────────
const HIDDEN_ROUTES = ['/james', '/login', '/register']

export default function GlobalJames() {
  const { pathname } = useLocation()

  // Hide on core James page and auth pages
  const isHidden = HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))

  const context = useMemo(() => buildContextForRoute(pathname), [pathname])

  if (isHidden) return null

  return <IntelJames context={context} />
}
