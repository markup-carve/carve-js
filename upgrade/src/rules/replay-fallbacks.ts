import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineEnd, lineOf, lineStart, lineText } from '../source.ts'

/** A quote-shaped line that 0.1 read as paragraph text stays visible below attributes. */
export function literalQuoteAfterAttributes(ctx: Context): void {
  const removed = ctx.findings.filter(({ record, edit }) => record.entry === 'U-031' && edit !== null
    && edit.text === '' && edit.start < edit.end)
  for (const finding of removed) {
    const edit = finding.edit!
    const line = lineOf(ctx.lines, edit.start)
    if (line < 2 || line > ctx.lines.count || ctx.blocks.leaf[line]?.node.type !== 'paragraph') continue
    const value = lineText(ctx.lines, line)
    if (!/^>+[ \t]*$/u.test(value) || !/^\{[^}\n]+\}$/u.test(lineText(ctx.lines, line - 1))) continue
    finding.edit = { ...edit, text: `${value}\n` }
    finding.record.message = 'quote-shaped paragraph text kept below its attribute line'
  }
}

/** Keep identical adjacent note definitions together when only the first has an old tree position. */
export function repeatedIndentedNote(ctx: Context): void {
  const positions = ctx.doc.footnoteDefPos as Record<string, { startLine: number }> | undefined
  if (positions === undefined) return
  for (const position of Object.values(positions)) {
    const first = position.startLine
    if (first >= ctx.lines.count) continue
    const one = lineText(ctx.lines, first)
    const two = lineText(ctx.lines, first + 1)
    const match = /^([ \t]+)(\[\^([^\]]+)\]: .+)$/u.exec(one)
    if (match === null || two.trimStart() !== match[2] || two === match[2]) continue
    const start = lineStart(ctx.lines, first)
    const end = lineStart(ctx.lines, first + 1)
    const removed = ctx.findings.find(({ record, edit }) => record.entry === 'U-039' && edit !== null
      && edit.start === start && edit.end === end && edit.text === '')
    const inserted = ctx.findings.find(({ record, edit }) => record.entry === 'U-039' && edit !== null
      && edit.start === edit.end && edit.text.trim() === match[2])
    if (removed === undefined || inserted === undefined) continue
    ctx.findings = ctx.findings.filter((finding) => finding !== removed && finding !== inserted
      && !(finding.record.entry === 'U-042' && finding.edit?.start === end
        && finding.edit.end === lineStart(ctx.lines, first + 2)))
    change(ctx, 'U-039', start, start + match[1]!.length, '',
      'repeated old note definitions kept together at document column')
    const indent = two.length - two.trimStart().length
    change(ctx, 'U-039', end, end + indent, '',
      'repeated old note definitions kept together at document column')
  }
}

/** Spell the extra old quote level on a list after a quoted plus line. */
export function quotedPlusNestedList(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'block_quote' || node.pos === undefined) continue
    const plusLine = node.pos.startLine
    const inner = node.children?.find((child) => child.type === 'block_quote'
      && child.pos?.startLine === plusLine + 1 && child.children?.[0]?.type === 'list')
    if (inner === undefined) continue
    const plus = /^([ \t]*(?:>[ \t]*)+)\+[ \t]*$/u.exec(lineText(ctx.lines, plusLine))
    const list = /^([ \t]*(?:>[ \t]*)+)(?:[-*]|\d+[.)])(?=[ \t])/u.exec(lineText(ctx.lines, plusLine + 1))
    if (plus === null || list === null) continue
    change(ctx, 'U-017', lineStart(ctx.lines, plusLine), lineStart(ctx.lines, plusLine + 1), '',
      'quoted plus line replaced by an explicit nested quote prefix')
    change(ctx, 'U-017', lineStart(ctx.lines, plusLine + 1), lineStart(ctx.lines, plusLine + 1), '> ',
      'old nested quote written explicitly before its list')
  }
}

/** Keep a fused block opener inside an old comment instead of replaying it as a new block. */
export function fusedCommentBlockOpener(ctx: Context): void {
  const moveOffsets = new Set<number>()
  for (const { node } of ctx.visits) {
    if (node.type !== 'comment' || node.block !== true || node.pos === undefined
      || node.pos.endLine <= node.pos.startLine) continue
    const line = node.pos.endLine
    const source = lineText(ctx.lines, line)
    if (!/^\s*%{3,}:::[^\n]*$/u.test(source)) continue
    moveOffsets.add(lineEnd(ctx.lines, line - 1))
  }
  if (moveOffsets.size === 0) return
  ctx.findings = ctx.findings.filter(({ record, edit }) => record.entry !== 'U-050' || edit === null
    || edit.start !== edit.end || !moveOffsets.has(edit.start))
}

/** An old marker-line attribute consumed by the following heading keeps its item empty. */
function markerHeadingSibling(visit: Visit): Node01 | null {
  const item = visit.node
  if (item.type !== 'list_item' || item.pos === undefined) return null
  const list = visit.parent
  const next = list?.siblings[list.index + 1]
  return list?.node.type === 'list' && next?.type === 'heading'
    && next.pos?.startLine !== undefined && next.pos.startLine <= item.pos.endLine + 2 ? next : null
}

export function markerAttributeBeforeHeading(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.type !== 'list_item' || node.pos === undefined) continue
    const nested = node.children?.some((child) => child.type === 'heading'
      && (child.pos?.startLine ?? 0) > node.pos!.startLine) ?? false
    const sibling = markerHeadingSibling(visit)
    if (!nested && sibling === null) continue
    const line = node.pos.startLine
    const source = lineText(ctx.lines, line)
    const match = /^([ \t]*(?:[-*]|\d+[.)])(?:\{[^}\n]+\})+[ \t]+)(\{[^}\n]+\})[ \t]*$/u.exec(source)
    if (match === null) continue
    const start = lineStart(ctx.lines, line) + match[1]!.length
    change(ctx, 'U-137', start, start + match[2]!.length, '{% %}',
      'marker-line attribute consumed by the old heading became an empty comment')
    if (sibling?.pos?.startLine === node.pos.endLine + 1) {
      const at = lineStart(ctx.lines, sibling.pos.startLine)
      change(ctx, 'U-006', at, at, '\n', 'blank line keeps the old sibling heading outside its list')
    }
  }
}

/** A colon opener that 0.1 kept as quoted paragraph text stays literal beside its inline tag. */
export function quotedColonOpenerText(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'paragraph' || node.pos === undefined) continue
    for (let line = node.pos.startLine; line <= node.pos.endLine; line++) {
      const source = lineText(ctx.lines, line)
      const match = /^([ \t]*(?:>[ \t]*)+):::[ \t]+(\{)(#[\w-]+)\}[ \t]*$/u.exec(source)
      if (match === null) continue
      const colon = lineStart(ctx.lines, line) + match[1]!.length
      const brace = lineStart(ctx.lines, line) + source.indexOf('{', match[1]!.length + 3)
      if (!node.children?.some((child) => child.type === 'tag' && child.pos?.startLine === line
        && child.pos.startOffset === brace + 1)) continue
      change(ctx, 'U-104', colon, colon, '\\', 'old quoted colon opener kept as paragraph text')
      change(ctx, 'U-430', brace, brace, '\\', 'old literal brace kept beside its inline tag')
    }
  }
}

function nestedDivWidth(ctx: Context, div: Node01): number {
  if (div.pos === undefined) return 0
  let width = 0
  for (let line = div.pos.startLine; line <= div.pos.endLine; line++) {
    width = Math.max(width, /^\s*(:{3,})/u.exec(lineText(ctx.lines, line))?.[1]?.length ?? 0)
  }
  return width
}

function closeOldQuoteCode(ctx: Context, quote: Node01): void {
  if (quote.pos === undefined) return
  for (const { node } of ctx.visits) {
    if (node.type !== 'code' || node.pos === undefined || node.pos.startLine >= node.pos.endLine
      || node.pos.startOffset < quote.pos.startOffset || node.pos.endOffset > quote.pos.endOffset) continue
    const marks = /^`+/u.exec(ctx.src.slice(node.pos.startOffset))?.[0]
    if (marks === undefined || ctx.findings.some(({ record, edit }) => record.entry === 'U-258'
      && edit?.start === node.pos!.endOffset && edit.end === edit.start)) continue
    change(ctx, 'U-258', node.pos.endOffset, node.pos.endOffset, marks, 'old cross-line code span closed at its end')
  }
}

function moveNestedDefinition(ctx: Context, quote: Node01): boolean {
  if (quote.pos === undefined) return false
  const definition = (ctx.doc.children ?? []).find((child) => child.type === 'link_reference_definition'
    && child.pos !== undefined && quote.pos!.startLine < child.pos.startLine
    && child.pos.startLine <= quote.pos!.endLine)
  if (definition?.pos === undefined) return false
  const from = lineStart(ctx.lines, definition.pos.startLine)
  const removed = ctx.findings.findIndex(({ record, edit }) => record.entry === 'U-038' && edit !== null
    && edit.text === '' && edit.start === from && edit.end > definition.pos!.startOffset)
  if (removed < 0) return false
  const moved = ctx.findings[removed + 1]
  if (moved?.record.entry !== 'U-038' || moved.edit === null || moved.edit === undefined
    || moved.edit.start !== moved.edit.end || !moved.edit.text.includes(`[${String(definition.label)}]:`)) return false
  moved.edit = { ...moved.edit, start: 0, end: 0, text: `${moved.edit.text.trimStart()}\n` }
  moved.record.message = 'definition hoisted above the old nested div'
  return true
}

function repairNestedAdmonition(ctx: Context, node: Node01): void {
  if (node.pos === undefined) return
  const quote = node.children?.find((child) => child.type === 'block_quote')
  const div = node.children?.find((child) => child.type === 'div' && child.children?.some((inner) => inner.type === 'div'))
  if (quote?.pos === undefined || div?.pos === undefined || div.pos.endLine !== node.pos.endLine) return
  const run = /^([ \t]*)(:{3,})(?=[ \t])/u.exec(lineText(ctx.lines, node.pos.startLine))
  if (run === null || !moveNestedDefinition(ctx, quote)) return
  const width = nestedDivWidth(ctx, div)
  if (width >= run[2]!.length) {
    const at = lineStart(ctx.lines, node.pos.startLine) + run[1]!.length + run[2]!.length
    change(ctx, 'U-049', at, at, ':'.repeat(width + 1 - run[2]!.length),
      'outer admonition widened past its old nested div')
  }
  closeOldQuoteCode(ctx, quote)
}

/** Keep the old nested div and quote when a shorter colon run would close their admonition. */
export function nestedDivInsideAdmonition(ctx: Context): void {
  for (const { node } of ctx.visits) if (node.type === 'admonition') repairNestedAdmonition(ctx, node)
}

function moveDefinitionAboveFence(ctx: Context, admonition: Node01, div: Node01): boolean {
  const moved = ctx.findings.find(({ record, edit }) => record.entry === 'U-038' && edit !== null
    && edit.start === ctx.src.length && edit.end === edit.start && /^\n\[\^[^\]]+\]: /u.test(edit.text))
  if (moved?.edit === null || moved?.edit === undefined) return false
  const note = moved.edit.text.trimStart()
  const hasSource = ctx.findings.some(({ record, edit }) => record.entry === 'U-038' && edit !== null
    && edit.text === '' && edit.start > admonition.pos!.startOffset && edit.end <= div.pos!.startOffset
    && ctx.src.slice(edit.start, edit.end).trim() === note.trim())
  if (!hasSource) return false
  moved.edit = { ...moved.edit, start: 0, end: 0, text: `${note}\n` }
  moved.record.message = 'definition placed above the old unclosed code fence'
  return true
}

/** Keep an old admonition around its longer div when that div holds an unclosed code fence. */
export function outerAdmonitionAroundDiv(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'admonition' || node.pos === undefined) continue
    const div = node.children?.find((child) => child.type === 'div' && child.pos?.endLine === node.pos!.endLine)
    if (div?.pos === undefined) continue
    const code = div.children?.find((child) => child.type === 'code_block'
      && child.pos?.endLine === div.pos!.endLine && /^\s*`{3,}/u.test(lineText(ctx.lines, child.pos.startLine)))
    if (code === undefined) continue
    const outer = /^([ \t]*)(:{3,})(?=[ \t])/u.exec(lineText(ctx.lines, node.pos.startLine))
    const inner = /^([ \t]*)(:{3,})[ \t]*$/u.exec(lineText(ctx.lines, div.pos.startLine))
    if (outer === null || inner === null || outer[2]!.length > inner[2]!.length
      || !moveDefinitionAboveFence(ctx, node, div)) continue
    const at = lineStart(ctx.lines, node.pos.startLine) + outer[1]!.length + outer[2]!.length
    change(ctx, 'U-049', at, at, ':'.repeat(inner[2]!.length + 1 - outer[2]!.length),
      'outer admonition widened past its old nested div')
  }
}

function alignDefinitionMarkers(ctx: Context, list: Node01, termColumn: number): void {
  for (const item of list.items ?? []) {
    const spans = item.definitionSpans as { startLine: number }[] | undefined
    for (const span of spans ?? []) {
      const line = span.startLine
      const marker = /^([ ]+):(?=[ \t]|$)/u.exec(lineText(ctx.lines, line))
      if (marker === null || marker[1]!.length <= termColumn) continue
      change(ctx, 'U-435', lineStart(ctx.lines, line) + termColumn,
        lineStart(ctx.lines, line) + marker[1]!.length, '',
        'old definition marker aligned with its term column')
    }
  }
}

function alignFollowingSibling(ctx: Context, visit: Visit, termColumn: number): void {
  const next = visit.siblings[visit.index + 1]
  if (next?.pos === undefined || visit.node.pos === undefined
    || next.pos.startLine <= visit.node.pos.endLine + 1) return
  const firstIndent = /^ */u.exec(lineText(ctx.lines, next.pos.startLine))![0].length
  const shift = firstIndent - termColumn
  if (shift <= 0) return
  for (let line = next.pos.startLine; line <= next.pos.endLine; line++) {
    const value = lineText(ctx.lines, line)
    const indent = /^ */u.exec(value)![0].length
    if (indent < shift || value.trim() === '') continue
    if (ctx.findings.some(({ edit }) => edit !== null && edit.start >= lineStart(ctx.lines, line)
      && edit.start < lineStart(ctx.lines, line) + indent && edit.end > edit.start)) continue
    change(ctx, 'U-435', lineStart(ctx.lines, line),
      lineStart(ctx.lines, line) + shift, '',
      'old sibling block kept outside the preceding definition')
  }
}

/** Align old definition markers and following siblings with the term's list column. */
export function descriptionMarkerColumns(ctx: Context): void {
  for (const visit of ctx.visits) {
    const list = visit.node
    if (list.type !== 'definition_list' || list.pos === undefined || visit.parent?.node.type !== 'list_item') continue
    const termColumn = list.pos.startColumn - 1
    alignDefinitionMarkers(ctx, list, termColumn)
    alignFollowingSibling(ctx, visit, termColumn)
  }
}

function padTsvRows(ctx: Context, table: Node01): void {
  const rows = Array.isArray(table.rows) ? table.rows as Node01[] : []
  for (const row of rows) {
    if (row.pos === undefined || !Array.isArray(row.cells) || row.pos.startLine !== row.pos.endLine) continue
    const line = row.pos.startLine
    const source = lineText(ctx.lines, line)
    const written = source.split('\t').length
    const missing = row.cells.length - written
    if (missing <= 0) continue
    change(ctx, 'U-150', lineEnd(ctx.lines, line), lineEnd(ctx.lines, line), '\t'.repeat(missing),
      'old TSV row padding written as explicit empty cells')
  }
}

function protectTsvBodyRun(ctx: Context, table: Node01): void {
  if (table.pos === undefined) return
  const first = table.pos.startLine
  const opener = lineText(ctx.lines, first)
  const run = /^([ \t]*)(`{3,})tsv[ \t]*$/u.exec(opener)
  if (run === null) return
  let longest = 0
  const rows = Array.isArray(table.rows) ? table.rows as Node01[] : []
  for (const row of rows) {
    if (row.pos === undefined) continue
    const body = /^[ \t]*(`{3,})[ \t]*$/u.exec(lineText(ctx.lines, row.pos.startLine))
    if (body !== null) longest = Math.max(longest, body[1]!.length)
  }
  if (longest < run[2]!.length) return
  const extra = '`'.repeat(longest + 1 - run[2]!.length)
  const at = lineStart(ctx.lines, first) + run[1]!.length + run[2]!.length
  change(ctx, 'U-049', at, at, extra, 'fence widened to keep the old TSV row literal')
  const last = table.pos.endLine
  const closer = lineText(ctx.lines, last)
  const oldCloser = /^([ \t]*)(`{3,})[ \t]*$/u.exec(closer)
  const finalRow = rows.at(-1)?.pos?.endLine ?? first
  if (oldCloser !== null && finalRow < last) {
    const closeAt = lineStart(ctx.lines, last) + oldCloser[1]!.length + oldCloser[2]!.length
    change(ctx, 'U-049', closeAt, closeAt, extra, 'old TSV closer widened with its opener')
    return
  }
  const after = lineStart(ctx.lines, last + 1)
  change(ctx, 'U-049', after, after, `${'`'.repeat(longest + 1)}\n`,
    'matching closer written after the old TSV row')
}

/** Write the cells the old TSV table padded and keep a bare run in its body. */
export function paddedTsvRows(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'table' || node.sourceFormat !== 'tsv') continue
    padTsvRows(ctx, node)
    protectTsvBodyRun(ctx, node)
  }
}

function blankBetween(ctx: Context, first: number, last: number): boolean {
  for (let line = first; line < last; line++) if (lineText(ctx.lines, line).trim() !== '') return false
  return true
}

function moveAttributeAcrossDefinition(ctx: Context, node: Node01,
  definition: { startLine: number; endLine: number }): void {
  const line = definition.startLine - 1
  if (line < 1 || node.pos === undefined || definition.endLine >= node.pos.startLine
    || !blankBetween(ctx, definition.endLine + 1, node.pos.startLine)) return
  const attribute = lineText(ctx.lines, line).trim()
  if (!/^\{[^{}\n]+\}$/u.test(attribute)) return
  ctx.findings = ctx.findings.filter(({ record, edit }) => record.entry !== 'U-033' || edit === null
    || ![line, definition.startLine].includes(lineOf(ctx.lines, edit.start)))
  change(ctx, 'U-031', lineStart(ctx.lines, line), lineStart(ctx.lines, line + 1), '\n',
    'old floating attribute moved beyond its intervening footnote definition')
  change(ctx, 'U-031', lineStart(ctx.lines, node.pos.startLine), lineStart(ctx.lines, node.pos.startLine),
    `${attribute}\n`, 'old floating attribute kept on its paragraph')
}

/** Carry a floating old attribute past a positioned footnote definition to its old paragraph. */
export function attributeAcrossFootnoteDefinition(ctx: Context): void {
  const positions = ctx.doc.footnoteDefPos
  if (typeof positions !== 'object' || positions === null) return
  const definitions = Object.values(positions as Record<string, { startLine: number; endLine: number }>)
  for (const { node, parent } of ctx.visits) {
    if (node.type !== 'paragraph' || node.pos === undefined || node.attrs === undefined
      || parent?.node.type !== 'document') continue
    for (const definition of definitions) moveAttributeAcrossDefinition(ctx, node, definition)
  }
}

/** The longest backtick run of the body that 0.2 would close the fence at, 0 for none; the fence must exceed it. */
function longestBodyRun(ctx: Context, firstLine: number, lastLine: number, width: number): number {
  const closer = lineText(ctx.lines, lastLine)
  let longest = 0
  for (let line = firstLine + 1; line < lastLine; line++) {
    const value = lineText(ctx.lines, line)
    const run = /^[ \t]*(`+)[ \t]*$/u.exec(value)?.[1]?.length ?? 0
    if (run >= width && value !== closer) longest = Math.max(longest, run)
  }
  return longest
}

/** Widen a fence when 0.1 kept an indented run in its body that 0.2 closes. */
export function innerFenceRun(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'code_block' || node.pos === undefined || node.pos.endLine <= node.pos.startLine + 1) continue
    const firstLine = node.pos.startLine
    const lastLine = node.pos.endLine
    const opener = lineText(ctx.lines, firstLine)
    const closer = lineText(ctx.lines, lastLine)
    const start = /^( *)(`{3,})(.*)$/u.exec(opener)
    if (start === null || closer !== `${start[1]}${start[2]}`) continue
    const longest = longestBodyRun(ctx, firstLine, lastLine, start[2]!.length)
    if (longest === 0) continue
    const marks = '`'.repeat(longest + 1 - start[2]!.length)
    const message = 'fence widened so an indented body run stays literal'
    const first = lineStart(ctx.lines, firstLine) + (start[1] ?? '').length
    const last = lineStart(ctx.lines, lastLine) + (start[1] ?? '').length
    change(ctx, 'U-049', first, first, marks, message)
    change(ctx, 'U-049', last, last, marks, message)
  }
}

/** Consecutive old headings need their own boundaries when the second mark is indented. */
export function siblingHeadingBoundary(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    const previous = visit.siblings[visit.index - 1]
    if (node.type !== 'heading' || node.pos === undefined || previous?.type !== 'heading'
      || previous.pos === undefined || previous.pos.endLine + 1 !== node.pos.startLine) continue
    const line = node.pos.startLine
    if (!/^ +#{1,6}(?:[ \t]|$)/u.test(lineText(ctx.lines, line))) continue
    change(ctx, 'U-001', lineStart(ctx.lines, line), lineStart(ctx.lines, line), '\n',
      'blank line keeps the next heading separate from its sibling')
  }
}

function attributeBodyColumn(source: string): number | null {
  return /^([ \t]*[-*+] +)[ \t]*\{[^}\n]+\}[ \t]*$/u.exec(source)?.[1]?.length ?? null
}

function emptyAttributeBody(ctx: Context, visit: Visit): { line: number; body: number } | null {
  const item = visit.node
  if (item.type !== 'list_item' || item.pos === undefined || (item.children?.length ?? 0) !== 0 || visit.index !== 0
    || visit.parent?.node.type !== 'list') return null
  const list = visit.parent.node
  const before = visit.parent.siblings[visit.parent.index - 1]
  if (list.pos === undefined || before?.type !== 'definition_list'
    || before.pos?.endLine !== list.pos.startLine - 1) return null
  const line = item.pos.startLine
  const column = attributeBodyColumn(lineText(ctx.lines, line))
  return column === null ? null : { line, body: lineStart(ctx.lines, line) + column }
}

/** An old empty list item carrying only unattached attributes keeps its empty body. */
export function emptyAttributeItemAfterDescription(ctx: Context): void {
  for (const visit of ctx.visits) {
    const place = emptyAttributeBody(ctx, visit)
    if (place === null) continue
    const { line, body } = place
    change(ctx, 'U-008', lineStart(ctx.lines, line), lineStart(ctx.lines, line), '\n',
      'blank line ends the description before the next list')
    change(ctx, 'U-034', body, lineEnd(ctx.lines, line), '{% %}',
      'unattached attributes of an empty item replaced with an empty body')
  }
}

function documentEmptyColonDiv(ctx: Context, visit: Visit, line: number, source: string): void {
  if (visit.parent?.node.type !== 'document' || !/^ +:::[ \t]*$/u.test(source)
    || line !== ctx.lines.count || !ctx.src.endsWith('\n')) return
  const at = lineEnd(ctx.lines, line) + 1
  change(ctx, 'U-049', at, at, '\n:::\n:::\n', 'empty div written explicitly after the old fence line')
}

function admonitionEmptyColonDiv(ctx: Context, visit: Visit, line: number, source: string): void {
  if (visit.parent?.node.type !== 'admonition' || !/^ *:{4,}[ \t]*$/u.test(source)
    || visit.parent.node.pos?.startLine === undefined) return
  const first = lineStart(ctx.lines, visit.parent.node.pos.startLine)
  const opener = lineText(ctx.lines, visit.parent.node.pos.startLine)
  const prefix = /^ *::: /u.exec(opener)?.[0]
  if (prefix === undefined) return
  if (source.trim() === '::::' && opener.startsWith(' ')) {
    change(ctx, 'U-276', first + prefix.length - 1, first + prefix.length - 1, '::',
      'outer admonition widened beyond its old empty div')
    return
  }
  if (first !== 0) return
  change(ctx, 'U-276', first + 3, first + 3, ':', 'outer admonition widened to hold its old empty div')
  change(ctx, 'U-276', lineStart(ctx.lines, line), lineEnd(ctx.lines, line), ':::\n:::\n::::',
    'empty div written before the outer admonition closes')
}

/** Keep a 0.1 empty div when a colon run becomes a closer in 0.2. */
export function emptyColonDiv(ctx: Context): void {
  for (const visit of ctx.visits) {
    const div = visit.node
    if (div.type !== 'div' || div.pos === undefined || div.pos.startLine !== div.pos.endLine
      || (div.children?.length ?? 0) !== 0) continue
    const line = div.pos.startLine
    const source = lineText(ctx.lines, line)
    documentEmptyColonDiv(ctx, visit, line, source)
    admonitionEmptyColonDiv(ctx, visit, line, source)
  }
}

/** A continued 0.1 head row needs every cell marked as a head after its separator is removed. */
export function continuedHeaderRow(ctx: Context): void {
  const removed = new Set(ctx.findings.filter(({ record, edit }) => record.entry === 'U-055'
    && edit !== null && edit.text === '' && edit.start < edit.end).map(({ edit }) => edit!.start))
  for (const { node } of ctx.visits) {
    if (node.type !== 'table_row' || node.pos === undefined || !node.continuationLines) continue
    const separator = lineStart(ctx.lines, node.pos.endLine + 1)
    if (!removed.has(separator)) continue
    const row = lineText(ctx.lines, node.pos.startLine)
    const pipe = row.indexOf('|')
    if (pipe < 0 || row[pipe + 1] === '=') continue
    const at = lineStart(ctx.lines, node.pos.startLine) + pipe + 1
    change(ctx, 'U-055', at, at, '=', 'continued header row keeps its first cell in the head')
  }
}

/** A description after a quoted term starts outside the quote in the old tree. */
export function descriptionAfterQuotedTerm(ctx: Context): void {
  for (const visit of ctx.visits) {
    const current = visit.node
    const before = visit.siblings[visit.index - 1]
    if (current.type !== 'definition_list' || current.pos === undefined || before?.type !== 'block_quote'
      || before.pos === undefined || before.pos.endLine + 1 !== current.pos.startLine
      || !before.children?.some((child) => child.type === 'definition_list')) continue
    const at = lineStart(ctx.lines, current.pos.startLine)
    change(ctx, 'U-004', at, at, '\n', 'blank line separates a description from the quoted term above')
  }
}

/** Nested old footnote definitions on one line need their outer label at document scope. */
export function nestedFootnoteAfterItem(ctx: Context): void {
  const positions = ctx.doc.footnoteDefPos
  if (typeof positions !== 'object' || positions === null) return
  const lines = new Map<number, number>()
  for (const value of Object.values(positions as Record<string, { startLine: number; startColumn: number }>)) {
    lines.set(value.startLine, (lines.get(value.startLine) ?? 0) + 1)
  }
  for (const [line, count] of lines) {
    if (count < 2 || line < 2 || ctx.blocks.leaf[line - 1]?.parent?.node.type !== 'list_item') continue
    const text = lineText(ctx.lines, line)
    const match = /^ +(?=\[\^[^\]\n]+\]:)/u.exec(text)
    if (match === null) continue
    const at = lineStart(ctx.lines, line)
    change(ctx, 'U-005', at, at + match[0].length, '',
      'nested footnote labels moved to document scope after the list')
  }
}

/** Adjacent old smart punctuation nodes keep their combined glyphs across the upgrade. */
export function legacyPlusDash(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    const next = visit.siblings[visit.index + 1]
    if (node.type !== 'smart_punctuation' || node.pos === undefined
      || next?.type !== 'smart_punctuation' || next.pos === undefined
      || node.pos.endOffset !== next.pos.startOffset) continue
    const from = node.pos.startOffset
    const to = next.pos.endOffset
    if (ctx.src.slice(from, to) !== '+---') continue
    change(ctx, 'U-115', from, to, '±–', 'old adjacent smart punctuation kept as its visible glyphs')
  }
}

/** A tabbed paragraph below a blank stays in the old footnote body after U-039 moves it. */
export function tabbedFootnoteContinuation(ctx: Context): void {
  const positions = ctx.doc.footnoteDefPos
  if (typeof positions !== 'object' || positions === null) return
  const bodyLines = new Set<number>()
  for (const pos of Object.values(positions as Record<string, { startLine: number; endLine: number }>)) {
    for (let line = pos.startLine + 1; line <= pos.endLine; line++) {
      if (lineText(ctx.lines, line - 1).trim() === '' && lineText(ctx.lines, line).startsWith('\t')) bodyLines.add(line)
    }
  }
  for (const finding of ctx.findings) {
    const edit = finding.edit
    if (finding.record.entry !== 'U-039' || edit === null || edit.text !== ''
      || ctx.src.slice(edit.start, edit.end) !== '\t') continue
    if (!bodyLines.has(lineOf(ctx.lines, edit.start))) continue
    finding.edit = { ...edit, text: ' ' }
    finding.record.message = 'tabbed continuation kept inside the old footnote body'
  }
}

/** A quote after a description in a footnote needs its own content column. */
export function footnoteQuoteAfterDescription(ctx: Context): void {
  const places = ctx.doc.footnoteDefPos
  if (typeof places !== 'object' || places === null) return
  const definitions = Object.values(places as Record<string, { startLine: number; endLine: number }>)
  for (const { node } of ctx.visits) {
    if (node.type !== 'block_quote' || node.pos === undefined) continue
    const line = node.pos.startLine
    if (!definitions.some((pos) => pos.startLine < line && line <= pos.endLine)
      || ctx.blocks.leaf[line - 1]?.parent?.node.type !== 'definition_list'
      || !/^ {2,}>/u.test(lineText(ctx.lines, line))) continue
    const at = lineStart(ctx.lines, line)
    const moved = ctx.findings.find(({ record, edit }) => record.entry === 'U-039' && edit?.start === at
      && edit.end === at + 1 && edit.text === '')
    if (moved?.edit === null || moved?.edit === undefined) continue
    moved.edit = { ...moved.edit, end: at + 2 }
    moved.record.message = 'quoted follower moved to the old footnote content column'
    ctx.findings = ctx.findings.filter(({ record, edit }) => record.entry !== 'U-435' || edit?.start !== at)
  }
}

/** A list outside an old note definition stays at document column after the blank. */
export function listAfterFootnote(ctx: Context): void {
  const places = ctx.doc.footnoteDefPos
  if (typeof places !== 'object' || places === null) return
  const after = new Set(Object.values(places as Record<string, { endLine: number }>).map((pos) => pos.endLine + 2))
  for (const visit of ctx.visits) {
    const list = visit.node
    if (list.type !== 'list' || list.pos === undefined || visit.parent?.node.type !== 'document'
      || !after.has(list.pos.startLine)) continue
    const line = list.pos.startLine
    if (lineText(ctx.lines, line - 1).trim() !== '') continue
    const match = /^ +(?=[-*+] |[0-9]+[.)] )/u.exec(lineText(ctx.lines, line))
    if (match === null) continue
    const at = lineStart(ctx.lines, line)
    change(ctx, 'U-109', at, at + match[0].length, '',
      'document list after a footnote moved to column zero')
  }
}

/** Compose inline escapes and braced spans without adding a second slash or a source space. */
export function inlineEditComposition(ctx: Context): void {
  const escaped = new Set(ctx.findings.filter(({ record, edit }) => record.entry === 'U-274'
    && edit?.text === '\\' && edit.start === edit.end).map(({ edit }) => edit!.start))
  ctx.findings = ctx.findings.filter(({ record, edit }) => record.entry !== 'U-070' || edit?.text !== '\\'
    || !escaped.has(edit.start))
  for (const finding of ctx.findings) {
    const edit = finding.edit
    if (finding.record.entry !== 'U-066' || edit === null || edit.text !== ' {'
      || ctx.src[edit.start - 1] !== '|') continue
    finding.edit = { ...edit, text: '{' }
    finding.record.message = 'braced strike kept beside its preceding pipe without a space'
  }
}

/** A removed empty quote marker inside an old footnote must not leave a blank body line. */
export function emptyQuoteInFootnote(ctx: Context): void {
  const positions = ctx.doc.footnoteDefPos
  if (typeof positions !== 'object' || positions === null) return
  const spans = Object.values(positions as Record<string, { startLine: number; endLine: number }>)
  for (const finding of ctx.findings) {
    const edit = finding.edit
    if (finding.record.entry !== 'U-038' || edit === null || edit.text !== '') continue
    const line = lineOf(ctx.lines, edit.start)
    if (!spans.some((pos) => pos.startLine < line && line < pos.endLine)
      || !/^[ \t]*>{2,}[ \t]*$/u.test(lineText(ctx.lines, line))
      || edit.end !== lineEnd(ctx.lines, line) || ctx.src[edit.end] !== '\n') continue
    finding.edit = { ...edit, end: edit.end + 1 }
    finding.record.message = 'empty quoted line removed without splitting the old footnote body'
  }
}

/** A lazy caption-shaped line stays text in the old quote paragraph. */
export function lazyCaretAfterQuote(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'block_quote' || node.pos === undefined) continue
    for (let line = node.pos.startLine + 1; line <= node.pos.endLine; line++) {
      const text = lineText(ctx.lines, line)
      if (!/^ *\^ +\S/u.test(text) || !/^ *>/u.test(lineText(ctx.lines, line - 1))) continue
      const at = lineStart(ctx.lines, line) + text.indexOf('^')
      change(ctx, 'U-006', at, at, '\\', 'lazy caption-shaped line kept as quote paragraph text')
    }
  }
}

const VERBATIM: ReadonlySet<string> = new Set(['code', 'code_block', 'math', 'raw_inline', 'raw_block'])

/** Whether `at` is inside the text of a 0.1 code, math or raw node, where a backslash would be text. */
function verbatimAt(ctx: Context): (at: number) => boolean {
  const ranges: [number, number][] = []
  for (const { node } of ctx.visits) {
    if (VERBATIM.has(node.type) && node.pos !== undefined) ranges.push([node.pos.startOffset, node.pos.endOffset])
  }
  return (at) => ranges.some(([start, end]) => start <= at && at < end)
}

/** A narrow space made these 0.1 link forms literal, including references to such definitions. */
export function literalNarrowSpaceLinks(ctx: Context): void {
  if (ctx.findings.some(({ record }) => record.entry === 'U-258' || record.entry === 'U-439')) return
  const verbatim = verbatimAt(ctx)
  const literalRefs = new Set<string>()
  for (const match of ctx.src.matchAll(/(?<!\\)\[([^\]\n]+)\]:[^\n]*\u202f[^\n]*/gu)) {
    const start = match.index
    if (start === undefined || verbatim(start)) continue
    literalRefs.add(match[1]!)
    change(ctx, 'U-132', start, start, '\\', 'old literal reference definition kept as text')
  }
  for (const match of ctx.src.matchAll(/(?<!\\)\[[^\]\n]+\]\([^\n)]*\u202f[^\n)]*\)/gu)) {
    if (match.index !== undefined && !verbatim(match.index)) change(ctx, 'U-132', match.index, match.index, '\\',
      'old literal link with a narrow space kept as text')
  }
  if (literalRefs.size === 0) return
  for (const match of ctx.src.matchAll(/(?<!\\)\[[^\]\n]+\]\[([^\]\n]+)\]/gu)) {
    if (match.index !== undefined && literalRefs.has(match[1]!) && !verbatim(match.index)) change(ctx, 'U-132',
      match.index, match.index, '\\', 'reference to an old literal definition kept as text')
  }
}

/** A document fence after a definition stays outside its description body. */
export function fenceAfterDescription(ctx: Context): void {
  for (const visit of ctx.visits) {
    const place = descriptionFence(ctx, visit)
    if (place !== null) moveFence(ctx, place)
  }
}

function descriptionFence(ctx: Context, visit: Visit): { first: number; last: number; indent: number; entry: string;
  closer: typeof ctx.findings[number] | undefined } | null {
  const node = visit.node
  const before = visit.siblings[visit.index - 1]
  if (node.type !== 'code_block' || node.pos === undefined || before?.type !== 'definition_list'
    || before.pos?.endLine !== node.pos.startLine - 1 || visit.parent?.node.type !== 'document') return null
  const first = node.pos.startLine
  const last = node.pos.endLine
  const opener = /^( +)(?:`{3,}|~{3,})/u.exec(lineText(ctx.lines, first))
  if (opener === null) return null
  const indent = opener[1]!.length
  const closer = ctx.findings.find(({ record, edit }) => record.entry === 'U-049'
    && edit?.start === lineEnd(ctx.lines, last) && edit.text.startsWith(`\n${' '.repeat(indent)}`))
  if (closer === undefined && !ctx.findings.some(({ record, edit }) => record.entry === 'U-116'
    && edit !== null && lineOf(ctx.lines, edit.start) === first)) return null
  return { first, last, indent, entry: closer === undefined ? 'U-116' : 'U-049', closer }
}

function moveFence(ctx: Context, { first, last, indent, entry, closer }: NonNullable<ReturnType<typeof descriptionFence>>): void {
  change(ctx, entry, lineStart(ctx.lines, first), lineStart(ctx.lines, first) + indent, '\n',
    'blank line and document column keep the fence outside the description')
  for (let line = first + 1; line <= last; line++) {
    const spaces = /^ */u.exec(lineText(ctx.lines, line))![0].length
    const cut = Math.min(indent, spaces)
    if (cut === 0) continue
    change(ctx, entry, lineStart(ctx.lines, line), lineStart(ctx.lines, line) + cut, '',
      'fence body shifted with its document opener')
  }
  if (closer?.edit !== null && closer?.edit !== undefined) {
    closer.edit = { ...closer.edit, text: closer.edit.text.replace(new RegExp(`^\\n {${indent}}`, 'u'), '\n') }
  }
}

/** Literal 0.1 include text keeps its sigil words from becoming 0.2 mentions. */
export function literalIncludeMentions(ctx: Context): void {
  if (!ctx.findings.some(({ record }) => record.entry === 'U-011')) return
  const verbatim = verbatimAt(ctx)
  for (let line = 1; line <= ctx.lines.count; line++) {
    const source = lineText(ctx.lines, line)
    if (!source.includes('{{') || !source.includes('}}')) continue
    const start = source.indexOf('{{')
    const end = source.indexOf('}}', start + 2)
    if (end < 0) continue
    for (const match of source.slice(start + 2, end).matchAll(/(?<!\\)@[A-Za-z][A-Za-z0-9-]*/gu)) {
      const at = lineStart(ctx.lines, line) + start + 2 + match.index
      if (!verbatim(at)) change(ctx, 'U-011', at, at, '\\', 'old literal include sigil kept as text')
    }
  }
}

function textOnly(node: Node01): boolean {
  return (node.children ?? []).every((child) => child.type === 'text' || child.type === 'soft_break'
    || (child.type === 'emphasis' && textOnly(child)))
}

/** 0.1 also paired the reversed strong/emphasis delimiters beside U-068. */
export function flippedStrong(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'strong' || node.pos === undefined || !textOnly(node)
      || !(node.children ?? []).some((child) => child.type === 'emphasis')) continue
    const { startOffset: start, endOffset: end } = node.pos
    if (!ctx.src.startsWith('*/', start) || !ctx.src.startsWith('/*', end - 2)) continue
    const message = 'the reversed strong and emphasis delimiters use an explicit braced span'
    change(ctx, 'U-068', start, start + 2, '{*{/', message)
    change(ctx, 'U-068', end - 2, end, '/}*}', message)
    for (let at = start + 2; at < end - 2; at++) {
      if ((ctx.src[at] === '{' || ctx.src[at] === '}') && ctx.src[at - 1] !== '\\') {
        change(ctx, 'U-068', at, at, '\\', message)
      }
    }
  }
}

/** An old strong span beginning beside a closer can be nested by the 0.2 bare pairing. */
export function crossLineStrong(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'strong' || node.pos === undefined || node.attrs === undefined
      || !node.children?.some((child) => child.type === 'soft_break')) continue
    const { startOffset: start, endOffset: end } = node.pos
    const last = node.children.at(-1)
    const close = last?.pos?.endOffset
    if (!ctx.src.startsWith('*/', start) || close === undefined || ctx.src[close] !== '*'
      || ctx.src[close + 1] !== '{' || ctx.src[end - 1] !== '}') continue
    const message = 'old cross-line strong pairing written as an explicit braced span'
    change(ctx, 'U-068', start, start + 1, '{*', message)
    change(ctx, 'U-068', close, close + 1, '*}', message)
  }
}

/** A deprecated glued header spelling that 0.1 kept as cell text must stay cell text. */
export function literalTableHeader(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'table_cell' || node.pos === undefined || node.header === true) continue
    const { startOffset: start, endOffset: end } = node.pos
    const value = ctx.src.slice(start, end)
    const marker = value.indexOf('=~>')
    if (marker < 0 || value.slice(0, marker).trim() !== '') continue
    change(ctx, 'U-168', start + marker, start + marker, '\\',
      'the deprecated glued header spelling is literal cell text in 0.1')
  }
}

interface EmptyDefinitionItem {
  line: number
  start: number
  end: number
  body: string
  label: string
}

function emptyDefinitionItem(ctx: Context, node: Node01): EmptyDefinitionItem | null {
  if (node.type !== 'list_item' || node.pos === undefined || (node.children?.length ?? 0) !== 0
    || node.pos.startLine !== node.pos.endLine) return null
  const line = node.pos.startLine
  const text = ctx.src.slice(node.pos.startOffset, lineEnd(ctx.lines, line))
  const marker = /^(?:[-+*]|[0-9]+[.)]) +/u.exec(text)
  if (marker === null) return null
  const start = node.pos.startOffset + marker[0].length
  const body = ctx.src.slice(start, lineEnd(ctx.lines, line)).trimEnd()
  const definition = /^\[([^\]^][^\]]*)\]:[ \t]+\S.*$/u.exec(body)
  if (definition === null) return null
  return { line, start, end: lineEnd(ctx.lines, line), body, label: definition[1]!.toLowerCase() }
}

function repeatedItems(items: EmptyDefinitionItem[]): EmptyDefinitionItem[] {
  const counts = new Map<string, number>()
  const keyOf = (item: EmptyDefinitionItem): string => `${item.label}\0${item.body}`
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1)
  return items.filter((item) => (counts.get(keyOf(item)) ?? 0) > 1)
}

function rewriteDuplicateGroup(ctx: Context, list: Node01, items: EmptyDefinitionItem[]): { from: number; to: number } | null {
  if (list.pos === undefined) return null
  const duplicates = repeatedItems(items)
  if (duplicates.length < 2) return null
  const from = lineStart(ctx.lines, list.pos.startLine)
  const to = lineEnd(ctx.lines, list.pos.endLine)
  const message = 'duplicate definitions consumed by empty list items lifted above their list'
  change(ctx, 'U-038', from, from, `${duplicates[0]!.body}\n\n`, message)
  for (const item of duplicates) change(ctx, 'U-038', item.start, item.end, '{% %}', message)
  if (list.pos.endLine < ctx.lines.count && lineText(ctx.lines, list.pos.endLine + 1).trim() !== '') {
    change(ctx, 'U-038', to, to, '\n', message)
  }
  return { from, to }
}

/** Duplicate definitions consumed by empty sibling items in 0.1 move outside their list. */
export function duplicateItemDefinitions(ctx: Context): void {
  const prior = ctx.findings.length
  const groups = new Map<Node01, EmptyDefinitionItem[]>()
  for (const visit of ctx.visits) {
    if (visit.parent?.node.type !== 'list') continue
    const item = emptyDefinitionItem(ctx, visit.node)
    if (item === null) continue
    const list = groups.get(visit.parent.node) ?? []
    list.push(item)
    groups.set(visit.parent.node, list)
  }
  const ranges: { from: number; to: number }[] = []
  for (const [list, items] of groups) {
    const range = rewriteDuplicateGroup(ctx, list, items)
    if (range !== null) ranges.push(range)
  }
  if (ranges.length === 0) return
  const masked = new Uint8Array(ctx.src.length + 1)
  for (const { from, to } of ranges) masked.fill(1, from, to + 1)
  ctx.findings = [...ctx.findings.slice(0, prior).filter(({ edit }) => edit === null || masked[edit.start] !== 1),
    ...ctx.findings.slice(prior)]
}

function escapeLiteralLinkText(ctx: Context, visit: Visit): void {
  const node = visit.node
  if (node.type !== 'text' || node.pos === undefined || visit.parent?.node.type !== 'paragraph') return
  const { startOffset: start, endOffset: end, startLine } = node.pos
  const source = ctx.src.slice(start, end)
  const next = visit.siblings[visit.index + 1]
  if (next?.type === 'code' && next.pos?.startOffset === end) {
    const opener = /\[[^\]\n]+\]\([^\)\n]*$/u.exec(source)
    if (opener?.index !== undefined) change(ctx, 'U-258', start + opener.index, start + opener.index, '\\',
      'literal link opener escaped so the old code run stays visible')
  }
  const line = lineText(ctx.lines, startLine)
  const prefix = line.match(/^[ \t]*/u)?.[0].length ?? 0
  if (start !== lineStart(ctx.lines, startLine) + prefix || !/^\[[^\]^\n]+\]:/u.test(source)) return
  change(ctx, 'U-258', start, start, '\\',
    'definition-shaped text escaped so 0.2 keeps the 0.1 paragraph')
}

/** Old paragraph text before an unclosed code span can resemble a 0.2 link opener. */
export function literalLinkBeforeCode(ctx: Context): void {
  const unclosed = ctx.visits.some(({ node }) => node.type === 'code' && node.pos !== undefined
    && ctx.src[node.pos.endOffset - 1] !== '`')
  if (!unclosed) return
  for (const visit of ctx.visits) escapeLiteralLinkText(ctx, visit)
}

function wrappedCodeRow(row: Node01): boolean {
  const cells = row.cells as Node01[] | undefined
  return row.type === 'table_row' && typeof row.continuationLines === 'number' && row.continuationLines > 0
    && cells?.some((cell) => cell.children?.some((child) => child.type === 'code'
      && Array.isArray(child.cellWraps) && child.cellWraps.length > 0)) === true
}

function flattenRow(ctx: Context, row: Node01): void {
  const pos = row.pos!
  const count = (row.cells as Node01[]).length
  const first = lineText(ctx.lines, pos.startLine)
  const pipe = first.indexOf('|')
  if (pipe < 0) return
  const prefix = first.slice(0, pipe)
  const chunks: string[][] = Array.from({ length: count }, () => [])
  for (let line = pos.startLine; line <= pos.endLine; line++) {
    const text = lineText(ctx.lines, line)
    const body = line === pos.startLine ? text.slice(pipe + 1) : text.slice(prefix.length).replace(/^\s*\+\s*/u, '')
    const parts = body.split('|').slice(0, count)
    if (parts.length < count) return
    for (let index = 0; index < count; index++) chunks[index]!.push(parts[index]!.trim())
  }
  const from = lineStart(ctx.lines, pos.startLine)
  const to = lineEnd(ctx.lines, pos.endLine)
  const cells = chunks.map((parts) => parts.join(' '))
  change(ctx, 'U-258', from, to, `${prefix}| ${cells.join(' | ')} |`,
    'code across a continuation row kept on one pipe-table row')
}

/** C2-B-223 ends inline content at a continuation fragment; one row keeps the old code span. */
export function wrappedCodeTableRow(ctx: Context): void {
  for (const { node } of ctx.visits) if (node.pos !== undefined && wrappedCodeRow(node)) flattenRow(ctx, node)
}

/** U-376 also applies when another rule moves the same abbreviation definition. */
export function abbreviationSpaces(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (node.type !== 'abbreviation_def' || node.pos === undefined) continue
    const start = node.pos.startOffset
    const source = ctx.src.slice(start, lineEnd(ctx.lines, node.pos.startLine))
    const match = /^\*\[[^\]\n]+\]:( {2,})/u.exec(source)
    if (match?.[1] === undefined) continue
    const from = start + match[0].length - match[1].length + 1
    change(ctx, 'U-376', from, from + match[1].length - 1, '',
      'extra abbreviation separator spaces removed so the expansion keeps its 0.1 title')
  }
}

/** An attribute-only line can leave an empty 0.1 quote that 0.2 otherwise drops. */
export function emptyAttributeQuote(ctx: Context): void {
  const lines: number[] = []
  for (const { node } of ctx.visits) {
    if (node.type !== 'block_quote' || node.pos === undefined || (node.children?.length ?? 0) !== 0
      || node.pos.startLine !== node.pos.endLine) continue
    const line = node.pos.startLine
    if (ctx.blocks.leaf[line - 1]?.node.type !== 'paragraph'
      || !/^[ \t]*>[ \t]*\{[^}\n]*\}[ \t]*$/u.test(lineText(ctx.lines, line))) continue
    lines.push(line)
  }
  if (lines.length === 0) return
  const masked = new Uint8Array(ctx.src.length + 1)
  for (const line of lines) masked.fill(1, lineStart(ctx.lines, line), lineEnd(ctx.lines, line) + 1)
  ctx.findings = ctx.findings.filter(({ edit }) => edit === null || masked[edit.start] !== 1)
  for (const line of lines) {
    change(ctx, 'U-034', lineStart(ctx.lines, line), lineEnd(ctx.lines, line), '\n> ',
      'an attribute-only quote kept as an empty quote after a paragraph break')
  }
}

/** A shifted list marker can still attach to the preceding list across a type boundary. */
export function siblingListBoundary(ctx: Context): void {
  for (const visit of ctx.visits) {
    const list = visit.node
    const above = visit.siblings[visit.index - 1]
    if (list.type !== 'list' || list.pos === undefined || above?.type !== 'list' || above.pos === undefined
      || list.ordered === above.ordered || list.pos.startLine !== above.pos.endLine + 1) continue
    const line = lineText(ctx.lines, list.pos.startLine)
    const indent = /^ +/u.exec(line)?.[0]
    if (indent === undefined || !/^(?:[-+*]|[0-9]+[.)]) /u.test(line.slice(indent.length))) continue
    const start = lineStart(ctx.lines, list.pos.startLine)
    change(ctx, 'U-023', start, start + indent.length, '\n',
      'sibling list separated and its marker moved to the list column')
  }
}

/** Keep a quote's two old paragraphs outside the preceding list after U-017 moves its first line. */
export function siblingQuoteParagraphs(ctx: Context): void {
  for (const visit of ctx.visits) {
    const quote = visit.node
    const above = visit.siblings[visit.index - 1]
    if (quote.type !== 'block_quote' || quote.pos === undefined || above?.type !== 'list'
      || above.pos?.endLine !== quote.pos.startLine - 1 || quote.children?.length !== 2
      || quote.children.some((child) => child.type !== 'paragraph' || child.pos === undefined)) continue
    const first = quote.children[0]!
    const second = quote.children[1]!
    const opener = quote.pos.startLine
    if (first.pos!.startLine !== opener + 1 || second.pos!.startLine !== first.pos!.endLine + 1
      || !/^>[ \t]*\+[ \t]*$/u.test(lineText(ctx.lines, opener))) continue
    const later = lineText(ctx.lines, second.pos!.startLine)
    const match = /^([ \t]*)>[ \t]+\S/u.exec(later)
    if (match === null) continue
    const start = lineStart(ctx.lines, opener)
    const after = lineStart(ctx.lines, second.pos!.startLine)
    change(ctx, 'U-126', start, start, '\n', 'sibling quote separated from the preceding list')
    change(ctx, 'U-125', after, after + match[1]!.length, '>\n',
      'empty quote line keeps the later old paragraph inside its sibling quote')
  }
}
