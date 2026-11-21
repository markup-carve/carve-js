/** U-423 to U-425: source forms of 0.1 host extensions, when the caller names those hosts. */
import map from '../../data/upgrade-map.json' with { type: 'json' }
import { carveToHtml, parse as parseOld, semanticSpan as oldSemanticSpan, wikilinks as oldWikilinks } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { wikilinks } from '../../extensions/inline/wikilinks.ts'
import { semanticSpan } from '../../extensions/inline/semantic-span.ts'
import { withExtensions } from '../../src/extensions/standard/bundle.ts'
import { compareHtmlExact } from './compare.ts'
import { applyEdits, selectEdits, type Edit } from './edits.ts'
import { type Node01 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineOf, readLines } from './source.ts'

export type RegisteredExtension = 'wikilinks' | 'samp'

const meaning = new Map(map.source.filter(row => ['U-423', 'U-424', 'U-425'].includes(row.id))
  .map(row => [row.id, row.meaning02]))

function walk(node: Node01, found: Node01[]): void {
  if (node.pos !== undefined) found.push(node)
  for (const value of Object.values(node)) {
    if (!Array.isArray(value)) continue
    for (const item of value as unknown[]) {
      if (item !== null && typeof item === 'object' && 'type' in item && typeof item.type === 'string') {
        walk(item as Node01, found)
      }
    }
  }
}

// The form-specific predicates below keep unrelated host and core nodes out of the rewrite.
// eslint-disable-next-line complexity
export function respellExtensions(source: string, registered: readonly RegisteredExtension[]): {
  output: string, records: ReportRecord[]
} {
  if (registered.length === 0) return { output: source, records: [] }
  const old = registered.flatMap(name => name === 'wikilinks' ? [oldWikilinks()] : [oldSemanticSpan()])
  const nodes: Node01[] = []
  walk(parseOld(source, { positions: true, extensions: old }) as Node01, nodes)
  const edits: Edit[] = []
  const records: ReportRecord[] = []
  const lines = readLines(source)
  for (const node of nodes) {
    const start = node.pos!.startOffset
    const end = node.pos!.endOffset
    const original = source.slice(start, end)
    let id: string | undefined
    let text: string | undefined
    if (registered.includes('wikilinks') && node.type === 'link' && original.startsWith('[[') && original.endsWith(']]')) {
      id = original.includes('|') ? 'U-424' : 'U-423'
      text = `:wiki[${original.slice(2, -2)}]`
    } else if (registered.includes('samp') && node.type === 'inline_extension' && node.name === 'samp'
      && original.startsWith(':samp[') && original.endsWith(']')) {
      id = 'U-425'
      text = `[${original.slice(6, -1)}]{samp}`
    }
    if (id === undefined || text === undefined) continue
    edits.push({ start, end, text, entry: id, sequence: edits.length })
    records.push(recordOf(id, lineOf(lines, start), meaning.get(id) ?? 'standard extension source respelled'))
  }
  return { output: applyEdits(source, selectEdits(edits)), records }
}

/** Both registered default hosts render the old and new source alike. */
export function sameExtensionHosts(old: string, next: string, registered: readonly RegisteredExtension[]): boolean {
  const oldHosts = registered.map(name => name === 'wikilinks' ? oldWikilinks() : oldSemanticSpan())
  const newHosts = registered.map(name => name === 'wikilinks' ? wikilinks() : semanticSpan())
  try {
    return compareHtmlExact(carveToHtml(old, { extensions: oldHosts }),
      render(next, withExtensions(...newHosts))).equal
  } catch { return false }
}
