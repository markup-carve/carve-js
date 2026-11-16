// Inline HTML to Carve inline nodes: foreign markup, and the elements and carriers of a 0.2 render (C2-H-072 to C2-H-101).
import { serializeOuter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { foldLabel, type Inline, type RubyPairNode } from '../../v2/src/index.ts'
import {
  at, attr, attrs, classList, content, degraded, elements, has, ignoredCarrier, isComment, isElement, isText, plain, unsupported,
  withoutClasses, withoutKeys, isRawFormat, isRawSpan, type HtmlContext, type NoteEntry,
} from './html-dom.ts'
import { coalesce, paragraph, safeUrl, softText, text, withDestination } from './kit.ts'

const EDGE_ELEMENTS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dt', 'caption', 'figcaption']

export function inlineChildren(node: Html.Element, context: HtmlContext, nodes: Html.ChildNode[] = content(node)): Inline[] {
  const children = normalizeBreaks(coalesce(nodes.flatMap(child => inline(child, context))), node, context)
  return EDGE_ELEMENTS.includes(node.tagName) ? trimInlineEdges(children, node, context) : children
}

function horizontal(code: number): boolean { return code === 32 || code === 9 }

export function trimStart(value: string): string {
  let index = 0
  while (index < value.length && horizontal(value.charCodeAt(index))) index++
  return value.slice(index)
}

export function trimEnd(value: string): string {
  let index = value.length
  while (index > 0 && horizontal(value.charCodeAt(index - 1))) index--
  return value.slice(0, index)
}

function appendSoft(result: Inline[], child: Extract<Inline, { type: 'soft_break' }>): boolean {
  let changed = false
  const previous = result.at(-1)
  if (previous?.type === 'text') {
    const value = trimEnd(previous.value)
    if (value !== previous.value) { previous.value = value; changed = true }
    if (value === '') result.pop()
  }
  const before = result.at(-1)
  if (before?.type === 'soft_break' || before?.type === 'hard_break') return true
  result.push(child)
  return changed
}

/** C2-H-045, C2-H-195 row 5: a render writes a hard break as `<br>` and a line ending, so a line ending before it is layout. */
function appendHard(result: Inline[], child: Extract<Inline, { type: 'hard_break' }>): boolean {
  const dropped = result.at(-1)?.type === 'soft_break'
  if (dropped) result.pop()
  result.push(child)
  return dropped
}

function appendText(result: Inline[], child: Extract<Inline, { type: 'text' }>): boolean {
  const previous = result.at(-1)
  if (previous?.type !== 'soft_break' && previous?.type !== 'hard_break') { result.push(child); return false }
  const value = trimStart(child.value)
  const changed = value !== child.value
  if (value !== '') { child.value = value; result.push(child) }
  return changed || value === ''
}

export function normalizeBreaks(children: Inline[], node: Html.ChildNode, context: HtmlContext): Inline[] {
  const result: Inline[] = []
  let changed = false
  for (const child of children) {
    if (child.type === 'soft_break') changed = appendSoft(result, child) || changed
    else if (child.type === 'hard_break') changed = appendHard(result, child) || changed
    else if (child.type === 'text') changed = appendText(result, child) || changed
    else result.push(child)
  }
  if (changed) degraded(context, node, 'HTML whitespace around line ending normalized')
  return result
}

function trimLeading(children: Inline[]): boolean {
  let trimmed = false
  while (true) {
    const first = children[0]
    if (first?.type === 'soft_break' || (trimmed && first?.type === 'text' && trimStart(first.value) === '')) {
      children.shift()
      trimmed = true
    } else break
  }
  const first = children[0]
  if (trimmed && first?.type === 'text') first.value = trimStart(first.value)
  return trimmed
}

function trimTrailing(children: Inline[]): boolean {
  let trimmed = false
  while (true) {
    const last = children.at(-1)
    const before = children.at(-2)
    if (last?.type === 'soft_break' || (last?.type === 'text' && trimEnd(last.value) === ''
      && before?.type === 'soft_break')) {
      children.pop()
      trimmed = true
    } else break
  }
  const last = children.at(-1)
  if (trimmed && last?.type === 'text') last.value = trimEnd(last.value)
  return trimmed
}

export function trimInlineEdges(children: Inline[], node: Html.ChildNode, context: HtmlContext): Inline[] {
  const leading = trimLeading(children)
  const trailing = trimTrailing(children)
  if (leading || trailing) degraded(context, node, 'HTML line ending at block edge omitted')
  return children
}

/** C2-H-002, C2-H-195 row 3: a no-break space is the character in text, in every document. */
function textNodes(value: string): Inline[] {
  return softText(value)
}

export function inline(node: Html.ChildNode, context: HtmlContext): Inline[] {
  if (isText(node)) return textNodes(node.value)
  if (isComment(node)) return [{ type: 'raw_inline', format: 'html', value: serializeOuter(node) }]
  if (isElement(node)) return inlineElement(node, context)
  unsupported(context, node, 'Doctype has no inline representation')
  return []
}

function inlineElement(node: Html.Element, context: HtmlContext): Inline[] {
  const own = carveInline(node, context)
  if (own !== undefined) return own
  const children = inlineChildren(node, context)
  const formatted = formatInline(node, children, context)
  if (formatted !== undefined) return formatted
  switch (node.tagName) {
    case 'br': return [{ type: 'hard_break' }]
    case 'wbr': degraded(context, node, 'Word break became a soft break'); return [{ type: 'soft_break' }]
    case 'span': return [{ type: 'span', children, ...attrs(context, node) }]
    case 'a': return htmlLink(node, children, context)
    case 'img': return htmlImage(node, context)
    case 'math': return htmlMath(node, context)
    case 'ruby': return htmlRuby(node, context)
    case 'abbr': return htmlAbbreviation(node, children, context)
    case 'time': case 'kbd': return [semanticSpan(node, children, context)]
    case 'input': unsupported(context, node, 'Standalone input has no Carve inline node'); return []
    default:
      degraded(context, node, `HTML ${node.tagName} mapped to a span`)
      return [{ type: 'span', children, ...attrs(context, node) }]
  }
}

/** The elements a 0.2 render writes for a node of its own, read before the generic mapping. */
function carveInline(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  if (node.tagName === 'a') return footnoteInline(node, context) ?? anchorCarrier(node, context)
  if (node.tagName === 'span') return spanCarrier(node, context) ?? classedSpan(node, context)
  if (node.tagName === 'sup' && classList(node).includes('footnote-ref')) {
    const anchor = elements(node).find(child => child.tagName === 'a')
    if (anchor) return [{ type: 'footnote_ref', key: footnoteKey(attr(anchor, 'href') ?? ''), namespace: 'footnote' }]
  }
  return undefined
}

export function footnoteKey(fragment: string): string {
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment
  for (const prefix of ['user-content-fn-', 'fn-', 'fn']) if (hash.startsWith(prefix)) return hash.slice(prefix.length)
  return hash
}

/** C2-H-088: a note reference; C2-H-114: its key or, on the note, the inline footnote it stands for. */
function footnoteInline(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  if (attr(node, 'role') === 'doc-backlink') {
    degraded(context, node, 'Generated footnote backlink omitted')
    return []
  }
  if (attr(node, 'role') !== 'doc-noteref' && !has(node, 'data-footnote-ref')) return undefined
  const href = attr(node, 'href') ?? ''
  const note = context.notes.get(href.startsWith('#') ? href.slice(1) : href)
  const label = attr(node, 'data-carve-footnote-label')
  const mapped = attrs(context, node, [...(isGeneratedRefId(attr(node, 'id'), href) ? ['id'] : []), 'href', 'role', 'data-footnote-ref'])
  if (note?.inline === true && label === undefined) {
    return [{ type: 'inline_footnote', children: noteInline(note.item, context), ...mapped }]
  }
  return [{ type: 'footnote_ref', key: noteKey(node, label, note, href, context), namespace: 'footnote', ...mapped }]
}

/** C2-H-186: why the `data-carve-footnote-label` of a reference is not read, or undefined when it is. */
function labelFault(node: Html.Element, label: string, note: NoteEntry | undefined): string | undefined {
  if (label === '' || foldLabel(label) !== label) return 'the key is not folded'
  if (has(node, 'data-carve-xref')) return 'the reference is also a cross-reference'
  return note !== undefined && note.label !== label ? 'it does not name the note it links to' : undefined
}

/** C2-H-186: the key a reference carries, where its note agrees with it. */
function noteKey(node: Html.Element, label: string | undefined, note: NoteEntry | undefined, href: string, context: HtmlContext): string {
  if (has(node, 'data-carve-xref')) ignoredCarrier(context, node, 'data-carve-xref', 'the element is a footnote reference')
  const fault = label === undefined ? undefined : labelFault(node, label, note)
  if (label !== undefined && fault === undefined) return label
  if (fault !== undefined) ignoredCarrier(context, node, 'data-carve-footnote-label', fault)
  return note?.label ?? footnoteKey(href)
}

/** C2-H-088: the id a render gives the Nth reference to note `#fnK`, `fnrefK` and then `fnrefK-N`; any other id was authored. */
function isGeneratedRefId(id: string | undefined, href: string): boolean {
  if (id === undefined || !href.startsWith('#fn')) return true
  const stem = `fnref${href.slice(3)}`
  if (id === stem) return true
  const tail = id.startsWith(`${stem}-`) ? id.slice(stem.length + 1) : ''
  return tail !== '' && String(Number(tail)) === tail && Number(tail) > 1
}

/** C2-H-090: the body of an inline footnote is one paragraph. */
function noteInline(item: Html.Element, context: HtmlContext): Inline[] {
  const first = elements(item).find(child => child.tagName === 'p')
  return first === undefined ? [] : inlineChildren(first, context)
}

const LINK_FORMS = ['data-carve-ref', 'data-carve-autolink', 'data-carve-xref']

/** C2-H-185: a reference, an autolink and a cross-reference exclude each other, so two of them are both ignored. */
export function linkForms(node: Html.Element): string[] {
  return LINK_FORMS.filter(name => has(node, name))
}

function anchorCarrier(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  const forms = linkForms(node)
  if (forms.length > 1) {
    for (const name of forms.filter(form => form !== 'data-carve-ref')) ignoredCarrier(context, node, name, 'the link has one form')
    return undefined
  }
  if (forms[0] === 'data-carve-autolink') return autolink(node, context)
  if (forms[0] === 'data-carve-xref') return xref(node, context)
  return undefined
}

function autolink(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  const href = attr(node, 'href')
  if (href === undefined || elements(node).length > 0) {
    ignoredCarrier(context, node, 'data-carve-autolink', 'an autolink is a destination and its text')
    return undefined
  }
  const label = plain(node)
  return [{ type: 'autolink', href, ...(label !== href ? { text: label } : {}), ...attrs(context, node, ['href']) }]
}

/** C2-H-096: the text of a cross-reference is generated, so only its target reads back. */
function xref(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  const href = attr(node, 'href') ?? ''
  const key = href.slice(1)
  // C2-I-096: a cross-reference id holds no `>`, space or line break.
  if (!href.startsWith('#') || key === '' || key.includes('>') || key.includes(' ') || key.includes('\n')) {
    ignoredCarrier(context, node, 'data-carve-xref', 'the target is no cross-reference id')
    return undefined
  }
  return [{ type: 'xref', key: href.slice(1), namespace: 'heading', href, ...attrs(context, node, ['href']) }]
}

function spanCarrier(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  const raw = attr(node, 'data-carve-raw')
  if (raw !== undefined) return rawSpan(node, raw, context)
  if (has(node, 'data-carve-caption-number')) return captionNumber(node, context)
  return undefined
}

function inCaption(node: Html.Element): boolean {
  for (let parent = node.parentNode; parent !== null; parent = 'parentNode' in parent ? parent.parentNode : null) {
    if (parent.nodeName === 'figcaption' || parent.nodeName === 'caption') return true
  }
  return false
}

/** C2-H-186: a caption number mark in place of the span; resolution numbers it again, so its digits are not read. */
function captionNumber(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  if (inCaption(node) && node.attrs.length === 1 && content(node).every(isText)) return [{ type: 'caption_number' }]
  ignoredCarrier(context, node, 'data-carve-caption-number', 'the mark stands outside a caption, holds an element or has attributes')
  return undefined
}

/** C2-H-051, C2-H-186: a raw span. Its content is never read as structure, so a carrier inside it is text. */
function rawSpan(node: Html.Element, format: string, context: HtmlContext): Inline[] | undefined {
  if (!isRawSpan(node)) {
    ignoredCarrier(context, node, 'data-carve-raw', isRawFormat(format) ? 'the span holds an element or has attributes'
      : 'the value is no raw format name')
    return undefined
  }
  return [{ type: 'raw_inline', format, value: plain(node) }]
}

const MATH_CLASSES = ['math', 'inline', 'display']

/** The spans whose classes a 0.2 render gives the node it writes (C2-H-076, C2-H-100, C2-H-102). */
function classedSpan(node: Html.Element, context: HtmlContext): Inline[] | undefined {
  const classes = classList(node)
  const first = classes[0]
  if (first === 'math' && (classes[1] === 'inline' || classes[1] === 'display')) return mathSpan(node, classes[1], context)
  if (first === 'critic-comment') return [{ type: 'critic_comment', value: plain(node), ...withoutClasses(attrs(context, node), [first]) }]
  if (first === 'mention' || first === 'tag') return socialSpan(node, first, context)
  if (first?.startsWith('ext-') === true && first.length > 4) {
    return [{ type: 'inline_extension', name: first.slice(4), children: inlineChildren(node, context),
      ...withoutClasses(attrs(context, node), [first]) }]
  }
  return undefined
}

/** C2-H-102: a formula between the delimiters of its display. */
function mathSpan(node: Html.Element, display: string, context: HtmlContext): Inline[] | undefined {
  const value = plain(node)
  const [open, close] = display === 'display' ? ['\\[', '\\]'] : ['\\(', '\\)']
  if (!value.startsWith(open) || !value.endsWith(close) || value.length < 4) return undefined
  const mapped = withoutKeys(withoutClasses(attrs(context, node), MATH_CLASSES), ['role'])
  return [{ type: 'math', display: display === 'display', value: value.slice(2, -2), ...mapped }]
}

/** C2-H-100: an inert mention or tag, its name behind its sigil. */
function socialSpan(node: Html.Element, kind: 'mention' | 'tag', context: HtmlContext): Inline[] | undefined {
  const strong = elements(node)
  const name = plain(node)
  const sigil = kind === 'mention' ? '@' : '#'
  if (strong.length !== 1 || strong[0]?.tagName !== 'strong' || !name.startsWith(sigil) || name.length === 1) return undefined
  const mapped = withoutClasses(attrs(context, node), [kind])
  if (kind === 'tag') return [{ type: 'tag', name: name.slice(1), ...mapped }]
  return [{ type: 'mention', target: name.slice(1), kind: 'user', ...mapped }]
}

/** C2-H-098, C2-H-075: an `abbr` is the abbreviation a template defines, or a span with the key `abbr`. */
function htmlAbbreviation(node: Html.Element, children: Inline[], context: HtmlContext): Inline[] {
  const expansion = attr(node, 'title')
  const key = plain(node)
  const definition = context.abbreviations.get(key)
  if (definition !== undefined && definition.expansion === expansion && elements(node).length === 0) {
    return [{ type: 'abbreviation', key, namespace: 'abbr', expansion, ...attrs(context, node, ['title']) }]
  }
  return [semanticSpan(node, children, context)]
}

const SEMANTIC_TARGETS: Readonly<Record<string, string | undefined>> = { abbr: 'title', time: 'datetime', kbd: undefined }

/** C2-H-075: the span whose key named the element; the key takes the value of the attribute the element derived from it. */
function semanticSpan(node: Html.Element, children: Inline[], context: HtmlContext): Inline {
  const target = SEMANTIC_TARGETS[node.tagName]
  const value = target === undefined ? '' : attr(node, target) ?? ''
  const mapped = attrs(context, node, target === undefined ? [] : [target])
  const keyValues: [string, string][] = [[node.tagName, value], ...mapped.attrs?.keyValues ?? []]
  return { type: 'span', children, ...mapped, attrs: { ...mapped.attrs, keyValues } }
}

function htmlMath(node: Html.Element, context: HtmlContext): Inline[] {
  const annotation = elements(node).flatMap(child => elements(child)).find(child => child.tagName === 'annotation' &&
    ['application/x-tex', 'text/x-tex', 'LaTeX'].includes(attr(child, 'encoding') ?? ''))
  const source = annotation ? plain(annotation) : attr(node, 'alttext')
  if (source !== undefined) return [{ type: 'math', display: attr(node, 'display') === 'block', value: source }]
  unsupported(context, node, 'MathML has no TeX annotation or alttext')
  return [text(plain(node))]
}

function rubyBase(node: Html.ChildNode, context: HtmlContext): Inline[] {
  if (!isElement(node)) return inline(node, context)
  if (node.tagName === 'rb') return inlineChildren(node, context)
  // The parentheses are fallback text that every render writes again (C2-H-197: one reading in every document).
  return node.tagName === 'rp' ? [] : inline(node, context)
}

function htmlRuby(node: Html.Element, context: HtmlContext): Inline[] {
  const pairs: RubyPairNode[] = []
  let base: Inline[] = []
  for (const child of content(node)) {
    if (isElement(child) && child.tagName === 'rt') {
      pairs.push({ type: 'ruby_pair', base: coalesce(base), annotation: inlineChildren(child, context) })
      base = []
    } else base.push(...rubyBase(child, context))
  }
  if (base.length) degraded(context, node, 'Ruby base without annotation became text')
  const ruby: Inline = { type: 'ruby', pairs, ...attrs(context, node) }
  return pairs.length ? [ruby, ...base] : base
}

/** Why the reference carriers of `node` are not read, or undefined when they are well formed. */
function referenceFault(node: Html.Element, key: string | undefined, collapsed: boolean): [string, string] | undefined {
  if (key === undefined) return [collapsed ? 'data-carve-ref-collapsed' : 'data-carve-ref-shortcut', 'there is no reference key']
  if (key === '' || foldLabel(key) !== key) return ['data-carve-ref', 'the key is not folded']
  return linkForms(node).length > 1 ? ['data-carve-ref', 'the link has one form'] : undefined
}

/** C2-H-185: the collapsed and the shortcut form contradict each other, so both are ignored. */
function referenceForm(node: Html.Element, collapsed: boolean, shortcut: boolean, context: HtmlContext): 'full' | 'collapsed' | 'shortcut' {
  if (!collapsed || !shortcut) return collapsed ? 'collapsed' : shortcut ? 'shortcut' : 'full'
  for (const name of ['data-carve-ref-collapsed', 'data-carve-ref-shortcut']) {
    ignoredCarrier(context, node, name, 'a reference has one form')
  }
  return 'full'
}

/** C2-H-114, C2-H-117: the key and form of a reference. A malformed or contradicted carrier is not read. */
function reference(node: Html.Element, context: HtmlContext): { key: string, refForm: 'full' | 'collapsed' | 'shortcut' } | undefined {
  const key = attr(node, 'data-carve-ref')
  const collapsed = has(node, 'data-carve-ref-collapsed')
  const shortcut = has(node, 'data-carve-ref-shortcut')
  if (key === undefined && !collapsed && !shortcut) return undefined
  const fault = referenceFault(node, key, collapsed)
  if (fault !== undefined || key === undefined) {
    if (fault !== undefined) ignoredCarrier(context, node, fault[0], fault[1])
    return undefined
  }
  return { key, refForm: referenceForm(node, collapsed, shortcut, context) }
}

/**
 * C2-H-019, C2-H-191: a definition renders nothing, so the first reference of each key gives it back. Whether a key
 * that links `#ID` needs one is decided on the imported tree (C2-H-198, `rebuiltDefinitions`).
 */
function define(context: HtmlContext, key: string, href: string | undefined, node: Html.Element): void {
  if (href === undefined || context.definitions.has(key)) return
  if (node.tagName === 'a' && href.startsWith('#')) context.anchorKeys.add(key)
  const tooltip = attr(node, 'title')
  context.definitions.set(key, { type: 'link_reference_definition', key, namespace: 'link', href,
    ...(tooltip !== undefined ? { tooltip } : {}) })
}

function htmlLink(node: Html.Element, children: Inline[], context: HtmlContext): Inline[] {
  const href = attr(node, 'href')
  const safe = href === undefined ? undefined : safeUrl(context, node.tagName, href, ...at(node))
  const ref = reference(node, context)
  if (ref !== undefined) define(context, ref.key, safe, node)
  // C2-H-141: the title of a reference is that of its definition, which HTML does not keep apart.
  const tooltip = ref === undefined ? attr(node, 'title') : undefined
  return withDestination({ type: 'link', children, ...(safe !== undefined ? { href: safe } : {}),
    ...(tooltip !== undefined ? { tooltip } : {}), ...(ref ? { key: ref.key, namespace: 'link' as const, refForm: ref.refForm } : {}),
    ...attrs(context, node, ['href', 'title']) })
}

export function htmlImage(node: Html.Element, context: HtmlContext): Inline[] {
  const src = attr(node, 'src')
  const safe = src === undefined ? undefined : safeUrl(context, node.tagName, src, ...at(node))
  const long = attr(node, 'longdesc')
  const longSafe = long === undefined ? undefined : safeUrl(context, 'img.longdesc', long, ...at(node))
  const longDescription = longSafe !== undefined ? [paragraph([{ type: 'link' as const, href: longSafe,
    children: [text(longSafe)] }])] : undefined
  const ref = reference(node, context)
  if (ref !== undefined) define(context, ref.key, safe, node)
  const tooltip = ref === undefined ? attr(node, 'title') : undefined
  return withDestination({ type: 'image', ...(safe !== undefined ? { src: safe } : {}), alt: attr(node, 'alt') ?? '',
    ...(tooltip !== undefined ? { tooltip } : {}), ...(ref ? { key: ref.key, namespace: 'link' as const, refForm: ref.refForm } : {}),
    ...(longDescription ? { longDescription } : {}), ...attrs(context, node, ['src', 'alt', 'title', 'longdesc']) })
}

function formatInline(node: Html.Element, children: Inline[], context: HtmlContext): Inline[] | undefined {
  const mapped = (): ReturnType<typeof attrs> => attrs(context, node)
  switch (node.tagName) {
    case 'em': case 'i': return [{ type: 'emphasis', children, ...mapped() }]
    case 'strong': case 'b': return [{ type: 'strong', children, ...mapped() }]
    case 's': case 'strike': return [{ type: 'strike', children, ...mapped() }]
    case 'del': return [{ type: 'delete', children, ...mapped() }]
    case 'ins': return [{ type: 'insert', children, ...mapped() }]
    case 'mark': return [{ type: 'highlight', children, ...mapped() }]
    case 'u': return [{ type: 'underline', children, ...mapped() }]
    case 'sub': return [{ type: 'subscript', children, ...mapped() }]
    case 'sup': return [{ type: 'superscript', children, ...mapped() }]
    case 'code': return [{ type: 'code', value: plain(node), ...mapped() }]
    default: return undefined
  }
}
