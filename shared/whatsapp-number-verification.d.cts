export type VerificationAuth = Readonly<{ userId: string; tenantId: string; sessionId: string; appRole: 'superadmin' | 'manager' | 'operator'; expiresAt: string; isAnonymous: false }>;
export type VerificationRequest = Readonly<{ request_id: string; expected_tenant_id: string; expected_actor_id: string; expected_session_id: string; expected_channel_id: string; phone: string; authorize_number_query: true }>;
export type VerificationQuery = Readonly<{ requestId: string; phone: string; tenantId: string; actorId: string; authSessionId: string; channelId: string; appRole: string }>;
export type VerificationGrant = Readonly<Omit<VerificationQuery, 'appRole'> & { transportSessionId: string; transportEpoch: number; expiresAt: string; allowed: true; connected: true; ownershipVerified: true }>;
export type VerificationResult = Readonly<{
  synthetic: true; request_id: string; tenant_id: string; actor_id: string; auth_session_id: string; channel_id: string; phone: string;
  observation: 'unknown' | 'registered_reported' | 'not_registered_reported';
  source: Readonly<{ kind: 'synthetic_transport_fixture'; origin: 'existing_gateway_onWhatsApp_contract'; library: '@whiskeysockets/baileys'; inspected_version: '7.0.0-rc14'; method: 'onWhatsApp'; received_at: string; source_observed_at: null }>;
  state: Readonly<{ whatsapp: 'unknown'; activity: 'unknown'; number_ownership: 'unverified'; consent: 'not_established'; contact_permission: 'not_established' }>;
  canContact: false; canSend: false; canEnqueue: false; canMarkLeadVerified: false; limitations: readonly string[];
}>;
export declare class WhatsappVerificationError extends Error { status: number; code: string; constructor(status: number, code: string); }
export declare function createWhatsappNumberVerification(options?: {
  enabled?: boolean; mode?: 'disabled' | 'synthetic'; now?: () => Date; timeoutMs?: number;
  authorizeQuery?: (query: VerificationQuery, options: { signal: AbortSignal }) => Promise<unknown> | unknown;
  transport?: { mode: 'synthetic'; getBinding: () => Readonly<{ tenantId: string; channelId: string; transportSessionId: string; transportEpoch: number; connected: true }>; onWhatsApp: (phoneDigits: string) => Promise<unknown> | unknown };
}): Readonly<{
  capabilities(): Readonly<{ enabled: boolean; mode: 'synthetic_only'; production_ready: false; reason: string | null; requires_query_authorization: true; limits: Readonly<{ deadline_ms: number; ledger_entries: number; concurrent_queries: number }>; limitations: readonly string[] }>;
  verify(input?: { auth: unknown; body: unknown }): Promise<VerificationResult>;
}>;
