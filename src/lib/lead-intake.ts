export const LEAD_CAPTURE_AVAILABLE = false
export const LEAD_CAPTURE_BLOCK_REASON = 'Captura indisponivel: Maps, Instagram e CNPJ ainda usam simulacoes. Nenhum dado simulado sera salvo.'
export type LeadIntakeOrigin = 'simulated-capture' | 'vcard-import'
type Candidate = { tenant_id: string; name: string; phone: string }
export function normalizeImportedPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const national = (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits
  if (!/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(national) || /^(.)\1+$/.test(national.slice(-8))) throw new Error('Telefone ausente ou formato brasileiro invalido; arquivo nao importado.')
  return '+55' + national
}
export function whatsappRecipientNumber(raw: string): string | null {
  try { return normalizeImportedPhone(raw).slice(1) } catch { return null }
}
export async function persistLeadBatch<T extends Candidate>(options: {
  origin: LeadIntakeOrigin; tenantId: string | undefined; candidates: T[];
  isCurrentTenant: () => boolean;
  readExisting: (tenantId: string) => PromiseLike<{ data: { phone: string }[] | null; error: unknown; count: number | null }>;
  insert: (rows: T[]) => PromiseLike<{ error: unknown }>;
}): Promise<{ inserted: number; skipped: number }> {
  if (options.origin !== 'vcard-import') throw new Error(LEAD_CAPTURE_BLOCK_REASON)
  const tenantId = options.tenantId
  if (!tenantId || !options.isCurrentTenant()) throw new Error('Empresa indisponivel; nenhuma importacao realizada.')
  const seen = new Set<string>()
  const candidates: T[] = []
  for (const item of options.candidates) {
    if (item.tenant_id !== tenantId || !item.name.trim()) throw new Error('Contato fora da empresa ou sem nome; arquivo nao importado.')
    const phone = normalizeImportedPhone(item.phone)
    if (!seen.has(phone)) { seen.add(phone); candidates.push({ ...item, phone }) }
  }
  if (!candidates.length) return { inserted: 0, skipped: 0 }
  const result = await options.readExisting(tenantId)
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) throw new Error('Nao foi possivel conferir duplicados; nenhuma importacao realizada.')
  const existing = new Set(result.data.flatMap(row => { try { return [normalizeImportedPhone(row.phone)] } catch { return [] } }))
  const fresh = candidates.filter(item => !existing.has(item.phone))
  if (!options.isCurrentTenant()) throw new Error('Empresa mudou durante a importacao; nenhuma gravacao realizada.')
  if (fresh.length) {
    const saved = await options.insert(fresh)
    if (saved.error) throw new Error('Importacao nao confirmada pelo banco. Verifique o resultado antes de tentar novamente.')
  }
  return { inserted: fresh.length, skipped: options.candidates.length - fresh.length }
}
