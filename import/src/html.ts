import { defaultTreeAdapter, parse, parseFragment, serializeOuter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import type { Attrs, Block, Inline, RubyPairNode, TableCellNode, TableRowNode } from '../../v2/src/index.ts'
import { attrsOf, cell, classNames, coalesce, complete, ensureForeignDepth, finding, list, paragraph, row, safeUrl, text,
  type Context, type ImportResult } from './kit.ts'

function attr(node: Html.Element, name: string): string | undefined {
  return node.attrs.find(item => item.name === name)?.value
}

function htmlInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  let at = 0
  while (value[at] === ' ' || value[at] === '\t' || value[at] === '\n' || value[at] === '\r') at++
  const start = at
  if (value[at] === '+' || value[at] === '-') at++
  const digits = at
  while (at < value.length && value.charCodeAt(at) >= 48 && value.charCodeAt(at) <= 57) at++
  if (at === digits) return undefined
  const result = Number(value.slice(start, at))
  return Number.isSafeInteger(result) ? result : undefined
}

function htmlSpan(value: string | undefined): number | undefined {
  const parsed = htmlInteger(value)
  return parsed !== undefined && parsed > 1 ? parsed : undefined
}

function attrs(node: Html.Element, omit: readonly string[] = []): { attrs?: Attrs, lang?: string,
  dir?: 'ltr' | 'rtl' | 'auto', data?: Record<string, unknown> } {
  const mapped = attrsOf(node.attrs.filter(item => !omit.includes(item.name) && !item.name.startsWith('on') &&
    item.name !== 'lang' && item.name !== 'dir')
    .map(item => [item.name, item.value]))
  const result: { attrs?: Attrs, lang?: string, dir?: 'ltr' | 'rtl' | 'auto', data?: Record<string, unknown> } = {}
  if (mapped) result.attrs = mapped
  const lang = attr(node, 'lang')
  const dir = attr(node, 'dir')
  if (lang) result.lang = lang
  if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') result.dir = dir
  const alignment = styleAlignment(attr(node, 'style'))
  if (alignment !== undefined) result.data = { 'carve.style': { alignment } }
  return result
}

function styleAlignment(style: string | undefined): 'start' | 'center' | 'end' | 'justify' | undefined {
  if (style === undefined) return undefined
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== 'text-align') continue
    const value = declaration.slice(colon + 1).trim().toLowerCase()
    if (value === 'left') return 'start'
    if (value === 'right') return 'end'
    if (value === 'center' || value === 'justify') return value
  }
  return undefined
}

function location(node: Html.ChildNode): [number | undefined, number | undefined] {
  return [node.sourceCodeLocation?.startOffset, node.sourceCodeLocation?.endOffset]
}

function degraded(context: Context, node: Html.ChildNode, message: string): void {
  const [start, end] = location(node)
  finding(context, 'import-degraded', node.nodeName, message, start, end)
}

function htmlRowspan(node: Html.Element, context: Context): number | undefined {
  const raw = attr(node, 'rowspan')
  if (htmlInteger(raw) === 0) degraded(context, node, 'HTML rowspan=0 extends to the end of its row group')
  return htmlSpan(raw)
}

function unsupported(context: Context, node: Html.ChildNode, message: string): void {
  const [start, end] = location(node)
  finding(context, 'import-unsupported', node.nodeName, message, start, end)
}

function isElement(node: Html.ChildNode): node is Html.Element { return defaultTreeAdapter.isElementNode(node) }
function isText(node: Html.ChildNode): node is Html.TextNode { return defaultTreeAdapter.isTextNode(node) }
function isComment(node: Html.ChildNode): node is Html.CommentNode { return defaultTreeAdapter.isCommentNode(node) }
function elements(node: Html.Element): Html.Element[] { return content(node).filter(isElement) }
function content(node: Html.Element): Html.ChildNode[] { return node.childNodes }

function footnoteKey(fragment: string): string {
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment
  for (const prefix of ['user-content-fn-', 'fn-', 'fn']) if (hash.startsWith(prefix)) return hash.slice(prefix.length)
  return hash
}

function isFootnoteSection(node: Html.Element): boolean {
  return attr(node, 'role') === 'doc-endnotes' || classNames(attr(node, 'class') ?? '').includes('footnotes')
}

function plain(node: Html.ChildNode): string {
  if (isText(node)) return node.value
  if (!isElement(node)) return ''
  return content(node).map(plain).join('')
}

function inlineChildren(node: Html.Element, context: Context): Inline[] {
  return coalesce(content(node).flatMap(child => inline(child, context)))
}

function inline(node: Html.ChildNode, context: Context): Inline[] {
  if (isText(node)) return [text(node.value)]
  if (isComment(node)) return [{ type: 'raw_inline', format: 'html', value: serializeOuter(node) }]
  if (isElement(node)) return inlineElement(node, context)
  unsupported(context, node, 'Doctype has no inline representation')
  return []
}

function inlineElement(node: Html.Element, context: Context): Inline[] {
  const footnote = footnoteInline(node, context)
  if (footnote !== undefined) return footnote
  const children = inlineChildren(node, context)
  const formatted = formatInline(node, children)
  if (formatted !== undefined) return formatted
  switch (node.tagName) {
    case 'br': return [{ type: 'hard_break' }]
    case 'wbr': degraded(context, node, 'Word break became a soft break'); return [{ type: 'soft_break' }]
    case 'span': return [{ type: 'span', children, ...attrs(node) }]
    case 'a': return htmlLink(node, children, context)
    case 'img': return htmlImage(node, context)
    case 'math': return htmlMath(node, context)
    case 'ruby': return htmlRuby(node, context)
    case 'abbr': {
      const expansion = attr(node, 'title')
      return [{ type: 'abbreviation', key: plain(node), namespace: 'abbr',
        ...(expansion !== undefined ? { expansion } : {}) }]
    }
    case 'input': unsupported(context, node, 'Standalone input has no Carve inline node'); return []
    default:
      degraded(context, node, `HTML ${node.tagName} mapped to a span`)
      return [{ type: 'span', children, ...attrs(node) }]
  }
}

function htmlMath(node: Html.Element, context: Context): Inline[] {
  const annotation = elements(node).flatMap(child => elements(child)).find(child => child.tagName === 'annotation' &&
    ['application/x-tex', 'text/x-tex', 'LaTeX'].includes(attr(child, 'encoding') ?? ''))
  const source = annotation ? plain(annotation) : attr(node, 'alttext')
  if (source !== undefined) return [{ type: 'math', display: attr(node, 'display') === 'block', value: source }]
  unsupported(context, node, 'MathML has no TeX annotation or alttext')
  return [text(plain(node))]
}

function htmlRuby(node: Html.Element, context: Context): Inline[] {
  const pairs: RubyPairNode[] = []
  let base: Inline[] = []
  for (const child of content(node)) {
    if (isElement(child) && child.tagName === 'rt') {
      pairs.push({ type: 'ruby_pair', base: coalesce(base), annotation: inlineChildren(child, context) })
      base = []
    } else if (isElement(child) && child.tagName === 'rp') {
      degraded(context, child, 'Ruby parentheses omitted')
    } else if (isElement(child) && child.tagName === 'rb') {
      base.push(...inlineChildren(child, context))
    } else {
      base.push(...inline(child, context))
    }
  }
  if (base.length) degraded(context, node, 'Ruby base without annotation became text')
  return pairs.length ? [{ type: 'ruby', pairs }, ...base] : base
}

function footnoteInline(node: Html.Element, context: Context): Inline[] | undefined {
  if (node.tagName === 'a' && attr(node, 'role') === 'doc-backlink') {
    degraded(context, node, 'Generated footnote backlink omitted')
    return []
  }
  if (node.tagName === 'a' && (attr(node, 'role') === 'doc-noteref' || attr(node, 'data-footnote-ref') !== undefined)) {
    return [{ type: 'footnote_ref', key: footnoteKey(attr(node, 'href') ?? ''), namespace: 'footnote' }]
  }
  if (node.tagName === 'sup' && classNames(attr(node, 'class') ?? '').includes('footnote-ref')) {
    const anchor = elements(node).find(child => child.tagName === 'a')
    if (anchor) return [{ type: 'footnote_ref', key: footnoteKey(attr(anchor, 'href') ?? ''), namespace: 'footnote' }]
  }
  return undefined
}

function htmlLink(node: Html.Element, children: Inline[], context: Context): Inline[] {
  const href = attr(node, 'href')
  const safe = href === undefined ? undefined : safeUrl(context, node.tagName, href, ...location(node))
  const tooltip = attr(node, 'title')
  return [{ type: 'link', children, ...(safe !== undefined ? { href: safe } : {}),
    ...(tooltip !== undefined ? { tooltip } : {}), ...attrs(node, ['href', 'title']) }]
}

function htmlImage(node: Html.Element, context: Context): Inline[] {
  const src = attr(node, 'src')
  const safe = src === undefined ? undefined : safeUrl(context, node.tagName, src, ...location(node))
  const long = attr(node, 'longdesc')
  const longSafe = long === undefined ? undefined : safeUrl(context, 'img.longdesc', long, ...location(node))
  const longDescription = longSafe !== undefined ? [paragraph([{ type: 'link' as const, href: longSafe,
    children: [text(longSafe)] }])] : undefined
  const tooltip = attr(node, 'title')
  return [{ type: 'image', ...(safe !== undefined ? { src: safe } : {}), alt: attr(node, 'alt') ?? '',
    ...(tooltip !== undefined ? { tooltip } : {}),
    ...(longDescription ? { longDescription } : {}), ...attrs(node, ['src', 'alt', 'title', 'longdesc']) }]
}

function formatInline(node: Html.Element, children: Inline[]): Inline[] | undefined {
  switch (node.tagName) {
    case 'em': case 'i': return [{ type: 'emphasis', children, ...attrs(node) }]
    case 'strong': case 'b': return [{ type: 'strong', children, ...attrs(node) }]
    case 's': case 'strike': return [{ type: 'strike', children, ...attrs(node) }]
    case 'del': return [{ type: 'delete', children, ...attrs(node) }]
    case 'ins': return [{ type: 'insert', children, ...attrs(node) }]
    case 'mark': return [{ type: 'highlight', children, ...attrs(node) }]
    case 'u': return [{ type: 'underline', children, ...attrs(node) }]
    case 'sub': return [{ type: 'subscript', children, ...attrs(node) }]
    case 'sup': return [{ type: 'superscript', children, ...attrs(node) }]
    case 'code': return [{ type: 'code', value: plain(node), ...attrs(node) }]
    default: return undefined
  }
}

function blockChildren(node: Html.Element, context: Context): Block[] {
  return content(node).flatMap(child => block(child, context))
}

function tableCell(node: Html.Element, context: Context): TableCellNode {
  const hasBlocks = elements(node).some(child => ['p', 'ul', 'ol', 'div', 'blockquote', 'pre', 'table', 'dl', 'figure']
    .includes(child.tagName))
  const result: TableCellNode = hasBlocks ? { type: 'table_cell', header: node.tagName === 'th',
    children: blockChildren(node, context) } : cell(inlineChildren(node, context), node.tagName === 'th')
  const colspan = htmlSpan(attr(node, 'colspan'))
  const rowspan = htmlRowspan(node, context)
  if (colspan !== undefined) result.colspan = colspan
  if (rowspan !== undefined) result.rowspan = rowspan
  const scope = attr(node, 'scope')
  if (scope === 'col' || scope === 'row' || scope === 'colgroup' || scope === 'rowgroup') result.scope = scope
  const align = attr(node, 'align')
  if (align === 'left' || align === 'right' || align === 'center') result.align = align
  const valign = attr(node, 'valign')
  if (valign === 'top' || valign === 'middle' || valign === 'bottom' || valign === 'baseline') result.valign = valign
  Object.assign(result, attrs(node, ['colspan', 'rowspan', 'scope', 'align', 'valign']))
  return result
}

function rows(node: Html.Element, context: Context): TableRowNode[] {
  if (node.tagName !== 'table') {
    for (const child of elements(node)) if (child.tagName !== 'tr') unsupported(context, child, 'Non-row child in table group')
  }
  return elements(node).filter(child => child.nodeName === 'tr').map(child => {
    for (const entry of elements(child)) {
      if (entry.nodeName !== 'th' && entry.nodeName !== 'td') unsupported(context, entry, 'Non-cell child in HTML row')
    }
    return { ...row(elements(child).filter(entry => entry.nodeName === 'th' || entry.nodeName === 'td')
      .map(entry => tableCell(entry, context))), ...attrs(child) }
  })
}

function table(node: Html.Element, context: Context): Block {
  const direct = rows(node, context)
  const groups = elements(node).filter(child => child.nodeName === 'thead' || child.nodeName === 'tbody' ||
    child.nodeName === 'tfoot')
  const children: Extract<Block, { type: 'table' }>['children'] = groups.map(group => {
    if (group.nodeName === 'thead') return { type: 'table_head', children: rows(group, context), ...attrs(group) }
    if (group.nodeName === 'tfoot') return { type: 'table_foot', children: rows(group, context), ...attrs(group) }
    return { type: 'table_body', children: rows(group, context), ...attrs(group) }
  })
  if (direct.length) children.unshift({ type: 'table_body', children: direct })
  if (!children.some(group => group.type === 'table_body')) children.push({ type: 'table_body', children: [] })
  const width = Math.max(0, ...children.flatMap(group => group.type === 'comment' ? [] : group.children
    .filter(entry => entry.type === 'table_row').map(entry => entry.children.reduce((sum, entryCell) =>
      sum + (entryCell.colspan ?? 1), 0))))
  const caption = elements(node).find(child => child.nodeName === 'caption')
  for (const child of elements(node)) {
    if (!['caption', 'thead', 'tbody', 'tfoot', 'tr'].includes(child.tagName)) {
      unsupported(context, child, `Unsupported table child ${child.tagName}`)
    }
  }
  return { type: 'table', children, columns: Array.from({ length: width }, () => ({ type: 'table_column' })),
    ...(caption ? { caption: { type: 'caption', children: [paragraph(inlineChildren(caption, context))],
      ...attrs(caption) } } : {}), ...attrs(node) }
}

function definitionList(node: Html.Element, context: Context): Block {
  const children: Extract<Block, { type: 'definition_list' }>['children'] = []
  for (const child of content(node)) {
    if (child.nodeName === 'dt') children.push({ type: 'definition_term', children: inlineChildren(child, context),
      ...attrs(child) })
    else if (child.nodeName === 'dd') children.push({ type: 'definition_description',
      children: blockChildren(child, context), ...attrs(child) })
    else if (!isText(child) || child.value.trim()) unsupported(context, child, 'Unexpected definition list child')
  }
  return { type: 'definition_list', children, ...attrs(node) }
}

function listItem(node: Html.Element, context: Context): Extract<Block, { type: 'list' }>['children'][number] {
  const checkbox = elements(node).find(child => child.nodeName === 'input' && attr(child, 'type') === 'checkbox')
  if (checkbox && checkbox.attrs.some(entry => !['type', 'checked', 'disabled'].includes(entry.name))) {
    degraded(context, checkbox, 'Checkbox attributes outside task state omitted')
  }
  const children = content(node).filter(child => child !== checkbox).flatMap((child, index) => {
    if (checkbox && index === 0 && isText(child) && child.value.startsWith(' ')) {
      return [paragraph([text(child.value.slice(1))])]
    }
    return block(child, context)
  })
  return { type: 'list_item', children, ...(checkbox ? { task: { mark: attr(checkbox, 'checked') !== undefined ? 'x' : ' ' } } : {}),
    ...attrs(node) }
}

function block(node: Html.ChildNode, context: Context): Block[] {
  if (isText(node)) return node.value.trim() ? [paragraph([text(node.value)])] : []
  if (isComment(node)) return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
  if (isElement(node)) return blockElement(node, context)
  degraded(context, node, 'Doctype omitted from Carve tree')
  return []
}

function blockElement(node: Html.Element, context: Context): Block[] {
  const simple = simpleBlockElement(node, context)
  if (simple !== undefined) return simple
  switch (node.tagName) {
    case 'ul': case 'ol': return htmlList(node, context)
    case 'pre': return htmlPre(node, context)
    case 'table': return [table(node, context)]
    case 'dl': return [definitionList(node, context)]
    case 'figure': {
      const caption = elements(node).find(child => child.nodeName === 'figcaption')
      const children = content(node).filter(child => child !== caption).flatMap(child => block(child, context))
      return [{ type: 'figure', children, ...(caption ? { caption: { type: 'caption',
        children: blockChildren(caption, context), ...attrs(caption) } } : {}),
        ...attrs(node) }]
    }
    case 'details': return detailsBlock(node, context)
    case 'script': case 'style': return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
    case 'template': degraded(context, node, 'HTML template retained as raw HTML');
      return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
    default: return fallbackBlock(node, context)
  }
}

function detailsBlock(node: Html.Element, context: Context): Block[] {
  degraded(context, node, 'Details disclosure mapped to a div')
  const mapped = attrs(node)
  return [{ type: 'div', children: blockChildren(node, context), ...mapped,
    attrs: { ...mapped.attrs, classes: ['details', ...(mapped.attrs?.classes ?? [])] } }]
}

function htmlPre(node: Html.Element, context: Context): Block[] {
  const code = elements(node).find(child => child.nodeName === 'code')
  const classes = code ? classNames(attr(code, 'class') ?? '') : []
  const language = classes.find(name => name.startsWith('language-'))?.slice(9)
  if (code && (code.attrs.some(entry => entry.name !== 'class') || classes.some(name => !name.startsWith('language-')))) {
    degraded(context, code, 'Code element attributes other than language omitted')
  }
  return [{ type: 'code_block', value: code ? plain(code) : plain(node), ...(language ? { syntax: language } : {}),
    ...attrs(node) }]
}

function htmlList(node: Html.Element, context: Context): Block[] {
  const items = elements(node).filter(child => child.nodeName === 'li').map(child => listItem(child, context))
  for (const child of elements(node)) if (child.tagName !== 'li') unsupported(context, child, 'Non-item child in HTML list')
  const start = htmlInteger(attr(node, 'start'))
  const result = list(node.tagName === 'ol', items, !items.some(item => item.children.some(child =>
    child.type === 'paragraph' && item.children.length > 1)), start)
  return [{ ...result, ...attrs(node, ['start', 'type']) }]
}

function simpleBlockElement(node: Html.Element, context: Context): Block[] | undefined {
  switch (node.tagName) {
    case 'p': return [{ type: 'paragraph', children: inlineChildren(node, context), ...attrs(node) }]
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return [{ type: 'heading',
      level: Number(node.tagName[1]), children: inlineChildren(node, context), ...attrs(node) }]
    case 'hr': return [{ type: 'thematic_break', ...attrs(node) }]
    case 'blockquote': return [{ type: 'block_quote', children: blockChildren(node, context), ...attrs(node) }]
    case 'section': return isFootnoteSection(node) ? footnoteSection(node, context) :
      [{ type: 'section', children: blockChildren(node, context), ...attrs(node) }]
    case 'div': return [{ type: 'div', children: blockChildren(node, context), ...attrs(node) }]
    default: return undefined
  }
}

function footnoteSection(node: Html.Element, context: Context): Block[] {
  const ordered = elements(node).find(child => child.tagName === 'ol')
  if (ordered === undefined) {
    unsupported(context, node, 'Footnote section has no ordered list')
    return []
  }
  for (const item of elements(ordered).filter(child => child.tagName === 'li')) {
    const id = attr(item, 'id')
    if (!id) { unsupported(context, item, 'Footnote has no id'); continue }
    context.deferred?.push({ type: 'footnote', key: footnoteKey(id), namespace: 'footnote',
      children: blockChildren(item, context) })
  }
  return []
}

function fallbackBlock(node: Html.Element, context: Context): Block[] {
  if (node.tagName === 'img') return [{ type: 'paragraph', role: 'image', children: htmlImage(node, context) }]
  if (node.tagName === 'math') {
    const children = htmlMath(node, context)
    return [{ type: 'paragraph', ...(children[0]?.type === 'math' ? { role: 'math' as const } : {}), children }]
  }
  if (['html', 'body', 'main', 'article'].includes(node.tagName)) {
    if (node.attrs.some(entry => !['lang', 'dir'].includes(entry.name))) {
      degraded(context, node, `HTML ${node.tagName} wrapper attributes omitted`)
    }
    return blockChildren(node, context)
  }
  if (['head', 'meta', 'link'].includes(node.tagName)) {
    if (node.tagName === 'head' && node.sourceCodeLocation === undefined && content(node).length === 0) return []
    unsupported(context, node, `HTML ${node.tagName} has no Carve block`)
    return []
  }
  return [paragraph(inline(node, context))]
}

function auditElement(node: Html.ChildNode, context: Context): void {
  if (!isElement(node)) return
  if (['script', 'style', 'template'].includes(node.tagName)) return
  for (const attribute of node.attrs) {
    if (attribute.name.startsWith('on')) unsupported(context, node, `Event attribute ${attribute.name} omitted`)
    if (attribute.name === 'dir' && !['ltr', 'rtl', 'auto'].includes(attribute.value)) {
      degraded(context, node, `Invalid direction ${attribute.value} omitted`)
    }
  }
  for (const child of content(node)) auditElement(child, context)
}

export function importHtml(input: string): ImportResult {
  const context: Context = { format: 'html', input, diagnostics: [], deferred: [] }
  const lower = input.toLowerCase()
  const full = lower.includes('<!doctype') || lower.includes('<html') || lower.includes('<head')
  const foreign = full ? parse(input, { sourceCodeLocationInfo: true }) :
    parseFragment(input, { sourceCodeLocationInfo: true })
  ensureForeignDepth(foreign, 'html')
  rootLanguage(foreign.childNodes, context)
  for (const child of foreign.childNodes) auditElement(child, context)
  return complete(context, [...foreign.childNodes.flatMap(child => block(child, context)), ...(context.deferred ?? [])])
}

function rootLanguage(nodes: Html.ChildNode[], context: Context): void {
  const html = nodes.find(child => isElement(child) && child.tagName === 'html')
  if (html && isElement(html)) {
    const body = elements(html).find(child => child.tagName === 'body')
    const lang = (body ? attr(body, 'lang') : undefined) ?? attr(html, 'lang')
    const dir = (body ? attr(body, 'dir') : undefined) ?? attr(html, 'dir')
    if (lang) context.rootLang = lang
    if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') context.rootDir = dir
  }
}
