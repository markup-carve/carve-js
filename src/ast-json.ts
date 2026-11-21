// The JSON form of a tree (C2-A-012, C2-A-165) and tree equality (C2-A-161, C2-A-162).
import { type DocumentNode, type Envelope, isRecord, type Node } from './ast.ts'
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

/** C2-A-040: adjacent text nodes compare as one. */
function coalesced(list: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const item of list) {
    const last = out[out.length - 1] as { type?: unknown, value?: string } | undefined
    const text = item as { type?: unknown, value?: string } | null
    if (text?.type === 'text' && last?.type === 'text') out[out.length - 1] = { ...last, value: (last.value ?? '') + (text.value ?? '') }
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
