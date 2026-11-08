export interface MemoryScope { userId: string; tenantId: string; sessionId: string; contactId: string | null }
export interface MemoryResult { ok: boolean; state?: string; lease?: string; reply?: string; turns?: Array<{ role: 'user' | 'assistant'; content: string }>; sessionId?: string }
export interface MemoryStore { call(action: string, scope: MemoryScope, args?: { requestId?: string; message?: string; reply?: string; lease?: string; safeFailure?: boolean }): Promise<MemoryResult> }
export class MemoryError extends Error { code: string; status: number; constructor(code: string, status?: number) }
export function memoryScope(identity: { userId: string; tenantId: string }, body: { sessionId?: string; contactId?: string | null }): MemoryScope;
export function createSupabaseMemoryStore(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }): MemoryStore;
