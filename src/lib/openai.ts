/**
 * OpenAI Service
 * As chamadas sensiveis passam pelo backend para evitar uso direto de API key no navegador.
 */

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || 'http://localhost:3001'
const API_SECRET  = (import.meta.env.VITE_API_SECRET  as string | undefined) || ''

async function postToBackend<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-secret': API_SECRET,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
    throw new Error(`Backend IA: ${msg}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Feature: Mensagem de resgate para cliente ausente
// James inclui link de afiliado carimbado quando disponivel
// ---------------------------------------------------------------------------
export async function generateRescueMessage(
  nome: string,
  diasAusente: number,
  salonName = 'o salao',
  affiliateLink?: string
): Promise<string> {
  const data = await postToBackend<{ text: string }>('/api/james/generate/rescue-message', {
    nome, diasAusente, salonName, affiliateLink,
  })
  return data.text
}

// ---------------------------------------------------------------------------
// Feature: Extrair dados de vCard/texto livre
// ---------------------------------------------------------------------------
export interface ExtractedContact {
  nome: string
  telefone: string
  email: string
  endereco: string
}

export async function extractContactFromText(text: string): Promise<ExtractedContact> {
  return postToBackend<ExtractedContact>('/api/james/generate/extract-contact', {
    text: text.slice(0, 800),
  })
}

// ---------------------------------------------------------------------------
// Feature: Sugestao de promocao para baixa temporada
// ---------------------------------------------------------------------------
export async function generatePromoSuggestion(context: {
  clientCount: number
  lowSeasonMonth: string
  salonName: string
}): Promise<string> {
  const data = await postToBackend<{ text: string }>('/api/james/generate/promo-suggestion', context)
  return data.text
}

// ---------------------------------------------------------------------------
// Feature: James "Auditor Comercial"
// ---------------------------------------------------------------------------
export async function checkAffiliateOpportunities(
  affiliateSummary: string,
  slowDays?: string[]
): Promise<string> {
  const data = await postToBackend<{ text: string }>('/api/james/generate/affiliate-opportunities', {
    affiliateSummary,
    slowDays,
  })
  return data.text
}

// ---------------------------------------------------------------------------
// Feature: Gera mensagens em lote para campanha Blitz
// ---------------------------------------------------------------------------
export async function generateBatchMessages(
  leads: Array<{ name: string; source: string }>,
  salonName: string
): Promise<Record<string, string>> {
  const data = await postToBackend<{ results: Record<string, string> }>('/api/james/generate/batch-messages', {
    leads,
    salonName,
  })
  return data.results
}

// ---------------------------------------------------------------------------
// Verifica se o backend de IA esta disponivel
// ---------------------------------------------------------------------------
export async function checkOpenAIKey(): Promise<boolean> {
  try {
    const data = await postToBackend<{ ok: boolean }>('/api/james/generate/health', {})
    return data.ok
  } catch {
    return false
  }
}

export const openaiService = {
  generateRescueMessage,
  extractContactFromText,
  generatePromoSuggestion,
  checkAffiliateOpportunities,
  generateBatchMessages,
  checkOpenAIKey,
}
