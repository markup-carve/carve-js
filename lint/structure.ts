import { forEachSlot, type Node } from '../src/ast.ts'
import { emptyMemo, readAttributeBlock } from '../src/attributes.ts'
import { isAttributeLine } from '../src/lines.ts'
import { type LintContext, type Rule } from './types.ts'
import { quotesAbove } from './ancestry.ts'
import { readPrefix } from '../src/layout-lines.ts'
import { advanceColumn } from '../src/source.ts'
import { escaped, isWord } from '../src/pair-marks.ts'

function bounds(node: Node, context: LintContext): [number, number] | null {
  if (node.pos === undefined) return null
  return [context.chars[node.pos.startOffset] ?? 0, context.chars[node.pos.endOffset] ?? context.source.length]
}

function reportNode(id: Rule['id'], node: Node, path: string, context: LintContext,
  values?: Record<string, string>, message?: number): void {
  const range = bounds(node, context)
  if (range !== null) context.report(id, range[0], range[1], path, values, message)
}

function raw(node: Node, context: LintContext): string {
  const range = bounds(node, context)
  return range === null ? '' : context.source.slice(range[0], range[1])
}

/** C2-A-084: a child of a group that carries a caption; C2-B-127: a nested figure group is a group of its own, no panel. */
function isPanel(child: Node): boolean {
  return child.type === 'table' || (child.type !== 'figure_group' && 'caption' in child && child.caption !== undefined)
}

function substitutionArrow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strike') return
  for (const child of node.children) {
    if (child.type !== 'text') continue
    const range = bounds(child, context)
    if (range === null) continue
    const source = raw(child, context)
    for (let at = source.indexOf('~>'); at >= 0; at = source.indexOf('~>', at + 2)) {
      if (!escaped(source, at)) return reportNode('deprecated-substitution-arrow', node, path, context)
    }
  }
}

function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

function bidiControl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'code_block' && node.type !== 'math') return
  if (node.type === 'text' && path.includes('/title/')
    && context.nodeTypes.get(path.slice(0, path.indexOf('/title/'))) === 'code_block') return
  const range = bounds(node, context)
  if (range === null) return
  const text = context.source.slice(range[0], range[1])
  const from = node.type === 'code_block' && context.layouts.size > 0 ? text.indexOf('\n') + 1 : 0
  for (let at = from; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (isBidiControl(code)) {
      context.report('bidi-control-in-source', range[0] + at, range[0] + at + 1, path,
        { code: code.toString(16).toUpperCase().padStart(4, '0') })
    }
  }
}

function headingLineColumn(line: LintContext['lines'][number], quotes: number, context: LintContext): number {
  const prefix = quotes === 0 ? { pos: line.start, column: 0, origin: 0 }
    : readPrefix(context.source, line.start, line.end, quotes)
  let column = prefix.column
  for (let at = prefix.pos; context.source[at] === ' ' || context.source[at] === '\t'; at++) {
    column = advanceColumn(column, context.source.charCodeAt(at))
  }
  return column - prefix.origin
}

function headingContinuation(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const first = context.lines[node.pos.startLine - 1]
  // C2-B-137: the line that continues the heading may stand below comment-only lines.
  let next = node.pos.startLine
  while (next < node.pos.endLine && context.lines[next]?.text.trimStart().startsWith('%%') === true) next++
  const second = next < node.pos.endLine ? context.lines[next] : undefined
  if (first === undefined || second === undefined) return
  const marker = context.layouts.get(path)?.markerColumn
  if (marker === undefined) return
  const quotes = quotesAbove(path, context)
  const indent = headingLineColumn(second, quotes, context)
  if (indent > marker) context.report('deprecated-indented-line-under-heading', second.start, second.end, path)
}

function hasCaptionNumber(node: Node): boolean {
  if (node.type === 'caption_number') return true
  let found = false
  forEachSlot(node, (children) => { if (children.some(hasCaptionNumber)) found = true })
  return found
}

function figurePanelNumber(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  for (let at = 0; at < node.children.length; at++) {
    const panel = node.children[at]
    if (panel === undefined || !isPanel(panel) || !('caption' in panel) || panel.caption === undefined) continue
    if (hasCaptionNumber(panel.caption)) {
      reportNode('figure-group-panel-number', panel, `${path}/children/${at}`, context)
    }
  }
}

function referencesPlacement(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'directive' || path.split('/').length <= 3) return
  if (node.kind === 'references') reportNode('references-placement-in-container', node, path, context)
}

function multilineHtmlComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'paragraph') return
  const range = bounds(node, context)
  if (range === null) return
  const source = raw(node, context)
  for (let at = source.indexOf('<!--'); at >= 0; at = source.indexOf('<!--', at + 4)) {
    const end = source.indexOf('-->', at + 4)
    if (end < 0 || !source.slice(at, end).includes('\n') || escaped(source, at)) continue
    context.report('html-comment-renders-as-text', range[0] + at, range[0] + end + 3, path)
  }
}

// carve#6176: every inline content of text, a description's through its paragraphs.
const INLINE_HOSTS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'definition_term', 'cell_paragraph'])

function unattachedInline(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const parent = path.slice(0, path.lastIndexOf('/children/'))
  if (!INLINE_HOSTS.has(context.nodeTypes.get(parent) ?? '')) return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = source.indexOf('{'); at >= 0; at = source.indexOf('{', at + 1)) {
    const end = source.indexOf('}', at + 1)
    if (at < 1 || end < 0 || escaped(source, at)) continue
    const block = source.slice(at, end + 1)
    if (isAttributeLine(block, 0, block.length)) context.report('unattached-inline-attribute',
      range[0] + at, range[0] + end + 1, path)
    at = end
  }
}

/** The 0.1.13 glued alignment prefix of a cell: a horizontal mark or `?`, then an optional vertical mark (C2-B-182). */
function oldAlignmentPrefix(source: string): string {
  const vertical = source[1] === '^' || source[1] === 'v' || source[1] === '~'
  if (source[0] === '<' || source[0] === '>' || source[0] === '~') return vertical ? source.slice(0, 2) : source[0]
  return source[0] === '?' && vertical ? source.slice(0, 2) : ''
}

/** The 0.1.13 alignment run at the start of `source`, a mark with an optional glued brace block, followed by a space. */
function oldAlignmentRun(source: string): { prefix: string, braced: string } | null {
  const mark = oldAlignmentPrefix(source)
  if (mark === '') return null
  let block = ''
  if (source[mark.length] === '{') {
    const end = source.indexOf('}', mark.length)
    if (end < 0 || source.slice(mark.length + 1, end).includes('{')) return null
    block = source.slice(mark.length + 1, end)
  }
  const prefix = block === '' && source[mark.length] !== '{' ? mark : source.slice(0, mark.length + block.length + 2)
  const after = source[prefix.length]
  if ((after !== ' ' && after !== '\t') || source.slice(prefix.length).trim() === '') return null
  return { prefix, braced: block.trim() === '' ? `{${mark}}` : `{${mark} ${block.trim()}}` }
}

/** Whether the text at `start` opens a cell: only padding and the header mark stand between it and its pipe. */
function opensCell(context: LintContext, start: number): boolean {
  let at = start - 1
  while (context.source[at] === ' ' || context.source[at] === '\t') at--
  if (context.source[at] === '=') at--
  return context.source[at] === '|'
}

function brokenCrossref(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'xref' || node.namespace !== 'heading' || node.href !== undefined) return
  context.state.crossrefs.push({ node, path })
}

function collectFragment(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link' && node.href?.startsWith('#')) context.state.fragmentLinks.push({ node, path })
}

function platformIssue(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '#' || isWord(source[at - 1]) || !isDigit(source[at + 1])) continue
    let end = at + 1
    while (isDigit(source[end])) end++
    context.report('platform-issue-reference', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function platformMention(node: Node, path: string, context: LintContext): void {
  if (node.type === 'mention') {
    reportNode('platform-mention-token', node, path, context,
      { host: 'GitHub', text: raw(node, context) })
    return
  }
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '@' || isWord(source[at - 1]) || !isWord(source[at + 1])) continue
    let end = at + 1
    while (isWord(source[end]) || source[end] === '-') end++
    context.report('platform-mention-token', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function intrawordUnderscore(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 1; at < source.length - 2; at++) {
    if (source[at] !== '_' || !isWord(source[at - 1])) continue
    const end = source.indexOf('_', at + 2)
    if (end < 0 || !isWord(source[at + 1]) || !isWord(source[end - 1]) || !isWord(source[end + 1])) continue
    context.report('djot-intraword-underscore', range[0] + at, range[0] + end + 1, path)
    at = end
  }
}

function markBeforeBrace(source: string, at: number): boolean {
  return '*_/~='.includes(source[at] ?? '') && source[at + 1] === '{' && !escaped(source, at)
}

/** Whether `source` from `start` to `end` is one attribute line; the grammar stops at the first character it cannot read. */
function attributeBlockBetween(source: string, start: number, end: number): boolean {
  const block = source.slice(start, end)
  return readAttributeBlock(block, 0, block.length, emptyMemo(), null) === block.length && isAttributeLine(block, 0, block.length)
}

function emphasisBeforeAttrs(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('{')) return
  const range = bounds(node, context)
  if (range === null) return
  // Each candidate looked for its `}` and scanned the block again, so a line of `_{` before one `}` was quadratic.
  let end = -1
  for (let at = 0; at < source.length - 2; at++) {
    const ch = source[at] ?? ''
    if (!markBeforeBrace(source, at)) continue
    if (end < at + 2) end = source.indexOf('}', at + 2)
    if (end < 0) return
    if (!attributeBlockBetween(source, at + 1, end + 1)) continue
    // C2-B-182: an alignment run that opens a cell is reported by deprecated-cell-alignment.
    if (at <= 1 && opensCell(context, range[0]) && oldAlignmentRun(source)?.prefix.length === end + 1) {
      at = end
      continue
    }
    context.report('emphasis-marker-before-attributes', range[0] + at, range[0] + end + 1,
      path, { ch }, 0)
    at = end
  }
}

function hasUnescapedMarker(source: string, marker: string, close: number): boolean {
  for (let at = 1; at < close; at++) if (source[at] === marker && !escaped(source, at)) return true
  return false
}

function spanMarkerBeforeAttrs(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strong' && node.type !== 'emphasis') return
  const source = raw(node, context)
  const marker = node.type === 'strong' ? '*' : '/'
  const attrs = /\{(?:[.#_]|[A-Za-z])[^}]*\}$/.exec(source)
  if (attrs === null) return
  const close = attrs.index - 1
  if (source[0] !== marker || source[close] !== marker || escaped(source, close)
    || !hasUnescapedMarker(source, marker, close)) return
  const range = bounds(node, context)
  if (range !== null) context.report('emphasis-marker-before-attributes', range[0] + close,
    range[0] + close + 1, path, { marker, name: node.type, line: String(node.pos?.startLine ?? 1),
      column: String(node.pos?.startColumn ?? 1) }, 1)
}

function carveVersion(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter') return
  const range = bounds(node, context)
  if (range === null) return
  const source = raw(node, context)
  for (const match of source.matchAll(/^[ \t]*(?:carve|carve-version):[ \t]*([^\s]+)[ \t]*$/gm)) {
    const version = match[1]!
    const parts = /^\d+(?:\.\d+)*$/.test(version) ? version.split('.').map(Number) : null
    if (parts !== null && parts[0] === 0 && (parts[1] ?? 0) <= 2 && parts.slice(2).every((part) => part === 0)) continue
    const start = range[0] + match.index + match[0].indexOf(version)
    context.report('carve-version-unsupported', start, start + version.length, path,
      { version: jsonText(version), SPEC_VERSION: '0.2' }, parts === null ? 0 : 1)
    return
  }
}

function commentInLabel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'line' || node.pos === undefined) return
  const line = context.lines[node.pos.startLine - 1]
  const range = bounds(node, context)
  if (line === undefined || range === null) return
  const before = context.source.slice(line.start, range[0])
  const open = before.lastIndexOf('[')
  if (open < 0 || before.indexOf(']', open) >= 0) return
  // C2-I-077: only a comment that takes the label's closer leaves the label unclosed; `[ %%` had none to take.
  if (!context.source.slice(range[0], line.end).includes(']')) return
  context.report('comment-in-reference-label', range[0], range[1], path)
}

/** A value as it stands inside a JSON string, its quotes and backslashes escaped. */
function jsonText(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

function tightBlankLine(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list' || node.spacing !== 'tight') return
  for (let at = 0; at < node.children.length; at++) {
    const item = node.children[at]
    if (item === undefined || !item.children.some((child) => child.type === 'paragraph')) continue
    for (let inner = 0; inner < item.children.length - 1; inner++) {
      const childPath = `${path}/children/${at}/children/${inner}`
      if ((context.layouts.get(childPath)?.blankLinesAfter ?? 0) > 0
        && item.children.slice(inner + 1).some((child) => child.type !== 'comment')) {
        reportNode('tight-list-item-with-blank-line', node, path, context)
        return
      }
    }
  }
}

function regionComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'line' || !/^#(?:end)?region(?![A-Za-z0-9_])/i.test(node.value)) return
  if (/^#(?:end)?region(?![A-Za-z0-9_])/.test(node.value)) return
  reportNode('region-marker-renders-as-text', node, path, context, {}, 1)
}

function unclosedBracedComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const at = source.indexOf('{%')
  const range = bounds(node, context)
  if (at < 0 || source.indexOf('%}', at + 2) >= 0 || range === null) return
  // C2-B-141: the comment is left unclosed by an interrupter line before its closer; with no closer at all nothing split it.
  if (context.source.indexOf('%}', range[1]) >= 0) context.report('unclosed-braced-comment', range[0] + at, range[1], path)
}

const OPENER_BEFORE = /[\s([{]/

function unclosedEmphasis(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('*') && !source.includes('/')) return
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length - 1; at++) {
    const ch = source[at]!
    if ((ch !== '*' && ch !== '/') || !isWord(source[at + 1]) || source[at - 1] === '{'
      || !OPENER_BEFORE.test(source[at - 1] ?? ' ')) continue
    if (source.indexOf(ch, at + 1) >= 0) continue
    context.report('unclosed-inline-emphasis', range[0] + at, range[0] + at + 1, path, { span: ch === '*' ? 'strong' : 'emphasis' })
    return
  }
}

// C2-I-079: a footnote label, a full reference's label or a definition label of only whitespace.

function sigilAfterLetter(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  if (!source.includes('@') && !source.includes('#')) return
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 1; at < source.length - 1; at++) {
    const sigil = source[at]
    if (sigil !== '@' && sigil !== '#') continue
    const before = source.charCodeAt(at - 1)
    if (before < 128 || !/[\p{L}\p{N}]/u.test(source[at - 1]!) || !isWord(source[at + 1])) continue
    const name = /^[\p{L}\p{N}_-]+/u.exec(source.slice(at + 1))?.[0] ?? ''
    if (/[\p{L}]/u.test(name)) {
      context.report('sigil-after-letter', range[0] + at, range[0] + at + 1, path)
    }
  }
}

/** C2-W-106 table: a block of an item, after its first, that starts past the marker and short of the content column. */

/** Each block of a list item, other than a paragraph, that starts past the item's content column. */

/** The marker column of the list item that holds the list at `path`, or undefined at the top of a container. */
function outerMarkerColumn(path: string, context: LintContext): number | undefined {
  const split = path.lastIndexOf('/children/')
  if (split < 0) return undefined
  const parent = path.slice(0, split)
  return context.nodeTypes.get(parent) === 'list_item' ? context.layouts.get(parent)?.markerColumn : undefined
}

/**
 * Each later item of `node` whose marker stands left of the item before it, with `between` true where it stands right of
 * the item that holds the list: C2-B-055 then read it between two open lists, and otherwise C2-B-054 left of them all.
 */
function leftMarkers(node: Node, path: string, context: LintContext,
  visit: (at: number, column: number, deeper: number, outer: number | undefined) => void): void {
  if (node.type !== 'list') return
  const outer = outerMarkerColumn(path, context)
  for (let at = 1; at < node.children.length; at++) {
    const deeper = context.layouts.get(`${path}/children/${at - 1}`)?.markerColumn
    const column = context.layouts.get(`${path}/children/${at}`)?.markerColumn
    if (deeper !== undefined && column !== undefined && column < deeper) visit(at, column, deeper, outer)
  }
}

function listMarkerBelowColumn(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  const split = path.lastIndexOf('/children/')
  const owner = path.slice(0, split)
  const index = Number(path.slice(split + '/children/'.length))
  if (context.nodeTypes.get(owner) === 'list_item' && index > 0) {
    const previous = `${owner}/children/${index - 1}`
    const outer = context.layouts.get(owner)?.markerColumn
    const deeper = context.nodeTypes.get(previous) === 'list'
      ? context.layouts.get(`${previous}/children/0`)?.markerColumn : undefined
    const column = context.layouts.get(`${path}/children/0`)?.markerColumn
    if (outer !== undefined && deeper !== undefined && column !== undefined && outer < column && column < deeper) {
      reportNode('list-marker-below-content-column', node.children[0]!, `${path}/children/0`, context,
        { column: String(column + 1), contentColumn: String(deeper + 1), baseColumn: String(outer + 1) })
    }
  }
  leftMarkers(node, path, context, (at, column, deeper, outer) => {
    const item = node.type === 'list' ? node.children[at] : undefined
    if (item === undefined || outer === undefined || column <= outer) return
    reportNode('list-marker-below-content-column', item, `${path}/children/${at}`, context,
      { column: String(column + 1), contentColumn: String(deeper + 1), baseColumn: String(outer + 1) })
  })
}

/** The whole opening mark of a block opener, as the row of `block-opener-overindented` states its range (carve#6192). */

/** Where the opening mark of a block stands: an attributed block starts at its attribute lines (C2-W-138). */

function bracedSpanAsText(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const split = path.lastIndexOf('/children/')
  if (split < 0) return
  const parent = context.nodeTypes.get(path.slice(0, split))
  if (parent !== 'strong' && parent !== 'emphasis') return
  const source = raw(node, context)
  const openers = [source.indexOf('{*'), source.indexOf('{/')].filter((at) => at >= 0)
  const at = openers.length === 0 ? -1 : Math.min(...openers)
  const range = bounds(node, context)
  const closer = source[at + 1] === '*' ? '*}' : '/}'
  const after = range === null ? '' : context.source.slice(range[0] + at + 2)
  if (at >= 0 && range !== null && after.includes(closer)) context.report('braced-span-opener-as-text', range[0] + at,
    range[0] + at + 2, path)
}

/** C2-B-030: an ordered marker left of the list's first marker that ends where the list's markers end. */
function rightAligned(node: Node, path: string, at: number, context: LintContext): boolean {
  if (node.type !== 'list' || node.marker.kind !== 'ordered' || at < 1) return false
  const first = context.layouts.get(`${path}/children/0`)
  const item = context.layouts.get(`${path}/children/${at}`)
  if (first?.markerColumn === undefined || item?.markerColumn === undefined) return false
  return first.markerColumn > item.markerColumn && first.contentColumn === item.contentColumn
}

function orderedRightAligned(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  for (let at = 1; at < node.children.length; at++) {
    if (rightAligned(node, path, at, context)) reportNode('ordered-marker-right-aligned', node.children[at]!, `${path}/children/${at}`, context)
  }
}

function unevenListIndent(node: Node, path: string, context: LintContext): void {
  leftMarkers(node, path, context, (at, column, _deeper, outer) => {
    const item = node.type === 'list' ? node.children[at] : undefined
    let footnoteColumn = 0
    for (let owner = path; owner !== ''; owner = owner.slice(0, owner.lastIndexOf('/children/'))) {
      if (context.nodeTypes.get(owner) === 'footnote') {
        footnoteColumn = context.layouts.get(owner)?.contentColumn ?? 0
        break
      }
    }
    const previous = context.layouts.get(`${path}/children/${at - 1}`)?.markerColumn ?? 0
    if (Math.max(0, column - footnoteColumn) >= Math.max(0, previous - footnoteColumn) || rightAligned(node, path, at, context)) return
    if (item !== undefined && (outer === undefined || column <= outer)) reportNode('uneven-list-indent', item, `${path}/children/${at}`, context)
  })
}

function nonDescriptiveLink(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' || node.children.length !== 1) return
  const child = node.children[0]
  if (child?.type !== 'text') return
  const value = child.value.toLowerCase().trim().replace(/\s+/g, ' ')
  if (value === 'here' || value === 'click here' || value === 'read more') {
    reportNode('non-descriptive-link-text', node, path, context)
  }
}

function unresolvedReference(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' && node.type !== 'image') return
  if (node.key === undefined) return
  const resolved = node.type === 'link' ? node.href !== undefined : node.src !== undefined
  if (resolved) return
  context.state.unresolvedReferences.push({ node, path })
}

function fragmentNames(href: string): [string, string] {
  const fragment = href.slice(1).split(':~:', 1)[0] ?? ''
  try { return [fragment, decodeURIComponent(fragment)] }
  catch { return [fragment, fragment] }
}

function brokenFragment(item: { node: Node, path: string }, context: LintContext): void {
  if (item.node.type !== 'link' || item.node.href === undefined) return
  const href = item.node.href
  const [fragment, decoded] = fragmentNames(href)
  if (fragment === '' || fragment.toLowerCase() === 'top') return
  if (context.state.ids.has(fragment) || context.state.ids.has(decoded)) return
  const caseOnly = [...context.state.ids].find((id) => id.toLowerCase() === fragment.toLowerCase()
    || id.toLowerCase() === decoded.toLowerCase())
  reportNode('broken-fragment-link', item.node, item.path, context, { href, caseOnly: caseOnly ?? '' },
    caseOnly === undefined ? 1 : 0)
}

function finishFragments(context: LintContext): void {
  if (context.options.rules?.['broken-fragment-link'] === 'off' || (context.options.extensions?.length ?? 0) > 0) return
  for (const item of context.state.fragmentLinks) brokenFragment(item, context)
}

function finishCrossrefs(context: LintContext): void {
  for (const item of context.state.crossrefs) {
    if (item.node.type !== 'xref') continue
    const target = item.node.key
    const exact = context.state.idOwners.get(target)
    if (exact !== undefined && exact !== 'heading' && exact !== 'caption') {
      reportNode('broken-crossref', item.node, item.path, context, { target, id: target, kind: exact }, 0)
      continue
    }
    const caseOnly = [...context.state.idOwners].filter(([id, type]) => (type === 'heading' || type === 'caption')
      && id.toLowerCase() === target.toLowerCase()).map(([id]) => id)
    const phrase = caseOnly.length === 1 ? `the id ${caseOnly[0]} differs only in case`
      : `the ids ${caseOnly.join(', ')} differ only in case`
    reportNode('broken-crossref', item.node, item.path, context,
      { target, caseOnlyPhrase: phrase }, caseOnly.length === 0 ? 2 : 1)
  }
}

function reportUnresolvedReference(item: { node: Node, path: string }, context: LintContext): void {
  const { node } = item
  if (node.type !== 'link' && node.type !== 'image') return
  const rawRef = context.layouts.get(item.path)?.rawRef ?? raw(node, context)
  const key = node.key ?? ''
  const matches = context.state.referenceDefinitions.filter(({ node: definition }) =>
    definition.type === 'link_reference_definition' && definition.key.toLowerCase() === key.toLowerCase())
  const headings = node.type === 'link' ? [...context.state.idOwners.keys()].filter((id) =>
    id.toLowerCase() === key.toLowerCase()) : []
  const caseOnly = [...matches.map(({ node: definition }) => definition.type === 'link_reference_definition'
    ? definition.key : ''), ...headings].filter((value) => value !== key)
  const index = node.type === 'link' ? (caseOnly.length > 0 ? 0 : 1) : (caseOnly.length > 0 ? 2 : 3)
  reportNode('unresolved-reference-link', node, item.path, context,
    { rawRef, caseOnlyPhrase: `the label ${caseOnly[0] ?? ''} differs only in case` }, index)
}

function finishReferences(context: LintContext): void {
  for (const item of context.state.unresolvedReferences) reportUnresolvedReference(item, context)
}

export function finishStructure(context: LintContext): void {
  finishFragments(context)
  finishCrossrefs(context)
  finishReferences(context)
  for (let at = context.diagnostics.length - 1; at >= 0; at--) {
    const entry = context.diagnostics[at]!
    if (entry.code !== 'platform-issue-reference' && entry.code !== 'platform-mention-token') continue
    const footnote = [...context.state.footnoteKeys].find(([path]) => entry.path?.startsWith(`${path}/`))
    if (footnote === undefined || context.state.usedFootnotes.has(footnote[1])) continue
    context.diagnostics.splice(at, 1)
    context.findingLines.splice(at, 1)
  }
}

/** C2-N-072: the attribute line above an include without `code` applies to nothing. */

/** C2-N-088: `lines` on a delimited table include counts physical lines, where `rows` counts records. */

function nodeRule(id: Rule['id'], nodes: readonly Node['type'][] , checkNode: NonNullable<Rule['checkNode']>): Rule {
  return { id, nodes, checkNode }
}

export const NODE_RULES: readonly Rule[] = [
                  nodeRule('deprecated-substitution-arrow', ['strike'], substitutionArrow),
      nodeRule('html-comment-renders-as-text', ['paragraph'], multilineHtmlComment),
  nodeRule('bidi-control-in-source', ['text', 'code', 'code_block', 'math'], bidiControl),
    nodeRule('deprecated-indented-line-under-heading', ['heading'], headingContinuation),
  nodeRule('figure-group-panel-number', ['figure_group'], figurePanelNumber),
    nodeRule('references-placement-in-container', ['directive'], referencesPlacement),
            nodeRule('unattached-inline-attribute', ['text'], unattachedInline),
          nodeRule('broken-crossref', ['xref'], brokenCrossref),
  nodeRule('broken-fragment-link', ['link'], collectFragment),
  nodeRule('platform-issue-reference', ['text'], platformIssue),
  nodeRule('platform-mention-token', ['text', 'mention'], platformMention),
  nodeRule('djot-intraword-underscore', ['text'], intrawordUnderscore),
  nodeRule('emphasis-marker-before-attributes', ['text'], emphasisBeforeAttrs),
  nodeRule('emphasis-marker-before-attributes', ['strong', 'emphasis'], spanMarkerBeforeAttrs),
  nodeRule('carve-version-unsupported', ['frontmatter'], carveVersion),
      nodeRule('comment-in-reference-label', ['comment'], commentInLabel),
  nodeRule('tight-list-item-with-blank-line', ['list'], tightBlankLine),
    nodeRule('region-marker-renders-as-text', ['comment'], regionComment),
  nodeRule('unclosed-braced-comment', ['text'], unclosedBracedComment),
  nodeRule('unclosed-inline-emphasis', ['text'], unclosedEmphasis),
  nodeRule('sigil-after-letter', ['text'], sigilAfterLetter),
      nodeRule('list-marker-below-content-column', ['list'], listMarkerBelowColumn),
    nodeRule('braced-span-opener-as-text', ['text'], bracedSpanAsText),
  nodeRule('ordered-marker-right-aligned', ['list'], orderedRightAligned),
  nodeRule('uneven-list-indent', ['list'], unevenListIndent),
  nodeRule('non-descriptive-link-text', ['link'], nonDescriptiveLink),
  nodeRule('unresolved-reference-link', ['link', 'image'], unresolvedReference),
      ]
