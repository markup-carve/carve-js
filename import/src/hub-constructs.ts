// The preserved-construct record of a hub import: what the library read in the caller's input, and whether the
// imported tree holds it. Ranges are UTF-8 bytes of the input, as the importer's own findings count them (C2-M-081).
import type { Event } from 'micromark-util-types'
import type { DocumentNode } from '../../src/index.ts'
import { byteOffsetTable, type ImportDiagnostic } from './kit.ts'

/** One construct of the input; `status` is `preserved` when the tree is shown to hold it, `unverified` otherwise. */
export interface ImportConstruct {
  /** The construct as the source library names it: a micromark token type or a djot.js node tag. */
  construct: string
  /** The Carve node type the construct imports as. */
  node: string
  status: 'preserved' | 'unverified'
  range: { startOffset: number, endOffset: number }
}

interface Found { construct: string, node: string, start: number, end: number }

/** micromark token types (CommonMark, GFM, math, frontmatter) and the node each one imports as. */
const MARKDOWN_NODES: Readonly<Record<string, string>> = {
  atxHeading: 'heading', setextHeading: 'heading', blockQuote: 'block_quote', listOrdered: 'list', listUnordered: 'list',
  codeFenced: 'code_block', codeIndented: 'code_block', thematicBreak: 'thematic_break', htmlFlow: 'raw_block',
  table: 'table', mathFlow: 'math', gfmFootnoteDefinition: 'footnote', yaml: 'frontmatter', toml: 'frontmatter',
  strong: 'strong', emphasis: 'emphasis', strikethrough: 'delete', codeText: 'code', link: 'link', image: 'image',
  autolink: 'link', literalAutolink: 'link', hardBreakEscape: 'hard_break', hardBreakTrailing: 'hard_break',
  htmlText: 'raw_inline', mathText: 'math', gfmFootnoteCall: 'footnote_ref',
}

/** djot.js node tags and the node each one imports as. */
const DJOT_NODES: Readonly<Record<string, string>> = {
  heading: 'heading', block_quote: 'block_quote', bullet_list: 'list', ordered_list: 'list', task_list: 'list',
  definition_list: 'definition_list', code_block: 'code_block', thematic_break: 'thematic_break', raw_block: 'raw_block',
  table: 'table', div: 'div', footnote: 'footnote',
  strong: 'strong', emph: 'emphasis', delete: 'delete', insert: 'insert', mark: 'highlight', superscript: 'superscript',
  subscript: 'subscript', verbatim: 'code', link: 'link', image: 'image', url: 'link', email: 'link', span: 'span',
  hard_break: 'hard_break', inline_math: 'math', display_math: 'math', raw_inline: 'raw_inline',
  footnote_reference: 'footnote_ref',
}

/** The HTML elements a node type is read from; a finding on one of them leaves the node type unverified. */
const NODE_ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  admonition: ['blockquote'], heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], block_quote: ['blockquote'], list: ['ul', 'ol', 'li', 'input'],
  definition_list: ['dl', 'dt', 'dd'], code_block: ['pre'], thematic_break: ['hr'],
  table: ['table', 'thead', 'tbody', 'tr', 'th', 'td'], div: ['div'], footnote: ['section'], strong: ['strong'],
  emphasis: ['em'], delete: ['del'], insert: ['ins'], highlight: ['mark'], superscript: ['sup'], subscript: ['sub'],
  code: ['code'], link: ['a'], image: ['img'], span: ['span'], hard_break: ['br'], footnote_ref: ['a', 'sup'],
}

const ALERT = /^>[ \t]?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|\r|$)/u

/** The constructs micromark entered, from the events the hub compiles anyway. */
export function markdownConstructs(events: readonly Event[], input: string, alerts: boolean): Found[] {
  const found: Found[] = []
  for (const [kind, token] of events) {
    if (kind !== 'enter') continue
    const type = token.type
    let node = MARKDOWN_NODES[type]
    if (node === undefined) continue
    // A GFM alert is an admonition; a wrong guess only leaves both types unverified.
    if (alerts && type === 'blockQuote' && ALERT.test(input.slice(token.start.offset, token.end.offset))) node = 'admonition'
    found.push({ construct: type, node, start: token.start.offset, end: token.end.offset })
  }
  return found
}

interface DjotPos { start: { offset: number }, end: { offset: number } }

function djotConstruct(value: object, inputLength: number): Found | undefined {
  const tag: unknown = Reflect.get(value, 'tag')
  const pos = Reflect.get(value, 'pos') as DjotPos | undefined
  if (pos === undefined) return undefined
  // Cleared, not deleted: a delete leaves each node in slow dictionary mode for the renderer.
  Reflect.set(value, 'pos', undefined)
  const node = typeof tag === 'string' ? DJOT_NODES[tag] : undefined
  if (node === undefined || typeof tag !== 'string') return undefined
  return { construct: tag, node, start: pos.start.offset, end: Math.min(pos.end.offset + 1, inputLength) }
}

/**
 * The constructs of a djot.js tree parsed with source positions, which are removed: the renderer would write them as
 * attributes. djot.js ends a range at its last character.
 */
export function djotConstructs(root: object, inputLength: number): Found[] {
  const found: Found[] = []
  const footnotes: unknown = Reflect.get(root, 'footnotes')
  const notes = footnotes !== null && typeof footnotes === 'object' ? Object.values(footnotes) as unknown[] : []
  // Walked last: the tree comes out in input order, and only notes, which may stand anywhere, need the sort.
  const pending: unknown[] = [...notes.reverse(), root]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object') continue
    const children: unknown = Reflect.get(value, 'children')
    if (Array.isArray(children)) for (let index = children.length - 1; index >= 0; index--) pending.push(children[index])
    const entry = djotConstruct(value, inputLength)
    if (entry !== undefined) found.push(entry)
  }
  return notes.length === 0 ? found : found.sort((a, b) => a.start - b.start || b.end - a.end)
}

function countNodes(document: DocumentNode): Map<string, number> {
  const counts = new Map<string, number>()
  const pending: unknown[] = [document]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) { pending.push(...(value as unknown[])); continue }
    const type: unknown = Reflect.get(value, 'type')
    if (typeof type === 'string') counts.set(type, (counts.get(type) ?? 0) + 1)
    for (const [key, child] of Object.entries(value)) if (key !== 'data' && key !== 'attrs') pending.push(child)
  }
  return counts
}

/**
 * A node type counts as preserved when the tree holds one node of it for each construct that imports as it and no
 * finding names an element it is read from. The check is per type, so a construct lost anywhere leaves every
 * construct of its type unverified rather than claiming the wrong one.
 */
export function constructRecords(input: string, found: readonly Found[], document: DocumentNode,
  diagnostics: readonly ImportDiagnostic[]): ImportConstruct[] {
  if (found.length === 0) return []
  const expected = new Map<string, number>()
  for (const entry of found) expected.set(entry.node, (expected.get(entry.node) ?? 0) + 1)
  const counts = countNodes(document)
  const flagged = new Set(diagnostics.flatMap(entry => entry.foreignType === undefined ? [] : [entry.foreignType]))
  const verified = new Set<string>()
  for (const [node, count] of expected) {
    if (counts.get(node) === count && !(NODE_ELEMENTS[node] ?? []).some(element => flagged.has(element))) verified.add(node)
  }
  const bytes = byteOffsetTable(input)
  const at = (offset: number): number => bytes[Math.min(Math.max(offset, 0), input.length)] ?? 0
  return found.map(entry => ({ construct: entry.construct, node: entry.node,
    status: verified.has(entry.node) ? 'preserved' : 'unverified',
    range: { startOffset: at(entry.start), endOffset: at(entry.end) } }))
}
