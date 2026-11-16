import { parse, parseFragment, serializeOuter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import type {
  Block, CaptionNode, DocumentNode, Inline, LinkReferenceDefinitionNode, ListItemNode, ListNode, TableCellNode, TableColumnNode,
  TableNode, TableRowNode,
} from '../../v2/src/index.ts'
import { resolveTree } from '../../v2/src/index.ts'
import {
  attr, attrs, CARRIERS, classList, content, degraded, elements, has, ignoredCarrier, isBlank, isComment, isElement, isText, plain,
  unsupported, withoutClasses, withoutKeys, type HtmlContext, type MappedAttrs,
} from './html-dom.ts'
import { htmlImage, inline, inlineChildren, normalizeBreaks, trimInlineEdges } from './html-inline.ts'
import { collectNotes, isFootnoteSection } from './html-notes.ts'
import { abbreviationTemplate, collectTemplates } from './html-template.ts'
import { resolveAlignments } from './html-table-align.ts'
import { cell, coalesce, complete, documentOf, ensureForeignDepth, paragraph, row, softText, type ImportResult } from './kit.ts'

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'section', 'div', 'ul', 'ol', 'dl', 'pre',
  'table', 'figure', 'figcaption', 'aside', 'details', 'summary', 'template', 'script', 'style', 'html', 'body', 'head', 'main',
  'article', 'meta', 'link', 'header', 'footer', 'nav', 'title'])

function htmlInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  let index = 0
  while (value[index] === ' ' || value[index] === '\t' || value[index] === '\n' || value[index] === '\r') index++
  const start = index
  if (value[index] === '+' || value[index] === '-') index++
  const digits = index
  while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) index++
  if (index === digits) return undefined
  const result = Number(value.slice(start, index))
  return Number.isSafeInteger(result) ? result : undefined
}

function htmlSpan(value: string | undefined): number | undefined {
  const parsed = htmlInteger(value)
  return parsed !== undefined && parsed > 1 ? parsed : undefined
}

function htmlRowspan(node: Html.Element, context: HtmlContext): number | undefined {
  const raw = attr(node, 'rowspan')
  if (htmlInteger(raw) === 0) degraded(context, node, 'HTML rowspan=0 extends to the end of its row group')
  return htmlSpan(raw)
}

function isPhrasing(node: Html.ChildNode): boolean {
  if (isText(node)) return true
  return isElement(node) && !BLOCK_TAGS.has(node.tagName) && !isDisplayImage(node)
}

function isDisplayImage(node: Html.Element): boolean {
  return node.tagName === 'img'
}

function isImage(node: Html.ChildNode): boolean {
  return isElement(node) && isDisplayImage(node)
}

/** C2-H-020: a bare image is a block image; C2-H-102: a paragraph of one display formula has the role `math`. */
function runParagraph(children: Inline[]): Block {
  const only = children.length === 1 ? children[0] : undefined
  if (only?.type === 'math' && only.display) return { type: 'paragraph', role: 'math', children }
  return paragraph(children)
}

type DocumentChild = DocumentNode['children'][number]
type Reader<T> = (node: Html.ChildNode, context: HtmlContext) => T[]

/** The blocks of a flow: a run of text and inline elements is one paragraph, as a render writes a bare paragraph. */
function flow<T extends DocumentChild = Block>(nodes: Html.ChildNode[], host: Html.ChildNode, context: HtmlContext,
  reader: Reader<T | Block> = block): (T | Block)[] {
  const result: (T | Block)[] = []
  let run: Html.ChildNode[] = []
  const flush = (): void => {
    // C2-H-020: a run of bare images is a block image paragraph each; beside other text an image is inline.
    if (run.some(isImage) && run.every(node => isBlank(node) || isImage(node) || isComment(node))) {
      for (const node of run) if (!isBlank(node)) result.push(...reader(node, context))
    } else if (run.some(node => !isBlank(node))) {
      const children = trimInlineEdges(normalizeBreaks(coalesce(run.flatMap(node => inline(node, context))), host, context),
        host, context)
      if (children.length > 0) result.push(runParagraph(children))
    }
    run = []
  }
  for (const node of nodes) {
    if (isPhrasing(node) || isImage(node) || (isComment(node) && run.length > 0)) run.push(node)
    else {
      flush()
      result.push(...reader(node, context))
    }
  }
  flush()
  return result
}

function blocks(nodes: Html.ChildNode[], host: Html.ChildNode, context: HtmlContext): Block[] {
  const result: Block[] = []
  for (const node of flow(nodes, host, context)) result.push(node)
  return result
}

/** The children of the document, and of a section a render opened in it (C2-H-026), where templates stand (C2-H-114). */
function documentChild(node: Html.ChildNode, context: HtmlContext): DocumentChild[] {
  if (!isElement(node)) return block(node, context)
  const template = node.tagName === 'template' ? abbreviationTemplate(node, context) : undefined
  if (template !== undefined) return template
  if (node.tagName === 'section') return section(node, context, documentChild)
  if (['html', 'body'].includes(node.tagName)) {
    if (node.attrs.some(entry => !['lang', 'dir'].includes(entry.name))) {
      degraded(context, node, `HTML ${node.tagName} wrapper attributes omitted`)
    }
    return flow(content(node), node, context, documentChild)
  }
  return block(node, context)
}

function blockChildren(node: Html.Element, context: HtmlContext): Block[] {
  return blocks(content(node), node, context)
}

function block(node: Html.ChildNode, context: HtmlContext): Block[] {
  if (isText(node)) {
    if (!node.value.trim()) return []
    return [paragraph(trimInlineEdges(normalizeBreaks(softText(node.value), node, context), node, context))]
  }
  if (isComment(node)) return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
  if (isElement(node)) return blockElement(node, context)
  degraded(context, node, 'Doctype omitted from Carve tree')
  return []
}

function blockElement(node: Html.Element, context: HtmlContext): Block[] {
  const simple = simpleBlockElement(node, context) ?? containerElement(node, context)
  if (simple !== undefined) return simple
  switch (node.tagName) {
    case 'ul': case 'ol': return [htmlList(node, context)]
    case 'pre': return htmlPre(node, context)
    case 'table': return [table(node, context)]
    case 'dl': return [definitionList(node, context)]
    case 'figure': return [figure(node, context)]
    case 'details': return detailsBlock(node, context)
    case 'script': case 'style': return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
    case 'template': return rawTemplate(node, context)
    default: return fallbackBlock(node, context)
  }
}

function rawTemplate(node: Html.Element, context: HtmlContext): Block[] {
  if (has(node, 'data-carve-abbreviations')) {
    ignoredCarrier(context, node, 'data-carve-abbreviations', 'a template is read only at the top level of the flow')
  }
  // C2-H-186: the reserved name does not stay, also on a template that is kept as raw HTML.
  node.attrs = node.attrs.filter(entry => !CARRIERS.has(entry.name))
  degraded(context, node, 'HTML template retained as raw HTML')
  return [{ type: 'raw_block', format: 'html', value: serializeOuter(node) }]
}

function detailsBlock(node: Html.Element, context: HtmlContext): Block[] {
  degraded(context, node, 'Details disclosure mapped to a div')
  const mapped = attrs(context, node)
  return [{ type: 'div', children: blockChildren(node, context), ...mapped,
    attrs: { ...mapped.attrs, classes: ['details', ...(mapped.attrs?.classes ?? [])] } }]
}

/** C2-H-047, C2-H-048: the title of the opener on `<pre>`, and its label (C2-H-114). */
function htmlPre(node: Html.Element, context: HtmlContext): Block[] {
  const code = elements(node).find(child => child.nodeName === 'code')
  const classes = code ? classList(code) : []
  const language = classes.find(name => name.startsWith('language-'))?.slice(9)
  if (code && (code.attrs.some(entry => entry.name !== 'class') || classes.some(name => !name.startsWith('language-')))) {
    degraded(context, code, 'Code element attributes other than language omitted')
  }
  const value = code ? plain(code) : plain(node)
  const title = attr(node, 'title')
  const label = codeLabel(node, code, context)
  return [{ type: 'code_block', value: value && !value.endsWith('\n') ? `${value}\n` : value,
    ...(language ? { syntax: language } : {}),
    ...(title !== undefined ? { title: [{ type: 'text' as const, value: title }] } : {}),
    ...(label !== undefined ? { groupLabel: label } : {}),
    ...attrs(context, node, title !== undefined ? ['title'] : []) }]
}

/** C2-H-186, C2-B-117: a fence label holds no `]` and no line break, and the `<pre>` holds one `<code>` and nothing else. */
function codeLabel(node: Html.Element, code: Html.Element | undefined, context: HtmlContext): string | undefined {
  const label = attr(node, 'data-carve-label')
  if (label === undefined) return undefined
  const only = code !== undefined && content(node).every(child => child === code)
  if (only && !label.includes(']') && !label.includes('\n') && !label.includes('\r')) return label
  ignoredCarrier(context, node, 'data-carve-label', only ? 'the value is no fence label' : 'the element holds more than its code')
  return undefined
}

function simpleBlockElement(node: Html.Element, context: HtmlContext): Block[] | undefined {
  switch (node.tagName) {
    case 'p': return [paragraphElement(node, context)]
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return [heading(node, Number(node.tagName[1]), context)]
    case 'hr': return [{ type: 'thematic_break', ...attrs(context, node) }]
    case 'blockquote': return [{ type: 'block_quote', children: blockChildren(node, context), ...attrs(context, node) }]
    case 'section': return section(node, context)
    case 'aside': return admonition(node, context)
    default: return undefined
  }
}

function paragraphElement(node: Html.Element, context: HtmlContext): Block {
  const children = inlineChildren(node, context)
  // C2-H-020: a block image keeps its `<p>` where the paragraph carries attributes or a `lang`. C2-B-197: a shortcut never is one.
  const only = children.length === 1 ? children[0] : undefined
  const image: Block = { type: 'paragraph', role: 'image', children }
  const base = only?.type === 'image' && only.refForm !== 'shortcut' ? image : runParagraph(children)
  return { ...base, ...attrs(context, node, [], true) }
}

/** C2-H-021, C2-H-023: a heading, its true level above six, and whether its id was authored (C2-H-114). */
function heading(node: Html.Element, level: number, context: HtmlContext, id?: HeadingId): Block {
  const own = headingId(node, context)
  const chosen = id ?? own
  const omit = ['id', ...(level > 6 ? ['role', 'aria-level'] : [])]
  const mapped = attrs(context, node, omit, true)
  const withId = chosen.authored === undefined ? mapped : { ...mapped, attrs: { ...mapped.attrs, id: chosen.authored } }
  return { type: 'heading', level, children: inlineChildren(node, context), ...withId }
}

interface HeadingId { authored?: string }

function headingId(node: Html.Element, context: HtmlContext): HeadingId {
  const id = attr(node, 'id')
  const explicit = has(node, 'data-carve-explicit-id')
  const generated = has(node, 'data-carve-generated-id')
  if (explicit && generated) {
    ignoredCarrier(context, node, 'data-carve-explicit-id', 'an id is authored or generated, not both')
    return id === undefined ? {} : { authored: id }
  }
  if ((explicit || generated) && (id === undefined || id === '')) {
    ignoredCarrier(context, node, explicit ? 'data-carve-explicit-id' : 'data-carve-generated-id', 'the element has no id')
    return {}
  }
  if (generated) return {}
  return id === undefined ? {} : { authored: id }
}

function headingLevel(node: Html.Element): number | undefined {
  if (/^h[1-6]$/u.test(node.tagName)) return Number(node.tagName[1])
  if (node.tagName !== 'div' || attr(node, 'role') !== 'heading') return undefined
  const level = htmlInteger(attr(node, 'aria-level'))
  return level !== undefined && level > 6 ? level : undefined
}

/** C2-H-026, C2-H-027: a section a render opens at a heading reads back as the heading and the blocks it holds. */
function section<T extends DocumentChild>(node: Html.Element, context: HtmlContext, reader: Reader<T | Block> = block): (T | Block)[] {
  if (isFootnoteSection(node)) return footnoteSection(node, context)
  const first = elements(node)[0]
  const level = first === undefined ? undefined : headingLevel(first)
  const before = first === undefined ? [] : content(node).slice(0, content(node).indexOf(first))
  if (first === undefined || level === undefined || !before.every(isBlank)) {
    for (const name of ['data-carve-explicit-id', 'data-carve-generated-id']) {
      if (has(node, name)) ignoredCarrier(context, node, name, 'the section opens with no heading')
    }
    return [{ type: 'section', children: blockChildren(node, context), ...attrs(context, node) }]
  }
  const id = headingId(node, context)
  const rest = content(node).slice(content(node).indexOf(first) + 1)
  return [heading(first, level, context, id), ...flow(rest, node, context, reader)]
}

/** C2-H-089: the notes stand at the section; an inline footnote reads back at its reference (C2-H-114). */
function footnoteSection(node: Html.Element, context: HtmlContext): Block[] {
  const ordered = elements(node).find(child => child.tagName === 'ol')
  if (ordered === undefined) {
    unsupported(context, node, 'Footnote section has no ordered list')
    return []
  }
  const notes: DocumentNode['children'] = []
  for (const item of elements(ordered).filter(child => child.tagName === 'li')) {
    const id = attr(item, 'id')
    if (!id) { unsupported(context, item, 'Footnote has no id'); continue }
    const note = context.notes.get(id)
    if (note?.inline === true) continue
    notes.push({ type: 'footnote', key: note?.label ?? footnoteKeyOf(id), namespace: 'footnote', children: blockChildren(item, context) })
  }
  context.footnotes.push(...notes.filter(note => note.type === 'footnote'))
  return notesDirective(node, context)
}

/**
 * C2-H-093, C2-H-158: a top-level `::: footnotes` directive places the section and gives it its title and label.
 * A section with either, or with blocks behind it, stood at a directive; its blocks were written before it.
 */
function notesDirective(node: Html.Element, context: HtmlContext): Block[] {
  const parts = titled(node, context)
  const parent = node.parentNode
  const siblings = parent === null ? [] : parent.childNodes
  const behind = siblings.slice(siblings.indexOf(node) + 1).some(child => !isBlank(child))
  if (parts.title === undefined && parts.groupLabel === undefined && !behind) return []
  return [{ type: 'directive', kind: 'footnotes', children: [], ...(parts.title ? { title: parts.title } : {}),
    ...(parts.groupLabel !== undefined ? { groupLabel: parts.groupLabel } : {}) }]
}

function footnoteKeyOf(id: string): string {
  for (const prefix of ['user-content-fn-', 'fn-', 'fn']) if (id.startsWith(prefix)) return id.slice(prefix.length)
  return id
}

const ADMONITION_KINDS = ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'] as const
const DIRECTIVE_KINDS = ['bibliography', 'footnotes', 'glossary', 'index', 'references', 'toc'] as const

function isKind<T extends string>(kinds: readonly T[], value: string | undefined): value is T {
  return kinds.some(kind => kind === value)
}

/** C2-H-154: `<p class="admonition-title">` and `<p class="div-label">` lead the body of a div or admonition. */
function titled(node: Html.Element, context: HtmlContext): { title?: Inline[], groupLabel?: string, rest: Html.ChildNode[] } {
  const nodes = content(node)
  let index = 0
  const next = (name: string): Html.Element | undefined => {
    while (index < nodes.length && isBlank(nodes[index] ?? nodes[0]!)) index++
    const candidate = nodes[index]
    if (candidate === undefined || !isElement(candidate) || candidate.tagName !== 'p' || attr(candidate, 'class') !== name) return undefined
    index++
    return candidate
  }
  const title = next('admonition-title')
  const label = next('div-label')
  return { ...(title ? { title: inlineChildren(title, context) } : {}), ...(label ? { groupLabel: plain(label) } : {}),
    rest: nodes.slice(index) }
}

function admonition(node: Html.Element, context: HtmlContext): Block[] | undefined {
  const classes = classList(node)
  const kind = classes[1]
  if (classes[0] !== 'admonition' || !isKind(ADMONITION_KINDS, kind)) return undefined
  const parts = titled(node, context)
  const mapped = withoutKeys(withoutClasses(attrs(context, node), ['admonition', kind]), ['aria-label', 'aria-labelledby'])
  return [{ type: 'admonition', kind, ...(parts.title ? { title: parts.title } : {}),
    ...(parts.groupLabel !== undefined ? { groupLabel: parts.groupLabel } : {}),
    children: flow(parts.rest, node, context), ...mapped }]
}

function containerElement(node: Html.Element, context: HtmlContext): Block[] | undefined {
  if (node.tagName !== 'div') return undefined
  const level = headingLevel(node)
  if (level !== undefined) return [heading(node, level, context)]
  const fault = lineBlockFault(node)
  if (has(node, 'data-carve-line-block') && fault === undefined) return [lineBlock(node, context)]
  if (fault !== undefined && has(node, 'data-carve-line-block')) ignoredCarrier(context, node, 'data-carve-line-block', fault)
  if (has(node, 'data-carve-div') && node.attrs.length > 1) {
    ignoredCarrier(context, node, 'data-carve-div', 'the div carries other attributes')
  }
  return [divElement(node, context)]
}

/** C2-H-186: why a `data-carve-line-block` is not read, or undefined when it is. */
function lineBlockFault(node: Html.Element): string | undefined {
  if (has(node, 'data-carve-div')) return 'the element is also a div'
  if (!classList(node).includes('line-block')) return 'the element lacks the class line-block'
  return content(node).every(child => isBlank(child) || (isElement(child) && child.tagName === 'p')) ? undefined
    : 'the element holds more than paragraphs'
}

function divElement(node: Html.Element, context: HtmlContext): Block {
  const parts = titled(node, context)
  const mapped = attrs(context, node, [], true)
  const kind = mapped.attrs?.classes?.[0]
  const head = { ...(parts.title ? { title: parts.title } : {}),
    ...(parts.groupLabel !== undefined ? { groupLabel: parts.groupLabel } : {}) }
  // C2-H-157: a directive that places nothing is a div with its kind as the first class.
  if (isKind(DIRECTIVE_KINDS, kind)) {
    return { type: 'directive', kind, ...head, children: flow(parts.rest, node, context), ...withoutClasses(mapped, [kind]) }
  }
  return { type: 'div', ...head, children: flow(parts.rest, node, context), ...mapped }
}

/** C2-H-043: one paragraph per stanza, a line per `<br>`, and leading spaces as no-break spaces. */
function lineBlock(node: Html.Element, context: HtmlContext): Block {
  const lines: Extract<Block, { type: 'line_block' }>['children'] = []
  for (const stanza of elements(node).filter(child => child.tagName === 'p')) {
    if (lines.length > 0) lines.push({ type: 'line', children: [] })
    let current: Html.ChildNode[] = []
    const flush = (): void => { lines.push({ type: 'line', children: lineInline(current, stanza, context) }); current = [] }
    for (const child of content(stanza)) {
      if (isElement(child) && child.tagName === 'br') flush()
      else current.push(child)
    }
    flush()
  }
  return { type: 'line_block', children: lines, ...withoutClasses(attrs(context, node), ['line-block']) }
}

function lineInline(nodes: Html.ChildNode[], host: Html.Element, context: HtmlContext): Inline[] {
  const children = coalesce(nodes.flatMap(node => inline(node, context)))
  const first = children[0]
  if (first?.type === 'soft_break') children.shift()
  let spaces = ''
  while (children[0]?.type === 'non_breaking_space') { children.shift(); spaces += ' ' }
  const lead = children[0]
  if (lead?.type === 'text' && lead.value.startsWith('\u00a0')) {
    let count = 0
    while (lead.value[count] === '\u00a0') count++
    spaces += ' '.repeat(count)
    lead.value = lead.value.slice(count)
  }
  if (spaces !== '') {
    if (lead?.type === 'text') lead.value = spaces + lead.value
    else children.unshift({ type: 'text', value: spaces })
  }
  return normalizeBreaks(coalesce(children), host, context)
}

/** C2-H-030, C2-H-031, C2-H-037: the marker an ordered list derives its attributes from, and the bullet of `data-marker`. */
function listMarker(node: Html.Element, context: HtmlContext): ListNode['marker'] {
  const carried = attr(node, 'data-marker')
  if (node.tagName === 'ul') {
    if (carried === undefined || carried === '-' || carried === '*') return { kind: 'bullet', char: carried ?? '-' }
    ignoredCarrier(context, node, 'data-marker', 'the bullet is not a list marker')
    return { kind: 'bullet', char: '-' }
  }
  if (carried !== undefined) ignoredCarrier(context, node, 'data-marker', 'an ordered list has no bullet')
  const type = attr(node, 'type')
  const start = htmlInteger(attr(node, 'start'))
  return { kind: 'ordered', style: type === 'a' || type === 'A' || type === 'i' || type === 'I' ? type : '1',
    delimiter: attr(node, 'data-delim') === ')' ? ')' : '.', ...(start !== undefined && start !== 1 ? { start } : {}) }
}

/** C2-H-034: a loose list writes the first paragraph of an item as `<p>`, which a tight list leaves bare. */
function hasLooseItem(node: Html.Element): boolean {
  return elements(node).some(item => item.tagName === 'li' && elements(item).some(child => child.tagName === 'p' &&
    child.attrs.length === 0 && content(item).slice(0, content(item).indexOf(child)).every(entry => isBlank(entry) ||
    (isElement(entry) && entry.tagName === 'input'))))
}

/** C2-H-138: a tight list says so with its carrier; without it the HTML is read as it stands (C2-H-195 row 6, C2-H-197). */
function listSpacing(node: Html.Element, items: ListItemNode[], context: HtmlContext): 'tight' | 'loose' {
  const loose = hasLooseItem(node)
  if (has(node, 'data-carve-tight')) {
    if (!loose) return 'tight'
    ignoredCarrier(context, node, 'data-carve-tight', 'an item writes its first paragraph as an element')
    return 'loose'
  }
  if (loose) return 'loose'
  return items.some(item => item.children.filter(child => child.type !== 'list').length > 1) ? 'loose' : 'tight'
}

function htmlList(node: Html.Element, context: HtmlContext): ListNode {
  const items = elements(node).filter(child => child.nodeName === 'li').map(child => listItem(child, context))
  for (const child of elements(node)) if (child.tagName !== 'li') unsupported(context, child, 'Non-item child in HTML list')
  const mapped = attrs(context, node, ['start', 'type', 'data-delim'])
  const tasks = items.some(item => item.task !== undefined)
  return { type: 'list', children: items, marker: listMarker(node, context), spacing: listSpacing(node, items, context),
    ...(tasks ? withoutClasses(mapped, ['task-list']) : mapped) }
}

/** C2-H-032, C2-H-033: the box of a task item, its state, and the class and style every render gives the item. */
function listItem(node: Html.Element, context: HtmlContext): ListItemNode {
  const checkbox = elements(node).find(child => child.nodeName === 'input' && attr(child, 'type') === 'checkbox')
  if (checkbox?.attrs.some(entry => !['type', 'checked', 'disabled', 'aria-label'].includes(entry.name)) === true) {
    degraded(context, checkbox, 'Checkbox attributes outside task state omitted')
  }
  const nodes = content(node).filter(child => child !== checkbox)
  const lead = nodes[0]
  if (checkbox && lead !== undefined && isText(lead) && lead.value.startsWith(' ')) {
    nodes[0] = { ...lead, value: lead.value.slice(1) }
  }
  const state = attr(node, 'data-task-state')
  const mark = state ?? (checkbox && attr(checkbox, 'checked') !== undefined ? 'x' : ' ')
  const mapped = attrs(context, node, ['data-task-state'])
  const own = checkbox ? withoutStyle(withoutClasses(mapped, ['task'])) : mapped
  return { type: 'list_item', children: blocks(nodes, node, context), ...(checkbox ? { task: { mark } } : {}), ...own }
}

function withoutStyle(mapped: MappedAttrs): MappedAttrs {
  const keyValues = mapped.attrs?.keyValues
  if (keyValues === undefined) return mapped
  const style = keyValues.find(([key]) => key === 'style')
  if (style === undefined) return mapped
  const rest = style[1] === 'list-style: none' ? undefined : style[1].startsWith('list-style: none; ') ? style[1].slice(18) : style[1]
  const next = keyValues.flatMap((entry): [string, string][] => entry !== style ? [entry] : rest === undefined ? [] : [['style', rest]])
  return withoutKeys({ ...mapped, attrs: { ...mapped.attrs, keyValues: next } }, [])
}

function figureCaption(node: Html.Element, context: HtmlContext): CaptionNode {
  return { type: 'caption', children: blockChildren(node, context), ...attrs(context, node) }
}

/**
 * C2-H-199, C2-H-063, C2-H-064: a figure, a figure group and its panels; a table panel wraps the table bare. A figure
 * that holds one block that can carry a caption is that block, with the caption in its slot and the attributes of
 * the figure (C2-A-082, C2-A-183); any other figure is a figure group of its blocks.
 */
function figure(node: Html.Element, context: HtmlContext, drop: readonly string[] = []): Block {
  const classes = classList(node)
  const group = classes[0] === 'carve-figure-group'
  const caption = elements(node).find(child => child.nodeName === 'figcaption')
  const nodes = content(node).filter(child => child !== caption)
  const children = group ? nodes.flatMap(child => isElement(child) && child.tagName === 'figure' ? [panel(child, context)]
    : block(child, context)) : flow(nodes, node, context)
  const captionPart = caption ? { caption: figureCaption(caption, context) } : {}
  if (group) return { type: 'figure_group', children, ...captionPart, ...withoutClasses(attrs(context, node), ['carve-figure-group']) }
  const own = withoutClasses(attrs(context, node), drop)
  const only = children.length === 1 ? children[0] : undefined
  if (only?.type === 'code_block' || only?.type === 'block_quote' || (only?.type === 'paragraph' && only.role !== undefined)) {
    return { ...only, ...captionPart, ...own }
  }
  return { type: 'figure_group', children, ...captionPart, ...own }
}

function panel(node: Html.Element, context: HtmlContext): Block {
  const inner = elements(node)
  const only = inner.length === 1 ? inner[0] : undefined
  if (classList(node)[0] === 'carve-figure-panel' && only?.tagName === 'table' && node.attrs.length === 1) return table(only, context)
  return figure(node, context, classList(node)[0] === 'carve-figure-panel' ? ['carve-figure-panel'] : [])
}

function tableCell(node: Html.Element, context: HtmlContext, inHead: boolean): TableCellNode {
  const hasBlocks = elements(node).some(child => BLOCK_TAGS.has(child.tagName))
  const result: TableCellNode = hasBlocks ? { type: 'table_cell', header: node.tagName === 'th',
    children: blockChildren(node, context) } : cell(cellInline(node, context), node.tagName === 'th')
  const colspan = htmlSpan(attr(node, 'colspan'))
  const rowspan = htmlRowspan(node, context)
  if (colspan !== undefined) result.colspan = colspan
  if (rowspan !== undefined) result.rowspan = rowspan
  cellMarks(node, result, inHead)
  const styled = result.align !== undefined && attr(node, 'align') === undefined
  Object.assign(result, attrs(context, node, ['colspan', 'rowspan', 'scope', 'align', 'valign', ...(styled ? ['style'] : [])]))
  return result
}

const SCOPES = ['col', 'row', 'colgroup', 'rowgroup'] as const
const VALIGNS = ['top', 'middle', 'bottom', 'baseline'] as const
const ALIGNS = ['left', 'right', 'center'] as const

/** C2-H-056 to C2-H-058: the scope, other than the default a render writes on every header cell, and the alignments. */
function cellMarks(node: Html.Element, result: TableCellNode, inHead: boolean): void {
  const scope = attr(node, 'scope')
  const implied = node.tagName === 'th' && scope === (inHead ? 'col' : 'row')
  if (!implied && isKind(SCOPES, scope)) result.scope = scope
  const align = attr(node, 'align') ?? cellAlign(attr(node, 'style'))
  if (isKind(ALIGNS, align)) result.align = align
  const valign = attr(node, 'valign')
  if (isKind(VALIGNS, valign)) result.valign = valign
}

const CELL_ALIGNS: Readonly<Record<string, string>> = {
  'text-align: left;': 'left', 'text-align: right;': 'right', 'text-align: center;': 'center',
}

function cellAlign(style: string | undefined): string | undefined {
  return style === undefined ? undefined : CELL_ALIGNS[style]
}

function flattenCellGroup(group: Inline[], pending: Inline[][]): boolean {
  let changed = false
  for (let index = 0; index < group.length; index++) {
    const child = group[index]
    if (child?.type === 'soft_break' || child?.type === 'hard_break') { group[index] = { type: 'text', value: ' ' }; changed = true }
    else if (child?.type === 'ruby') for (const pair of child.pairs) pending.push(pair.base, pair.annotation)
    else if (child !== undefined && 'children' in child && child.type !== 'citation_group') pending.push(child.children)
  }
  return changed
}

function cellInline(node: Html.Element, context: HtmlContext): Inline[] {
  const children = inlineChildren(node, context)
  const pending: Inline[][] = [children]
  let changed = false
  while (pending.length > 0) {
    const group = pending.pop()
    if (group !== undefined) changed = flattenCellGroup(group, pending) || changed
  }
  if (changed) degraded(context, node, 'HTML table cell line break normalized to a space')
  return coalesce(children)
}

function rows(node: Html.Element, context: HtmlContext, inHead: boolean): TableRowNode[] {
  if (node.tagName !== 'table') {
    for (const child of elements(node)) if (child.tagName !== 'tr') unsupported(context, child, 'Non-row child in table group')
  }
  const groupRows = elements(node).filter(child => child.nodeName === 'tr')
  const result: TableRowNode[] = groupRows.map(child => {
    for (const entry of elements(child)) {
      if (entry.nodeName !== 'th' && entry.nodeName !== 'td') unsupported(context, entry, 'Non-cell child in HTML row')
    }
    return { ...row(elements(child).filter(entry => entry.nodeName === 'th' || entry.nodeName === 'td')
      .map(entry => tableCell(entry, context, inHead))), ...attrs(context, child) }
  })
  clampRowspans(result, groupRows, context)
  return result
}

/** C2-A-093, C2-B-174: as in the HTML table model, a row span ends at the last row of its group. */
function clampRowspans(result: TableRowNode[], groupRows: Html.Element[], context: HtmlContext): void {
  result.forEach((tableRow, index) => {
    for (const tableCell of tableRow.children) {
      const room = result.length - index
      if (tableCell.rowspan === undefined || tableCell.rowspan <= room) continue
      degraded(context, groupRows[index]!, 'HTML rowspan past the end of its row group clamped')
      if (room > 1) tableCell.rowspan = room
      else delete tableCell.rowspan
    }
  })
}

type TableChildren = Extract<Block, { type: 'table' }>['children']

function tableGroups(node: Html.Element, context: HtmlContext): TableChildren {
  const direct = rows(node, context, false)
  const children: TableChildren = elements(node).filter(child => ['thead', 'tbody', 'tfoot'].includes(child.nodeName)).map(group => {
    if (group.nodeName === 'thead') return { type: 'table_head', children: rows(group, context, true), ...attrs(context, group) }
    if (group.nodeName === 'tfoot') return { type: 'table_foot', children: rows(group, context, false), ...attrs(context, group) }
    return { type: 'table_body', children: rows(group, context, false), ...attrs(context, group) }
  })
  if (direct.length) children.unshift({ type: 'table_body', children: direct })
  return children
}

/** C2-H-152: the widths of a column group, a percent each. */
function columnWidths(node: Html.Element): (number | undefined)[] {
  const group = elements(node).find(child => child.tagName === 'colgroup')
  return (group === undefined ? [] : elements(group).filter(child => child.tagName === 'col')).map(col => {
    const style = attr(col, 'style') ?? ''
    if (!style.startsWith('width: ') || !style.endsWith('%;')) return undefined
    const value = Number(style.slice(7, -2))
    return Number.isFinite(value) && value > 0 ? value / 100 : undefined
  })
}

function tableColumns(children: TableChildren, node: Html.Element): TableColumnNode[] {
  const width = Math.max(0, ...children.flatMap(group => group.type === 'comment' ? [] : group.children
    .filter(entry => entry.type === 'table_row').map(entry => entry.children.reduce((sum, entryCell) =>
      sum + (entryCell.colspan ?? 1), 0))))
  const widths = columnWidths(node)
  return Array.from({ length: width }, (_, index) => {
    const value = widths[index]
    return value === undefined ? { type: 'table_column' as const }
      : { type: 'table_column' as const, width: value, authored: true as const }
  })
}

function table(node: Html.Element, context: HtmlContext): Block {
  const children = tableGroups(node, context)
  const caption = elements(node).find(child => child.nodeName === 'caption')
  for (const child of elements(node)) {
    if (!['caption', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(child.tagName)) {
      unsupported(context, child, `Unsupported table child ${child.tagName}`)
    }
  }
  const captionNode = caption === undefined ? undefined : figureCaption(caption, context)
  const result: TableNode = { type: 'table', children, columns: tableColumns(children, node),
    ...(captionNode ? { caption: captionNode } : {}), ...attrs(context, node) }
  resolveAlignments(result)
  return result
}

function definitionList(node: Html.Element, context: HtmlContext): Block {
  const children: Extract<Block, { type: 'definition_list' }>['children'] = []
  for (const child of content(node)) {
    if (isElement(child) && child.nodeName === 'dt') {
      children.push({ type: 'definition_term', children: inlineChildren(child, context), ...attrs(context, child) })
    } else if (isElement(child) && child.nodeName === 'dd') {
      children.push({ type: 'definition_description', children: blockChildren(child, context), ...attrs(context, child) })
    } else if (!isText(child) || child.value.trim()) unsupported(context, child, 'Unexpected definition list child')
  }
  return { type: 'definition_list', children, ...attrs(context, node) }
}

function fallbackBlock(node: Html.Element, context: HtmlContext): Block[] {
  if (node.tagName === 'img') return [{ type: 'paragraph', role: 'image', children: htmlImage(node, context) }]
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

function auditElement(node: Html.ChildNode, context: HtmlContext): void {
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
  const lower = input.toLowerCase()
  const full = lower.includes('<!doctype') || lower.includes('<html') || lower.includes('<head')
  const foreign = full ? parse(input, { sourceCodeLocationInfo: true }) :
    parseFragment(input, { sourceCodeLocationInfo: true })
  ensureForeignDepth(foreign, 'html')
  const context: HtmlContext = { format: 'html', input, diagnostics: [], deferred: [],
    notes: new Map(), footnotes: [], abbreviations: new Map(), templates: new Map(), definitions: new Map(),
    anchorKeys: new Set() }
  collectNotes(foreign.childNodes, context)
  rootLanguage(foreign.childNodes, context)
  for (const child of foreign.childNodes) auditElement(child, context)
  collectTemplates(foreign.childNodes, context)
  const first = foreign.childNodes[0]
  const children = first === undefined ? [] : flow(foreign.childNodes, first, context, documentChild)
  return complete(context, [...children, ...rebuiltDefinitions(context, children), ...context.footnotes, ...(context.deferred ?? [])])
}

/** The `href` of the first link of each key in `keys` below `node`, as resolution gave it. */
function resolvedHrefs(node: unknown, keys: Set<string>, found: Map<string, string | undefined>): void {
  if (Array.isArray(node)) {
    for (const item of node) resolvedHrefs(item, keys, found)
    return
  }
  if (typeof node !== 'object' || node === null) return
  const fields = node as Record<string, unknown>
  const key = fields['key']
  if (fields['type'] === 'link' && typeof key === 'string' && keys.has(key) && !found.has(key)) {
    found.set(key, typeof fields['href'] === 'string' ? fields['href'] : undefined)
  }
  for (const value of Object.values(fields)) if (typeof value === 'object') resolvedHrefs(value, keys, found)
}

/**
 * C2-H-198: no definition is rebuilt for a key whose first `<a>` links `#ID` where the heading lookup of the key
 * (C2-I-084) finds the heading with that id in the imported tree; the tree is resolved without those definitions to see.
 */
function rebuiltDefinitions(context: HtmlContext, children: DocumentNode['children']): LinkReferenceDefinitionNode[] {
  const all = [...context.definitions.values()]
  if (context.anchorKeys.size === 0) return all
  const others = all.filter(definition => !context.anchorKeys.has(definition.key))
  const probe = documentOf(context, structuredClone([...children, ...others, ...context.footnotes]))
  const found = new Map<string, string | undefined>()
  resolvedHrefs(resolveTree(probe).document.children, context.anchorKeys, found)
  return all.filter(definition => !context.anchorKeys.has(definition.key) || found.get(definition.key) !== definition.href)
}

function rootLanguage(nodes: Html.ChildNode[], context: HtmlContext): void {
  const html = nodes.find(child => isElement(child) && child.tagName === 'html')
  if (html && isElement(html)) {
    const body = elements(html).find(child => child.tagName === 'body')
    const lang = (body ? attr(body, 'lang') : undefined) ?? attr(html, 'lang')
    const dir = (body ? attr(body, 'dir') : undefined) ?? attr(html, 'dir')
    if (lang) context.rootLang = lang
    if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') context.rootDir = dir
  }
}

