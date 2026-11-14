import { parse, type Block as DjotBlock, type Inline as DjotInline, type Doc, type Row } from '@djot/djot'
import type { Attrs, Block, DocumentNode, Inline, TableCellNode, TableRowNode } from '../../v2/src/index.ts'
import { assertNever, attrsOf, cell, coalesce, complete, finding, list, paragraph, row, safeUrl, text,
  type Context, type ImportResult } from './kit.ts'

function djotAttrs(node: { attributes?: Record<string, string> }): { attrs: Attrs } | Record<string, never> {
  const attrs = attrsOf(Object.entries(node.attributes ?? {}))
  return attrs ? { attrs } : {}
}

function djotLoss(context: Context, node: { tag: string, pos?: { start: { offset: number }, end: { offset: number } } },
  message: string): void {
  finding(context, 'import-degraded', node.tag, message, node.pos?.start.offset, node.pos?.end.offset)
}

function textOf(nodes: DjotInline[]): string {
  return nodes.map(node => {
    if ('text' in node) return node.text
    if ('children' in node) return textOf(node.children)
    return ''
  }).join('')
}

function inlines(nodes: DjotInline[], context: Context): Inline[] {
  return coalesce(nodes.flatMap(node => inline(node, context)))
}

type LeafInline = Extract<DjotInline, { tag: 'str' | 'soft_break' | 'hard_break' | 'non_breaking_space' |
  'verbatim' | 'raw_inline' | 'inline_math' | 'display_math' | 'symb' | 'url' | 'email' | 'footnote_reference' |
  'smart_punctuation' }>
function isLeafInline(node: DjotInline): node is LeafInline {
  return ['str', 'soft_break', 'hard_break', 'non_breaking_space', 'verbatim', 'raw_inline', 'inline_math',
    'display_math', 'symb', 'url', 'email', 'footnote_reference', 'smart_punctuation'].includes(node.tag)
}

function leafInline(node: LeafInline, context: Context): Inline[] {
  switch (node.tag) {
    case 'str': return [text(node.text)]
    case 'soft_break': return [{ type: 'soft_break' }]
    case 'hard_break': return [{ type: 'hard_break' }]
    case 'non_breaking_space': return [{ type: 'non_breaking_space' }]
    case 'verbatim': return [{ type: 'code', value: node.text, ...djotAttrs(node) }]
    case 'raw_inline': return [{ type: 'raw_inline', format: node.format, value: node.text, ...djotAttrs(node) }]
    case 'inline_math': return [{ type: 'math', display: false, value: node.text }]
    case 'display_math': return [{ type: 'math', display: true, value: node.text }]
    case 'symb': return [{ type: 'symbol', name: node.alias }]
    case 'url': return djotUrl(node, context)
    case 'email': return [{ type: 'autolink', href: `mailto:${node.text}`, text: node.text }]
    case 'footnote_reference': return [{ type: 'footnote_ref', key: node.text, namespace: 'footnote' }]
    case 'smart_punctuation': {
      const kind = node.type === 'ellipses' ? 'ellipsis' : node.type
      return [{ type: 'smart_punctuation', kind, source: node.text }]
    }
    default: return assertNever(node)
  }
}

function djotUrl(node: Extract<DjotInline, { tag: 'url' }>, context: Context): Inline[] {
  const href = safeUrl(context, node.tag, node.text, node.pos?.start.offset, node.pos?.end.offset)
  return href === undefined ? [text(node.text)] : [{ type: 'autolink', href }]
}

type StyledInline = Extract<DjotInline, { tag: 'emph' | 'strong' | 'mark' | 'superscript' | 'subscript' |
  'insert' | 'delete' | 'span' }>
function isStyledInline(node: DjotInline): node is StyledInline {
  return ['emph', 'strong', 'mark', 'superscript', 'subscript', 'insert', 'delete', 'span'].includes(node.tag)
}

function styledInline(node: StyledInline, context: Context): Inline[] {
  switch (node.tag) {
    case 'emph': return [{ type: 'emphasis', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'strong': return [{ type: 'strong', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'mark': return [{ type: 'highlight', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'superscript': return [{ type: 'superscript', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'subscript': return [{ type: 'subscript', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'insert': return [{ type: 'insert', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'delete': return [{ type: 'delete', children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'span': return [{ type: 'span', children: inlines(node.children, context), ...djotAttrs(node) }]
    default: return assertNever(node)
  }
}

function inline(node: DjotInline, context: Context): Inline[] {
  if (isLeafInline(node)) return leafInline(node, context)
  if (isStyledInline(node)) return styledInline(node, context)
  switch (node.tag) {
    case 'double_quoted':
    case 'single_quoted': return quoteInline(node, context)
    case 'link': return linkInline(node, context)
    case 'image': return imageInline(node, context)
    default: return assertNever(node)
  }
}

function quoteInline(node: Extract<DjotInline, { tag: 'double_quoted' | 'single_quoted' }>, context: Context): Inline[] {
  djotLoss(context, node, 'Quote punctuation mapped to text')
  return [text(node.tag === 'double_quoted' ? '“' : '‘'), ...inlines(node.children, context),
    text(node.tag === 'double_quoted' ? '”' : '’')]
}

function linkInline(node: Extract<DjotInline, { tag: 'link' }>, context: Context): Inline[] {
  const href = node.destination ? safeUrl(context, node.tag, node.destination,
    node.pos?.start.offset, node.pos?.end.offset) : undefined
  return [{ type: 'link', children: inlines(node.children, context), ...(href !== undefined ? { href } : {}),
    ...(node.reference ? { key: node.reference, namespace: 'link' as const, refForm: 'full' as const } : {}),
    ...djotAttrs(node) }]
}

function imageInline(node: Extract<DjotInline, { tag: 'image' }>, context: Context): Inline[] {
  const src = node.destination ? safeUrl(context, node.tag, node.destination,
    node.pos?.start.offset, node.pos?.end.offset) : undefined
  return [{ type: 'image', alt: textOf(node.children), ...(src !== undefined ? { src } : {}),
    ...(node.reference ? { key: node.reference, namespace: 'link' as const, refForm: 'full' as const } : {}),
    ...djotAttrs(node) }]
}

function tableRow(node: Row, context: Context): TableRowNode {
  const cells: TableCellNode[] = node.children.map(entry => {
    const result = cell(inlines(entry.children, context), entry.head)
    if (entry.align !== 'default') result.align = entry.align
    return result
  })
  return row(cells)
}

function blocks(nodes: DjotBlock[], context: Context): Block[] { return nodes.flatMap(node => block(node, context)) }

type SimpleBlock = Extract<DjotBlock, { tag: 'para' | 'heading' | 'thematic_break' | 'section' | 'div' |
  'block_quote' | 'code_block' | 'raw_block' }>
function isSimpleBlock(node: DjotBlock): node is SimpleBlock {
  return ['para', 'heading', 'thematic_break', 'section', 'div', 'block_quote', 'code_block', 'raw_block'].includes(node.tag)
}

function simpleBlock(node: SimpleBlock, context: Context): Block[] {
  switch (node.tag) {
    case 'para': return [paragraph(inlines(node.children, context))]
    case 'heading': return [{ type: 'heading', level: node.level, children: inlines(node.children, context), ...djotAttrs(node) }]
    case 'thematic_break': return [{ type: 'thematic_break', ...djotAttrs(node) }]
    case 'section': return [{ type: 'section', children: blocks(node.children, context), ...djotAttrs(node) }]
    case 'div': return [{ type: 'div', children: blocks(node.children, context), ...djotAttrs(node) }]
    case 'block_quote': return [{ type: 'block_quote', children: blocks(node.children, context), ...djotAttrs(node) }]
    case 'code_block': return [{ type: 'code_block', value: node.text, ...(node.lang ? { syntax: node.lang } : {}),
      ...djotAttrs(node) }]
    case 'raw_block': return [{ type: 'raw_block', format: node.format, value: node.text, ...djotAttrs(node) }]
    default: return assertNever(node)
  }
}

function block(node: DjotBlock, context: Context): Block[] {
  if (isSimpleBlock(node)) return simpleBlock(node, context)
  switch (node.tag) {
    case 'bullet_list':
      if (node.style === '+') djotLoss(context, node, 'Plus list marker became a hyphen marker')
      return [list(false, node.children.map(item => ({ type: 'list_item', children: blocks(item.children, context),
        ...djotAttrs(item) })), node.tight)]
    case 'ordered_list': {
      const result = list(true, node.children.map(item => ({ type: 'list_item', children: blocks(item.children, context),
        ...djotAttrs(item) })), node.tight, node.start)
      const style = [...node.style].filter(char => char !== '(' && char !== ')' && char !== '.').join('')
      result.marker = { kind: 'ordered', style, delimiter: node.style.endsWith(')') ? ')' : '.',
        ...(node.start && node.start !== 1 ? { start: node.start } : {}) }
      if (node.style.startsWith('(')) djotLoss(context, node, 'Parenthesized marker became a plain marker')
      return [result]
    }
    case 'task_list': return [list(false, node.children.map(item => ({ type: 'list_item',
      children: blocks(item.children, context), task: { mark: item.checkbox === 'checked' ? 'x' : ' ' },
      ...djotAttrs(item) })), node.tight)]
    case 'definition_list': return [{ type: 'definition_list', children: node.children.flatMap(item => [
      { type: 'definition_term' as const, children: inlines(item.children[0].children, context) },
      { type: 'definition_description' as const, children: blocks(item.children[1].children, context) },
    ]) }]
    case 'table': return djotTable(node, context)
    default: return assertNever(node)
  }
}

function djotTable(node: Extract<DjotBlock, { tag: 'table' }>, context: Context): Block[] {
  const [caption, ...rows] = node.children
  const header = rows.filter(entry => entry.head).map(entry => tableRow(entry, context))
  const body = rows.filter(entry => !entry.head).map(entry => tableRow(entry, context))
  const width = Math.max(0, ...rows.map(entry => entry.children.length))
  return [{ type: 'table', columns: Array.from({ length: width }, () => ({ type: 'table_column' })),
    children: [...(header.length ? [{ type: 'table_head' as const, children: header }] : []),
      { type: 'table_body', children: body }],
    ...(caption && caption.children.length ? { caption: { type: 'caption' as const,
      children: [paragraph(inlines(caption.children, context))] } } : {}) }]
}

export function importDjot(input: string): ImportResult {
  const context: Context = { format: 'djot', input, diagnostics: [] }
  const foreign: Doc = parse(input, { sourcePositions: true })
  const children: DocumentNode['children'] = blocks(foreign.children, context)
  for (const ref of Object.values(foreign.references)) {
    const href = safeUrl(context, 'reference', ref.destination, ref.pos?.start.offset, ref.pos?.end.offset)
    if (href !== undefined) children.push({ type: 'link_reference_definition', key: ref.label, namespace: 'link', href })
  }
  for (const [key, ref] of Object.entries(foreign.autoReferences)) {
    if (foreign.references[key] !== undefined) continue
    const href = safeUrl(context, 'autoReference', ref.destination, ref.pos?.start.offset, ref.pos?.end.offset)
    if (href !== undefined) children.push({ type: 'link_reference_definition', key: ref.label, namespace: 'link', href })
  }
  for (const note of Object.values(foreign.footnotes)) children.push({ type: 'footnote',
    key: note.label, namespace: 'footnote', children: blocks(note.children, context) })
  return complete(context, children)
}
