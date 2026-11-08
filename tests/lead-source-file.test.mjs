import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareLeadFile } from '../src/lib/lead-source-file.ts'

const preview = (text, fileName = 'contacts.csv', overrides = {}) => prepareLeadFile({ bytes: new TextEncoder().encode(text), fileName, tenantId: 'tenant-a', requestId: 'request-a', ...overrides })
const card = (fields) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${fields}\r\nEND:VCARD\r\n`

test('CSV BOM, escaped quotes, multiline names, semicolons and exact byte hash', async () => {
  const text = '\ufeffnome;telefone;extra\r\n"Ana ""A""\r\nSilva";"(11) 91234-5678";ignored\r\n'
  const result = await preview(text)
  assert.equal(result.contacts[0].name, 'Ana "A"\r\nSilva')
  assert.equal(result.contacts[0].phone, '+5511912345678')
  assert.equal(result.source.sha256, createHash('sha256').update(text).digest('hex'))
  assert.equal(result.source.authorization, 'user_import_for_qualification')
  assert.equal(result.canImport, true)
  assert.equal(result.requestId, 'request-a'); assert.equal(result.tenantId, 'tenant-a')
  assert.equal(JSON.stringify(result).includes('ignored'), false)
})
test('CSV duplicates preserve record numbers across empty records', async () => {
  const result = await preview('name,phone\nAna,11912345678\n\n ANA ,+5511912345678\nBia,21987654321')
  assert.deepEqual(result.contacts[0].record_numbers, [1, 3])
  assert.deepEqual(result.summary, { records: 3, valid: 3, invalid: 0, duplicates: 1 })
  assert.equal(result.source.record_count, 4)
})
test('CSV ambiguous, duplicate, missing headers and broken syntax reject', async () => {
  for (const text of ['name,nome,phone\nA,A,11912345678', 'name,phone,whatsapp\nA,1,2', 'name,phone,phone\nA,1,2', 'name,phone,extra,extra\nA,1,2,3', 'name,number\nA,11912345678', 'name,phone\n"A,11912345678', 'name,phone\n"A"oops,11912345678']) await assert.rejects(preview(text))
})
test('record issues block whole batch and never fabricate fallback data', async () => {
  const result = await preview('nome,telefone\nAna,11912345678\n,21987654321\nBia,abc11912345678\nCaio,11912345678,extra')
  assert.equal(result.canImport, false)
  assert.deepEqual(result.summary, { records: 4, valid: 1, invalid: 3, duplicates: 0 })
  assert.deepEqual(result.issues.map(x => x.record_number), [2, 3, 4])
  assert.equal(result.contacts.length, 1)
})
test('phones reject formulas, alphabetic extensions, foreign prefixes and placeholders', async () => {
  for (const phone of ['=11912345678', '@11912345678', '-11912345678', '11912345678x2', '11912345678 ramal 3', '+12125551234', '11900000000', '123', '+55(11)912345678;ext=3']) {
    const result = await preview(`name,phone\nAna,${phone}`)
    assert.equal(result.canImport, false, phone); assert.equal(result.contacts.length, 0, phone)
  }
})
test('vCard unfolding, escaped names, grouped TEL and multiple phones', async () => {
  const result = await preview(card('FN:Ana\\, Silva\r\n e Filhos\r\nitem1.TEL;TYPE=CELL:tel:+5511912345678\r\nTEL;LABEL="home: main":+5521987654321'), 'agenda.vcf')
  assert.equal(result.canImport, true)
  assert.equal(result.contacts.length, 2)
  assert.equal(result.contacts[0].name, 'Ana, Silvae Filhos')
  assert.deepEqual(result.summary, { records: 1, valid: 1, invalid: 0, duplicates: 0 })
})
test('vCard N fallback respects escaped semicolons and card indexes', async () => {
  const result = await preview(card('N:Silva\\;Junior;Ana;;;\r\nTEL:11912345678') + card('FN:ana  SILVA;Junior\r\nTEL:11912345678'), 'agenda.vcard')
  assert.equal(result.contacts[0].name, 'Ana Silva;Junior')
  assert.deepEqual(result.contacts[0].record_numbers, [1, 2])
  assert.equal(result.summary.duplicates, 1)
  assert.equal(result.canImport, true)
})
test('conflicting names block all records sharing the phone and preserve provenance', async () => {
  const result = await preview('name,phone\nAna,11912345678\nBia,+5511912345678\n ANA ,11912345678\nCaio,21987654321')
  assert.equal(result.canImport, false)
  assert.deepEqual(result.contacts[0].record_numbers, [1, 2, 3])
  assert.deepEqual(result.issues, [1, 2, 3].map(record_number => ({ record_number, code: 'conflicting_names' })))
  assert.deepEqual(result.summary, { records: 4, valid: 1, invalid: 3, duplicates: 2 })
  const vcard = await preview(card('FN:Ana\r\nTEL:11912345678') + card('FN:Bia\r\nTEL:11912345678'), 'x.vcf')
  assert.equal(vcard.canImport, false)
  assert.deepEqual(vcard.contacts[0].record_numbers, [1, 2])
  assert.equal(vcard.summary.invalid, 2)
})
test('equivalent Unicode, whitespace and case names consolidate without conflict', async () => {
  const result = await preview('name,phone\nJosé Silva,11912345678\n JOSE\u0301   SILVA ,11912345678')
  assert.equal(result.canImport, true)
  assert.deepEqual(result.contacts[0].record_numbers, [1, 2])
  assert.deepEqual(result.issues, [])
})
test('file name must be a basename, and supported card extensions stay explicit', async () => {
  for (const fileName of ['../file.csv', 'folder/file.csv', 'C:\\folder\\file.csv', 'folder\\file.vcf']) await assert.rejects(preview('name,phone', fileName), /invalid_file_name/)
  for (const fileName of ['file.vcf', 'file.vcard', 'FILE.VCARD']) assert.equal((await preview(card('FN:Ana\r\nTEL:11912345678'), fileName)).canImport, true)
})
test('vCard bad TEL invalidates entire card, and missing fields remain visible', async () => {
  const result = await preview(card('FN:Ana\r\nTEL:11912345678\r\nTEL:invalid') + card('TEL:21987654321') + card('FN:Bia'), 'x.vcf')
  assert.equal(result.contacts.length, 0); assert.equal(result.summary.invalid, 3); assert.equal(result.canImport, false)
  assert.deepEqual(result.issues.map(x => x.code), ['invalid_phone', 'missing_name', 'missing_phone'])
})
test('vCard structural errors reject and unsupported encodings cannot silently corrupt names', async () => {
  for (const value of ['FN:Ana', 'BEGIN:VCARD\nFN:Ana', 'END:VCARD', 'BEGIN:VCARD\nBEGIN:VCARD\nEND:VCARD', card('FN Ana'), card('BEGIN:OTHER')]) await assert.rejects(preview(value, 'x.vcf'))
  const result = await preview(card('FN;ENCODING=QUOTED-PRINTABLE:Ana\r\nTEL:11912345678'), 'x.vcf')
  assert.equal(result.canImport, false)
})
test('reject unsupported extensions, invalid UTF8, binary, excessive size and missing context', async () => {
  for (const fileName of ['file.xls', 'file.xlsx', 'file.txt']) await assert.rejects(preview('name,phone\nAna,11912345678', fileName))
  for (const bytes of [new Uint8Array(), new Uint8Array([0xc3, 0x28]), new Uint8Array([0]), new Uint8Array(1024 * 1024 + 1)]) await assert.rejects(preview('', 'x.csv', { bytes }))
  await assert.rejects(preview('name,phone', 'x.csv', { tenantId: '' }))
  await assert.rejects(preview('name,phone', 'x.csv', { requestId: '' }))
})
test('bounded records, contacts and fields; empty files cannot import', async () => {
  const row = 'Ana,11912345678\n'
  assert.equal((await preview('name,phone\n' + row.repeat(1000))).summary.records, 1000)
  await assert.rejects(preview('name,phone\n' + row.repeat(1001)))
  await assert.rejects(preview(card('FN:Ana\r\n' + 'TEL:11912345678\r\n'.repeat(1001)), 'x.vcf'))
  await assert.rejects(preview('name,phone\n' + 'a'.repeat(4097) + ',11912345678'))
  assert.equal((await preview('name,phone')).canImport, false)
  assert.equal((await preview('name,phone\n' + 'a'.repeat(201) + ',11912345678')).canImport, false)
})
test('snapshot isolates exact file digest from caller mutation while awaiting crypto', async () => {
  const bytes = new TextEncoder().encode('name,phone\nAna,11912345678')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const pending = preview('', 'x.csv', { bytes }); bytes.fill(0)
  const result = await pending
  assert.equal(result.source.sha256, hash); assert.equal(result.canImport, true)
})
