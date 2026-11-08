const DEFAULT_TIMEOUT_MS = 90_000

export interface BankerStatus { status: 'online' }
export interface BankerChatResponse { agente: string; modelo: string; resposta: string }
export class BankerUnavailableError extends Error {
  constructor(message = 'Banker indisponivel') { super(message); this.name = 'BankerUnavailableError' }
}
interface BankerClientOptions { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch }
export class BankerClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  constructor(options: BankerClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.BANKER_BASE_URL ?? ''
    if (!baseUrl.trim()) throw new BankerUnavailableError('Banker nao configurado')
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }
  async status(): Promise<BankerStatus> {
    const value = await this.request('/status', { method: 'GET' })
    if (!isRecord(value) || value.status !== 'online') throw new BankerUnavailableError('Status invalido do Banker')
    return { status: 'online' }
  }
  async chat(message: string): Promise<BankerChatResponse> {
    const normalized = message.trim()
    if (!normalized) throw new BankerUnavailableError('Entrada invalida para o Banker')
    const value = await this.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: normalized, modelo: 'llama3.2' }) })
    if (!isRecord(value) || typeof value.agente !== 'string' || typeof value.modelo !== 'string' || typeof value.resposta !== 'string' || !value.resposta.trim()) throw new BankerUnavailableError('Resposta invalida do Banker')
    return { agente: value.agente, modelo: value.modelo, resposta: value.resposta.trim() }
  }
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
      if (!response.ok) throw new BankerUnavailableError()
      return await response.json()
    } catch (error) {
      if (error instanceof BankerUnavailableError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new BankerUnavailableError('Timeout do Banker')
      throw new BankerUnavailableError()
    } finally { clearTimeout(timeout) }
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
export function createBankerClient(): BankerClient { return new BankerClient() }
export async function checkBankerHealth(): Promise<BankerStatus> { return createBankerClient().status() }
