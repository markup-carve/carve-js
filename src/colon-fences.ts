import { parse, type UnclosedContainer } from './parse.js'

export interface ColonFenceSite {
  kind: 'div' | 'admonition' | 'line block' | 'hard-break block'
  line: number; column: number; start: number; end: number; width: number
}
export interface ColonFenceMismatch {
  opener: ColonFenceSite
  line: number; column: number; start: number; end: number
  authoredWidth: number; expectedWidth: number
  outcome: 'nested container' | 'literal text'
}

/** Inspect exact pairs and likely near closers from the parser's container tree. */
export function inspectColonFences(source: string): {
  pairs: Array<{ opener: ColonFenceSite; closer: ColonFenceSite }>
  mismatches: ColonFenceMismatch[]
} {
  const unclosed: UnclosedContainer[] = []
  const document = parse(source, { positions: true, onUnclosedContainer: (site) => unclosed.push(site) })
  const lines = source.split(/\r?\n/)
  const starts: number[] = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  const key = (line: number, column: number, width: number) => `${line}:${column}:${width}`
  const unclosedKeys = new Set(unclosed.map((site) => key(site.line, site.column, site.fenceWidth)))
  const pairs: Array<{ opener: ColonFenceSite; closer: ColonFenceSite }> = []
  const mismatches: ColonFenceMismatch[] = []

  const walk = (value: unknown, parent: ColonFenceSite | null): void => {
    if (Array.isArray(value)) { for (const child of value) walk(child, parent); return }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    const container = containerSite(node, lines, starts)
    const nextParent = container ?? parent
    if (container) {
      const authored = lineRun(lines[container.line - 1] ?? '', container.column - 1)
      if (unclosedKeys.has(key(container.line, container.column, container.width)) && authored?.bare && parent && authored.width !== parent.width) {
        mismatches.push({ opener: parent, line: container.line, column: container.column,
          start: container.start, end: container.end, authoredWidth: authored.width,
          expectedWidth: parent.width, outcome: 'nested container' })
      } else if (!unclosedKeys.has(key(container.line, container.column, container.width))) {
        const pos = node.pos as { endLine?: number; endColumn?: number } | undefined
        const closeLine = pos?.endLine ?? 0
        const closeColumn = (pos?.endColumn ?? 1) - container.width
        const close = lineRun(lines[closeLine - 1] ?? '', closeColumn - 1)
        if (close?.bare && close.width === container.width) {
          const start = (starts[closeLine - 1] ?? 0) + closeColumn - 1
          pairs.push({ opener: container, closer: { ...container, line: closeLine, column: closeColumn, start, end: start + close.width } })
        }
      }
    }
    for (const [name, child] of Object.entries(node)) if (name !== 'pos' && name !== 'attrs') walk(child, nextParent)
  }
  walk(document.children, null)
  return { pairs, mismatches }
}

function containerSite(node: Record<string, unknown>, lines: string[], starts: number[]): ColonFenceSite | null {
  const kind: ColonFenceSite['kind'] | null = node.type === 'div' ? 'div'
    : node.type === 'admonition' ? 'admonition' : node.type === 'line_block' ? 'line block'
      : node.type === 'hard_break_block' ? 'hard-break block' : null
  const pos = node.pos as { startLine?: number; startColumn?: number } | undefined
  if (!kind || !pos?.startLine || !pos.startColumn) return null
  const run = lineRun(lines[pos.startLine - 1] ?? '', pos.startColumn - 1)
  if (!run) return null
  const start = (starts[pos.startLine - 1] ?? 0) + pos.startColumn - 1
  return { kind, line: pos.startLine, column: pos.startColumn, start, end: start + run.width, width: run.width }
}

function lineRun(line: string, at: number): { width: number; bare: boolean } | null {
  const match = /^(:{3,})(.*)$/.exec(line.slice(at))
  return match ? { width: match[1]!.length, bare: /^[ \t]*$/.test(match[2]!) } : null
}
