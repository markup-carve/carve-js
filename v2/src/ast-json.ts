// The JSON form of a tree (C2-A-012, C2-A-165) and tree equality (C2-A-161 to C2-A-163).
import { AST_VERSION, type AstNode, type Envelope } from './ast.ts'
import { CarveTreeError, validateTree } from './ast-validate.ts'

/** The bare tree as JSON, every field included (C2-A-165). */
export function encodeTree(document: AstNode): string {
  return JSON.stringify(document)
}

/** C2-A-012, C2-A-013: the tree inside its envelope, for a storage or process boundary. */
export function encodeEnvelope(document: AstNode): string {
  const envelope: Envelope = { astVersion: document.astVersion ?? AST_VERSION, document }
  if (document.extensions !== undefined) envelope.extensions = document.extensions
  return JSON.stringify(envelope)
}

/** C2-A-044: every U+0000 of an ingested string becomes U+FFFD. */
function cleanString(_key: string, value: unknown): unknown {
  return typeof value === 'string' && value.includes('\u0000') ? value.replaceAll('\u0000', '�') : value
}

/**
 * Reads a bare tree or an envelope from JSON. C2-A-167, C2-A-170: a text that is no JSON, or no
 * tree of contract 2.0, is refused here with a `CarveTreeError`, not with the error of the JSON library.
 */
export function decodeTree(json: string): AstNode {
  let value: unknown
  try {
    value = JSON.parse(json, cleanString)
  } catch {
    throw new CarveTreeError('', 'not JSON')
  }
  const fields = value as { type?: unknown, document?: unknown } | null
  const document = fields !== null && typeof fields === 'object' && fields.type === undefined && fields.document !== undefined
    ? fields.document
    : value
  validateTree(document)
  return document
}

// C2-A-162: positions and the results of resolution are not compared.
const SKIPPED = ['pos', 'segments', 'srcByteLength', 'stages', 'generatedId', 'resolvedAlign', 'n']
// A count on a cell is a resolution result where span marks are written, and an authored fact where they are not (C2-A-093).
const SPAN_COUNTS = ['colspan', 'rowspan']

function isReferenceUse(node: Record<string, unknown>): boolean {
  return node['key'] !== undefined && (node['type'] === 'link' || node['type'] === 'image' || node['type'] === 'xref')
}

function isNumbered(node: Record<string, unknown>): boolean {
  return node['type'] === 'footnote_ref' || node['type'] === 'inline_footnote'
}

/** The fields of `node` that equality compares, sorted by name. */
function comparedFields(node: Record<string, unknown>, counts: boolean): string[] {
  const reference = isReferenceUse(node)
  return Object.keys(node).filter((name) => {
    if (SKIPPED.includes(name) || node[name] === undefined) return false
    if (reference && (name === 'href' || name === 'src')) return false
    if (name === 'number' && isNumbered(node)) return false
    return counts || !SPAN_COUNTS.includes(name)
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

function hasSpanMarks(table: Record<string, unknown>): boolean {
  return JSON.stringify(table['children']).includes('"span":')
}

function equalLists(a: unknown[], b: unknown[], counts: boolean): boolean {
  const left = coalesced(a)
  const right = coalesced(b)
  return left.length === right.length && left.every((item, index) => equalValues(item, right[index], counts))
}

function equalObjects(a: Record<string, unknown>, b: Record<string, unknown>, counts: boolean): boolean {
  const inner = a['type'] === 'table' ? !(hasSpanMarks(a) || hasSpanMarks(b)) : counts
  const names = comparedFields(a, inner)
  const others = comparedFields(b, inner)
  if (names.length !== others.length || names.some((name, index) => name !== others[index])) return false
  return names.every((name) => equalField(name, a[name], b[name], inner))
}

function equalField(name: string, a: unknown, b: unknown, counts: boolean): boolean {
  if (name !== 'marker') return equalValues(a, b, counts)
  // C2-A-058: a start of 1 is the same as none.
  const normal = (marker: unknown): unknown => {
    const fields = { ...(marker as Record<string, unknown>) }
    if (fields['start'] === 1) delete fields['start']
    return fields
  }
  return equalValues(normal(a), normal(b), counts)
}

function equalValues(a: unknown, b: unknown, counts: boolean): boolean {
  if (Array.isArray(a)) return Array.isArray(b) && equalLists(a, b, counts)
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(b)) return a === b
  return equalObjects(a as Record<string, unknown>, b as Record<string, unknown>, counts)
}

/** C2-A-161: whether two trees are the same document. */
export function treesEqual(a: AstNode, b: AstNode): boolean {
  return equalValues(a, b, true)
}
