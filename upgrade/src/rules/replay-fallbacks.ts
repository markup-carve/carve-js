import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineEnd, lineStart, lineText } from '../source.ts'

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
