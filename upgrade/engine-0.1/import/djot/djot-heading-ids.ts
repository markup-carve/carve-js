import { parse } from '../../parse.js'
import { inlineText, resolveHeadingIds, slugify } from '../../heading/heading-ids.js'
import { forEachChildBlockList } from '../../parse/block/block-children.js'
import type { BlockNode, Heading } from '../../ast.js'

function headings(blocks: BlockNode[]): Heading[] {
  const result: Heading[] = []
  const visit = (children: BlockNode[]): void => {
    for (const block of children) {
      if (block.type === 'heading') result.push(block)
      forEachChildBlockList(block, visit)
    }
  }
  visit(blocks)
  return result
}

/** Keep Djot's first collision suffix (1) when Carve would assign 2. */
export function preserveDjotHeadingIds(source: string): string {
  const doc = parse(source, { positions: true })
  const candidates = headings(doc.children)
  if (candidates.length < 2 && !source.includes('{#') && !source.includes('{id=')) return source
  const explicit: Array<{ at: number; id: string }> = []
  const seen = new Set<object>()
  const collect = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) { for (const child of value) collect(child); return }
    const node = value as Record<string, unknown>
    const id = (node.attrs as { id?: string } | undefined)?.id
    const at = (node.pos as { startOffset?: number } | undefined)?.startOffset
    if (id !== undefined && at !== undefined) explicit.push({ at, id })
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'attrs' && key !== 'pos') collect(child)
    }
  }
  collect(doc)
  explicit.sort((a, b) => a.at - b.at)
  const occupied = new Set<string>()
  const nextSuffix = new Map<string, number>()
  let nextExplicit = 0
  const actual = headings(resolveHeadingIds(parse(source)).children)
  const edits: Array<{ at: number; text: string }> = []
  for (let i = 0; i < candidates.length; i++) {
    const heading = candidates[i]!
    const at = heading.pos?.startOffset
    while (nextExplicit < explicit.length && explicit[nextExplicit]!.at <= (at ?? Infinity)) {
      occupied.add(explicit[nextExplicit++]!.id)
    }
    if (heading.attrs?.id !== undefined) continue
    const base = slugify(inlineText(heading.children))
    let id = base
    let suffix = nextSuffix.get(base) ?? 1
    while (occupied.has(id)) id = `${base}-${suffix++}`
    nextSuffix.set(base, suffix)
    occupied.add(id)
    if (actual[i]?.attrs?.id === id || at === undefined) continue
    const lineStart = source.lastIndexOf('\n', at - 1) + 1
    const prefix = source.slice(lineStart, at)
    const continuation = prefix.replace(/(?:[-+*]|\d+[.)])(?=[ \t]*$)/, marker => ' '.repeat(marker.length))
    edits.push({ at, text: `{#${id}}\n${continuation}` })
  }
  if (edits.length === 0) return source
  const chunks: string[] = []
  let cursor = 0
  for (const edit of edits) {
    chunks.push(source.slice(cursor, edit.at), edit.text)
    cursor = edit.at
  }
  chunks.push(source.slice(cursor))
  return chunks.join('')
}
