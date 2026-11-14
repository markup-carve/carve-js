import { type Node } from '../src/ast.ts'
import { type LintContext, type Rule } from './types.ts'

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

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))
}

function paired(text: string, mark: string, visit: (start: number, end: number) => void): void {
  let at = 0
  while (at < text.length) {
    const start = text.indexOf(mark, at)
    if (start < 0) return
    const end = text.indexOf(mark, start + mark.length + 1)
    if (end < 0) return
    const before = text[start - 1]
    const after = text[end + mark.length]
    const inside = text.slice(start + mark.length, end)
    if (before !== '\\' && inside[0] !== mark[0] && inside.at(-1) !== mark[0] &&
      inside.trim() === inside && inside !== '' && !isWord(before) && !isWord(after)) {
      visit(start, end + mark.length)
    }
    at = end + mark.length
  }
}

function textPair(mark: string, id: Rule['id']): (node: Node, path: string, context: LintContext) => void {
  return (node, path, context) => checkTextPair(node, path, context, mark, id)
}

function checkTextPair(node: Node, path: string, context: LintContext, mark: string, id: Rule['id']): void {
  if (node.type !== 'text') return
  const range = bounds(node, context)
  if (range === null) return
  const text = context.source.slice(range[0], range[1])
  paired(text, mark, (start, end) => context.report(id, range[0] + start, range[0] + end, path))
}

function imageAlt(node: Node, path: string, context: LintContext): void {
  if (node.type === 'image' && node.alt === '' && node.decorative !== true) {
    reportNode('a11y/image-alt', node, path, context)
  }
}

function emptyDestination(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link' && node.href === '') reportNode('empty-link-destination', node, path, context)
}

function looseAttribute(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  if (node.attrs?.keyValues?.some(([key]) => key === 'loose')) reportNode('deprecated-loose-attribute', node, path, context)
}

function tableAttribute(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table' || context.layouts.get(path)?.sourceFormat !== 'pipe') return
  if (attributeValue(node, context, 'header-rows') !== undefined) {
    reportNode('deprecated-table-attribute', node, path, context)
  }
}

function attributeValue(node: Node, context: LintContext, key: string): string | undefined {
  if (node.pos === undefined) return undefined
  const line = context.lines[node.pos.startLine - 1]?.text.trim()
  if (line === undefined || !line.startsWith('{') || !line.endsWith('}')) return undefined
  const at = line.indexOf(key)
  if (at < 0 || (at > 0 && line[at - 1] !== '{' && line[at - 1] !== ' ')) return undefined
  const equals = at + key.length
  if (line[equals] !== '=') return ''
  return readAttributeValue(line, equals + 1)
}

function readAttributeValue(line: string, offset: number): string {
  let end = offset
  const quoted = line[end] === '"'
  if (quoted) end++
  const start = end
  while (end < line.length && line[end] !== (quoted ? '"' : ' ') && line[end] !== '}') end++
  return line.slice(start, end)
}

function headingLevel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const previous = context.state.headingLevel
  if (previous > 0 && node.level > previous + 1) {
    reportNode('heading-level-skip', node, path, context, { previous: String(previous), level: String(node.level) })
  }
  context.state.headingLevel = node.level
}

function headingKind(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const source = raw(node, context)
  const kind = source.trimStart()[0]
  if (kind === '#' || kind === '=') {
    context.state.headingKinds.add(kind)
    if (context.state.headingKinds.size === 2 && !context.state.mixedReported) {
      reportNode('heading-marker-mixed', node, path, context)
      context.state.mixedReported = true
    }
  }
}

function headingClosing(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const source = raw(node, context)
  const end = source.trimEnd()
  const hash = end.lastIndexOf(' #')
  if (hash >= 0 && isHashRun(end.slice(hash + 1))) {
    const range = bounds(node, context)
    if (range !== null) context.report('heading-closing-hashes', range[0] + hash + 1, range[0] + end.length,
      path, { run: end.slice(hash + 1) })
  }
}

function headingTrailing(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading') return
  const end = raw(node, context).trimEnd()
  const brace = end.lastIndexOf(' {')
  if (brace >= 0 && end.endsWith('}')) {
    const block = end.slice(brace + 1)
    const range = bounds(node, context)
    if (range !== null) context.report('heading-trailing-attribute', range[0] + brace + 1, range[0] + end.length,
      path, { block })
  }
}

function isHashRun(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) if (ch !== '#') return false
  return true
}

function duplicateReferenceUrl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link_reference_definition') return
  if (context.state.referenceUrls.has(node.href)) reportNode('duplicate-reference-url', node, path, context)
  else context.state.referenceUrls.add(node.href)
}

function separatorRow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_row' || node.children.length === 0) return
  const line = raw(node, context).trim()
  if (!line.startsWith('|') || !line.endsWith('|')) return
  const cells = line.slice(1, -1).split('|')
  if (cells.length < 1 || !cells.every(isSeparatorCell)) return
  reportNode('deprecated-separator-row', node, path, context)
}

function isSeparatorCell(value: string): boolean {
  const text = value.trim()
  if (text.length < 3) return false
  let hyphens = 0
  for (const ch of text) {
    if (ch === '-') hyphens++
    else if (ch !== ':') return false
  }
  return hyphens >= 3
}

function tableRows(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  let width = -1
  for (let outer = 0; outer < node.children.length; outer++) {
    const section = node.children[outer]
    if (section?.type !== 'table_head' && section?.type !== 'table_body' && section?.type !== 'table_foot') continue
    for (let inner = 0; inner < section.children.length; inner++) {
      const row = section.children[inner]
      if (row?.type !== 'table_row') continue
      if (width < 0) width = row.children.length
      else if (row.children.length !== width) {
        reportNode('table-row-cell-count', row, `${path}/children/${outer}/children/${inner}`, context,
          { cells: String(row.children.length), width: String(width) })
      }
    }
  }
}

function panelCount(node: Node): number {
  if (node.type !== 'figure_group') return 0
  return node.children.filter((child) => child.type === 'figure' || ('caption' in child && child.caption !== undefined)).length
}

function figureEmpty(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  if (panelCount(node) === 0) reportNode('figure-group-empty', node, path, context)
}

function figureSingle(node: Node, path: string, context: LintContext): void {
  if (node.type === 'figure_group' && panelCount(node) === 1) reportNode('figure-group-single-panel', node, path, context)
}

function substitutionArrow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strike' || !raw(node, context).includes('~>')) return
  reportNode('deprecated-substitution-arrow', node, path, context)
}

function frontmatterBreak(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter') return
  const value = node.value.trim()
  if (value === '' || !value.includes(':')) reportNode('frontmatter-shaped-thematic-break', node, path, context)
}

function bidiControl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'code_block') return
  const range = bounds(node, context)
  if (range === null) return
  const text = context.source.slice(range[0], range[1])
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      context.report('bidi-control-in-source', range[0] + at, range[0] + at + 1, path,
        { code: code.toString(16).toUpperCase().padStart(4, '0') })
    }
  }
}

function multilineTerm(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'definition_term' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const line = context.lines[node.pos.startLine]
  if (line !== undefined) context.report('description-term-multi-line', line.start, line.end, path)
}

function headingContinuation(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'heading' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const first = context.lines[node.pos.startLine - 1]
  const second = context.lines[node.pos.startLine]
  if (first === undefined || second === undefined) return
  const marker = first.text.trimStart()
  let width = 0
  while (marker[width] === '#' || marker[width] === '=') width++
  let indent = 0
  while (second.text[indent] === ' ') indent++
  if (indent > width) context.report('deprecated-indented-line-under-heading', second.start, second.end, path)
}

function figureNested(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  const split = path.lastIndexOf('/children/')
  if (split >= 0 && context.nodeTypes.get(path.slice(0, split)) === 'figure_group') {
    reportNode('figure-group-nested', node, path, context)
  }
}

function figurePanelNumber(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'figure_group') return
  for (let at = 0; at < node.children.length; at++) {
    const panel = node.children[at]
    if (panel === undefined || !('caption' in panel) || panel.caption === undefined) continue
    if (raw(panel.caption, context).includes('#')) {
      reportNode('figure-group-panel-number', panel.caption, `${path}/children/${at}/caption`, context)
    }
  }
}

function footnotePlacement(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'directive' || path.split('/').length <= 3) return
  if (node.kind === 'footnotes') reportNode('footnotes-placement-in-container', node, path, context)
}

function referencesPlacement(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'directive' || path.split('/').length <= 3) return
  if (node.kind === 'references') reportNode('references-placement-in-container', node, path, context)
}

function semanticOutside(node: Node, path: string, context: LintContext): void {
  if (node.type === 'span') return
  for (const [name, value] of node.attrs?.keyValues ?? []) {
    if (name === 'abbr' || name === 'dfn' || name === 'time' || name === 'mark') {
      reportNode('semantic-attribute-outside-span', node, path, context, { name, type: node.type, value })
    }
  }
}

function semanticValue(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'span') return
  for (const [name, value] of node.attrs?.keyValues ?? []) {
    if (value !== '' && (name === 'mark' || name === 'kbd' || name === 'samp')) {
      reportNode('semantic-attribute-value-ignored', node, path, context, { name })
    }
  }
}

function tableColumnArity(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  for (const key of ['aligns', 'widths']) {
    const value = attributeValue(node, context, key)
    if (value === undefined) continue
    const count = value.split(',').length
    if (count < node.columns.length) reportNode('table-column-arity', node, path, context,
      { key, count: String(count), widest: String(node.columns.length) })
  }
}

function tableWidth(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  let total = 0
  for (const column of node.columns) total += column.width ?? 0
  if (total > 1) reportNode('table-width-total', node, path, context)
}

function rowAttributeCell(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_row') return
  const source = raw(node, context)
  const last = source.lastIndexOf('|')
  const before = source.lastIndexOf('|', last - 1)
  if (last < 0 || before < 0) return
  const cell = source.slice(before + 1, last).trim()
  if (cell.startsWith('{') && cell.endsWith('}')) reportNode('table-row-attribute-as-cell', node, path, context)
}

function emphasizedHeading(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'paragraph' || node.children.length !== 1 || node.children[0]?.type !== 'emphasis') return
  reportNode('emphasis-as-heading', node, path, context)
}

function commentEmphasis(node: Node, path: string, context: LintContext): void {
  if (node.type === 'emphasis' && raw(node, context).startsWith('/*') && raw(node, context).endsWith('*/')) {
    reportNode('comment-shaped-emphasis', node, path, context)
  }
}

function globStrong(node: Node, path: string, context: LintContext): void {
  if (node.type === 'strong' && raw(node, context).includes('*.' )) reportNode('glob-shaped-strong', node, path, context)
}

function djotBracedStrike(node: Node, path: string, context: LintContext): void {
  if (node.type === 'strike' && raw(node, context).startsWith('{~')) {
    reportNode('djot-subscript-tilde-braced', node, path, context)
  }
}

function djotBracedHighlight(node: Node, path: string, context: LintContext): void {
  if (node.type === 'highlight' && raw(node, context).startsWith('{=')) {
    reportNode('djot-highlight-braces', node, path, context)
  }
}

function unattachedInline(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const at = source.indexOf('{.')
  if (at < 1) return
  const end = source.indexOf('}', at + 2)
  const range = bounds(node, context)
  if (end > at && range !== null) context.report('unattached-inline-attribute', range[0] + at,
    range[0] + end + 1, path)
}

function deprecatedCellAlignment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell') return
  const source = raw(node, context).trimStart()
  const prefix = source[0]
  if (prefix !== '<' && prefix !== '>' && prefix !== '~') return
  if (source[1] !== ' ' && source[1] !== '\t') return
  if (source.slice(1).trim() === '') return
  reportNode('deprecated-cell-alignment', node, path, context, { prefix, braced: `{${prefix}}` })
}

function markerRunPadding(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell') return
  const source = raw(node, context).trimStart()
  if (!source.startsWith('{')) return
  const close = source.indexOf('}')
  const marker = source[close + 1]
  if (close < 2 || marker === undefined || !'<>~'.includes(marker)) return
  const block = source.slice(0, close + 1)
  reportNode('table-marker-run-padding', node, path, context,
    { spelling: block + marker, marker, block })
}

function fenceCloserIndent(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'code_block' || node.pos === undefined || node.pos.endLine <= node.pos.startLine) return
  const first = context.lines[node.pos.startLine - 1]
  const last = context.lines[node.pos.endLine - 1]
  if (first === undefined || last === undefined) return
  const opener = first.text.indexOf('```')
  const closer = last.text.indexOf('```')
  if (opener < 0 || closer < 0 || opener === closer) return
  if (!last.text.slice(closer).startsWith('```')) return
  context.report('fence-closer-indented', last.start + closer, last.end, path)
}

function indentation(text: string): number {
  let at = 0
  while (text[at] === ' ' || text[at] === '\t') at++
  return at < text.length ? at : -1
}

function figureOpenerMetadata(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'div' || !node.attrs?.classes?.includes('figure')) return
  const first = context.lines[node.pos?.startLine === undefined ? 0 : node.pos.startLine - 1]
  if (first === undefined || !first.text.trimStart().startsWith('::: figure ')) return
  if (first.text.includes('"') || first.text.includes('[')) {
    context.report('figure-group-opener-metadata', first.start, first.end, path)
  }
}

function commentInLineBlock(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'line' || !raw(node, context).trimStart().startsWith('%%')) return
  reportNode('comment-line-in-line-block', node, path, context)
}

function brokenCrossref(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'xref' || node.namespace !== 'heading' || node.href !== undefined) return
  reportNode('broken-crossref', node, path, context, { target: node.key }, 2)
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
      { host: 'GitHub', what: 'a mention token', text: raw(node, context) })
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
      { host: 'GitHub', what: 'a mention token', text: source.slice(at, end) })
    at = end - 1
  }
}

function delimitedWideRow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  const format = context.layouts.get(path)?.sourceFormat
  if (format !== 'csv' && format !== 'tsv') return
  const state = { width: -1, records: 0 }
  for (let sectionIndex = 0; sectionIndex < node.children.length; sectionIndex++) {
    const section = node.children[sectionIndex]
    if (section !== undefined) checkWideSection(section, sectionIndex, path, context, state, node.pos?.startLine ?? 1)
  }
}

function checkWideSection(section: Node, index: number, path: string, context: LintContext,
  state: { width: number, records: number }, firstLine: number): void {
  if (section.type !== 'table_body' && section.type !== 'table_head' && section.type !== 'table_foot') return
  for (let rowIndex = 0; rowIndex < section.children.length; rowIndex++) {
    const row = section.children[rowIndex]
    if (row?.type !== 'table_row') continue
    if (state.width < 0) state.width = row.children.length
    else if (row.children.length > state.width) {
      const line = context.lines[firstLine + 1 + state.records]
      if (line !== undefined) context.report('delimited-table-wide-row', line.start, line.end,
        `${path}/children/${index}/children/${rowIndex}`)
    }
    state.records++
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
    if (end < 0 || !isWord(source[end + 1])) continue
    context.report('djot-intraword-underscore', range[0] + at, range[0] + end + 1, path)
    at = end
  }
}

function emphasisBeforeAttrs(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length - 2; at++) {
    const ch = source[at]
    if ((ch !== '*' && ch !== '/') || source[at + 1] !== '{') continue
    const end = source.indexOf('}', at + 2)
    if (end < 0) continue
    context.report('emphasis-marker-before-attributes', range[0] + at, range[0] + end + 1,
      path, { ch }, 0)
    at = end
  }
}

function carveVersion(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'frontmatter') return
  for (const line of node.value.split('\n')) {
    if (!line.startsWith('carve:')) continue
    const version = line.slice(6).trim()
    if (version === '' || version === '0.2' || version === '0.2.0') return
    reportNode('carve-version-unsupported', node, path, context, { version, SPEC_VERSION: '0.2' },
      version.startsWith('0.') ? 0 : 1)
    return
  }
}

function commentFenceCloserText(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'block' || node.pos === undefined) return
  const opener = context.lines[node.pos.startLine - 1]?.text.trimStart() ?? ''
  let width = 0
  while (opener[width] === '%') width++
  if (width < 3) return
  for (let lineNumber = node.pos.startLine + 1; lineNumber <= node.pos.endLine; lineNumber++) {
    const line = context.lines[lineNumber - 1]
    if (line === undefined) continue
    const text = line.text.trimStart()
    let run = 0
    while (text[run] === '%') run++
    if (run >= width && text.slice(run).trim() !== '') {
      context.report('comment-fence-closer-with-text', line.start, line.end, path)
    }
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
  context.report('comment-in-reference-label', line.start + open, range[1], path)
}

function footnoteWhitespace(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'footnote') return
  const source = raw(node, context)
  const close = source.indexOf(']')
  if (!source.startsWith('[^') || close < 0) return
  const label = source.slice(2, close)
  const twin = context.state.footnoteLabels.get(node.key)
  if (twin !== undefined && twin !== label) {
    reportNode('footnote-labels-differ-only-in-whitespace', node, path, context,
      { label, twin, key: node.key })
  } else if (twin === undefined) context.state.footnoteLabels.set(node.key, label)
}

function tableColumnOverlap(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table' || attributeValue(node, context, 'aligns') === undefined) return
  const head = node.children.find((child) => child.type === 'table_head')
  const first = head?.type === 'table_head' ? head.children.find((child) => child.type === 'table_row') : undefined
  if (first?.type !== 'table_row') return
  for (let at = 0; at < node.columns.length; at++) {
    if (node.columns[at]?.authored === true && first.children[at]?.align !== undefined) {
      reportNode('table-column-overlap', node, path, context, { n: String(at + 1) })
    }
  }
}

function tightBlankLine(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list' || node.spacing !== 'tight') return
  for (let at = 0; at < node.children.length; at++) {
    const item = node.children[at]
    if (item === undefined) continue
    for (let inner = 0; inner < item.children.length - 1; inner++) {
      const child = item.children[inner]
      const childPath = `${path}/children/${at}/children/${inner}`
      if (child?.type === 'paragraph' && (context.layouts.get(childPath)?.blankLinesAfter ?? 0) > 0) {
        reportNode('tight-list-item-with-blank-line', child, childPath, context)
      }
    }
  }
}

function templateComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'braced') return
  const source = raw(node, context)
  const content = source.startsWith('{%') ? source.slice(2).trimStart() : ''
  if (['if ', 'for ', 'endif', 'endfor', 'assign ', 'set ', 'include '].some((word) => content.startsWith(word))) {
    reportNode('braced-comment-in-a-template-source', node, path, context)
  }
}

function unclosedBracedComment(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const at = source.indexOf('{%')
  const range = bounds(node, context)
  if (at >= 0 && source.indexOf('%}', at + 2) < 0 && range !== null) {
    context.report('unclosed-braced-comment', range[0] + at, range[1], path)
  }
}

function unclosedEmphasis(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length - 1; at++) {
    if (source[at] !== '*' || !isWord(source[at + 1]) || isWord(source[at - 1])) continue
    if (source.indexOf('*', at + 1) >= 0) continue
    context.report('unclosed-inline-emphasis', range[0] + at, range[0] + at + 1, path)
    return
  }
}

function orderedKindSplit(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'document') return
  for (let at = 1; at < node.children.length; at++) {
    const before = node.children[at - 1]
    const after = node.children[at]
    if (before?.type !== 'list' || after?.type !== 'list' || before.children.length !== 1) continue
    if (before.marker.style === 'i' && after.marker.style === 'a') {
      reportNode('ordered-list-kind-split', after, `${path}/children/${at}`, context)
    }
  }
}

function sigilAfterLetter(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 1; at < source.length - 1; at++) {
    const sigil = source[at]
    if (sigil !== '@' && sigil !== '#') continue
    const before = source.charCodeAt(at - 1)
    if (!(isWord(source[at - 1]) || before >= 128) || !isWord(source[at + 1])) continue
    if (sigil !== '#' || !isDigit(source[at + 1])) {
      context.report('sigil-after-letter', range[0] + at, range[0] + at + 1, path)
    }
  }
}

function listItemBodyColumn(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list_item' || node.pos === undefined) return
  const layout = context.layouts.get(path)
  const marker = layout?.markerColumn
  const content = layout?.contentColumn
  if (marker === undefined || content === undefined) return
  for (let lineNumber = node.pos.startLine + 1; lineNumber <= node.pos.endLine; lineNumber++) {
    const line = context.lines[lineNumber - 1]
    const previous = context.lines[lineNumber - 2]
    if (line === undefined || previous?.text.trim() !== '') continue
    const indent = indentation(line.text)
    if (indent > marker && indent < content) {
      context.report('list-item-body-below-content-column', line.start + indent, line.end, path)
    }
  }
}

function listItemBlockIndent(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list_item') return
  const content = context.layouts.get(path)?.contentColumn
  if (content === undefined) return
  for (let at = 0; at < node.children.length; at++) {
    const child = node.children[at]
    if (child === undefined || child.type === 'paragraph' || child.pos === undefined) continue
    const line = context.lines[child.pos.startLine - 1]
    if (line === undefined) continue
    const indent = indentation(line.text)
    if (indent > content) context.report('list-item-block-overindented', line.start + indent, line.end,
      `${path}/children/${at}`, { contentColumn: String(content + 1) })
  }
}

function listMarkerBelowColumn(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  const split = path.lastIndexOf('/children/')
  if (split < 0) return
  const parent = path.slice(0, split)
  if (context.nodeTypes.get(parent) !== 'list_item') return
  const outer = context.layouts.get(parent)
  const first = context.layouts.get(`${path}/children/0`)
  const marker = first?.markerColumn
  const base = outer?.markerColumn
  const content = outer?.contentColumn
  if (marker === undefined || base === undefined || content === undefined) return
  if (marker > base && marker < content) reportNode('list-marker-below-content-column', node, path, context,
    { column: String(marker + 1), contentColumn: String(content + 1), baseColumn: String(base + 1) })
}

function blockOverindent(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list_item') return
  const content = context.layouts.get(path)?.contentColumn
  if (content === undefined) return
  for (let at = 0; at < node.children.length; at++) {
    const child = node.children[at]
    if (child === undefined || child.type === 'paragraph' || child.pos === undefined) continue
    const line = context.lines[child.pos.startLine - 1]
    if (line === undefined) continue
    const indent = indentation(line.text)
    if (indent <= content) continue
    const kind = child.type.replaceAll('_', ' ')
    context.report('block-opener-overindented', line.start + indent, line.end, `${path}/children/${at}`,
      { kind, past: String(indent - content), owner: 'list item' })
  }
}

function bracedSpanAsText(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const split = path.lastIndexOf('/children/')
  if (split < 0) return
  const parent = context.nodeTypes.get(path.slice(0, split))
  if (parent !== 'strong' && parent !== 'emphasis') return
  const source = raw(node, context)
  const at = source.indexOf(parent === 'strong' ? '{*' : '{/')
  const range = bounds(node, context)
  if (at >= 0 && range !== null) context.report('braced-span-opener-as-text', range[0] + at,
    range[0] + at + 2, path)
}

function colonFenceMismatch(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'div' && node.type !== 'admonition' && node.type !== 'figure_group') return
  const layout = context.layouts.get(path)
  const opener = layout?.openerRaw
  const closer = layout?.closerRaw
  if (opener === undefined || closer === undefined || opener.length === closer.length || node.pos === undefined) return
  if (!allColons(opener) || !allColons(closer)) return
  const endLine = context.lines[node.pos.endLine - 1]
  if (endLine === undefined) return
  if (endLine.text.trim() !== closer) return
  context.report('colon-fence-length-mismatch', endLine.start, endLine.end, path,
    { authoredWidth: String(closer.length), expectedWidth: String(opener.length), kind: node.type.replaceAll('_', ' '),
      line: String(node.pos.startLine), column: String(node.pos.startColumn), outcome: 'closes the container' })
}

function allColons(value: string): boolean {
  if (value.length < 3) return false
  for (const ch of value) if (ch !== ':') return false
  return true
}

function consumedNearMiss(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table') return
  for (const [word] of node.attrs?.keyValues ?? []) {
    const key = word === 'align' ? 'aligns' : word === 'width' ? 'widths' : undefined
    if (key !== undefined) reportNode('consumed-key-near-miss', node, path, context, { word, key })
  }
}

function orderedRightAligned(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list' || node.marker.kind !== 'ordered' || node.children.length < 2) return
  const first = context.layouts.get(`${path}/children/0`)
  const second = context.layouts.get(`${path}/children/1`)
  if (first?.markerColumn === undefined || second?.markerColumn === undefined) return
  if (first.markerColumn > second.markerColumn && first.contentColumn === second.contentColumn) {
    reportNode('ordered-marker-right-aligned', node.children[0]!, `${path}/children/0`, context)
  }
}

function spanMarkerBlocked(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'table_cell' || node.span !== undefined) return
  const marker = raw(node, context).trim()
  if (marker !== '<' && marker !== '^') return
  const reason = marker === '<' ? 'There is no cell to the left.' : 'There is no cell above, or the head boundary blocks it.'
  reportNode('table-span-marker-blocked', node, path, context, { marker, reason })
}

function unevenListIndent(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'list') return
  for (let at = 1; at < node.children.length; at++) {
    const first = context.layouts.get(`${path}/children/${at - 1}`)
    const next = context.layouts.get(`${path}/children/${at}`)
    if (first?.markerColumn !== undefined && next?.markerColumn !== undefined && next.markerColumn < first.markerColumn) {
      const item = node.children[at]
      if (item !== undefined) reportNode('uneven-list-indent', item, `${path}/children/${at}`, context)
    }
  }
}

function nonDescriptiveLink(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' || node.children.length !== 1) return
  const child = node.children[0]
  if (child?.type !== 'text') return
  const value = child.value.toLowerCase().trim()
  if (value === 'here' || value === 'click here' || value === 'read more') {
    reportNode('non-descriptive-link-text', node, path, context)
  }
}

function unresolvedReference(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' && node.type !== 'image') return
  if (node.key === undefined) return
  const resolved = node.type === 'link' ? node.href !== undefined : node.src !== undefined
  if (resolved) return
  const rawRef = context.layouts.get(path)?.rawRef ?? raw(node, context)
  const message = node.type === 'link' ? 1 : 3
  reportNode('unresolved-reference-link', node, path, context, { rawRef }, message)
}

function unusedReference(node: Node, path: string, context: LintContext): void {
  if (node.type === 'link_reference_definition') context.state.referenceDefinitions.push({ node, path })
  else if ((node.type === 'link' || node.type === 'image') && node.key !== undefined) {
    context.state.usedReferences.add(node.key)
  }
}

function unresolvedFootnote(node: Node, path: string, context: LintContext): void {
  if (node.type === 'footnote_ref' && node.number === undefined) {
    reportNode('unresolved-footnote', node, path, context, { id: node.key })
  }
}

function unusedFootnote(node: Node, path: string, context: LintContext): void {
  if (node.type === 'footnote') context.state.footnoteDefinitions.push({ node, path })
  else if (node.type === 'footnote_ref') context.state.usedFootnotes.add(node.key)
}

function finishFragments(context: LintContext): void {
  if (context.options.rules?.['broken-fragment-link'] !== 'off') {
    for (const item of context.state.fragmentLinks) {
      if (item.node.type !== 'link' || item.node.href === undefined) continue
      if (!context.state.ids.has(item.node.href.slice(1))) {
        reportNode('broken-fragment-link', item.node, item.path, context, { href: item.node.href }, 1)
      }
    }
  }
}

function finishReferences(context: LintContext): void {
  if (context.options.rules?.['unused-link-reference-definition'] !== 'off') {
    for (const item of context.state.referenceDefinitions) {
      if (item.node.type === 'link_reference_definition' && !context.state.usedReferences.has(item.node.key)) {
        reportNode('unused-link-reference-definition', item.node, item.path, context)
      }
    }
  }
}

function finishFootnotes(context: LintContext): void {
  if (context.options.rules?.['unused-footnote-definition'] !== 'off') {
    for (const item of context.state.footnoteDefinitions) {
      if (item.node.type === 'footnote' && !context.state.usedFootnotes.has(item.node.key)) {
        reportNode('unused-footnote-definition', item.node, item.path, context, { label: item.node.key })
      }
    }
  }
}

export function finishStructure(context: LintContext): void {
  finishFragments(context)
  finishReferences(context)
  finishFootnotes(context)
}

function nodeRule(id: Rule['id'], nodes: readonly Node['type'][] , checkNode: NonNullable<Rule['checkNode']>): Rule {
  return { id, nodes, checkNode }
}

export const NODE_RULES: readonly Rule[] = [
  nodeRule('deprecated-bare-underline', ['text'], textPair('_', 'deprecated-bare-underline')),
  nodeRule('deprecated-bare-strike', ['text'], textPair('~', 'deprecated-bare-strike')),
  nodeRule('deprecated-bare-highlight', ['text'], textPair('=', 'deprecated-bare-highlight')),
  nodeRule('markdown-strong-double-star', ['text'], textPair('**', 'markdown-strong-double-star')),
  nodeRule('markdown-strikethrough-double-tilde', ['text'], textPair('~~', 'markdown-strikethrough-double-tilde')),
  nodeRule('djot-emphasis-underscore', ['text'], textPair('_', 'djot-emphasis-underscore')),
  nodeRule('djot-subscript-tilde', ['text'], textPair('~', 'djot-subscript-tilde')),
  nodeRule('djot-superscript-caret', ['text'], textPair('^', 'djot-superscript-caret')),
  nodeRule('a11y/image-alt', ['image'], imageAlt),
  nodeRule('empty-link-destination', ['link'], emptyDestination),
  nodeRule('deprecated-loose-attribute', ['list'], looseAttribute),
  nodeRule('deprecated-table-attribute', ['table'], tableAttribute),
  nodeRule('heading-level-skip', ['heading'], headingLevel),
  nodeRule('heading-marker-mixed', ['heading'], headingKind),
  nodeRule('heading-closing-hashes', ['heading'], headingClosing),
  nodeRule('heading-trailing-attribute', ['heading'], headingTrailing),
  nodeRule('duplicate-reference-url', ['link_reference_definition'], duplicateReferenceUrl),
  nodeRule('deprecated-separator-row', ['table_row'], separatorRow),
  nodeRule('table-row-cell-count', ['table'], tableRows),
  nodeRule('figure-group-empty', ['figure_group'], figureEmpty),
  nodeRule('figure-group-single-panel', ['figure_group'], figureSingle),
  nodeRule('deprecated-substitution-arrow', ['strike'], substitutionArrow),
  nodeRule('frontmatter-shaped-thematic-break', ['frontmatter'], frontmatterBreak),
  nodeRule('bidi-control-in-source', ['text', 'code', 'code_block'], bidiControl),
  nodeRule('description-term-multi-line', ['definition_term'], multilineTerm),
  nodeRule('deprecated-indented-line-under-heading', ['heading'], headingContinuation),
  nodeRule('figure-group-nested', ['figure_group'], figureNested),
  nodeRule('figure-group-panel-number', ['figure_group'], figurePanelNumber),
  nodeRule('footnotes-placement-in-container', ['directive'], footnotePlacement),
  nodeRule('references-placement-in-container', ['directive'], referencesPlacement),
  nodeRule('semantic-attribute-outside-span', ['paragraph', 'heading', 'link', 'image', 'strong'], semanticOutside),
  nodeRule('semantic-attribute-value-ignored', ['span'], semanticValue),
  nodeRule('table-column-arity', ['table'], tableColumnArity),
  nodeRule('table-width-total', ['table'], tableWidth),
  nodeRule('table-row-attribute-as-cell', ['table_row'], rowAttributeCell),
  nodeRule('emphasis-as-heading', ['paragraph'], emphasizedHeading),
  nodeRule('comment-shaped-emphasis', ['emphasis'], commentEmphasis),
  nodeRule('glob-shaped-strong', ['strong'], globStrong),
  nodeRule('djot-subscript-tilde-braced', ['strike'], djotBracedStrike),
  nodeRule('djot-highlight-braces', ['highlight'], djotBracedHighlight),
  nodeRule('unattached-inline-attribute', ['text'], unattachedInline),
  nodeRule('deprecated-cell-alignment', ['table_cell'], deprecatedCellAlignment),
  nodeRule('table-marker-run-padding', ['table_cell'], markerRunPadding),
  nodeRule('fence-closer-indented', ['code_block'], fenceCloserIndent),
  nodeRule('figure-group-opener-metadata', ['div'], figureOpenerMetadata),
  nodeRule('comment-line-in-line-block', ['line'], commentInLineBlock),
  nodeRule('broken-crossref', ['xref'], brokenCrossref),
  nodeRule('broken-fragment-link', ['link'], collectFragment),
  nodeRule('platform-issue-reference', ['text'], platformIssue),
  nodeRule('platform-mention-token', ['text', 'mention'], platformMention),
  nodeRule('delimited-table-wide-row', ['table'], delimitedWideRow),
  nodeRule('djot-intraword-underscore', ['text'], intrawordUnderscore),
  nodeRule('emphasis-marker-before-attributes', ['text'], emphasisBeforeAttrs),
  nodeRule('carve-version-unsupported', ['frontmatter'], carveVersion),
  nodeRule('comment-fence-closer-with-text', ['comment'], commentFenceCloserText),
  nodeRule('comment-in-reference-label', ['comment'], commentInLabel),
  nodeRule('footnote-labels-differ-only-in-whitespace', ['footnote'], footnoteWhitespace),
  nodeRule('table-column-overlap', ['table'], tableColumnOverlap),
  nodeRule('tight-list-item-with-blank-line', ['list'], tightBlankLine),
  nodeRule('braced-comment-in-a-template-source', ['comment'], templateComment),
  nodeRule('unclosed-braced-comment', ['text'], unclosedBracedComment),
  nodeRule('unclosed-inline-emphasis', ['text'], unclosedEmphasis),
  nodeRule('ordered-list-kind-split', ['document'], orderedKindSplit),
  nodeRule('sigil-after-letter', ['text'], sigilAfterLetter),
  nodeRule('list-item-body-below-content-column', ['list_item'], listItemBodyColumn),
  nodeRule('list-item-block-overindented', ['list_item'], listItemBlockIndent),
  nodeRule('list-marker-below-content-column', ['list'], listMarkerBelowColumn),
  nodeRule('block-opener-overindented', ['list_item'], blockOverindent),
  nodeRule('braced-span-opener-as-text', ['text'], bracedSpanAsText),
  nodeRule('colon-fence-length-mismatch', ['div', 'admonition', 'figure_group'], colonFenceMismatch),
  nodeRule('consumed-key-near-miss', ['table'], consumedNearMiss),
  nodeRule('ordered-marker-right-aligned', ['list'], orderedRightAligned),
  nodeRule('table-span-marker-blocked', ['table_cell'], spanMarkerBlocked),
  nodeRule('uneven-list-indent', ['list'], unevenListIndent),
  nodeRule('non-descriptive-link-text', ['link'], nonDescriptiveLink),
  nodeRule('unresolved-reference-link', ['link', 'image'], unresolvedReference),
  nodeRule('unused-link-reference-definition', ['link', 'image', 'link_reference_definition'], unusedReference),
  nodeRule('unresolved-footnote', ['footnote_ref'], unresolvedFootnote),
  nodeRule('unused-footnote-definition', ['footnote', 'footnote_ref'], unusedFootnote),
]
