export interface JamesTurn { role: 'user' | 'assistant'; content: string }

export async function requestJamesConversation(
  transport: (path: string, init: RequestInit) => Promise<Response>,
  message: string,
  history: JamesTurn[],
  signal: AbortSignal,
  scope?: { sessionId: string; requestId: string; contactId: string | null },
): Promise<string> {
  const recent = history.slice(-6).map(turn => ({ role: turn.role, content: [...turn.content].slice(0, 2000).join('') }))
  const response = await transport('/api/james/conversation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scope ? { message, ...scope } : { message, history: recent }), signal,
  })
  const data = await response.json().catch(() => null) as { reply?: unknown; code?: string } | null
  if (!response.ok) {
    const messages: Record<string, string> = {
      auth_unavailable: 'O vinculo autorizado entre Qadma e Nucleo ainda precisa ser configurado.',
      budget_disabled: 'Uso pago desligado. O responsavel precisa autorizar o orcamento.',
      budget_unavailable: 'Nao foi possivel confirmar o orcamento. Nao reenvie sem revisar o pedido.',
      budget_uncertain: 'O resultado e o custo desta tentativa sao incertos. Nao repetimos automaticamente.',
      budget_invalid_usage: 'O provedor nao confirmou o consumo. A reserva foi mantida para revisao.',
      budget_exhausted: 'O limite autorizado foi atingido. Consulte o responsavel.',
      budget_exceeded: 'O limite autorizado foi atingido. Consulte o responsavel.',
      ai_disabled: 'A IA ainda não foi habilitada pelo responsável.',
      ai_not_configured: 'A configuração segura da IA está pendente.',
      ai_busy: 'A IA atingiu um limite. Aguarde antes de tentar novamente.',
      ai_timeout: 'A resposta demorou. Não reenviamos automaticamente.',
      invalid_message: 'Escreva uma mensagem de até 2.000 caracteres.',
      unauthorized: 'Entre novamente para conversar com James.',
      memory_unavailable: 'Não foi possível confirmar a memória. Consulte o estado antes de iniciar outro pedido.',
      request_busy: 'A resposta anterior ainda está em processamento. Use Retomar conversa.',
      request_uncertain: 'O resultado anterior é incerto. Não repetiremos a geração. Revise a tentativa antes de iniciar outra conversa.',
      request_conflict: 'O pedido já está associado a outra mensagem.',
      session_not_found: 'Conversa indisponível neste contexto de acesso.',
      session_closed: 'Conversa encerrada. Inicie uma nova conversa.',
    }
    throw new Error(messages[data?.code ?? ''] ?? 'Não foi possível obter uma resposta. Sua mensagem foi preservada.')
  }
  if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new Error('James não recebeu uma resposta válida.')
  return data.reply.trim()
}

export interface JamesMemoryState {
  memory: 'disabled' | 'persistent';
  turns: JamesTurn[];
  state?: string;
  pending?: { id: string; message: string } | null;
}
export async function accessJamesMemory(
  transport: (path: string, init: RequestInit) => Promise<Response>,
  action: 'load' | 'close', sessionId: string, contactId: string | null, signal: AbortSignal,
): Promise<JamesMemoryState> {
  const response = await transport('/api/james/conversation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, sessionId, contactId }), signal,
  })
  const data = await response.json().catch(() => null)
  if (response.status === 404 && data?.code === 'session_not_found' && action === 'load')
    return { memory: 'persistent', turns: [], state: 'new' }
  if (action === 'close' && response.status === 409 && data?.code === 'session_closed') return { memory: 'persistent', turns: [], state: 'closed' }
  if (action === 'close' && (data?.memory !== 'persistent' || data?.state !== 'closed'))
    throw new Error('O servidor não confirmou o encerramento persistente. Retome a conversa para conferir o estado.')
  if (!response.ok || !['disabled', 'persistent'].includes(data?.memory))
    throw new Error('Não foi possível recuperar a conversa. Nenhuma mensagem foi reenviada.')
  return { ...data, turns: Array.isArray(data.turns) ? data.turns : [] }
}
