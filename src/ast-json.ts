// The JSON form of a tree (C2-A-012, C2-A-165) and tree equality (C2-A-161, C2-A-162).
import { type DocumentNode, type Envelope, isRecord, type Node, pointerKey } from './ast.ts'
import { AST_RESULTS, type ResultField } from './ast-tables.ts'
import { type AnnotationRangeSidecar, CarveTreeError, validateEnvelope, validateTree, validateTreeWithAnnotations } from './ast-validate.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { utf8Length } from './positions.ts'

export const JSON_SOURCE_LENGTH = Symbol('jsonSourceLength')

/** The bare tree as JSON, every field included (C2-A-165). */
export function encodeTree(document: Node): string {
  return canonicalJson(document)
}

/** C2-A-217: RFC 8785 orders object keys by UTF-16 code units at every depth. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** C2-A-012, C2-A-013: the tree inside its envelope, for a storage or process boundary. */
export function encodeEnvelope(document: DocumentNode): string {
  const envelope: Envelope = { astVersion: document.astVersion, document }
  if (document.extensions !== undefined) envelope.extensions = document.extensions
  return JSON.stringify(envelope)
}

/** C2-A-044: every U+0000 of an ingested string becomes U+FFFD. */
function cleanString(_key: string, value: unknown): unknown {
  return typeof value === 'string' && value.includes('\u0000') ? value.replaceAll('\u0000', '�') : value
}

/** The offset of the quote that closes the string opened at `quote`. */
function stringEnd(json: string, quote: number): number {
  let close = json.indexOf('"', quote + 1)
  for (;;) {
    let slashes = 0
    while (json.charCodeAt(close - 1 - slashes) === 92) slashes++
    if (slashes % 2 === 0) return close
    close = json.indexOf('"', close + 1)
  }
}

/** A number spelling as sign, significant digits without leading or trailing zeros, and exponent; zero is `0`. */
function decimalValue(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (match === null) return text
  const fraction = match[3] ?? ''
  const digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/, '')
  if (digits === '') return '0'
  const significant = digits.replace(/0+$/, '')
  return `${match[1] ?? ''}${significant}e${BigInt(match[4] ?? 0) - BigInt(fraction.length) + BigInt(digits.length - significant.length)}`
}

/** Whether the number spelled `text` is a binary64 value as it stands (C2-A-219). */
function keepsValue(text: string): boolean {
  const number = Number(text)
  return Number.isFinite(number) && decimalValue(text) === decimalValue(String(number))
}

/** The end of the number that starts at `start`, negative when it is an integer of at most 15 digits, which keeps its value. */
function numberEnd(json: string, start: number, end: number): number {
  let stop = start + 1
  let plain = true
  for (; stop < end; stop++) {
    const code = json.charCodeAt(stop)
    if (code >= 48 && code <= 57) continue
    if (code !== 46 && code !== 69 && code !== 101 && code !== 43 && code !== 45) break
    plain = false
  }
  return plain && stop - start <= 15 ? -stop : stop
}

/** The offset of the first number of `json` from `from` to `end`, which hold no string, that does not keep its value, or -1. */
function inexactBetween(json: string, from: number, end: number): number {
  for (let index = from; index < end; index++) {
    const code = json.charCodeAt(index)
    if (code !== 45 && (code < 48 || code > 57)) continue
    const stop = numberEnd(json, index, end)
    if (stop > 0 && !keepsValue(json.slice(index, stop))) return index
    index = Math.abs(stop)
  }
  return -1
}

/**
 * C2-A-219: the offset of the first number of the JSON text whose spelling does not denote its binary64 value, or -1.
 * The text is valid JSON, so outside strings a digit or a minus sign can only start a number.
 */
function inexactNumber(json: string): number {
  let from = 0
  for (;;) {
    const quote = json.indexOf('"', from)
    const found = inexactBetween(json, from, quote === -1 ? json.length : quote)
    if (found !== -1 || quote === -1) return found
    from = stringEnd(json, quote) + 1
  }
}

/** The RFC 6901 pointer to the value that starts at `offset` of the JSON text. */
function pointerAt(json: string, offset: number): string {
  const path: (string | number)[] = []
  const arrays: boolean[] = []
  let key = false
  for (let index = 0; index < offset; index++) {
    const char = json[index]
    const last = path.length - 1
    if (char === '"') {
      const end = stringEnd(json, index)
      if (key) path[last] = JSON.parse(json.slice(index, end + 1)) as string
      index = end
    } else if (char === '{' || char === '[') {
      arrays.push(char === '[')
      path.push(char === '[' ? 0 : '')
      key = char === '{'
    } else if (char === '}' || char === ']') {
      arrays.pop()
      path.pop()
      key = false
    } else if (char === ',' && arrays[arrays.length - 1] === true) path[last] = (path[last] as number) + 1
    else if (char === ',' || char === ':') key = char === ','
  }
  return path.map((part) => `/${pointerKey(String(part))}`).join('')
}

/** C2-A-012: `value` as an envelope, which has a document and no type, or null for a bare tree. */
function envelopeOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && value['type'] === undefined && value['document'] !== undefined ? value : null
}

/**
 * Reads a bare tree or an envelope from JSON. C2-A-167, C2-A-170: a text that is no JSON, or no
 * tree of contract 2.0, is refused here with a `CarveTreeError`, not with the error of the JSON library.
 */
export function decodeTree(json: string, source?: string, extensions: readonly ExtensionDefinition[] = [],
  annotations?: AnnotationRangeSidecar): DocumentNode {
  let value: unknown
  try {
    value = JSON.parse(json, cleanString)
  } catch {
    throw new CarveTreeError('', 'not JSON')
  }
  const inexact = inexactNumber(json)
  if (inexact !== -1) throw new CarveTreeError(pointerAt(json, inexact), 'number does not keep its value as binary64')
  const envelope = envelopeOf(value)
  if (envelope !== null) validateEnvelope(envelope, extensions)
  const document = envelope === null ? value : envelope['document']
  // A path inside the envelope starts at its document.
  try {
    validateTree(document, envelope ?? undefined, source, extensions)
  } catch (error) {
    if (envelope !== null && error instanceof CarveTreeError) throw new CarveTreeError(`/document${error.path}`, error.reason)
    throw error
  }
  if (annotations !== undefined) validateTreeWithAnnotations(document, annotations, envelope ?? undefined, source, extensions)
  Object.defineProperty(document, JSON_SOURCE_LENGTH, { value: utf8Length(json) })
  return document
}

/** The `when` of each result field, by node type; the first entry of a field decides, as in AST_RESULTS. */
const RESULT_WHEN: ReadonlyMap<string, ReadonlyMap<string, string | undefined>> = new Map([...AST_RESULTS].map(([type, fields]) => {
  const byField = new Map<string, string | undefined>()
  for (const entry of fields as readonly ResultField[]) if (!byField.has(entry.field)) byField.set(entry.field, entry.when)
  return [type, byField]
}))

/** The result fields of the type of `node`, or null where it has no typed entry. */
function resultsOf(node: Record<string, unknown>): ReadonlyMap<string, string | undefined> | null {
  const type = node['type']
  return typeof type === 'string' ? RESULT_WHEN.get(type) ?? null : null
}

/** Whether equality compares this field. `spanMarks`: the node stands in a table with span marks. */
function comparedField(node: Record<string, unknown>, results: ReadonlyMap<string, string | undefined> | null, name: string,
  spanMarks: boolean): boolean {
  if (node[name] === undefined) return false
  if (results === null) return true
  if (name === 'pos' || name === 'segments' || name === 'srcByteLength') return false
  if (!results.has(name)) return true
  const when = results.get(name)
  if (when === 'reference use') return node['key'] === undefined
  if (when === 'derived from authored span mark') return !spanMarks
  return false
}

const TEXT_RUN = new Set(['type', 'value', 'pos', 'segments'])

/** Two texts whose other fields agree; only such runs join, so a field that differs is compared. */
function joinableTexts(last: unknown, next: unknown): last is { type: 'text', value?: string } {
  if (!isRecord(last) || !isRecord(next) || last['type'] !== 'text' || next['type'] !== 'text') return false
  const fields = (node: Record<string, unknown>): string[] =>
    Object.keys(node).filter((name) => !TEXT_RUN.has(name) && node[name] !== undefined)
  const own = fields(last)
  const other = fields(next)
  return own.length === other.length && own.every((name) => Object.hasOwn(next, name) && equalValues(last[name], next[name], false))
}

/** C2-A-040: adjacent text nodes compare as one. */
function coalesced(list: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const item of list) {
    const last = out[out.length - 1]
    if (joinableTexts(last, item)) out[out.length - 1] = { ...last, value: (last.value ?? '') + ((item as { value?: string }).value ?? '') }
    else out.push(item)
  }
  return out
}

/** The node list of `node` in its slot `name`, or none. */
function listOf(node: unknown, name: string): unknown[] {
  const list = isRecord(node) ? node[name] : undefined
  return Array.isArray(list) ? list : []
}

/** C2-A-093: whether a cell of the rows of `table` carries span marks, read from the `span` field of each cell. */
function hasSpanMarks(table: Record<string, unknown>): boolean {
  return listOf(table, 'children').some((group) => listOf(group, 'children').some((row) => listOf(row, 'children').some(
    (cell) => isRecord(cell) && cell['type'] === 'table_cell' && cell['span'] !== undefined,
  )))
}

/** Item by item, skipping the holes of a sparse `a` as `every` did. */
function equalItems(a: unknown[], b: unknown[], spanMarks: boolean): boolean {
  for (let index = 0; index < a.length; index++) if (index in a && !equalValues(a[index], b[index], spanMarks)) return false
  return true
}

function equalLists(a: unknown[], b: unknown[], spanMarks: boolean): boolean {
  // Parsed trees normally contain no adjacent text. Avoid two arrays per comparison in that case.
  if (a.length === b.length) {
    let adjacent = false
    for (let index = 1; index < a.length; index++) {
      if ((a[index - 1] as { type?: unknown } | null)?.type === 'text' &&
          (a[index] as { type?: unknown } | null)?.type === 'text' ||
          (b[index - 1] as { type?: unknown } | null)?.type === 'text' &&
          (b[index] as { type?: unknown } | null)?.type === 'text') { adjacent = true; break }
    }
    if (!adjacent) return equalItems(a, b, spanMarks)
  }
  const left = coalesced(a)
  const right = coalesced(b)
  return left.length === right.length && left.every((item, index) => equalValues(item, right[index], spanMarks))
}

function equalObjects(a: Record<string, unknown>, b: Record<string, unknown>, spanMarks: boolean): boolean {
  const inner = a['type'] === 'table' ? hasSpanMarks(a) || hasSpanMarks(b) : spanMarks
  const left = resultsOf(a)
  const right = resultsOf(b)
  let count = 0
  for (const name of Object.keys(a)) {
    if (!comparedField(a, left, name, inner)) continue
    count++
    if (!Object.hasOwn(b, name) || !comparedField(b, right, name, inner) || !equalValues(a[name], b[name], inner)) return false
  }
  for (const name of Object.keys(b)) if (comparedField(b, right, name, inner)) count--
  return count === 0
}

function equalValues(a: unknown, b: unknown, spanMarks: boolean): boolean {
  if (Array.isArray(a)) return Array.isArray(b) && equalLists(a, b, spanMarks)
  if (!isRecord(a) || !isRecord(b)) return a === b
  return equalObjects(a, b, spanMarks)
}

/** C2-A-161: whether two trees are the same document. */
export function treesEqual(a: Node, b: Node): boolean {
  return equalValues(a, b, false)
}
