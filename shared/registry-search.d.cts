export type RegistryAuth = { userId: string; tenantId: string; appRole: 'superadmin' | 'manager' | 'operator'; isAnonymous?: boolean };
export type RegistryFilters = { cnae_fiscal: string; uf: string; municipio: string };
export type RegistryRequest = {
  request_id: string; expected_tenant_id: string; expected_provider: 'minha_receita';
  authorize_registry_query: true; filters: RegistryFilters; page_size: number; cursor: string | null;
};
export type RegistryResult = {
  cnpj: string; cnpj_key: string; cnpj_validation: 'syntax_only';
  razao_social: string | null; nome_fantasia: string | null; uf: string;
  municipio: { codigo_ibge: string; nome: string | null };
  cnae_fiscal: { codigo: string; descricao: string | null };
  situacao_cadastral: { descricao: string | null; data: string | null };
  phone_evidence: { source_field: 'ddd_telefone_1' | 'ddd_telefone_2'; raw: string; normalized: string; evidence_type: 'registry_phone'; ownership: 'unverified' }[];
  omitted_fields: { field: string; reason: 'invalid_source_text' | 'possible_personal_identifier' }[];
  source: { provider: 'minha_receita'; upstream: 'Receita Federal'; origin: 'https://minhareceita.org/'; source_extracted_at: null };
};
export type RegistryResponse = {
  request_id: string; tenant_id: string; provider: 'minha_receita'; filters: RegistryFilters;
  fetched_at: string; source_extracted_at: null; results: RegistryResult[];
  pagination: { next_cursor: string | null; has_more: boolean; returned: number; session_returned: number; session_limit: number; pages_fetched: number; stop_reason: 'session_limit' | 'source_exhausted' | null };
  state: { whatsapp: 'unknown'; activity: 'unknown'; contact_permission: 'not_established' }; limitations: string[];
};
export declare class RegistrySearchError extends Error { status: number; code: string; constructor(status: number, code: string); }
export declare const LIMITS: Readonly<{ page_size: 10; session_results: 30; session_pages: 30; ttl_ms: 600000; response_bytes: 262144; deadline_ms: 8000; sessions: 64; ledger: 512 }>;
export declare function createBoundedRegistryTransport(fetchImpl?: typeof fetch): (request: { filters: RegistryFilters; limit: number; cursor: string | null; signal: AbortSignal }) => Promise<{ results: RegistryResult[]; cursor: string | null }>;
/** No HTTP auth: only call with an identity verified by a trusted caller. State is process-local and non-durable. */
export declare function createRegistrySearchAdapter(options?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number }): {
  capabilities(auth: RegistryAuth): {
    tenant_id: string; provider: 'minha_receita'; enabled: boolean; reason: string | null; requires_query_authorization: true;
    filters: { cnae_fiscal: 'primary_only'; uf: 'required'; municipio: 'ibge7_required' };
    limits: typeof LIMITS; source_extracted_at: null; limitations: string[];
  };
  search(request: { auth: RegistryAuth; body: RegistryRequest }): Promise<RegistryResponse>;
};
