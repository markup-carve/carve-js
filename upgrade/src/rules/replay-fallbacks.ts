import { change, type Context } from '../context.ts'
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

function rewriteDuplicateGroup(ctx: Context, list: Node01, items: EmptyDefinitionItem[]): void {
  if (list.pos === undefined) return
  const duplicates = repeatedItems(items)
  if (duplicates.length < 2) return
  const from = lineStart(ctx.lines, list.pos.startLine)
  const to = lineEnd(ctx.lines, list.pos.endLine)
  for (let index = ctx.findings.length - 1; index >= 0; index--) {
    const edit = ctx.findings[index]!.edit
    if (edit !== null && edit.start >= from && edit.start <= to) ctx.findings.splice(index, 1)
  }
  const message = 'duplicate definitions consumed by empty list items lifted above their list'
  change(ctx, 'U-038', from, from, `${duplicates[0]!.body}\n\n`, message)
  for (const item of duplicates) change(ctx, 'U-038', item.start, item.end, '{% %}', message)
  if (list.pos.endLine < ctx.lines.count && lineText(ctx.lines, list.pos.endLine + 1).trim() !== '') {
    change(ctx, 'U-038', to, to, '\n', message)
  }
}

/** Duplicate definitions consumed by empty sibling items in 0.1 move outside their list. */
export function duplicateItemDefinitions(ctx: Context): void {
  const groups = new Map<Node01, EmptyDefinitionItem[]>()
  for (const visit of ctx.visits) {
    if (visit.parent?.node.type !== 'list') continue
    const item = emptyDefinitionItem(ctx, visit.node)
    if (item === null) continue
    const list = groups.get(visit.parent.node) ?? []
    list.push(item)
    groups.set(visit.parent.node, list)
  }
  for (const [list, items] of groups) rewriteDuplicateGroup(ctx, list, items)
}
