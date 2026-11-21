/* eslint-disable complexity, sonarjs/cognitive-complexity -- preserve the 0.1 editor session's mapping and atomic update behavior */
import type { DocumentNode } from './ast.ts'
import type { ParseOptions } from './options.ts'
import { parse } from './api.ts'
import { utf8Length } from './positions.ts'
import { NODE_TABLE } from './ast-validate.ts'

const INLINE_TYPES: ReadonlySet<string> = new Set(NODE_TABLE.INLINES)

type AstJsonDocument = DocumentNode
type AstJsonBlock = DocumentNode['children'][number]
export interface NodeIdentitySidecar { version: 1; session: string; nodes: { id: string; path: string }[] }
const astNodePaths = (ast: DocumentNode): string[] => {
  const paths: string[] = []
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return
    if ('type' in value && typeof value.type === 'string') paths.push(path)
    for (const [key, child] of Object.entries(value)) {
      if (key === 'pos' || key === 'segments') continue
      if (Array.isArray(child)) child.forEach((item, index) => visit(item, `${path}/${key}/${index}`))
      else if (child && typeof child === 'object') visit(child, `${path}/${key}`)
    }
  }
  visit(ast, '')
  return paths
}
const nodeIdentityForPaths = (paths: readonly string[], session: string, ids: ReadonlyMap<string, string>): NodeIdentitySidecar => ({
  version: 1, session, nodes: paths.map(path => ({ id: ids.get(path)!, path })),
})

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

function byteToUtf16(source: string): Uint32Array {
  const result = new Uint32Array(utf8Length(source) + 1)
  let byte = 0
  for (let at = 0; at < source.length;) {
    const point = String.fromCodePoint(source.codePointAt(at)!)
    const length = utf8Length(point)
    result.fill(at, byte, byte + length)
    byte += length
    at += point.length
  }
  result[byte] = source.length
  return result
}

function mappedNodes(source: string, ast: AstJsonDocument): EditorMappedNode[] {
  const offsets = byteToUtf16(source)
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
      result.push({ path, start: offsets[start], end: offsets[end],
        ...(typeof node.type === 'string' ? { type: node.type } : {}), tokens: [] })
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
  const cellsByRow = new Map<string, EditorRange[]>()
  for (const node of result) {
    if (node.type !== 'table_cell') continue
    const row = node.path.slice(0, node.path.lastIndexOf('/children/'))
    const cells = cellsByRow.get(row)
    if (cells) cells.push(node)
    else cellsByRow.set(row, [node])
  }
  for (const node of result) {
    const tokens: EditorToken[] = []
    const token = (role: EditorToken['role'], start: number, end: number): void => { if (end > start) tokens.push({ role, start, end }) }
    // The attribute lines above a block lie inside its range; the block's own markers start behind them.
    let contentStart = node.start
    if (hasAttrs.has(node.path) && !INLINE_TYPES.has(node.type ?? '')) {
      // An attribute line is followed by the rest of its block, so the last line of the range never is one.
      for (let line = attributeLine(source, contentStart); line !== null && line.next < node.end;) {
        token('attribute', contentStart, line.end)
        contentStart = line.next
        line = attributeLine(source, contentStart)
      }
    }
    const authored = source.slice(contentStart, node.end)
    if (node.type === 'heading') {
      const marker = /^([ \t]*)(?:={1,6}|#{1,6})[ \t]+/.exec(authored)
      if (marker) token('block-marker', contentStart + marker[1]!.length, contentStart + marker[0].length)
    } else if (node.type === 'list_item') {
      const content = byPath.get(`${node.path}/children/0`)
      if (content && content.start > contentStart) token('block-marker', contentStart, content.start)
    } else if (node.type === 'link') {
      const text = textByAncestor.get(node.path)
      if (text) {
        const { start, end } = text
        token('open-marker', node.start, start)
        const tail = source.slice(end, node.end)
        if (tail.startsWith('](') && tail.endsWith(')')) {
          token('close-marker', end, end + 2)
          token('destination', end + 2, end + 2 + destinationLength(tail.slice(2, -1)))
          token('close-marker', node.end - 1, node.end)
        } else token('close-marker', end, node.end)
      }
    } else if (node.type === 'code_block') {
      const first = authored.indexOf('\n')
      const last = authored.lastIndexOf('\n')
      if (first >= 0) token('fence-open', contentStart, contentStart + first + 1)
      const closer = first >= 0 ? /`{3,}[ \t]*$/.exec(authored.slice(last + 1)) : null
      if (closer) token('fence-close', contentStart + last + 1 + closer.index, node.end)
    } else if (node.type === 'table_row') {
      const cells = (cellsByRow.get(node.path) ?? []).sort((a, b) => a.start - b.start)
      let cell = 0
      for (let index = contentStart; index < node.end; index++) {
        while (cell < cells.length && cells[cell]!.end <= index) cell++
        const inCell = cell < cells.length && cells[cell]!.start <= index
        if (source[index] === '|' && !inCell) token('table-marker', index, index + 1)
      }
    }
    if (hasAttrs.has(node.path) && contentStart === node.start) {
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

/** The attribute line `{...}` that starts at `start`: where its text ends and where the next line starts. */
function attributeLine(source: string, start: number): { end: number; next: number } | null {
  if (source[start] !== '{' || source[start + 1] === '{') return null
  let end = start
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end++
  if (end === start || source[end - 1] !== '}' || end >= source.length) return null
  return { end, next: end + (source.startsWith('\r\n', end) ? 2 : 1) }
}

/** The length of the destination at the start of the inside of `(...)`: up to a space or tab outside parentheses. */
function destinationLength(inside: string): number {
  if (inside.startsWith('<')) {
    const close = inside.indexOf('>')
    return close < 0 ? inside.length : close + 1
  }
  let depth = 0
  for (let at = 0; at < inside.length; at++) {
    const char = inside[at]
    if (char === '\\') at++
    else if (char === '(') depth++
    else if (char === ')') depth--
    else if (depth === 0 && (char === ' ' || char === '\t' || char === '\n' || char === '\r')) return at
  }
  return inside.length
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
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to < change.from ||
      change.to > source.length) {
      throw new EditorChangeError(`change ${index} has an invalid range`)
    }
    if (index > 0 && change.from < previousEnd) throw new EditorChangeError(`change ${index} overlaps or is out of order`)
    if (!scalarBoundary(source, change.from) || !scalarBoundary(source, change.to)) {
      throw new EditorChangeError(`change ${index} splits a Unicode scalar`)
    }
    previousEnd = change.to
  })
}

function nodeSignatures(ast: AstJsonDocument, nodePaths: readonly string[]): Map<string, string> {
  const paths = new Set(nodePaths)
  const signatures = new Map<string, string>()
  const visit = (value: unknown, path: string): unknown => {
    if (!value || typeof value !== 'object') return value
    const reduced = Array.isArray(value)
      ? value.map((child, index) => visit(child, `${path}/${index}`))
      : Object.fromEntries(Object.entries(value).map(([key, child]) =>
        [key, visit(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`)]))
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
    block.children.every(inline => inline.type === 'text' && typeof inline.pos?.startOffset === 'number' &&
      typeof inline.pos?.endOffset === 'number'))
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
    for (const child of Object.values(value) as unknown[]) if (child && typeof child === 'object') pending.push(child)
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
  const offsets = byteToUtf16(previous.source)
  for (const [index, block] of previous.ast.children.entries()) {
    if (block.type !== 'paragraph' || !block.pos || block.pos.startOffset === undefined ||
      block.pos.endOffset === undefined) return undefined
    const start = offsets[block.pos.startOffset]!, end = offsets[block.pos.endOffset]!
    if (change.from < start || change.to > end) continue
    const fragment = previous.source.slice(start, change.from) + change.insert + previous.source.slice(change.to, end)
    if (!fragment || fragment.includes('\n') || fragment.startsWith(' ') || fragment.endsWith(' ')) return undefined
    const replacement = parseDocument(fragment)
    if (replacement.children.length !== 1 || !reusableParagraphs(fragment, replacement)) return undefined
    const delta = utf8Length(fragment) - (block.pos.endOffset - block.pos.startOffset)
    const children = [...previous.ast.children]
    const edited = replacement.children[0]!
    shiftParagraph(edited, block.pos.startOffset, block.pos.startLine - 1)
    children[index] = edited
    for (let following = index + 1; following < children.length; following++) {
      const paragraph = children[following]!
      if (paragraph.type !== 'paragraph') return undefined
      children[following] = {
        ...paragraph,
        pos: { ...paragraph.pos!, startOffset: paragraph.pos!.startOffset + delta, endOffset: paragraph.pos!.endOffset + delta },
        children: paragraph.children.map(inline => ({
          ...inline,
          pos: { ...inline.pos!, startOffset: inline.pos!.startOffset + delta, endOffset: inline.pos!.endOffset + delta },
        })),
      }
    }
    return { ...previous.ast, children, srcByteLength: utf8Length(source) }
  }
  return undefined
}

/**
 * Create a source-authoritative editing session. Updates use UTF-16 offsets,
 * apply atomically, and always produce the same AST/map as a fresh parse.
 */
export function createEditorSessionInternal(
  initialSource: string,
  parseDocument: (source: string, options?: ParseOptions) => AstJsonDocument,
  options: ParseOptions = {},
  allowParagraphReuse = false,
): EditorSession {
  const session = globalThis.crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}-${(++sessionCounter).toString(36)}`
  let nextId = 0
  const pathsByAst = new WeakMap<AstJsonDocument, readonly string[]>()
  const build = (source: string, revision: number, previous?: EditorSnapshot, changes: readonly EditorChange[] = []): EditorSnapshot => {
    let parsedSourceBytes = 0
    const parse = (text: string): AstJsonDocument => {
      parsedSourceBytes += new TextEncoder().encode(text).length
      return parseDocument(text, { ...options, positions: true })
    }
    const incremental = allowParagraphReuse && previous && !options.extensions?.length && !options.includes
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
      const deltas = [0]
      for (const change of changes) deltas.push(deltas.at(-1)! + change.insert.length - (change.to - change.from))
      for (const old of previous.nodes) {
        if (old.path === '') continue
        let low = 0, high = changes.length
        while (low < high) {
          const mid = (low + high) >> 1
          if (changes[mid]!.to <= old.start) low = mid + 1
          else high = mid
        }
        if (low < changes.length && changes[low]!.from < old.end) continue
        const delta = deltas[low]!
        const start = old.start + delta, end = old.end + delta
        const matches = candidates.get(`${old.type ?? ''}:${start}:${end}`) ?? []
        if (matches.length !== 1) continue
        const id = oldIds.get(old.path)
        if (id && !ids.has(matches[0]!.path)) ids.set(matches[0]!.path, id)
      }
    }
    const paths = astNodePaths(ast)
    pathsByAst.set(ast, paths)
    for (const path of paths) if (!ids.has(path)) ids.set(path, `n${nextId++}`)
    const identity = nodeIdentityForPaths(paths, session, ids)
    return Object.freeze({ revision, source, ast, nodes, identity, parsedSourceBytes, reusedPreviousTree })
  }
  let current = build(initialSource, 0)
  let signatures: Map<string, string> | null = nodeSignatures(current.ast, pathsByAst.get(current.ast)!)
  return {
    snapshot: () => current,
    update(changes) {
      validateChanges(current.source, changes)
      const parts: string[] = []
      let cursor = 0
      for (const change of changes) {
        parts.push(current.source.slice(cursor, change.from), change.insert)
        cursor = change.to
      }
      parts.push(current.source.slice(cursor))
      const source = parts.join('')
      if (source === current.source) {
        const unchanged = Object.freeze({ ...current, revision: current.revision + 1, parsedSourceBytes: 0,
          reusedPreviousTree: true, changedPaths: Object.freeze([] as string[]) })
        current = unchanged
        return unchanged
      }
      const next = build(source, current.revision + 1, current, changes)
      let paths: string[]
      if (next.reusedPreviousTree && changes.length === 1) {
        const at = changes[0]!.from
        const edited = current.nodes.find(node => /^\/children\/\d+$/u.test(node.path) && node.start <= at && at <= node.end)
        const index = edited === undefined ? -1 : Number(edited.path.slice('/children/'.length))
        const delta = source.length - current.source.length
        paths = index < 0 ? [''] : ['', ...pathsByAst.get(next.ast)!.filter(path => {
          const match = /^\/children\/(\d+)(?:\/|$)/u.exec(path)
          return match !== null && (Number(match[1]) === index || (delta !== 0 && Number(match[1]) > index))
        })]
        signatures = null
      } else {
        const nextSignatures = nodeSignatures(next.ast, pathsByAst.get(next.ast)!)
        paths = changedPaths(signatures ?? nodeSignatures(current.ast, pathsByAst.get(current.ast)!), nextSignatures)
        signatures = nextSignatures
      }
      const update = Object.freeze({ ...next, changedPaths: Object.freeze(paths.sort()) })
      current = next
      return update
    },
  }
}

let sessionCounter = 0

/** Create a source-authoritative editor session backed by the 0.2 parser. */
export function createEditorSession(source: string, options: ParseOptions = {}): EditorSession {
  return createEditorSessionInternal(source, (text, parseOptions) => parse(text, parseOptions), options, true)
}
