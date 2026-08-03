import type { Document } from './ast.js'

/**
 * Child-bearing fields, the same set the serializer walks.
 *
 * Kept local rather than imported so this pass does not depend on the
 * serializer: it exists to make the RUNTIME tree right, and the serializer is
 * only where the breach happened to be measured.
 */
const CHILD_FIELDS = ['children', 'items', 'rows', 'cells', 'inline', 'content', 'caption', 'title']

/**
 * Join adjacent `text` nodes everywhere in a resolved document (PART 12 §1a).
 *
 * `parse()` already returns a coalesced tree. `resolve()` then RE-SPLITS runs:
 * an unresolved reference degrades to text and a nested autolink is unwrapped
 * inside its link label, and neither rejoins the text around it. Since the CLI
 * and every `carveToAstJson` caller resolve, that re-split shape is the one
 * consumers actually receive - so §1a was satisfied at parse and broken by the
 * stage after it (carve-js#549).
 *
 * A merged run keeps its span only where the pieces are CONTIGUOUS in the
 * source. Where they are not - the unwrapped autolink leaves the `<` and `>`
 * behind - the joined value is not a slice of the source at any offset, and §4
 * rates a span that selects the wrong text as worse than none.
 *
 * `escaped_text` is a different type and never merges in: an escape is authored
 * form and §5 keeps the two apart on purpose.
 */
export function coalesceTextRuns(doc: Document): Document {
  visit(doc as unknown as Record<string, unknown>)
  for (const blocks of Object.values(doc.footnoteDefs ?? {})) {
    for (const block of blocks) visit(block as unknown as Record<string, unknown>)
  }
  return doc
}

function visit(node: Record<string, unknown> | null | undefined): void {
  if (!node || typeof node !== 'object') return
  for (const field of CHILD_FIELDS) {
    const value = node[field]
    if (!Array.isArray(value)) continue
    for (const child of value) visit(child as Record<string, unknown>)
    const merged = mergeRun(value as Array<Record<string, unknown>>)
    if (merged !== null) node[field] = merged
  }
}

/** The merged list, or null when there was nothing adjacent to merge. */
function mergeRun(
  nodes: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | null {
  let adjacent = false
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i - 1]?.['type'] === 'text' && nodes[i]?.['type'] === 'text') {
      adjacent = true
      break
    }
  }
  if (!adjacent) return null

  // Parts are collected and joined ONCE per run. Appending to the previous
  // node's value as the run grows is quadratic in the run's total bytes, and
  // this pass runs inside `resolve()` - so `carveToHtml` on a pathological
  // document (a thousand unclosed `{` openers, which is what the far-brace
  // perf guard feeds) pays that cost on every render.
  const out: Array<Record<string, unknown>> = []
  let run: Record<string, unknown> | null = null
  let parts: string[] = []
  let pos: unknown

  const flush = (): void => {
    if (run === null) return
    if (parts.length > 1) {
      run['value'] = parts.join('')
      run['pos'] = pos
    }
    out.push(run)
    run = null
    parts = []
    pos = undefined
  }

  for (const node of nodes) {
    if (node?.['type'] === 'text') {
      if (run === null) {
        run = node
        parts = [String(node['value'] ?? '')]
        pos = node['pos']
        continue
      }
      parts.push(String(node['value'] ?? ''))
      pos = joinPos(pos, node['pos'])
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

function joinPos(left: unknown, right: unknown): unknown {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return undefined
  const a = left as Record<string, number>
  const b = right as Record<string, number>
  if (a['endOffset'] !== b['startOffset']) return undefined
  return {
    ...a,
    endLine: b['endLine'],
    endColumn: b['endColumn'],
    endOffset: b['endOffset'],
  }
}
