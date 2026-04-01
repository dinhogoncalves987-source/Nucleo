/**
 * Bubble.io API Service Layer
 * App: thebeautyhub.com.br
 */

const BUBBLE_URL   = '/bubble-api/api/1.1'
const BUBBLE_TOKEN = import.meta.env.VITE_BUBBLE_API_TOKEN ?? ''

const headers = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${BUBBLE_TOKEN}`,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BubbleClient {
  _id: string
  'First Name': string
  'Last Name'?: string
  nome?: string
  telefone?: string
  email?: string
  'Created Date': string
  [key: string]: unknown
}

export interface BubbleAgendamento {
  _id: string
  data?: string
  'Data e Hora'?: string
  cliente?: string // ID do cliente
  profissional?: string
  servico?: string
  status?: string
  'Created Date': string
  [key: string]: unknown
}

export interface BubbleResponse<T> {
  response: {
    results: T[]
    count: number
    remaining: number
    cursor: number
  }
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

async function bubbleGet<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T[]> {
  // new URL() precisa de base absoluta quando a URL é relativa (proxy Vite)
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  const url = new URL(`${BUBBLE_URL}/obj/${endpoint}`, base)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const res = await fetch(url.toString(), { headers: headers() })
  if (!res.ok) throw new Error(`Bubble GET ${endpoint} failed: ${res.status}`)

  const json: BubbleResponse<T> = await res.json()
  return json.response.results
}

async function bubblePost<T>(endpoint: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${BUBBLE_URL}/obj/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bubble POST ${endpoint} failed: ${res.status} — ${text}`)
  }
  return res.json()
}

async function bubblePatch(endpoint: string, id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BUBBLE_URL}/obj/${endpoint}/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Bubble PATCH ${endpoint}/${id} failed: ${res.status}`)
}

// ---------------------------------------------------------------------------
// Auto-descoberta de endpoint (a nomenclatura pode variar no Bubble)
// ---------------------------------------------------------------------------
const CANDIDATE_CLIENTES   = ['clientes','cliente','Clientes','Cliente','clients','client','Clients','Customer','customer']
const CANDIDATE_AGENDAMENTO = ['agendamento','Agendamento','agendamentos','Agendamentos','appointment','appointments','agenda','Agenda','schedule','schedules','booking','bookings']

async function tryEndpoint(name: string): Promise<boolean> {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  try {
    const res = await fetch(
      new URL(`${BUBBLE_URL}/obj/${name}?limit=1`, base).toString(),
      { headers: headers() }
    )
    return res.ok
  } catch { return false }
}

let _clientesEndpoint: string | null = null
let _agendamentoEndpoint: string | null = null

async function resolveEndpoint(candidates: string[], cached: string | null): Promise<string | null> {
  if (cached) return cached
  // Testa todos os candidatos em PARALELO — muito mais rápido que sequencial
  try {
    const result = await Promise.any(
      candidates.map(name =>
        tryEndpoint(name).then(ok => {
          if (!ok) throw new Error(`${name} not found`)
          return name
        })
      )
    )
    return result
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export const BubbleClientes = {
  list: async (limit = 50, cursor = 0) => {
    const endpoint = await resolveEndpoint(CANDIDATE_CLIENTES, _clientesEndpoint)
    if (!endpoint) throw new Error('Nenhum endpoint de clientes acessível no Bubble. Habilite a Data API e marque a caixa do tipo "clientes".')
    _clientesEndpoint = endpoint
    return bubbleGet<BubbleClient>(endpoint, { limit, cursor })
  },

  create: async (data: { nome: string; telefone: string; email?: string; origem?: string }) => {
    const endpoint = _clientesEndpoint ?? 'clientes'
    return bubblePost<BubbleClient>(endpoint, {
      nome: data.nome,
      telefone: data.telefone,
      email: data.email ?? '',
      origem: data.origem ?? 'Beauty Hub OS',
    })
  },

  update: async (id: string, data: Partial<{ nome: string; telefone: string; email: string }>) => {
    const endpoint = _clientesEndpoint ?? 'clientes'
    return bubblePatch(endpoint, id, data)
  },
}

// ---------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------

export const BubbleAgendamentos = {
  list: async (limit = 100) => {
    const endpoint = await resolveEndpoint(CANDIDATE_AGENDAMENTO, _agendamentoEndpoint)
    if (!endpoint) return [] as BubbleAgendamento[] // silently return empty if not accessible
    _agendamentoEndpoint = endpoint
    return bubbleGet<BubbleAgendamento>(endpoint, { limit })
  },

  /** Detecta clientes ausentes (sem agendamento nos últimos N dias) */
  detectarAusentes: async (diasSemRetorno = 30): Promise<string[]> => {
    const todos = await BubbleAgendamentos.list(200)
    const corte = new Date()
    corte.setDate(corte.getDate() - diasSemRetorno)

    // Mapeia último agendamento por cliente
    const ultimoPorCliente: Record<string, Date> = {}
    todos.forEach(ag => {
      const dataAg = new Date(ag['Data e Hora'] ?? ag.data ?? ag['Created Date'])
      const clienteId = ag.cliente ?? ''
      if (!clienteId) return
      if (!ultimoPorCliente[clienteId] || dataAg > ultimoPorCliente[clienteId]) {
        ultimoPorCliente[clienteId] = dataAg
      }
    })

    // Retorna IDs de clientes cujo último agendamento foi antes da data de corte
    return Object.entries(ultimoPorCliente)
      .filter(([, ultima]) => ultima < corte)
      .map(([id]) => id)
  },
}

// ---------------------------------------------------------------------------
// Workflow triggers (Bubble backend workflows)
// ---------------------------------------------------------------------------

export const BubbleWorkflows = {
  /** Dispara um workflow no Bubble via API */
  trigger: async (workflowName: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${BUBBLE_URL}/wf/${workflowName}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(params),
    })
    if (!res.ok) throw new Error(`Bubble Workflow ${workflowName} failed: ${res.status}`)
    return res.json()
  },
}

// ---------------------------------------------------------------------------
// Health check — usa o meta endpoint (Workflow API está ativo)
// ---------------------------------------------------------------------------

export const bubbleHealthCheck = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${BUBBLE_URL}/meta`, {
      headers: headers(),
    })
    // Meta retorna 200 quando o Workflow API está ativo
    return res.status === 200
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Tipo da coisa a ser buscada pelo Data API (quando ativado)
// ---------------------------------------------------------------------------

export const bubbleDataApiStatus = async (): Promise<{ enabled: boolean; types: string[] }> => {
  try {
    const res = await fetch(`${BUBBLE_URL}/obj/clientes?limit=1`, { headers: headers() })
    if (res.ok) return { enabled: true, types: ['clientes'] }
    return { enabled: false, types: [] }
  } catch {
    return { enabled: false, types: [] }
  }
}
