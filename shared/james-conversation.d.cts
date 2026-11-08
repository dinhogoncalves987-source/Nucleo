import type { BudgetStore } from './james-budget.cjs';
import type { MemoryStore, MemoryScope } from './james-memory.cjs';
export interface ConversationRequest { method?: string; body?: unknown; headers?: unknown }
export interface ConversationIdentity { userId: string; tenantId: string }
export interface ConversationContext { scope?: MemoryScope; requestId?: string; budget?: BudgetStore | null }
export interface Turn { role: 'user' | 'assistant'; content: string }
export class ConversationError extends Error { status: number; code: string; constructor(status: number, code: string, message: string) }
export function parseInput(body: unknown): Turn[];
export function createOpenAIResponder(options?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number; budget?: BudgetStore }): (input: Turn[], context?: ConversationContext) => Promise<string>;
export function createConversationHandler(options: {
  authenticate: (request: ConversationRequest) => Promise<ConversationIdentity | null>;
  respond?: (input: Turn[], context?: ConversationContext) => Promise<string>;
  budget?: (identity: ConversationIdentity) => Promise<BudgetStore | null>;
  memory?: (identity: ConversationIdentity) => Promise<MemoryStore | null>;
}): (request: ConversationRequest) => Promise<{ status: number; body: { reply?: string; error?: string; code?: string; memory?: string; turns?: Turn[]; sessionId?: string; replayed?: boolean } }>;
