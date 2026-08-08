import type { AstJsonDocument } from './ast-json.js'

export interface SourceLayoutNode {
  path: string
  startByte: number
  endByte: number
}

export interface SourceLayout {
  version: 1
  encoding: 'utf-8'
  source: string
  lineEndings: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed'
  bom: boolean
  nodes: SourceLayoutNode[]
}

type Positioned = { pos?: { startOffset?: number; endOffset?: number } }

/** Build the optional PART 12 §13 sidecar without changing the AST payload. */
export function toSourceLayout(source: string, ast: AstJsonDocument): SourceLayout {
  const points = [...source]
  const byteAt = (offset: number): number => new TextEncoder().encode(points.slice(0, offset).join('')).length
  const nodes: SourceLayoutNode[] = []
  const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')
  const walk = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return
    const positioned = value as Positioned
    const start = positioned.pos?.startOffset
    const end = positioned.pos?.endOffset
    if (Number.isInteger(start) && Number.isInteger(end)) {
      nodes.push({ path, startByte: byteAt(start!), endByte: byteAt(end!) })
    }
    if (Array.isArray(value)) value.forEach((child, index) => walk(child, `${path}/${index}`))
    else Object.entries(value).forEach(([key, child]) => {
      if (key !== 'pos') walk(child, `${path}/${escape(key)}`)
    })
  }
  walk(ast, '')
  nodes.sort((a, b) => a.path.localeCompare(b.path))
  const endings = source.match(/\r\n|\r|\n/g) ?? []
  const kinds = new Set(endings.map((x) => x === '\r\n' ? 'crlf' : x === '\r' ? 'cr' : 'lf'))
  const lineEndings = kinds.size === 0 ? 'none' : kinds.size > 1 ? 'mixed' : [...kinds][0]!
  return { version: 1, encoding: 'utf-8', source, lineEndings, bom: source.startsWith('\uFEFF'), nodes }
}
