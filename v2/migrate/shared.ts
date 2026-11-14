import { foldLabel } from '../src/ast-attributes.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { type NodeLayout, type SourceLayout } from '../src/layout.ts'

export type Fields = Record<string, unknown>

export interface MigrationState {
  source: string | undefined
  draft: boolean
  diagnostics: Diagnostic[]
  facts: Map<Fields, Partial<NodeLayout>>
}

export function record(value: unknown): Fields | undefined {
  if (!object(value)) return undefined
  return { ...value }
}

export function object(value: unknown): value is Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function integer(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === 'number' ? value : undefined
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function nodeList(value: unknown): Fields[] {
  return list(value).filter(object)
}

export function coalesceText(node: Fields): void {
  if (!Array.isArray(node['children'])) return
  const output: Fields[] = []
  for (const child of nodeList(node['children'])) {
    const previous = output[output.length - 1]
    if (child['type'] === 'text' && previous?.['type'] === 'text' && string(child['value']) !== undefined
      && string(previous['value']) !== undefined) {
      previous['value'] = `${previous['value']}${child['value']}`
      if (object(previous['pos']) && object(child['pos'])) {
        previous['pos'] = { ...previous['pos'], endLine: child['pos']['endLine'],
          endColumn: child['pos']['endColumn'], endOffset: child['pos']['endOffset'] }
      }
    } else output.push(child)
  }
  node['children'] = output
}

export function folded(value: unknown): string | undefined {
  const label = string(value)
  return label === undefined ? undefined : foldLabel(label)
}

export function loss(state: MigrationState, path: string, message: string): void {
  state.diagnostics.push({ code: 'migration-loss', severity: 'warning', channel: 'render-loss', path, message })
}

export function fact(state: MigrationState, node: Fields, name: keyof NodeLayout, value: unknown): void {
  if (value === undefined) return
  const entry = state.facts.get(node) ?? {}
  Object.assign(entry, { [name]: value })
  state.facts.set(node, entry)
}

function endingKind(lf: boolean, cr: boolean, crlf: boolean): SourceLayout['lineEndings'] {
  if (Number(lf) + Number(cr) + Number(crlf) > 1) return 'mixed'
  if (lf) return 'lf'
  if (crlf) return 'crlf'
  if (cr) return 'cr'
  return 'none'
}

function lineEndings(source: string): SourceLayout['lineEndings'] {
  let lf = false
  let cr = false
  let crlf = false
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r' && source[i + 1] === '\n') { crlf = true; i++; continue }
    if (source[i] === '\r') cr = true
    if (source[i] === '\n') lf = true
  }
  return endingKind(lf, cr, crlf)
}

function entry(state: MigrationState, node: Fields, path: string): NodeLayout | undefined {
  const facts = state.facts.get(node)
  if (facts === undefined) return undefined
  const pos = object(node['pos']) ? node['pos'] : undefined
  const start = state.source === undefined ? 0 : integer(pos?.['startOffset']) ?? 0
  const end = state.source === undefined ? 0 : integer(pos?.['endOffset']) ?? start
  const wraps = facts.wraps?.map((wrap) => wrap.path === '$' ?
    { ...wrap, path: `${path}/children/0/children/0` } : wrap)
  return { path, startByte: start, endByte: end, ...facts, ...(wraps === undefined ? {} : { wraps }) }
}

export function makeLayout(state: MigrationState, document: unknown): SourceLayout {
  const source = state.source ?? ''
  const nodes: NodeLayout[] = []
  const visit = (node: Fields, path: string): void => {
    const value = entry(state, node, path)
    if (value !== undefined) nodes.push(value)
    for (const key of ['children', 'columns', 'pairs', 'prefix', 'suffix', 'base', 'annotation', 'title', 'short']) {
      nodeList(node[key]).forEach((child, index) => visit(child, `${path}/${key}/${index}`))
    }
    for (const key of ['caption']) {
      if (object(node[key])) visit(node[key], `${path}/${key}`)
    }
  }
  if (object(document)) visit(document, '')
  return { version: 2, encoding: 'utf-8', source, lineEndings: lineEndings(source), bom: source.startsWith('\uFEFF'), nodes }
}
