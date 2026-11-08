export type Provider = 'duckduckgo_instant_answer' | 'google_cse';
export type SearchEnv = Record<string, string | undefined>;
export type SearchAuth = {
    userId?: string;
    tenantId?: string;
    appRole?: string;
};
export type Transport = (url: string, options: {
    params: Record<string, string | number>;
    timeout: number;
    maxContentLength: number;
    maxBodyLength: number;
    maxRedirects: number;
    signal: AbortSignal;
}) => Promise<{
    data: unknown;
}>;
export declare class PublicSearchError extends Error {
    status: number;
    constructor(status: number, code: string);
}
export declare function requireSearchAuth(auth: SearchAuth | undefined): {
    userId: string;
    tenantId: string;
};
export declare function searchCapabilities(env: SearchEnv, auth: SearchAuth | undefined, now?: () => Date): {
    tenant_id: string;
    enabled: boolean;
    provider: Provider;
    configured: boolean;
    reason: string | null;
    requires_query_authorization: true;
    limitations: string[];
};
export declare function publicResultUrl(value: unknown): string | null;
export declare function phoneEvidence(snippet: string): {
    raw: string;
    normalized: string;
    excerpt: string;
}[];
export declare function adaptResults(provider: Provider, data: unknown): {
    title: string;
    snippet: string;
    url: string;
    phone_evidence: ReturnType<typeof phoneEvidence>;
}[];
export declare function runPublicSearch(options: {
    env: SearchEnv;
    auth: SearchAuth | undefined;
    body: unknown;
    transport: Transport;
    now?: () => Date;
    ledger?: ReturnType<typeof createSearchLedger>;
}): Promise<{
    request_id: string;
    tenant_id: string;
    query: string;
    provider: Provider;
    searched_at: string;
    results: {
        title: string;
        snippet: string;
        url: string;
        phone_evidence: ReturnType<typeof phoneEvidence>;
    }[];
    limitations: string[];
    state: {
        whatsapp: string;
        activity: string;
        contact_permission: string;
    };
}>;
type HttpRequest = {
    auth?: SearchAuth;
    body?: unknown;
};
type HttpResponse = {
    status: (code: number) => HttpResponse;
    json: (body: unknown) => unknown;
    setHeader: (key: string, value: string) => unknown;
};
export declare function createSearchHandlers(options: {
    now?: () => Date;
    ledger?: ReturnType<typeof createSearchLedger>;
    env: SearchEnv;
    transport: Transport;
}): {
    guard(req: HttpRequest, res: HttpResponse, next: () => void): void;
    capabilities(req: HttpRequest, res: HttpResponse): void;
    search(req: HttpRequest, res: HttpResponse): Promise<void>;
};
export {};

export declare function createSearchLedger(maxEntries?: number): { claim(scope: unknown[], payload: unknown[]): { replay?: Awaited<ReturnType<typeof runPublicSearch>>; complete?: (result: Awaited<ReturnType<typeof runPublicSearch>>) => void; uncertain?: () => void } };
