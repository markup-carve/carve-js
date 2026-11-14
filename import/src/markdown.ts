import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { frontmatter } from 'micromark-extension-frontmatter'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown } from 'mdast-util-math'
import { directive } from 'micromark-extension-directive'
import { directiveFromMarkdown } from 'mdast-util-directive'
import type { RootContent, PhrasingContent, TableRow } from 'mdast'
import type { Block, DocumentNode, Inline, TableCellNode, TableRowNode } from '../../v2/src/index.ts'
import { assertNever, attrsOf, cell, coalesce, complete, finding, list, paragraph, row, safeUrl, text,
  type Context, type ImportResult } from './kit.ts'

function range(node: { position?: { start: { offset?: number | undefined }, end: { offset?: number | undefined } } | undefined }):
  [number | undefined, number | undefined] {
  return [node.position?.start.offset, node.position?.end.offset]
}

function loss(context: Context, node: RootContent | PhrasingContent, message: string): void {
  const [start, end] = range(node)
  finding(context, 'import-degraded', node.type, message, start, end)
}

function inlineList(nodes: PhrasingContent[], context: Context): Inline[] {
  return coalesce(nodes.flatMap(node => inline(node, context)))
}

type PlainInline = Extract<PhrasingContent, { type: 'text' | 'break' | 'inlineCode' | 'inlineMath' | 'html' |
  'footnoteReference' | 'image' | 'imageReference' }>

function isPlainInline(node: PhrasingContent): node is PlainInline {
  return ['text', 'break', 'inlineCode', 'inlineMath', 'html', 'footnoteReference', 'image', 'imageReference'].includes(node.type)
}

function plainInline(node: PlainInline, context: Context): Inline[] {
  switch (node.type) {
    case 'text': return [text(node.value)]
    case 'break': return [{ type: 'hard_break' }]
    case 'inlineCode': return [{ type: 'code', value: node.value }]
    case 'inlineMath': return [{ type: 'math', display: false, value: node.value }]
    case 'html': return [{ type: 'raw_inline', format: 'html', value: node.value }]
    case 'footnoteReference': return [{ type: 'footnote_ref', key: node.identifier, namespace: 'footnote' }]
    case 'image': {
      const src = safeUrl(context, node.type, node.url, ...range(node))
      return [{ type: 'image', ...(src !== undefined ? { src } : {}), alt: node.alt ?? '',
        ...(node.title !== null && node.title !== undefined ? { tooltip: node.title } : {}) }]
    }
    case 'imageReference': return imageReference(node, context)
    default: return assertNever(node)
  }
}

function imageReference(node: Extract<PhrasingContent, { type: 'imageReference' }>, context: Context): Inline[] {
  if (node.referenceType === 'shortcut') loss(context, node, 'Shortcut image reference became a full reference')
  return [{ type: 'image', key: node.identifier, namespace: 'link', alt: node.alt ?? '',
    refForm: node.referenceType === 'collapsed' ? 'collapsed' : 'full' }]
}

function inline(node: PhrasingContent, context: Context): Inline[] {
  if (isPlainInline(node)) return plainInline(node, context)
  switch (node.type) {
    case 'emphasis': return [{ type: 'emphasis', children: inlineList(node.children, context) }]
    case 'strong': return [{ type: 'strong', children: inlineList(node.children, context) }]
    case 'delete': return [{ type: 'strike', children: inlineList(node.children, context) }]
    case 'link': {
      const href = safeUrl(context, node.type, node.url, ...range(node))
      return [{ type: 'link', children: inlineList(node.children, context), ...(href !== undefined ? { href } : {}),
        ...(node.title !== null && node.title !== undefined ? { tooltip: node.title } : {}) }]
    }
    case 'linkReference':
      if (node.referenceType === 'shortcut') loss(context, node, 'Shortcut link reference became a full reference')
      return [{ type: 'link', children: inlineList(node.children, context), key: node.identifier,
        namespace: 'link', refForm: node.referenceType === 'collapsed' ? 'collapsed' : 'full' }]
    case 'textDirective':
      loss(context, node, `Directive ${node.name} mapped to a span`)
      return [{ type: 'span', children: inlineList(node.children, context),
        attrs: attrsOf(Object.entries(node.attributes ?? {}).map(([key, value]) => [key, value ?? ''])) ??
          { classes: [node.name] } }]
    default: return assertNever(node)
  }
}

function tableRow(node: TableRow, header: boolean, context: Context): TableRowNode {
  const cells: TableCellNode[] = node.children.map(entry => cell(inlineList(entry.children, context), header))
  return row(cells)
}

function blocks(nodes: RootContent[], context: Context): DocumentNode['children'] {
  return nodes.flatMap(node => block(node, context))
}

type RootOnly = Extract<DocumentNode['children'][number], { type: 'frontmatter' | 'footnote' |
  'link_reference_definition' | 'abbreviation_def' | 'citation_definition' }>
function isRootOnly(node: DocumentNode['children'][number]): node is RootOnly {
  return ['frontmatter', 'footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition'].includes(node.type)
}

function contentBlocks(nodes: RootContent[], context: Context): Block[] {
  const result: Block[] = []
  for (const node of nodes) {
    for (const entry of block(node, context)) {
      if (isRootOnly(entry)) {
        loss(context, node, `${entry.type} moved to document level`)
        context.deferred?.push(entry)
      } else {
        result.push(entry)
      }
    }
  }
  return result
}

type PlainBlock = Extract<RootContent, { type: 'paragraph' | 'heading' | 'thematicBreak' | 'code' | 'math' |
  'html' | 'yaml' | 'toml' | 'definition' | 'footnoteDefinition' }>

function isPlainBlock(node: RootContent): node is PlainBlock {
  return ['paragraph', 'heading', 'thematicBreak', 'code', 'math', 'html', 'yaml', 'toml', 'definition',
    'footnoteDefinition'].includes(node.type)
}

function plainBlock(node: PlainBlock, context: Context): DocumentNode['children'] {
  switch (node.type) {
    case 'paragraph': return [paragraph(inlineList(node.children, context))]
    case 'heading': return [{ type: 'heading', level: node.depth, children: inlineList(node.children, context) }]
    case 'thematicBreak': return [{ type: 'thematic_break' }]
    case 'code': return codeBlock(node, context)
    case 'math': return [{ type: 'paragraph', role: 'math', children: [{ type: 'math', value: node.value, display: true }] }]
    case 'html': return [{ type: 'raw_block', format: 'html', value: node.value }]
    case 'yaml': return [{ type: 'frontmatter', format: 'yaml', value: node.value ? `${node.value}\n` : '' }]
    case 'toml': return [{ type: 'frontmatter', format: 'toml', value: node.value ? `${node.value}\n` : '' }]
    case 'definition': {
      const href = safeUrl(context, node.type, node.url, ...range(node))
      if (href === undefined) return []
      return [{ type: 'link_reference_definition', key: node.identifier, namespace: 'link', href,
        ...(node.title ? { tooltip: node.title } : {}) }]
    }
    case 'footnoteDefinition': return [{ type: 'footnote', key: node.identifier, namespace: 'footnote',
      children: contentBlocks(node.children, context) }]
    default: return assertNever(node)
  }
}

function codeBlock(node: Extract<RootContent, { type: 'code' }>, context: Context): Block[] {
  if (node.meta) loss(context, node, `Code fence meta ${node.meta} has no typed Carve field`)
  return [{ type: 'code_block', value: node.value, ...(node.lang ? { syntax: node.lang } : {}) }]
}

type StructuredBlock = Extract<RootContent, { type: 'blockquote' | 'list' | 'table' | 'leafDirective' |
  'containerDirective' }>

function isStructuredBlock(node: RootContent): node is StructuredBlock {
  return ['blockquote', 'list', 'table', 'leafDirective', 'containerDirective'].includes(node.type)
}

function structuredBlock(node: StructuredBlock, context: Context): DocumentNode['children'] {
  switch (node.type) {
    case 'blockquote': return [markdownQuote(node, context)]
    case 'list': return [list(node.ordered ?? false, node.children.map(item => ({ type: 'list_item',
      children: contentBlocks(item.children, context), ...(item.checked !== null && item.checked !== undefined
        ? { task: { mark: item.checked ? 'x' : ' ' } } : {}) })), node.spread !== true, node.start ?? undefined)]
    case 'table': {
      const [head, ...body] = node.children
      const columns = (node.align ?? []).map(align => align ? { type: 'table_column' as const, align } :
        { type: 'table_column' as const })
      return [{ type: 'table', columns, children: [
        ...(head ? [{ type: 'table_head' as const, children: [tableRow(head, true, context)] }] : []),
        { type: 'table_body', children: body.map(entry => tableRow(entry, false, context)) },
      ] }]
    }
    case 'leafDirective':
    case 'containerDirective':
      return directiveBlock(node, context)
    default: return assertNever(node)
  }
}

function markdownQuote(node: Extract<RootContent, { type: 'blockquote' }>, context: Context): Block {
  const children = contentBlocks(node.children, context)
  const first = children[0]
  const marker = first?.type === 'paragraph' && first.children[0]?.type === 'text' ? first.children[0].value : ''
  const kind = context.format === 'gfm' ? alertKind(marker) : undefined
  if (kind === undefined) return { type: 'block_quote', children }
  const prefix = marker.slice(0, marker.indexOf(']') + 1)
  if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
    const remainder = first.children[0].value.slice(prefix.length)
    const remaining = remainder.startsWith('\n') ? remainder.slice(1) : remainder
    if (remaining) first.children[0].value = remaining
    else first.children.shift()
    if (first.children.length === 0) children.shift()
  }
  return { type: 'admonition', kind, children }
}

function alertKind(marker: string): Extract<Block, { type: 'admonition' }>['kind'] | undefined {
  const kinds = [
    ['[!NOTE]', 'note'], ['[!TIP]', 'tip'], ['[!IMPORTANT]', 'info'],
    ['[!WARNING]', 'warning'], ['[!CAUTION]', 'danger'],
  ] as const
  for (const [prefix, kind] of kinds) if (marker === prefix || marker.startsWith(`${prefix}\n`)) return kind
  return undefined
}

type MarkdownDirective = Extract<RootContent, { type: 'leafDirective' | 'containerDirective' }>
function directiveBlock(node: MarkdownDirective, context: Context): Block[] {
  const children = node.type === 'containerDirective' ? contentBlocks(node.children, context)
    : [paragraph(inlineList(node.children, context))]
  const attrs = attrsOf(Object.entries(node.attributes ?? {}).map(([key, value]) => [key, value ?? '']))
  if (isAdmonition(node.name)) return [{ type: 'admonition', kind: node.name, children,
    ...(attrs ? { attrs } : {}) }]
  if (isDirective(node.name)) return [{ type: 'directive', kind: node.name, children,
    ...(attrs ? { attrs } : {}) }]
  loss(context, node, `Directive ${node.name} mapped to a div`)
  return [{ type: 'div', children, attrs: { classes: [node.name, ...(attrs?.classes ?? [])],
    ...(attrs?.id ? { id: attrs.id } : {}), ...(attrs?.keyValues ? { keyValues: attrs.keyValues } : {}) } }]
}

function isAdmonition(name: string): name is Extract<Block, { type: 'admonition' }>['kind'] {
  return ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'].includes(name)
}

function isDirective(name: string): name is Extract<Block, { type: 'directive' }>['kind'] {
  return ['bibliography', 'footnotes', 'glossary', 'index', 'references', 'toc'].includes(name)
}

type Orphan = Extract<RootContent, { type: 'listItem' | 'tableCell' | 'tableRow' }>
function isOrphan(node: RootContent): node is Orphan {
  return ['listItem', 'tableCell', 'tableRow'].includes(node.type)
}

function block(node: RootContent, context: Context): DocumentNode['children'] {
  if (isPlainBlock(node)) return plainBlock(node, context)
  if (isStructuredBlock(node)) return structuredBlock(node, context)
  if (isOrphan(node)) {
    const [start, end] = range(node)
    finding(context, 'import-unsupported', node.type, `Orphan ${node.type} has no block position`, start, end)
    return []
  }
  return [paragraph(inline(node, context))]
}

export function importMarkdown(input: string, from: 'markdown' | 'gfm'): ImportResult {
  const context: Context = { format: from, input, diagnostics: [], deferred: [] }
  const extensions = [frontmatter(['yaml', 'toml']), math(), directive(), ...(from === 'gfm' ? [gfm()] : [])]
  const mdastExtensions = [frontmatterFromMarkdown(['yaml', 'toml']), mathFromMarkdown(), directiveFromMarkdown(),
    ...(from === 'gfm' ? [gfmFromMarkdown()] : [])]
  const foreign = fromMarkdown(input, { extensions, mdastExtensions })
  const children = blocks(foreign.children, context)
  return complete(context, [...children, ...(context.deferred ?? [])])
}
