import type { AstJsonDocument } from './ast-json.js'
import { NODE_POSITION_KIND } from './wire-fields.js'

export interface NodeIdentity { id: string; path: string }
export interface NodeIdentitySidecar { version: 1; session: string; nodes: NodeIdentity[] }
export interface AnnotationAnchor { path: string; offset: number }
export interface AnnotationRange { id: string; kind: string; start: AnnotationAnchor; end: AnnotationAnchor; data?: Record<string, unknown> }
export interface AnnotationRangeSidecar { version: 1; ranges: AnnotationRange[] }
export interface ProvenanceSource { id: string; uri?: string; format?: string; parent?: string }
export interface NodeProvenance { path: string; source: string; origin: 'authored' | 'generated'; startByte?: number; endByte?: number; step?: string }
export interface ProvenanceSidecar { version: 1; sources: ProvenanceSource[]; nodes: NodeProvenance[] }

export class AstSidecarError extends TypeError {
  constructor(message: string) { super(message); this.name = 'AstSidecarError' }
}

const ANNOTATION_CHILD_FIELDS = ['target', 'title', 'children', 'items', 'rows', 'cells', 'blocks', 'inline', 'content', 'prefix', 'locator', 'suffix', 'old', 'new', 'pairs', 'base', 'annotation', 'caption', 'shortCaption', 'fallback'] as const

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const pointer = /^(?:|(?:\/(?:[^~/]|~[01])*)+)$/

function fields(value: RecordValue, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new AstSidecarError(`${label} has unknown field ${key}`)
}

function root(value: unknown, allowed: readonly string[], label: string): asserts value is RecordValue {
  if (!record(value) || value.version !== 1) throw new AstSidecarError(`${label} requires version 1`)
  fields(value, allowed, label)
}

function nodeAt(ast: AstJsonDocument, path: unknown, canonical = collectNodes(ast)): RecordValue {
  if (typeof path !== 'string' || !pointer.test(path)) throw new AstSidecarError('invalid RFC 6901 node path')
  const value = canonical.get(path)
  if (!value) throw new AstSidecarError(`path ${path} does not address a node`)
  return value
}

function collectNodes(ast: AstJsonDocument): Map<string, RecordValue> {
  const nodes = new Map<string, RecordValue>()
  const visitNode = (value: unknown, path: string): void => {
    if (!record(value) || !nonempty(value.type)) return
    nodes.set(path, value)
    for (const key of ANNOTATION_CHILD_FIELDS) {
      const child = value[key]
      const kind = NODE_POSITION_KIND[`${value.type}.${key}`]
      const next = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
      if (kind === 'node') visitNode(child, next)
      else if (kind === 'nodes' && Array.isArray(child)) child.forEach((item, index) => visitNode(item, `${next}/${index}`))
      else if (kind === 'records' && Array.isArray(child)) child.forEach((item, index) => visitRecord(item, `${next}/${index}`, 'rubyPair'))
      else if (kind === 'node-matrix' && Array.isArray(child)) child.forEach((row, i) => { if (Array.isArray(row)) row.forEach((item, j) => visitNode(item, `${next}/${i}/${j}`)) })
    }
  }
  const visitRecord = (value: unknown, path: string, name: string): void => {
    if (!record(value)) return
    for (const key of ANNOTATION_CHILD_FIELDS) {
      const child = value[key]
      if (NODE_POSITION_KIND[`${name}.${key}`] !== 'nodes' || !Array.isArray(child)) continue
      child.forEach((item, index) => visitNode(item, `${path}/${key}/${index}`))
    }
  }
  visitNode(ast, '')
  return nodes
}

/** Enumerate nodes in canonical AST pointer order. */
export function astNodePaths(ast: AstJsonDocument): string[] { return [...collectNodes(ast).keys()] }

export function readNodeIdentity(input: unknown, ast: AstJsonDocument): NodeIdentitySidecar {
  root(input, ['version', 'session', 'nodes'], 'node identity sidecar')
  if (!nonempty(input.session) || !Array.isArray(input.nodes)) throw new AstSidecarError('invalid node identity sidecar')
  const ids = new Set<string>(), paths = new Set<string>()
  const canonical = collectNodes(ast)
  for (const entry of input.nodes) {
    if (!record(entry) || !nonempty(entry.id)) throw new AstSidecarError('invalid node identity entry')
    fields(entry, ['id', 'path'], 'node identity entry')
    nodeAt(ast, entry.path, canonical)
    if (ids.has(entry.id) || paths.has(entry.path as string)) throw new AstSidecarError('duplicate node identity id or path')
    ids.add(entry.id); paths.add(entry.path as string)
  }
  return input as unknown as NodeIdentitySidecar
}

export function toNodeIdentity(ast: AstJsonDocument, session: string, ids?: ReadonlyMap<string, string>): NodeIdentitySidecar {
  if (!nonempty(session)) throw new AstSidecarError('session must be nonempty')
  const used = new Set(ids?.values() ?? [])
  let next = 0
  const nodes = astNodePaths(ast).map((path) => {
    let id = ids?.get(path)
    if (id === undefined) {
      do { id = `n${next++}` } while (used.has(id))
      used.add(id)
    }
    return { id, path }
  })
  return readNodeIdentity({ version: 1, session, nodes }, ast)
}

function textMetrics(canonical: Map<string, RecordValue>): Map<string, { start: number; length: number }> {
  const result = new Map<string, { start: number; length: number }>()
  const active: string[] = []
  let offset = 0
  for (const [path, node] of canonical) {
    while (active.length && !(path === active[active.length - 1] || path.startsWith(`${active[active.length - 1]}/`) || active[active.length - 1] === '')) {
      const finished = result.get(active.pop()!)!
      finished.length = offset - finished.start
    }
    result.set(path, { start: offset, length: 0 })
    active.push(path)
    const own = node.type === 'soft_break' || node.type === 'hard_break' ? '\n'
      : node.type === 'non_breaking_space' ? '\u00a0'
      : [node.value, node.content, node.text, node.alt].find((value): value is string => typeof value === 'string') ?? ''
    offset += [...own].length
  }
  while (active.length) {
    const path = active.pop()!
    result.get(path)!.length = offset - result.get(path)!.start
  }
  return result
}

function anchor(value: unknown, ast: AstJsonDocument, canonical: Map<string, RecordValue>, metrics: Map<string, { start: number; length: number }>): number {
  if (!record(value) || !integer(value.offset)) throw new AstSidecarError('invalid annotation anchor')
  fields(value, ['path', 'offset'], 'annotation anchor')
  nodeAt(ast, value.path, canonical)
  const metric = metrics.get(value.path as string)!
  if (value.offset > metric.length) throw new AstSidecarError('annotation offset exceeds node text')
  return metric.start + value.offset
}

export function readAnnotationRanges(input: unknown, ast: AstJsonDocument): AnnotationRangeSidecar {
  root(input, ['version', 'ranges'], 'annotation range sidecar')
  if (!Array.isArray(input.ranges)) throw new AstSidecarError('annotation ranges must be an array')
  const ids = new Set<string>()
  const canonical = collectNodes(ast)
  const metrics = textMetrics(canonical)
  for (const range of input.ranges) {
    if (!record(range) || !nonempty(range.id) || !nonempty(range.kind)) throw new AstSidecarError('invalid annotation range')
    fields(range, ['id', 'kind', 'start', 'end', 'data'], 'annotation range')
    const start = anchor(range.start, ast, canonical, metrics), end = anchor(range.end, ast, canonical, metrics)
    if (start > end) throw new AstSidecarError('annotation start follows end')
    if (range.data !== undefined && !record(range.data)) throw new AstSidecarError('annotation data must be an object')
    if (ids.has(range.id)) throw new AstSidecarError('duplicate annotation id')
    ids.add(range.id)
  }
  return input as unknown as AnnotationRangeSidecar
}

export function toAnnotationRanges(ast: AstJsonDocument, ranges: readonly AnnotationRange[]): AnnotationRangeSidecar {
  return readAnnotationRanges({ version: 1, ranges: [...ranges] }, ast)
}

export function readProvenance(input: unknown, ast: AstJsonDocument): ProvenanceSidecar {
  root(input, ['version', 'sources', 'nodes'], 'provenance sidecar')
  if (!Array.isArray(input.sources) || !Array.isArray(input.nodes)) throw new AstSidecarError('invalid provenance arrays')
  const sources = new Set<string>(), paths = new Set<string>()
  const canonical = collectNodes(ast)
  for (const source of input.sources) {
    if (!record(source) || !nonempty(source.id)) throw new AstSidecarError('invalid provenance source')
    fields(source, ['id', 'uri', 'format', 'parent'], 'provenance source')
    if (sources.has(source.id)) throw new AstSidecarError('duplicate provenance source id')
    for (const field of ['uri', 'format', 'parent']) if (source[field] !== undefined && !nonempty(source[field])) throw new AstSidecarError(`invalid source ${field}`)
    sources.add(source.id)
  }
  for (const source of input.sources as RecordValue[]) {
    if (source.parent !== undefined && (!sources.has(source.parent as string) || source.parent === source.id)) throw new AstSidecarError('invalid provenance parent')
    const visited = new Set<string>()
    let cursor: RecordValue | undefined = source
    while (cursor?.parent !== undefined) {
      if (visited.has(cursor.id as string)) throw new AstSidecarError('provenance source cycle')
      visited.add(cursor.id as string)
      cursor = (input.sources as RecordValue[]).find((item) => item.id === cursor?.parent)
    }
  }
  for (const entry of input.nodes) {
    if (!record(entry) || !nonempty(entry.source) || !sources.has(entry.source) || !['authored', 'generated'].includes(entry.origin as string)) throw new AstSidecarError('invalid node provenance')
    fields(entry, ['path', 'source', 'origin', 'startByte', 'endByte', 'step'], 'node provenance')
    nodeAt(ast, entry.path, canonical)
    if (paths.has(entry.path as string)) throw new AstSidecarError('duplicate provenance path')
    paths.add(entry.path as string)
    if ((entry.startByte === undefined) !== (entry.endByte === undefined) || (entry.startByte !== undefined && (!integer(entry.startByte) || !integer(entry.endByte) || (entry.endByte as number) < (entry.startByte as number)))) throw new AstSidecarError('invalid provenance byte range')
    if (entry.step !== undefined && !nonempty(entry.step)) throw new AstSidecarError('invalid provenance step')
  }
  return input as unknown as ProvenanceSidecar
}

export function toProvenance(ast: AstJsonDocument, sources: readonly ProvenanceSource[], nodes: readonly NodeProvenance[]): ProvenanceSidecar {
  return readProvenance({ version: 1, sources: [...sources], nodes: [...nodes] }, ast)
}

/** Record measured bytes for top-level authored blocks in one source file. */
export function toAuthoredProvenance(ast: AstJsonDocument, source: string, uri: string): ProvenanceSidecar {
  if (!nonempty(uri)) throw new AstSidecarError('source URI must be nonempty')
  const byteAt = [0]
  const encoder = new TextEncoder()
  for (const point of source) byteAt.push(byteAt[byteAt.length - 1]! + encoder.encode(point).length)
  const nodes: NodeProvenance[] = []
  for (let index = 0; index < ast.children.length; index++) {
    const child = ast.children[index]!
    const pos = child.pos
    if (pos?.file !== undefined) continue
    const start = pos?.startOffset, end = pos?.endOffset
    if (!integer(start) || !integer(end) || end < start || byteAt[end] === undefined) continue
    nodes.push({ path: `/children/${index}`, source: 's0', origin: 'authored', startByte: byteAt[start]!, endByte: byteAt[end]! })
  }
  return toProvenance(ast, [{ id: 's0', uri }], nodes)
}
