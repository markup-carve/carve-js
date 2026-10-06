import type { AstJsonBlock, AstJsonDocument } from './ast-json.js'
import type { ParseOptions } from './parse.js'
import { astNodePaths, toNodeIdentity, type NodeIdentitySidecar } from './ast-sidecars.js'

export interface EditorRange { start: number; end: number }
export interface EditorToken extends EditorRange {
  role: 'block-marker' | 'open-marker' | 'close-marker' | 'destination' | 'attribute' | 'fence-open' | 'fence-close' | 'table-marker'
}
export interface EditorMappedNode extends EditorRange { path: string; type?: string; tokens: readonly EditorToken[] }
export interface EditorChange { from: number; to: number; insert: string }
export interface EditorSnapshot {
  readonly parsedSourceBytes: number
  readonly reusedPreviousTree: boolean
  readonly revision: number
  readonly source: string
  readonly ast: AstJsonDocument
  /** Document-space UTF-16 ranges, ready for browser and CodeMirror APIs. */
  readonly nodes: readonly EditorMappedNode[]
  readonly identity: NodeIdentitySidecar
}
export interface EditorUpdate extends EditorSnapshot { readonly changedPaths: readonly string[] }
export interface EditorSession {
  snapshot(): EditorSnapshot
  update(changes: readonly EditorChange[]): EditorUpdate
}

export class EditorChangeError extends RangeError {
  constructor(message: string) { super(message); this.name = 'EditorChangeError' }
}

type Positioned = { type?: unknown; attrs?: unknown; pos?: { startOffset?: unknown; endOffset?: unknown } }

function codepointToUtf16(source: string): number[] {
  const result = [0]
  let utf16 = 0
  for (const point of source) { utf16 += point.length; result.push(utf16) }
  return result
}

function mappedNodes(source: string, ast: AstJsonDocument): EditorMappedNode[] {
  const offsets = codepointToUtf16(source)
  const lineStarts = new Int32Array(source.length + 1)
  let lineStart = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') lineStart = i + 1
    lineStarts[i + 1] = lineStart
  }
  const result: EditorMappedNode[] = []
  const hasAttrs = new Set<string>()
  const escape = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1')
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Positioned
    const start = node.pos?.startOffset
    const end = node.pos?.endOffset
    if (typeof start === 'number' && typeof end === 'number' && offsets[start] !== undefined && offsets[end] !== undefined) {
      result.push({ path, start: offsets[start], end: offsets[end], ...(typeof node.type === 'string' ? { type: node.type } : {}), tokens: [] })
      if (node.attrs && typeof node.attrs === 'object') hasAttrs.add(path)
    }
    if (Array.isArray(value)) value.forEach((child, index) => walk(child, `${path}/${index}`))
    else for (const [key, child] of Object.entries(value)) if (key !== 'pos') walk(child, `${path}/${escape(key)}`)
  }
  walk(ast, '')
  const byPath = new Map(result.map((node) => [node.path, node]))
  const textByAncestor = new Map<string, { start: number; end: number }>()
  for (const node of result) {
    if (node.type !== 'text') continue
    let ancestor = node.path.slice(0, node.path.lastIndexOf('/'))
    while (ancestor) {
      const previous = textByAncestor.get(ancestor)
      textByAncestor.set(ancestor, previous
        ? { start: Math.min(previous.start, node.start), end: Math.max(previous.end, node.end) }
        : { start: node.start, end: node.end })
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'))
    }
  }
  for (const node of result) {
    const tokens: EditorToken[] = []
    const authored = source.slice(node.start, node.end)
    const token = (role: EditorToken['role'], start: number, end: number): void => { if (end > start) tokens.push({ role, start, end }) }
    if (node.type === 'heading') {
      const marker = /^(#{1,6})[ \t]+/.exec(authored)
      if (marker) token('block-marker', node.start, node.start + marker[0].length)
    } else if (node.type === 'list_item') {
      const content = byPath.get(`${node.path}/children/0`)
      if (content && content.start > node.start) token('block-marker', node.start, content.start)
    } else if (node.type === 'link') {
      const text = textByAncestor.get(node.path)
      if (text) {
        const { start, end } = text
        token('open-marker', node.start, start)
        const destination = /^\]\((.*)\)$/.exec(source.slice(end, node.end))
        if (destination) {
          token('close-marker', end, end + 2)
          token('destination', end + 2, node.end - 1)
          token('close-marker', node.end - 1, node.end)
        } else token('close-marker', end, node.end)
      }
    } else if (node.type === 'code_block') {
      const first = authored.indexOf('\n')
      const last = authored.lastIndexOf('\n')
      if (first >= 0 && last > first) {
        token('fence-open', node.start, node.start + first + 1)
        token('fence-close', node.start + last, node.end)
      }
    } else if (node.type === 'table_row') {
      for (let index = 0; index < authored.length; index++) if (authored[index] === '|') token('table-marker', node.start + index, node.start + index + 1)
    }
    if (hasAttrs.has(node.path)) {
      let end = node.start
      if (source[end - 1] === '\n') { end--; if (source[end - 1] === '\r') end-- }
      else if (source[end - 1] === '\r') end--
      const lineStart = lineStarts[end]!
      const line = source.slice(lineStart, end)
      if (/^\{[^\r\n]+\}$/.test(line)) token('attribute', lineStart, lineStart + line.length)
    }
    node.tokens = Object.freeze(tokens.sort((a, b) => a.start - b.start || a.end - b.end))
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function scalarBoundary(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return true
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
}

function validateChanges(source: string, changes: readonly EditorChange[]): void {
  let previousEnd = 0
  changes.forEach((change, index) => {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to < change.from || change.to > source.length) {
      throw new EditorChangeError(`change ${index} has an invalid range`)
    }
    if (index > 0 && change.from < previousEnd) throw new EditorChangeError(`change ${index} overlaps or is out of order`)
    if (!scalarBoundary(source, change.from) || !scalarBoundary(source, change.to)) throw new EditorChangeError(`change ${index} splits a Unicode scalar`)
    previousEnd = change.to
  })
}

function nodeSignatures(ast: AstJsonDocument): Map<string, string> {
  const paths = new Set(astNodePaths(ast))
  const signatures = new Map<string, string>()
  const visit = (value: unknown, path: string): unknown => {
    if (!value || typeof value !== 'object') return value
    const reduced = Array.isArray(value)
      ? value.map((child, index) => visit(child, `${path}/${index}`))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)]))
    if (!paths.has(path)) return reduced
    signatures.set(path, JSON.stringify(reduced))
    return { type: (value as { type: string }).type }
  }
  visit(ast, '')
  return signatures
}

function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const changed = new Set<string>()
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue
    let ancestor = path
    while (true) {
      if (changed.has(ancestor)) break
      if (before.has(ancestor) || after.has(ancestor)) changed.add(ancestor)
      if (ancestor === '') break
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'))
    }
  }
  return [...changed].sort()
}

function reusableParagraphs(source: string, ast: AstJsonDocument): boolean {
  return /^[\p{L}\p{N}\p{M} .,!?\n]*$/u.test(source) && ast.children.length > 0 && ast.children.every(block =>
    block.type === 'paragraph' && !block.attrs && block.pos?.startColumn === 1 && block.pos.startLine === block.pos.endLine &&
    typeof block.pos.startOffset === 'number' && typeof block.pos.endOffset === 'number' &&
    block.children.every(inline => inline.type === 'text' && typeof inline.pos?.startOffset === 'number' && typeof inline.pos?.endOffset === 'number'))
}

function shiftParagraph(block: AstJsonBlock, offset: number, lines: number): void {
  if (block.type !== 'paragraph') return
  for (const node of [block, ...block.children]) {
    if (node.pos && node.pos.startOffset !== undefined && node.pos.endOffset !== undefined) {
      node.pos.startOffset += offset; node.pos.endOffset += offset
      node.pos.startLine += lines; node.pos.endLine += lines
    }
  }
}

function freezeAst(ast: AstJsonDocument): void {
  const pending: object[] = [ast]
  while (pending.length) {
    const value = pending.pop()!
    if (Object.isFrozen(value)) continue
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child)
    Object.freeze(value)
  }
}

function reparseParagraph(
  source: string, previous: EditorSnapshot, changes: readonly EditorChange[],
  parseDocument: (source: string) => AstJsonDocument,
): AstJsonDocument | undefined {
  if (!reusableParagraphs(previous.source, previous.ast)) return undefined
  if (!changes.length) return previous.ast
  if (changes.length !== 1) return undefined
  const change = changes[0]!
  if (!/^[\p{L}\p{N}\p{M} .,!?]*$/u.test(change.insert) || change.insert.includes('\n')) return undefined
  const offsets = codepointToUtf16(previous.source)
  for (const [index, block] of previous.ast.children.entries()) {
    if (block.type !== 'paragraph' || !block.pos || block.pos.startOffset === undefined || block.pos.endOffset === undefined) return undefined
    const start = offsets[block.pos.startOffset]!, end = offsets[block.pos.endOffset]!
    if (change.from < start || change.to > end) continue
    const fragment = previous.source.slice(start, change.from) + change.insert + previous.source.slice(change.to, end)
    if (!fragment || fragment.includes('\n') || fragment.startsWith(' ') || fragment.endsWith(' ')) return undefined
    const replacement = parseDocument(fragment)
    if (replacement.children.length !== 1 || !reusableParagraphs(fragment, replacement)) return undefined
    const delta = [...fragment].length - (block.pos.endOffset - block.pos.startOffset)
    const children = [...previous.ast.children]
    const edited = replacement.children[0]!
    shiftParagraph(edited, block.pos.startOffset, block.pos.startLine - 1)
    children[index] = edited
    for (let following = index + 1; following < children.length; following++) {
      children[following] = structuredClone(children[following]!)
      shiftParagraph(children[following]!, delta, 0)
    }
    return { ...previous.ast, children, srcByteLength: new TextEncoder().encode(source).length }
  }
  return undefined
}

/**
 * Create a source-authoritative editing session. Updates use UTF-16 offsets,
 * apply atomically, and always produce the same AST/map as a fresh parse.
 */
export function createEditorSession(
  initialSource: string,
  parseDocument: (source: string, options?: ParseOptions) => AstJsonDocument,
  options: ParseOptions = {},
  allowParagraphReuse = false,
): EditorSession {
  const session = globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}-${(++sessionCounter).toString(36)}`
  let nextId = 0
  const build = (source: string, revision: number, previous?: EditorSnapshot, changes: readonly EditorChange[] = []): EditorSnapshot => {
    let parsedSourceBytes = 0
    const parse = (text: string): AstJsonDocument => {
      parsedSourceBytes += new TextEncoder().encode(text).length
      return parseDocument(text, { ...options, positions: true })
    }
    const incremental = allowParagraphReuse && previous && !options.extensions?.length && !options.onUnclosedContainer
      ? reparseParagraph(source, previous, changes, parse) : undefined
    const ast = incremental ?? parse(source)
    const reusedPreviousTree = incremental !== undefined && (changes.length === 0 || ast.children.length > 1)
    if (allowParagraphReuse) freezeAst(ast)
    const nodes = Object.freeze(mappedNodes(source, ast))
    const ids = new Map<string, string>()
    if (previous) {
      ids.set('', previous.identity.nodes.find((entry) => entry.path === '')!.id)
      const oldIds = new Map(previous.identity.nodes.map((entry) => [entry.path, entry.id]))
      const candidates = new Map<string, EditorMappedNode[]>()
      for (const node of nodes) {
        const key = `${node.type ?? ''}:${node.start}:${node.end}`
        const bucket = candidates.get(key) ?? []
        bucket.push(node)
        candidates.set(key, bucket)
      }
      for (const old of previous.nodes) {
        if (old.path === '') continue
        let delta = 0, touched = false
        for (const change of changes) {
          if (change.to <= old.start) delta += change.insert.length - (change.to - change.from)
          else if (change.from < old.end) { touched = true; break }
        }
        if (touched) continue
        const start = old.start + delta, end = old.end + delta
        const matches = candidates.get(`${old.type ?? ''}:${start}:${end}`) ?? []
        if (matches.length !== 1 || previous.source.slice(old.start, old.end) !== source.slice(start, end)) continue
        const id = oldIds.get(old.path)
        if (id && !ids.has(matches[0]!.path)) ids.set(matches[0]!.path, id)
      }
    }
    for (const path of astNodePaths(ast)) if (!ids.has(path)) ids.set(path, `n${nextId++}`)
    const identity = toNodeIdentity(ast, session, ids)
    return Object.freeze({ revision, source, ast, nodes, identity, parsedSourceBytes, reusedPreviousTree })
  }
  let current = build(initialSource, 0)
  let signatures = nodeSignatures(current.ast)
  return {
    snapshot: () => current,
    update(changes) {
      validateChanges(current.source, changes)
      let source = current.source
      for (let index = changes.length - 1; index >= 0; index--) {
        const change = changes[index]!
        source = source.slice(0, change.from) + change.insert + source.slice(change.to)
      }
      const next = build(source, current.revision + 1, current, changes)
      const nextSignatures = nodeSignatures(next.ast)
      const update = Object.freeze({ ...next, changedPaths: Object.freeze(changedPaths(signatures, nextSignatures)) })
      signatures = nextSignatures
      current = next
      return update
    },
  }
}

let sessionCounter = 0
