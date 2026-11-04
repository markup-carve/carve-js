import type { Document } from '../ast.js'

// Not an AST field: the lines belong to no node, and only the writer's
// "every authored line is written" guard needs them (PART 18 first wins).
const losingLines = new WeakMap<Document, ReadonlySet<number>>()

export function recordLosingFootnoteLines(doc: Document, lines: ReadonlySet<number>): void {
  if (lines.size) losingLines.set(doc, new Set(lines))
}

export function losingFootnoteLines(doc: Document): ReadonlySet<number> {
  return losingLines.get(doc) ?? new Set()
}
