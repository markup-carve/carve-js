import { defaultTreeAdapter, html, parse, Parser, type DefaultTreeAdapterMap, type DefaultTreeAdapterTypes as Html } from 'parse5'
import type {
  Attrs, Block, CaptionNode, DocumentNode, Inline, LinkReferenceDefinitionNode, ListItemNode, ListNode, TableCellNode, TableColumnNode,
  TableNode, TableRowNode,
} from '../../src/index.ts'
import { resolveTree } from '../../src/index.ts'
import {
  asciiLower, attr, attrs, CARRIERS, classList, content, directionOf, droppedAttribute, elements, has, ignoredCarrier, isBlank,
  isComment, isElement, isRawSpan, readsCarrier, SOURCE_LEVEL,
  isText, plain, report, withoutClasses, withoutKeys, type HtmlContext, type MappedAttrs,
} from './html-dom.ts'
import { dropElement, isBlockElement, isOrphan, keepsRaw, rawValue, treatment } from './html-elements.ts'
import { TASK_NO_STATE, TASK_STATUS } from '../../src/tree-tables.ts'
import { htmlImage, inline, inlineChildren, normalizeBreaks, trimInlineEdges } from './html-inline.ts'
import { collectNotes, isFootnoteSection } from './html-notes.ts'
import { applyAdapter, type Adapter } from './html-adapter.ts'
import { abbreviationTemplate, collectTemplates } from './html-template.ts'
import { resolveAlignments } from './html-table-align.ts'
import {
  cell, coalesce, complete, documentOf, ensureForeignDepth, imageParagraph, paragraph, row, softText, type ImportResult,
} from './kit.ts'
import { append } from '../../src/append.ts'
import { DEFAULT_LABELS } from '../../src/option-tables.ts'

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
  if (htmlInteger(raw) === 0) report(context, node, 'import-structure-repaired', 'HTML rowspan=0 gives no span')
  return htmlSpan(raw)
}

function isPhrasing(node: Html.ChildNode): boolean {
  if (isText(node)) return true
  return isElement(node) && !isBlockElement(node) && !isDisplayImage(node)
}

/** C2-M-065: a comment and a raw element stand among blocks on their own, or inside a run of inline content. */
function isRaw(node: Html.ChildNode): boolean {
  return isComment(node) || (isElement(node) && (treatment(node) === 'raw' || isRawSpan(node)))
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

/** The blocks of a flow: a run of text and inline elements is one paragraph, as a render writes a bare paragraph (C2-M-012). */
function flow<T extends DocumentChild = Block>(nodes: Html.ChildNode[], host: Html.ChildNode, context: HtmlContext,
  reader: Reader<T | Block> = block): (T | Block)[] {
  const result: (T | Block)[] = []
  let run: Html.ChildNode[] = []
  const flush = (): void => {
    const solid = run.filter(node => !isBlank(node))
    // C2-M-013: a run of images, whitespace and comments is one image paragraph per image; C2-M-065: raw nodes alone are blocks.
    if (solid.length > 0 && (solid.every(isRaw) || (solid.some(isImage) && solid.every(node => isImage(node) || isComment(node))))) {
      for (const node of solid) append(result, reader(node, context))
    } else if (solid.length > 0) {
      const children = trimInlineEdges(normalizeBreaks(coalesce(run.flatMap(node => inline(node, context))), host, context),
        host, context)
      if (children.length > 0) result.push(runParagraph(children))
    }
    run = []
  }
  for (const node of nodes) {
    if (isPhrasing(node) || isImage(node) || isComment(node)) run.push(node)
    else {
      flush()
      append(result, reader(node, context))
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
    wrapperAttributes(node, context)
    return flow(content(node), node, context, documentChild)
  }
  return block(node, context)
}

/** C2-M-004: of `<html>` and `<body>` only `lang` and `dir` reach the document node. */
function wrapperAttributes(node: Html.Element, context: HtmlContext): void {
  for (const entry of node.attrs) {
    if (entry.name !== 'lang' && entry.name !== 'dir' && droppedAttribute(entry.name, entry.value) === undefined) {
      report(context, node, 'import-attribute-dropped', `Attribute ${entry.name} of ${node.tagName} dropped`)
    }
  }
}

function blockChildren(node: Html.Element, context: HtmlContext): Block[] {
  return blocks(content(node), node, context)
}

function block(node: Html.ChildNode, context: HtmlContext): Block[] {
  if (isText(node)) {
    if (!node.value.trim()) return []
    return [paragraph(trimInlineEdges(normalizeBreaks(softText(node.value), node, context), node, context))]
  }
  if (isComment(node)) return keepsRaw(node, context) ? [rawBlock(node)] : []
  if (isElement(node)) return blockElement(node, context)
  report(context, node, 'import-element-dropped', 'Doctype dropped')
  return []
}

/** C2-M-065: a raw block value ends with a line feed (C2-A-045). */
function rawBlock(node: Html.ChildNode): Block {
  const value = rawValue(node)
  return { type: 'raw_block', format: 'html', value: value.endsWith('\n') ? value : `${value}\n` }
}

/** C2-M-056, C2-M-058: the treatment of an element among blocks, before the element is read by its row. */
function treatedBlock(node: Html.Element, context: HtmlContext): Block[] | undefined {
  const kind = treatment(node)
  if (kind === 'drop') return node.tagName === 'head' ? head(node, context) : dropElement(node, context)
  if (kind === 'raw' || isRawSpan(node)) return rawElement(node, context)
  if (kind === 'unwrap' || isOrphan(node)) {
    if (node.tagName !== 'html' && node.tagName !== 'body') report(context, node, 'import-element-mapped', `HTML ${node.tagName} unwrapped`)
    return blockChildren(node, context)
  }
  if (kind !== 'div') return undefined
  report(context, node, 'import-element-mapped', `HTML ${node.tagName} read as a div`)
  return [{ type: 'div', children: divChildren(node, context), ...attrs(context, node) }]
}

/** C2-M-059: the first `<summary>` of a `<details>` and the `<legend>` of a `<fieldset>` are its first paragraph. */
function divChildren(node: Html.Element, context: HtmlContext): Block[] {
  const lead = node.tagName === 'details' ? 'summary' : node.tagName === 'fieldset' ? 'legend' : undefined
  const first = lead === undefined ? undefined : elements(node).find(child => child.tagName === lead)
  if (first === undefined) return blockChildren(node, context)
  const rest = content(node).filter(child => child !== first)
  const title = trimInlineEdges(inlineChildren(first, context), first, context)
  return [...(title.length > 0 ? [paragraph(title)] : []), ...blocks(rest, node, context)]
}

/** C2-M-005: the head and everything in it are dropped and reported once; the parser's implied empty head is no fact. */
function head(node: Html.Element, context: HtmlContext): Block[] {
  if (!node.sourceCodeLocation && content(node).length === 0) return []
  return dropElement(node, context)
}

function rawElement(node: Html.Element, context: HtmlContext): Block[] {
  if (has(node, 'data-carve-abbreviations')) {
    ignoredCarrier(context, node, 'data-carve-abbreviations', 'a template is read only at the top level of the flow')
  }
  return keepsRaw(node, context) ? [rawBlock(node)] : []
}

function blockElement(node: Html.Element, context: HtmlContext): Block[] {
  const treated = treatedBlock(node, context)
  if (treated !== undefined) return treated
  const simple = simpleBlockElement(node, context) ?? containerElement(node, context)
  if (simple !== undefined) return simple
  switch (node.tagName) {
    case 'ul': case 'ol': case 'menu': return htmlList(node, context)
    case 'pre': return htmlPre(node, context)
    case 'table': return [table(node, context)]
    case 'dl': return definitionList(node, context)
    case 'figure': return [figure(node, context)]
    default: return fallbackBlock(node, context)
  }
}

/** C2-H-047, C2-H-048: the title of the opener on `<pre>`, and its label (C2-H-114). */
function htmlPre(node: Html.Element, context: HtmlContext): Block[] {
  const code = elements(node).find(child => child.nodeName === 'code')
  const classes = code ? classList(code) : []
  const language = classes.find(name => name.startsWith('language-'))?.slice(9)
  if (code && (code.attrs.some(entry => entry.name !== 'class') || classes.some(name => !name.startsWith('language-')))) {
    report(context, code, 'import-attribute-dropped', 'Code element attributes other than language dropped')
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
    case 'p': return withContent(paragraphElement(node, context), node, context)
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return withContent(heading(node, Number(node.tagName[1]), context), node, context)
    case 'hr': return [{ type: 'thematic_break', ...attrs(context, node) }]
    case 'blockquote': return [{ type: 'block_quote', children: blockChildren(node, context), ...attrs(context, node) }]
    case 'section': return section(node, context)
    case 'aside': return admonition(node, context) ?? [divElement(node, context)]
    default: return undefined
  }
}

/** C2-M-069: a paragraph, heading or term with no content is dropped; a drop that loses an attribute is reported. */
function withContent<T extends Block | DefinitionEntry>(node: T, element: Html.Element, context: HtmlContext): T[] {
  if (!('children' in node) || node.children.length > 0) return [node]
  if (node.attrs !== undefined || node.lang !== undefined || node.dir !== undefined) {
    report(context, element, 'import-structure-repaired', `Empty HTML ${element.tagName} with attributes dropped`)
  }
  return []
}

type DefinitionEntry = Extract<Block, { type: 'definition_list' }>['children'][number]

function paragraphElement(node: Html.Element, context: HtmlContext): Block {
  const children = inlineChildren(node, context)
  // C2-H-020: a block image keeps its `<p>` where the paragraph carries attributes or a `lang`. C2-B-197: a shortcut never is one.
  const only = children.length === 1 ? children[0] : undefined
  const image: Block = { type: 'paragraph', role: 'image', children }
  const base = only?.type === 'image' && only.refForm !== 'shortcut' ? image : runParagraph(children)
  return { ...base, ...attrs(context, node, [], true) }
}

/** C2-H-021, C2-A-134: a heading, its true level above six, and whether its id was authored (C2-H-114). */
function heading(node: Html.Element, level: number, context: HtmlContext, id?: HeadingId): Block {
  const own = headingId(node, context)
  const chosen = id ?? own
  const omit = ['id', SOURCE_LEVEL, ...(level > 6 ? ['role', 'aria-level'] : [])]
  const mapped = attrs(context, node, omit, true, true)
  const withId = chosen.authored === undefined ? mapped : { ...mapped, attrs: { ...mapped.attrs, id: chosen.authored } }
  return { type: 'heading', level: sourceLevel(node, level, context), children: inlineChildren(node, context), ...withId }
}

/** C2-H-186, C2-H-208: the level a heading had before `headingShift`, where its carrier gives a valid one. */
function sourceLevel(node: Html.Element, level: number, context: HtmlContext): number {
  const value = attr(node, SOURCE_LEVEL)
  if (value === undefined) return level
  const source = /^[1-9][0-9]*$/u.test(value) ? Number(value) : undefined
  if (source === undefined) ignoredCarrier(context, node, SOURCE_LEVEL, 'the value is no decimal integer of at least 1')
  else if (source >= level) ignoredCarrier(context, node, SOURCE_LEVEL, 'the value is not smaller than the level of the element')
  return source !== undefined && source < level ? source : level
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

/** C2-M-027: a render writes no attribute but the id on the section it opens at a heading; C2-M-009 reports other carriers. */
function sectionAttributes(node: Html.Element, context: HtmlContext): void {
  for (const entry of node.attrs) {
    if (CARRIERS.has(entry.name) && !readsCarrier(node, entry.name)) {
      ignoredCarrier(context, node, entry.name, 'a section reads only the id carriers')
      continue
    }
    if (entry.name === 'id' || CARRIERS.has(entry.name) || droppedAttribute(entry.name, entry.value) !== undefined) continue
    report(context, node, 'import-attribute-dropped', `Attribute ${entry.name} of a section dropped`)
  }
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
    // C2-M-028: a section that does not open with a heading is a div.
    report(context, node, 'import-element-mapped', 'HTML section without a heading read as a div')
    return [{ type: 'div', children: blockChildren(node, context), ...attrs(context, node) }]
  }
  sectionAttributes(node, context)
  const rest = content(node).slice(content(node).indexOf(first) + 1)
  return [heading(first, level, context, sectionId(node, first, context)), ...flow(rest, node, context, reader)]
}

/** C2-M-026: the id of the section is the heading's, unless the heading carries an id of its own that differs. */
function sectionId(node: Html.Element, first: Html.Element, context: HtmlContext): HeadingId | undefined {
  const own = attr(first, 'id')
  const outer = attr(node, 'id')
  if (own === undefined || own === '') return headingId(node, context)
  if (outer !== undefined && outer !== own) {
    report(context, node, 'import-attribute-dropped', `Attribute id of a section dropped: its heading carries the id ${own}`)
  }
  return undefined
}

/** C2-H-089: the notes stand at the section; an inline footnote reads back at its reference (C2-H-114). */
function footnoteSection(node: Html.Element, context: HtmlContext): Block[] {
  const ordered = elements(node).find(child => child.tagName === 'ol')
  if (ordered === undefined) {
    report(context, node, 'import-structure-repaired', 'Footnote section has no ordered list')
    return []
  }
  const notes: DocumentNode['children'] = []
  for (const item of elements(ordered).filter(child => child.tagName === 'li')) {
    const id = attr(item, 'id')
    if (!id) { report(context, item, 'import-structure-repaired', 'Footnote has no id'); continue }
    const note = context.notes.get(id)
    if (note?.inline === true) continue
    const key = note?.label ?? footnoteKeyOf(id)
    // C2-M-061: an item whose key would be empty is dropped.
    if (key === '') { report(context, item, 'import-structure-repaired', 'Footnote key is empty'); continue }
    notes.push({ type: 'footnote', key, namespace: 'footnote', children: blockChildren(item, context) })
  }
  append(context.footnotes, notes.filter(note => note.type === 'footnote'))
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
  const behind = siblings.slice(siblings.indexOf(node) + 1).some(child =>
    !isBlank(child) && !(isElement(child) && isFootnoteSection(child)))
  if (parts.title === undefined && parts.groupLabel === undefined && !behind) return []
  return [{ type: 'directive', kind: 'footnotes', children: [], ...(parts.title ? { title: parts.title } : {}),
    ...(parts.groupLabel !== undefined ? { groupLabel: parts.groupLabel } : {}) }]
}

function footnoteKeyOf(id: string): string {
  for (const prefix of ['user-content-fn-', 'fn-', 'fn']) if (id.startsWith(prefix)) return id.slice(prefix.length)
  return id
}

export const ADMONITION_KINDS = ['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'] as const
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
  const label = context.labels[`admonition${kind[0]!.toUpperCase()}${kind.slice(1)}`]
  const omit = [
    ...(parts.title && attr(node, 'aria-labelledby') !== undefined ? ['aria-labelledby'] : []),
    ...(attr(node, 'aria-label') === label ? ['aria-label'] : []),
  ]
  const mapped = withoutKeys(withoutClasses(attrs(context, node), ['admonition', kind]), omit)
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
  if (node.tagName !== 'ol') {
    if (carried === undefined || carried === '-' || carried === '*') return { kind: 'bullet', char: carried ?? '-' }
    ignoredCarrier(context, node, 'data-marker', 'the bullet is not a list marker')
    return { kind: 'bullet', char: '-' }
  }
  if (carried !== undefined) ignoredCarrier(context, node, 'data-marker', 'an ordered list has no bullet')
  const type = attr(node, 'type')
  const style = type === 'a' || type === 'A' || type === 'i' || type === 'I' ? type : '1'
  const start = listStart(node, context, style === '1' ? 0 : 1)
  return { kind: 'ordered', style, delimiter: attr(node, 'data-delim') === ')' ? ')' : '.',
    ...(start !== undefined && start !== 1 ? { start } : {}) }
}

// C2-M-031, C2-B-219: a start lies between 0 and 999999999.
const MAX_START = 999_999_999

/**
 * C2-M-031, C2-B-045: the `start` of `<ol>` as an HTML integer; one below `least`, which is 1 on a list of letters
 * or roman numerals, or above the bound is dropped and reported.
 */
function listStart(node: Html.Element, context: HtmlContext, least: number): number | undefined {
  const start = htmlInteger(attr(node, 'start'))
  if (start === undefined || (start >= least && start <= MAX_START)) return start
  report(context, node, 'import-attribute-dropped', `Attribute start of ol dropped: ${start} lies outside ${least} to 999999999`)
  return undefined
}

/** C2-H-034: a loose list writes the first paragraph of an item as `<p>`, which a tight list leaves bare. */
function hasLooseItem(node: Html.Element): boolean {
  return elements(node).some(item => item.tagName === 'li' && elements(item).some(child => child.tagName === 'p' &&
    child.attrs.length === 0 && content(item).slice(0, content(item).indexOf(child)).every(entry => isBlank(entry) ||
    (isElement(entry) && entry.tagName === 'input'))))
}

/**
 * C2-H-138: a tight list says so with its carrier; without it the HTML is read as it stands (C2-H-195 row 6, C2-H-197).
 * C2-M-033: a list with one item is tight (C2-B-062).
 */
function listSpacing(node: Html.Element, items: ListItemNode[], context: HtmlContext): 'tight' | 'loose' {
  const loose = hasLooseItem(node)
  if (has(node, 'data-carve-tight')) {
    if (!loose) return 'tight'
    ignoredCarrier(context, node, 'data-carve-tight', 'an item writes its first paragraph as an element')
    return items.length > 1 ? 'loose' : 'tight'
  }
  if (items.length <= 1) return 'tight'
  if (loose) return 'loose'
  return items.some(item => item.children.filter(child => child.type !== 'list').length > 1) ? 'loose' : 'tight'
}

/** C2-M-034, C2-M-070: a child of a list that is no item is dropped and reported, and so is a list with no item. */
function htmlList(node: Html.Element, context: HtmlContext): ListNode[] {
  for (const child of content(node)) {
    if (isBlank(child) || isComment(child) || (isElement(child) && child.tagName === 'li')) continue
    report(context, child, 'import-structure-repaired', 'Non-item child of an HTML list dropped')
  }
  const items = elements(node).filter(child => child.nodeName === 'li').map(child => listItem(child, context))
  if (items.length === 0) {
    report(context, node, 'import-structure-repaired', 'HTML list with no item dropped')
    return []
  }
  const mapped = attrs(context, node, ['start', 'type', 'data-delim'])
  const tasks = items.some(item => item.task !== undefined)
  return [{ type: 'list', children: items, marker: listMarker(node, context), spacing: listSpacing(node, items, context),
    ...(tasks ? withoutClasses(mapped, ['task-list']) : mapped) }]
}

/** C2-M-032: the mark of a task item: a known state attribute, or else the box's `checked`. */
function taskMark(node: Html.Element, checkbox: Html.Element, context: HtmlContext): string {
  const state = attr(node, 'data-task-state')
  if (state !== undefined && TASK_STATUS.has(state) && !TASK_NO_STATE.includes(state)) return state
  if (state !== undefined) report(context, node, 'import-attribute-dropped', `Unknown task state ${state} dropped`)
  return attr(checkbox, 'checked') !== undefined ? 'x' : ' '
}

/** C2-H-032, C2-H-033: the box of a task item, its state, and the class and style every render gives the item. */
function listItem(node: Html.Element, context: HtmlContext): ListItemNode {
  const [checkbox, ...further] = elements(node).filter(child => child.nodeName === 'input' && attr(child, 'type') === 'checkbox')
  // C2-M-032: each box after the first is dropped, also with rawHtml on.
  for (const box of further) report(context, box, 'import-element-dropped', 'A further checkbox of a task item dropped')
  if (checkbox?.attrs.some(entry => !['type', 'checked', 'disabled', 'aria-label'].includes(entry.name)) === true) {
    report(context, checkbox, 'import-attribute-dropped', 'Checkbox attributes outside task state dropped')
  }
  const nodes = content(node).filter(child => child !== checkbox)
  const lead = nodes[0]
  if (checkbox && lead !== undefined && isText(lead) && lead.value.startsWith(' ')) {
    nodes[0] = { ...lead, value: lead.value.slice(1) }
  }
  const kept = nodes.filter(child => !further.some(box => box === child))
  const mapped = attrs(context, node, ['data-task-state'])
  const own = checkbox ? withoutStyle(withoutClasses(mapped, ['task'])) : mapped
  const task = checkbox ? { task: { mark: taskMark(node, checkbox, context) } } : {}
  return { type: 'list_item', children: blocks(kept, node, context), ...task, ...own }
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
  if (only !== undefined && takesCaption(only, caption !== undefined)) {
    return { ...only, ...captionPart, ...merged(context, node, own, only) }
  }
  return { type: 'figure_group', children, ...captionPart, ...own }
}

/**
 * C2-M-043, C2-H-199: the attributes of a figure and of its block, merged as consecutive attribute blocks are, the
 * figure's first: classes add up, and an id, a key, a `lang` or a `dir` of the block replaces the figure's, which is
 * dropped and reported.
 */
function merged(context: HtmlContext, node: Html.Element, figure: MappedAttrs, block: Block): MappedAttrs {
  const inner: MappedAttrs = {}
  if ('attrs' in block && block.attrs !== undefined) inner.attrs = block.attrs
  if (block.lang !== undefined) inner.lang = block.lang
  if (block.dir !== undefined) inner.dir = block.dir
  if (replacesFigure(figure, inner)) {
    report(context, node, 'import-attribute-dropped', 'A figure attribute that the captioned block replaces dropped')
  }
  const result: MappedAttrs = {}
  const attrsOut = mergedAttrs(figure.attrs ?? {}, inner.attrs ?? {})
  if (attrsOut !== undefined) result.attrs = attrsOut
  const lang = inner.lang ?? figure.lang
  const dir = inner.dir ?? figure.dir
  if (lang !== undefined) result.lang = lang
  if (dir !== undefined) result.dir = dir
  return result
}

function replacesFigure(figure: MappedAttrs, inner: MappedAttrs): boolean {
  if (figure.lang !== undefined && inner.lang !== undefined) return true
  if (figure.dir !== undefined && inner.dir !== undefined) return true
  const outer = figure.attrs ?? {}
  const own = inner.attrs ?? {}
  if (outer.id !== undefined && own.id !== undefined) return true
  return (outer.keyValues ?? []).some(([key]) => (own.keyValues ?? []).some(([name]) => name === key))
}

function mergedAttrs(outer: Attrs, own: Attrs): Attrs | undefined {
  const result: Attrs = {}
  const id = own.id ?? outer.id
  if (id !== undefined) result.id = id
  const classes = [...outer.classes ?? [], ...own.classes ?? []]
  if (classes.length > 0) result.classes = classes
  const keys = new Map([...outer.keyValues ?? [], ...own.keyValues ?? []])
  if (keys.size > 0) result.keyValues = [...keys]
  return Object.keys(result).length > 0 ? result : undefined
}

/** C2-M-043, C2-A-082: the blocks with a caption slot, which the figure's caption may fill. */
function takesCaption(block: Block, captioned: boolean): boolean {
  const slot = block.type === 'code_block' || block.type === 'block_quote' || block.type === 'table'
    || (block.type === 'paragraph' && block.role !== undefined)
  return slot && (!captioned || !('caption' in block) || block.caption === undefined)
}

function panel(node: Html.Element, context: HtmlContext): Block {
  const inner = elements(node)
  const only = inner.length === 1 ? inner[0] : undefined
  if (classList(node)[0] === 'carve-figure-panel' && only?.tagName === 'table' && node.attrs.length === 1) return table(only, context)
  return figure(node, context, classList(node)[0] === 'carve-figure-panel' ? ['carve-figure-panel'] : [])
}

function tableCell(node: Html.Element, context: HtmlContext, inHead: boolean): TableCellNode {
  const hasBlocks = elements(node).some(child => isBlockElement(child) || treatment(child) === 'div')
  const result: TableCellNode = hasBlocks ? { type: 'table_cell', header: node.tagName === 'th',
    children: blockChildren(node, context) } : cell(cellInline(node, context), node.tagName === 'th')
  // C2-M-038, C2-A-091: a cell whose blocks were all dropped keeps one empty cell paragraph.
  if (result.children.length === 0) {
    result.children.push({ type: 'cell_paragraph', children: [] })
    report(context, node, 'import-structure-repaired', 'A table cell whose blocks were all dropped holds an empty paragraph')
  }
  const colspan = htmlSpan(attr(node, 'colspan'))
  const rowspan = htmlRowspan(node, context)
  if (colspan !== undefined) result.colspan = colspan
  if (rowspan !== undefined) result.rowspan = rowspan
  const styled = cellMarks(node, result, inHead, context)
  Object.assign(result, attrs(context, node, ['colspan', 'rowspan', 'scope', 'align', 'valign', ...(styled ? ['style'] : [])]))
  return result
}

const SCOPES = ['col', 'row', 'colgroup', 'rowgroup'] as const
const VALIGNS = ['top', 'middle', 'bottom', 'baseline'] as const
const ALIGNS = ['left', 'right', 'center'] as const

/** The value of the attribute `name` in lower case when it lies in `set`; one outside it is dropped and reported. */
function cellValue<T extends string>(node: Html.Element, name: string, set: readonly T[], context: HtmlContext): T | undefined {
  const raw = attr(node, name)
  if (raw === undefined) return undefined
  const value = asciiLower(raw)
  if (isKind(set, value)) return value
  report(context, node, 'import-attribute-dropped', `A ${name} value outside its set dropped`)
  return undefined
}

/** C2-M-040: an axis that a declaration gives drops the attribute of that axis, since the declaration wins. */
function cellAxis<T extends string>(node: Html.Element, name: string, set: readonly T[], declared: T | undefined,
  context: HtmlContext): T | undefined {
  if (declared === undefined) return cellValue(node, name, set, context)
  if (has(node, name)) report(context, node, 'import-attribute-dropped', `A ${name} attribute beside a declaration of its axis dropped`)
  return declared
}

/**
 * C2-H-056 to C2-H-058, C2-M-040: the scope, other than the default a render writes on every header cell, and the
 * alignments. Returns whether the `style` gave an alignment, which then is no authored style.
 */
function cellMarks(node: Html.Element, result: TableCellNode, inHead: boolean, context: HtmlContext): boolean {
  const scope = cellValue(node, 'scope', SCOPES, context)
  const implied = node.tagName === 'th' && scope === (inHead ? 'col' : 'row')
  if (!implied && scope !== undefined) result.scope = scope
  const declared = cellStyle(attr(node, 'style'))
  const align = cellAxis(node, 'align', ALIGNS, declared?.align, context)
  const valign = cellAxis(node, 'valign', VALIGNS, declared?.valign, context)
  if (align !== undefined) result.align = align
  if (valign !== undefined) result.valign = valign
  return declared !== undefined
}

type CellAlign = typeof ALIGNS[number]
type CellValign = typeof VALIGNS[number]

/** C2-M-040: a `style` exactly as a render writes it (C2-H-057): one declaration of either axis, or both in order. */
function cellStyle(style: string | undefined): { align?: CellAlign, valign?: CellValign } | undefined {
  if (style === undefined) return undefined
  const align = declaration(style, 'text-align: ', ALIGNS)
  if (align !== undefined) return { align }
  const valign = declaration(style, 'vertical-align: ', VALIGNS)
  if (valign !== undefined) return { valign }
  const gap = style.indexOf('; ')
  const first = gap < 0 ? undefined : declaration(style.slice(0, gap + 1), 'text-align: ', ALIGNS)
  const second = gap < 0 ? undefined : declaration(style.slice(gap + 2), 'vertical-align: ', VALIGNS)
  return first !== undefined && second !== undefined ? { align: first, valign: second } : undefined
}

function declaration<T extends string>(text: string, property: string, set: readonly T[]): T | undefined {
  if (!text.startsWith(property) || !text.endsWith(';')) return undefined
  const value = text.slice(property.length, -1)
  return isKind(set, value) ? value : undefined
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
  if (flattenCellBreaks(children)) report(context, node, 'import-whitespace-normalized', 'HTML table cell line break read as a space')
  return coalesce(children)
}

/** A line break at any depth of a cell reads as a space; returns whether there was one. */
export function flattenCellBreaks(children: Inline[]): boolean {
  const pending: Inline[][] = [children]
  let changed = false
  while (pending.length > 0) {
    const group = pending.pop()
    if (group !== undefined) changed = flattenCellGroup(group, pending) || changed
  }
  return changed
}

function groupRows(node: Html.Element, context: HtmlContext): Html.Element[] {
  if (node.tagName !== 'table') {
    for (const child of elements(node)) {
      if (child.tagName !== 'tr') report(context, child, 'import-structure-repaired', 'Non-row child in table group')
    }
  }
  return elements(node).filter(child => child.nodeName === 'tr')
}

function rows(node: Html.Element, context: HtmlContext, inHead: boolean): TableRowNode[] {
  return rowsOf(groupRows(node, context), context, inHead)
}

function rowsOf(groupRows: Html.Element[], context: HtmlContext, inHead: boolean): TableRowNode[] {
  const result: TableRowNode[] = groupRows.map(child => {
    for (const entry of elements(child)) {
      if (entry.nodeName !== 'th' && entry.nodeName !== 'td') {
        report(context, entry, 'import-structure-repaired', 'Non-cell child in HTML row')
      }
    }
    return { ...row(elements(child).filter(entry => entry.nodeName === 'th' || entry.nodeName === 'td')
      .map(entry => tableCell(entry, context, inHead))), ...attrs(context, child) }
  })
  clampRowspans(result, groupRows, context)
  return result
}

/** C2-M-037: a row heads the columns when it has cells and each is a `<th>` with no `scope` or with `scope` `col`. */
function headsColumns(tr: Html.Element): boolean {
  const cells = elements(tr).filter(entry => entry.nodeName === 'th' || entry.nodeName === 'td')
  return cells.length > 0 && cells.every(entry => {
    if (entry.nodeName !== 'th') return false
    const scope = attr(entry, 'scope')
    return scope === undefined || asciiLower(scope) === 'col'
  })
}

/** C2-A-093, C2-B-174: as in the HTML table model, a row span ends at the last row of its group. */
function clampRowspans(result: TableRowNode[], groupRows: Html.Element[], context: HtmlContext): void {
  result.forEach((tableRow, index) => {
    for (const tableCell of tableRow.children) {
      const room = result.length - index
      if (tableCell.rowspan === undefined || tableCell.rowspan <= room) continue
      const owner = groupRows[index]
      if (owner !== undefined) report(context, owner, 'import-structure-repaired', 'HTML rowspan past the end of its row group clamped')
      if (room > 1) tableCell.rowspan = room
      else delete tableCell.rowspan
    }
  })
}

type TableChildren = Extract<Block, { type: 'table' }>['children']

/**
 * C2-M-037, C2-A-086: the first `<thead>` is the first group and the first `<tfoot>` the last, as HTML displays them;
 * each further one is a body at its place, reported. With no `<thead>`, the leading column-heading rows of the first
 * body are the head, and a body they leave empty is dropped.
 */
function tableGroups(node: Html.Element, context: HtmlContext): TableChildren {
  const groups = elements(node).filter(child => ['thead', 'tbody', 'tfoot'].includes(child.nodeName))
  const head = groups.find(group => group.nodeName === 'thead')
  const foot = groups.find(group => group.nodeName === 'tfoot')
  const bodies = groups.filter(group => group !== head && group !== foot)
  const directRows = groupRows(node, context)
  const firstBody = directRows.length ? node : bodies[0]
  let headRows: TableRowNode[] = []
  const bodyOf = (group: Html.Element): TableRowNode[] => {
    const all = group === node ? directRows : groupRows(group, context)
    if (head !== undefined || group !== firstBody) return rowsOf(all, context, false)
    let lead = 0
    while (lead < all.length && headsColumns(all[lead] as Html.Element)) lead++
    headRows = rowsOf(all.slice(0, lead), context, true)
    return rowsOf(all.slice(lead), context, false)
  }
  const direct = directRows.length ? bodyOf(node) : []
  const children: TableChildren = []
  for (const group of bodies) {
    if (group.nodeName !== 'tbody') report(context, group, 'import-structure-repaired', `A further ${group.nodeName} read as a body`)
    const bodyRows = bodyOf(group)
    const bodyAttrs = attrs(context, group)
    if (bodyRows.length || group !== firstBody || headRows.length === 0) children.push({ type: 'table_body', children: bodyRows, ...bodyAttrs })
    else if (Object.keys(bodyAttrs).length) report(context, group, 'import-attribute-dropped', 'The attributes of a body left empty by its head rows dropped')
  }
  if (direct.length) children.unshift({ type: 'table_body', children: direct })
  if (head !== undefined) children.unshift({ type: 'table_head', children: rows(head, context, true), ...attrs(context, head) })
  else if (headRows.length) children.unshift({ type: 'table_head', children: headRows })
  if (foot !== undefined) children.push({ type: 'table_foot', children: rows(foot, context, false), ...attrs(context, foot) })
  return children
}

/** C2-H-152: the widths of a column group, a percent each. */
function columnWidths(node: Html.Element, context: HtmlContext): (number | undefined)[] {
  const group = elements(node).find(child => child.tagName === 'colgroup')
  return (group === undefined ? [] : elements(group).filter(child => child.tagName === 'col')).map(col => {
    const style = attr(col, 'style')
    const read = style === undefined ? undefined : colStyleWidth(style)
    // C2-M-041: a style that gives no width or holds another declaration is reported.
    if (read !== undefined && (read.width === undefined || read.other)) {
      report(context, col, 'import-attribute-dropped', 'A col style that gives no width or holds another declaration dropped')
    }
    return read?.width
  })
}

const ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu

/**
 * C2-M-041: the style of a `<col>` read as declarations; the last `width: N%` gives the width, and `other` says
 * whether any other declaration stands beside it.
 */
function colStyleWidth(style: string): { width: number | undefined, other: boolean } {
  let width: number | undefined
  let declarations = 0
  for (const piece of style.split(';')) {
    if (piece.replace(ASCII_WHITESPACE, '') === '') continue
    declarations++
    const colon = piece.indexOf(':')
    if (colon < 0 || piece.slice(0, colon).replace(ASCII_WHITESPACE, '').toLowerCase() !== 'width') continue
    const value = percentWidth(piece.slice(colon + 1).replace(ASCII_WHITESPACE, ''))
    if (value !== undefined) width = value
  }
  return { width, other: declarations > 1 }
}

/** C2-M-041, C2-B-212: `N%` with N a decimal number above 0 and at most 100, as a fraction. */
function percentWidth(text: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)%$/u.exec(text)
  if (match === null) return undefined
  const value = Number(match[1])
  return value > 0 && value <= 100 ? value / 100 : undefined
}

function tableColumns(children: TableChildren, node: Html.Element, context: HtmlContext): TableColumnNode[] {
  const width = Math.max(0, ...children.flatMap(group => group.type === 'comment' ? [] : group.children
    .filter(entry => entry.type === 'table_row').map(entry => entry.children.reduce((sum, entryCell) =>
      sum + (entryCell.colspan ?? 1), 0))))
  const widths = columnWidths(node, context)
  return Array.from({ length: width }, (_, index) => {
    const value = widths[index]
    return value === undefined ? { type: 'table_column' as const }
      : { type: 'table_column' as const, width: value }
  })
}

function table(node: Html.Element, context: HtmlContext): Block {
  const children = tableGroups(node, context)
  const captions = elements(node).filter(child => child.nodeName === 'caption')
  const caption = captions[0]
  // C2-M-041: each caption after the first is dropped with its content.
  for (const extra of captions.slice(1)) report(context, extra, 'import-element-dropped', 'A second caption of a table dropped')
  for (const child of elements(node)) {
    if (!['caption', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(child.tagName)) {
      report(context, child, 'import-structure-repaired', `Unsupported table child ${child.tagName}`)
    }
  }
  const captionNode = caption === undefined ? undefined : figureCaption(caption, context)
  const result: TableNode = { type: 'table', children, columns: tableColumns(children, node, context),
    ...(captionNode ? { caption: captionNode } : {}), ...attrs(context, node) }
  resolveAlignments(result)
  return result
}

function definitionEntries(nodes: Html.ChildNode[], context: HtmlContext, inGroup: boolean): DefinitionEntry[] {
  const children: DefinitionEntry[] = []
  for (const child of nodes) {
    if (isElement(child) && child.nodeName === 'dt') {
      children.push(...withContent<DefinitionEntry>({ type: 'definition_term', children: inlineChildren(child, context),
        ...attrs(context, child) }, child, context))
    } else if (isElement(child) && child.nodeName === 'dd') {
      children.push({ type: 'definition_description', children: blockChildren(child, context), ...attrs(context, child) })
    } else if (isElement(child) && child.nodeName === 'div' && !inGroup) {
      // C2-M-036: the HTML Standard allows a div around a group of terms and descriptions.
      append(children, definitionEntries(content(child), context, true))
    } else if (!isBlank(child) && !isComment(child)) {
      report(context, child, 'import-structure-repaired', 'Non-entry child of a description list dropped')
    }
  }
  return children
}

/** C2-M-036, C2-M-070: a description list with no entry is dropped and reported. */
function definitionList(node: Html.Element, context: HtmlContext): Block[] {
  const children = definitionEntries(content(node), context, false)
  if (children.length === 0) {
    report(context, node, 'import-structure-repaired', 'Description list with no entry dropped')
    return []
  }
  return [{ type: 'definition_list', children, ...attrs(context, node) }]
}

function fallbackBlock(node: Html.Element, context: HtmlContext): Block[] {
  if (node.tagName === 'img') return imageParagraph(htmlImage(node, context))
  const children = trimInlineEdges(inline(node, context), node, context)
  return children.length > 0 ? [paragraph(children)] : []
}

/** The elements that never reach the tree as elements, with their content: their attributes give no entry (C2-M-066). */
function silent(node: Html.Element): boolean {
  const kind = treatment(node)
  return kind === 'drop' || kind === 'raw' || isRawSpan(node) || node.tagName === 'input'
}

/** C2-M-052, C2-M-054: every attribute the tree cannot keep, once; markup inside code and math is dropped unread. */
function auditElement(node: Html.ChildNode, context: HtmlContext): void {
  if (!isElement(node) || silent(node)) return
  for (const attribute of node.attrs) {
    const reason = droppedAttribute(attribute.name, attribute.value)
    if (reason !== undefined) report(context, node, 'import-attribute-dropped', `Attribute ${attribute.name} dropped: ${reason}`)
  }
  if (['math', 'pre', 'code'].includes(node.tagName)) return
  for (const child of content(node)) auditElement(child, context)
}

/** C2-M-002: a document starts, after leading ASCII whitespace and comments, with `<!doctype` or `<html`. */
export function isFullDocument(input: string): boolean {
  let at = 0
  while (at < input.length) {
    const code = input.charCodeAt(at)
    if (code === 32 || code === 9 || code === 10 || code === 12 || code === 13) at++
    else if (input.startsWith('<!--', at)) {
      const end = input.indexOf('-->', at + 4)
      if (end < 0) return false
      at = end + 3
    } else break
  }
  const head = input.slice(at, at + 9).toLowerCase()
  return head === '<!doctype' || head.startsWith('<html')
}

/**
 * C2-M-002: parse5 `parseFragment` with a `body` context, where parse5 defaults to `template`. The children leave the
 * fragment root at once: parse5 splices each one off the front, which is quadratic.
 */
function parseFragment(input: string, sourceLocations = true): Html.DocumentFragment {
  const body = defaultTreeAdapter.createElement('body', html.NS.HTML, [])
  const parser = Parser.getFragmentParser<DefaultTreeAdapterMap>(body, { sourceCodeLocationInfo: sourceLocations })
  parser.tokenizer.write(input, true)
  const fragment = defaultTreeAdapter.createDocumentFragment()
  const root = defaultTreeAdapter.getFirstChild(parser.document)
  if (root === null || !('childNodes' in root)) return fragment
  fragment.childNodes = root.childNodes
  root.childNodes = []
  for (const child of fragment.childNodes) child.parentNode = fragment
  return fragment
}

/** What the Markdown and Djot hub adds around the HTML import: carriers set on the parsed HTML, and children restored after it. */
export interface HubHooks {
  prepare?: (nodes: Html.ChildNode[]) => void
  finish?: (children: DocumentNode['children']) => DocumentNode['children']
}

export function importHtml(
  input: string, rawHtml = false, hooks: HubHooks = {}, sourceLocations = true, labels: Readonly<Record<string, string>> = {},
  adapter: Adapter = 'generic',
): ImportResult {
  const full = isFullDocument(input)
  const foreign = full ? parse(input, { sourceCodeLocationInfo: sourceLocations }) : parseFragment(input, sourceLocations)
  ensureForeignDepth(foreign, 'html')
  hooks.prepare?.(foreign.childNodes)
  applyAdapter(foreign, adapter)
  const context: HtmlContext = { format: 'html', input, rawHtml, labels: { ...DEFAULT_LABELS, ...labels }, diagnostics: [], deferred: [],
    notes: new Map(), footnotes: [], abbreviations: new Map(), templates: new Map(), definitions: new Map(),
    anchorKeys: new Set() }
  if (!full) fragmentBody(input, context)
  collectNotes(foreign.childNodes, context)
  rootLanguage(foreign.childNodes, context)
  for (const child of foreign.childNodes) auditElement(child, context)
  collectTemplates(foreign.childNodes, context)
  const first = foreign.childNodes[0]
  const children = first === undefined ? [] : flow(foreign.childNodes, first, context, documentChild)
  const all: DocumentNode['children'] = [...children, ...rebuiltDefinitions(context, children), ...context.footnotes,
    ...(context.deferred ?? [])]
  return complete(context, hooks.finish ? hooks.finish(all) : all)
}

function fragmentBody(input: string, context: HtmlContext): void {
  if (!/<body(?:\s|>)/iu.test(input)) return
  const document = parse(input, { sourceCodeLocationInfo: true })
  const html = document.childNodes.find(node => isElement(node) && node.tagName === 'html')
  if (!html || !isElement(html)) return
  const body = elements(html).find(node => node.tagName === 'body')
  if (body?.sourceCodeLocation === undefined) return
  wrapperAttributes(body, context)
  const lang = attr(body, 'lang')
  const dir = directionOf(attr(body, 'dir'))
  if (lang) context.rootLang = lang
  if (dir !== undefined) context.rootDir = dir
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
    const dir = directionOf((body ? attr(body, 'dir') : undefined) ?? attr(html, 'dir'))
    if (lang) context.rootLang = lang
    if (dir !== undefined) context.rootDir = dir
  }
}

