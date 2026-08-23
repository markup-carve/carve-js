import type { AstJsonDocument } from './ast-json.js'
import type { ParseOptions } from './parse.js'

export interface EditorRange { start: number; end: number }
export interface EditorMappedNode extends EditorRange { path: string; type?: string }
export interface EditorChange { from: number; to: number; insert: string }
export interface EditorSnapshot {
  readonly revision: number
  readonly source: string
  readonly ast: AstJsonDocument
  /** Document-space UTF-16 ranges, ready for browser and CodeMirror APIs. */
  readonly nodes: readonly EditorMappedNode[]
}
export interface EditorUpdate extends EditorSnapshot { readonly changedPaths: readonly string[] }
export interface EditorSession {
  snapshot(): EditorSnapshot
  update(changes: readonly EditorChange[]): EditorUpdate
}

export class EditorChangeError extends RangeError {
  constructor(message: string) { super(message); this.name = 'EditorChangeError' }
}

type Positioned = { type?: unknown; pos?: { startOffset?: unknown; endOffset?: unknown } }

function codepointToUtf16(source: string): number[] {
  const result = [0]
  let utf16 = 0
  for (const point of source) { utf16 += point.length; result.push(utf16) }
  return result
}

function mappedNodes(source: string, ast: AstJsonDocument): EditorMappedNode[] {
  const offsets = codepointToUtf16(source)
  const result: EditorMappedNode[] = []
  const escape = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1')
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Positioned
    const start = node.pos?.startOffset
    const end = node.pos?.endOffset
    if (typeof start === 'number' && typeof end === 'number' && offsets[start] !== undefined && offsets[end] !== undefined) {
      result.push({ path, start: offsets[start], end: offsets[end], ...(typeof node.type === 'string' ? { type: node.type } : {}) })
    }
    if (Array.isArray(value)) value.forEach((child, index) => walk(child, `${path}/${index}`))
    else for (const [key, child] of Object.entries(value)) if (key !== 'pos') walk(child, `${path}/${escape(key)}`)
  }
  walk(ast, '')
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

function changedPaths(before: readonly EditorMappedNode[], after: readonly EditorMappedNode[]): string[] {
  const old = new Map(before.map((node) => [node.path, `${node.type ?? ''}:${node.start}:${node.end}`]))
  const next = new Map(after.map((node) => [node.path, `${node.type ?? ''}:${node.start}:${node.end}`]))
  return [...new Set([...old.keys(), ...next.keys()].filter((path) => old.get(path) !== next.get(path)))].sort()
}

/**
 * Create a source-authoritative editing session. Updates use UTF-16 offsets,
 * apply atomically, and always produce the same AST/map as a fresh parse.
 */
export function createEditorSession(
  initialSource: string,
  parseDocument: (source: string, options?: ParseOptions) => AstJsonDocument,
  options: ParseOptions = {},
): EditorSession {
  const build = (source: string, revision: number): EditorSnapshot => {
    const ast = parseDocument(source, { ...options, positions: true })
    return Object.freeze({ revision, source, ast, nodes: Object.freeze(mappedNodes(source, ast)) })
  }
  let current = build(initialSource, 0)
  return {
    snapshot: () => current,
    update(changes) {
      validateChanges(current.source, changes)
      let source = current.source
      for (let index = changes.length - 1; index >= 0; index--) {
        const change = changes[index]!
        source = source.slice(0, change.from) + change.insert + source.slice(change.to)
      }
      const next = build(source, current.revision + 1)
      const update = Object.freeze({ ...next, changedPaths: Object.freeze(changedPaths(current.nodes, next.nodes)) })
      current = next
      return update
    },
  }
}
