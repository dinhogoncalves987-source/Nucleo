import { normalizeImportedPhone } from './lead-intake.ts'

export type LeadFileIssue = { record_number: number; code: string }
export type PreparedLeadFile = {
  requestId: string; tenantId: string
  source: { format: 'csv' | 'vcard'; file_name: string; sha256: string; record_count: number; authorization: 'user_import_for_qualification' }
  contacts: { name: string; phone: string; record_numbers: number[] }[]
  issues: LeadFileIssue[]
  summary: { records: number; valid: number; invalid: number; duplicates: number }
  canImport: boolean
}
type RecordInput = { number: number; name: string; phones: string[]; issues?: string[] }
const MAX_BYTES = 1024 * 1024
const MAX_RECORDS = 1000
const MAX_FIELD = 4096
function fail(code: string): never { throw new Error(code) }
function comparableName(name: string): string { return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() }

// RFC 4180-style state machine. Delimiter is selected only by an unambiguous header.
function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false
  const cell = () => { row.push(field); field = ''; closed = false; if (row.length > 100) fail('too_many_columns') }
  const end = () => { cell(); rows.push(row); row = []; if (rows.length > MAX_RECORDS + 1) fail('too_many_records') }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false; closed = true } }
      else field += c
    } else if (c === delimiter) cell()
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; end() }
    else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') fail('malformed_csv'); field += c }
    if (field.length > MAX_FIELD) fail('field_too_long')
  }
  if (quoted) fail('malformed_csv')
  if (field || row.length || closed) end()
  return rows
}
function headerIndices(header: string[]): { name: number; phone: number } {
  const normalized = header.map(h => h.trim().toLowerCase())
  if (new Set(normalized).size !== normalized.length || normalized.some(h => !h)) fail('ambiguous_headers')
  const names = normalized.flatMap((h, i) => ['nome', 'name'].includes(h) ? [i] : [])
  const phones = normalized.flatMap((h, i) => ['telefone', 'phone', 'celular', 'whatsapp'].includes(h) ? [i] : [])
  if (names.length !== 1 || phones.length !== 1) fail('ambiguous_headers')
  return { name: names[0], phone: phones[0] }
}
function parseCsv(text: string): { records: RecordInput[]; recordCount: number } {
  const candidates: { rows: string[][]; indices: { name: number; phone: number } }[] = []
  for (const delimiter of [',', ';']) {
    try { const rows = csvRows(text, delimiter); if (rows.length) candidates.push({ rows, indices: headerIndices(rows[0]) }) } catch { /* Reject candidate; never guess columns. */ }
  }
  if (candidates.length !== 1) fail('invalid_or_ambiguous_csv')
  const { rows, indices } = candidates[0]
  return { recordCount: rows.length - 1, records: rows.slice(1).flatMap((row, i) => row.every(value => !value.trim()) ? [] : [{
    number: i + 1, name: row[indices.name] ?? '', phones: [row[indices.phone] ?? ''],
    issues: row.length === rows[0].length ? [] : ['column_count_mismatch'],
  }]) }
}
function unescapeCard(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_, c: string) => c.toLowerCase() === 'n' ? '\n' : c)
}
function structuredName(value: string): string {
  // Split only unescaped semicolons; preserve escaped punctuation in each component.
  const fields: string[] = []; let field = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) { field += value[i] + value[++i] }
    else if (value[i] === ';') { fields.push(unescapeCard(field)); field = '' }
    else field += value[i]
  }
  fields.push(unescapeCard(field))
  return [fields[3], fields[1], fields[2], fields[0], fields[4]].filter(Boolean).join(' ')
}
function parseVcard(text: string): RecordInput[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const result: RecordInput[] = []; let card: RecordInput | undefined; let fn: string | undefined; let n: string | undefined
  for (const line of lines) {
    if (line.length > MAX_FIELD) fail('field_too_long')
    if (!line.trim()) continue
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (card) fail('malformed_vcard')
      if (result.length >= MAX_RECORDS) fail('too_many_records')
      card = { number: result.length + 1, name: '', phones: [], issues: [] }; fn = undefined; n = undefined; continue
    }
    if (/^END:VCARD$/i.test(line)) {
      if (!card) fail('malformed_vcard')
      card.name = fn?.trim() || (n === undefined ? '' : structuredName(n)); result.push(card); card = undefined; continue
    }
    if (!card) fail('malformed_vcard')
    // Property parameters can contain quoted colons, e.g. LABEL="home: main".
    let quoted = false; let colon = -1
    for (let i = 0; i < line.length; i++) { if (line[i] === '"') quoted = !quoted; else if (line[i] === ':' && !quoted) { colon = i; break } }
    if (colon < 1) fail('malformed_vcard')
    const descriptor = line.slice(0, colon); const value = line.slice(colon + 1)
    const property = descriptor.split(';')[0].split('.').pop()?.toUpperCase()
    if (!property || property === 'BEGIN' || property === 'END') fail('malformed_vcard')
    if (['FN', 'N', 'TEL'].includes(property) && /;(?:ENCODING|CHARSET)=/i.test(descriptor)) card.issues!.push('unsupported_vcard_encoding')
    if (property === 'FN') { if (fn !== undefined) card.issues!.push('ambiguous_name'); fn = unescapeCard(value) }
    if (property === 'N') { if (n !== undefined) card.issues!.push('ambiguous_name'); n = value }
    if (property === 'TEL') { card.phones.push(unescapeCard(value).replace(/^tel:/i, '')); if (card.phones.length > MAX_RECORDS) fail('too_many_contacts') }
  }
  if (card) fail('malformed_vcard')
  return result
}

/** Pure preview only. The authorization marker is a proposed source category, NOT consent.
 * The caller must obtain explicit file authorization and confirm the current tenant before RPC.
 * No network, persistence, WhatsApp registration check or permission to message is performed.
 * Fatal file/schema errors reject; record issues return a preview with canImport=false.
 * summary counts nonempty records; source.record_count includes empty CSV positions so
 * provenance indexes stay within 1..record_count. duplicates counts repeated phone occurrences.
 */
export async function prepareLeadFile(options: { bytes: Uint8Array; fileName: string; tenantId: string; requestId: string }): Promise<PreparedLeadFile> {
  const { fileName, tenantId, requestId } = options
  if (!tenantId.trim() || !requestId.trim()) fail('missing_context')
  // eslint-disable-next-line no-control-regex -- File names must not contain control characters.
  if (!fileName || fileName.length > 255 || /[\x00-\x1f\x7f/\\]/.test(fileName)) fail('invalid_file_name')
  const format = /\.csv$/i.test(fileName) ? 'csv' : /\.(vcf|vcard)$/i.test(fileName) ? 'vcard' : fail('unsupported_file_type')
  if (!(options.bytes instanceof Uint8Array) || !options.bytes.length || options.bytes.length > MAX_BYTES) fail('invalid_file_size')
  const bytes = new Uint8Array(options.bytes) // Snapshot before any await; hash and parser always see identical bytes.
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return fail('invalid_utf8') }
  // eslint-disable-next-line no-control-regex -- Reject binary/control input; preserve tab and line endings.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail('binary_or_control_data')
  const parsed = format === 'csv' ? parseCsv(text) : { records: parseVcard(text), recordCount: 0 }
  const records = parsed.records
  const recordCount = format === 'csv' ? parsed.recordCount : records.length
  const issues: LeadFileIssue[] = []; const contacts: PreparedLeadFile['contacts'] = []; const seen = new Map<string, PreparedLeadFile['contacts'][number]>()
  const conflictingPhones = new Set<string>()
  let duplicates = 0; let phoneCount = 0
  for (const record of records) {
    const errors = new Set(record.issues ?? []); const name = record.name.trim(); const phones: string[] = []
    if (!name) errors.add('missing_name')
    if (name.length > 200) errors.add('name_too_long')
    if (!record.phones.length) errors.add('missing_phone')
    for (const raw of record.phones) {
      if (++phoneCount > MAX_RECORDS) fail('too_many_contacts')
      const phone = raw.trim()
      if (!phone) { errors.add('missing_phone'); continue }
      // Never strip letters, formulas, extensions or multiple numbers into a plausible phone.
      if (phone.length > 64 || !/^\+?[0-9][0-9 () .-]*$/.test(phone.replace(/^\(/, '')) || (phone.startsWith('+') && !phone.startsWith('+55'))) { errors.add('invalid_phone'); continue }
      try { phones.push(normalizeImportedPhone(phone)) } catch { errors.add('invalid_phone') }
    }
    if (errors.size) { for (const code of errors) issues.push({ record_number: record.number, code }); continue }
    for (const phone of phones) {
      const previous = seen.get(phone)
      if (previous) {
        duplicates++
        if (!previous.record_numbers.includes(record.number)) previous.record_numbers.push(record.number)
        if (comparableName(previous.name) !== comparableName(name)) conflictingPhones.add(phone)
      }
      else { const contact = { name, phone, record_numbers: [record.number] }; seen.set(phone, contact); contacts.push(contact) }
    }
  }
  // Every record sharing an ambiguous identity must be reviewed, including the first
  // occurrence and subsequent aliases. Keep all provenance indexes in the blocked preview.
  const conflictingRecords = new Set<number>()
  for (const phone of conflictingPhones) for (const number of seen.get(phone)!.record_numbers) conflictingRecords.add(number)
  for (const record_number of conflictingRecords) issues.push({ record_number, code: 'conflicting_names' })
  const invalid = new Set(issues.map(issue => issue.record_number)).size
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  return { requestId, tenantId, source: { format, file_name: fileName, sha256, record_count: recordCount, authorization: 'user_import_for_qualification' }, contacts, issues,
    summary: { records: records.length, valid: records.length - invalid, invalid, duplicates }, canImport: records.length > 0 && !issues.length && contacts.length > 0 }
}
