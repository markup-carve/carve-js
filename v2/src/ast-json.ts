// The JSON form of a tree (C2-A-012, C2-A-165) and tree equality (C2-A-161 to C2-A-163).
import { type DocumentNode, type Envelope, isRecord, type Node } from './ast.ts'
import { AST_RESULTS, type ResultField } from './ast-tables.ts'
import { CarveTreeError, validateEnvelope, validateTree } from './ast-validate.ts'

/** The bare tree as JSON, every field included (C2-A-165). */
export function encodeTree(document: Node): string {
  return JSON.stringify(document)
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
export function decodeTree(json: string, source?: string): DocumentNode {
  let value: unknown
  try {
    value = JSON.parse(json, cleanString)
  } catch {
    throw new CarveTreeError('', 'not JSON')
  }
  const envelope = envelopeOf(value)
  if (envelope !== null) validateEnvelope(envelope)
  const document = envelope === null ? value : envelope['document']
  // A path inside the envelope starts at its document.
  try {
    validateTree(document, envelope ?? undefined, source)
  } catch (error) {
    if (envelope !== null && error instanceof CarveTreeError) throw new CarveTreeError(`/document${error.path}`, error.reason)
    throw error
  }
  return document
}

function skippedResult(node: Record<string, unknown>, name: string, spanMarks: boolean): boolean {
  const type = node['type']
  if (typeof type !== 'string') return false
  const result = AST_RESULTS.get(type)?.find((entry: ResultField) => entry.field === name)
  if (result === undefined) return false
  if (result.when === 'reference use') return node['key'] !== undefined
  if (result.when === 'derived from authored span mark') return spanMarks
  return true
}

/** The fields of `node` that equality compares, sorted by name. `spanMarks`: the node stands in a table with span marks. */
function comparedFields(node: Record<string, unknown>, spanMarks: boolean): string[] {
  const typed = typeof node['type'] === 'string' && AST_RESULTS.has(node['type'])
  return Object.keys(node).filter((name) => {
    if (node[name] === undefined) return false
    if (typed && (name === 'pos' || name === 'segments' || name === 'srcByteLength')) return false
    return !skippedResult(node, name, spanMarks)
  }).sort()
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

function equalLists(a: unknown[], b: unknown[], spanMarks: boolean): boolean {
  const left = coalesced(a)
  const right = coalesced(b)
  return left.length === right.length && left.every((item, index) => equalValues(item, right[index], spanMarks))
}

function equalObjects(a: Record<string, unknown>, b: Record<string, unknown>, spanMarks: boolean): boolean {
  const inner = a['type'] === 'table' ? hasSpanMarks(a) || hasSpanMarks(b) : spanMarks
  const names = comparedFields(a, inner)
  const others = comparedFields(b, inner)
  if (names.length !== others.length || names.some((name, index) => name !== others[index])) return false
  return names.every((name) => equalValues(a[name], b[name], inner))
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
