'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class MemoryError extends Error {
  constructor(code, status = 503) {
    const messages = {
      memory_unavailable: 'Não foi possível confirmar a memória. Nenhuma nova geração será iniciada sem essa confirmação.',
      session_not_found: 'Conversa indisponível para este usuário, empresa ou contato.',
      session_closed: 'Esta conversa foi encerrada. Inicie uma nova conversa.',
      request_conflict: 'Este pedido já existe com outro conteúdo.',
      request_busy: 'Há uma resposta em processamento nesta conversa. Aguarde antes de consultar novamente.',
      request_uncertain: 'Não foi possível confirmar a tentativa anterior. Ela não será repetida automaticamente; inicie outra conversa somente após revisar o resultado.',
      invalid_scope: 'Identificação da conversa ou do contato inválida.',
    };
    super(messages[code] ?? messages.memory_unavailable); this.code = code; this.status = status;
  }
}
function memoryScope(identity, body) {
  if (!UUID.test(identity.userId) || !UUID.test(identity.tenantId) || typeof body.sessionId !== 'string' || !UUID.test(body.sessionId)
    || (body.contactId != null && (typeof body.contactId !== 'string' || !UUID.test(body.contactId)))) throw new MemoryError('invalid_scope', 400);
  return { userId: identity.userId, tenantId: identity.tenantId, sessionId: body.sessionId, contactId: body.contactId ?? null };
}
function createSupabaseMemoryStore(db) {
  return { async call(action, scope, args = {}) {
    let result;
    try {
      result = await db.rpc('nucleo_memory_v1', {
        p_action: action, p_user: scope.userId, p_tenant: scope.tenantId,
        p_session: scope.sessionId, p_contact: scope.contactId,
        p_request: args.requestId ?? null, p_message: args.message ?? null,
        p_reply: args.reply ?? null, p_lease: args.lease ?? null, p_safe_failure: args.safeFailure ?? false,
      });
    } catch { throw new MemoryError('memory_unavailable'); }
    if (result.error || !result.data || typeof result.data !== 'object') throw new MemoryError('memory_unavailable');
    if (!result.data.ok) {
      const code = result.data.code;
      throw new MemoryError(code, code === 'session_not_found' ? 404 : 409);
    }
    return result.data;
  } };
}
module.exports = { MemoryError, memoryScope, createSupabaseMemoryStore, UUID };
