// The inline elements of C2-H-072 to C2-H-101.
import { pushAll } from './arrays.ts'
import {
  type AbbreviationNode, type Attrs, type AutolinkNode, type CaptionNumberNode, type FootnoteRefNode, type ImageNode,
  type Inline, type InlineExtensionNode, type InlineFootnoteNode, type InlineParent, isBreak, type LinkNode,
  type LinkReferenceDefinitionNode, type LiteralInlineNode, type MathNode, type MentionNode, type Node, type NodeHandlers, type NodeOfType,
  type RawInlineNode, type RubyNode, type SmartPunctuationNode, type SpanNode, type SymbolNode, type TagNode, type XrefNode,
} from './ast.ts'
import {
  attributeBlockText, attributes, deniesUrl, destination, escapeCarrierText, escapeText, escapeTextNode, isDenied, keyValue, loss,
  type Pair, type Render, snippetCarriers, type TagParts,
} from './html-attributes.ts'
import { inlinesText } from './profile.ts'
import { kindGlyph, smartGlyph } from './ast-text.ts'
import { type SocialRequest } from './options.ts'
import { drawDerivedText } from './derived-text.ts'
import { withoutUnpairedSurrogates } from './unicode.ts'
import { utf8Length } from './positions.ts'
import { SNIPPET_CARRIERS, SNIPPET_MARKS } from './snippet-marks.ts'

type InlineWriter = (node: InlineParent, r: Render) => string


/** A space or tab only text, which a comment-only line may hold beside its comments. */
function isBlank(value: string): boolean {
  for (let p = 0; p < value.length; p++) {
    const code = value.charCodeAt(p)
    if (code !== 0x20 && code !== 0x09) return false
  }
  return true
}

/**
 * Whether the line that starts beside `from` and runs in the direction `step` holds only comments and spaces, with
 * at least one comment. `atEnd` asks in addition that the line ends the content and not at a break. In the
 * children of an inline node (`nested`) the line runs on past the list, where it holds the markup of the node.
 */
function isCommentOnlyLine(nodes: readonly Inline[], from: number, step: number, atEnd: boolean, nested: boolean): boolean {
  let comment = false
  let at = from
  for (; at >= 0 && at < nodes.length; at += step) {
    const node = nodes[at]!
    if (node.type === 'comment') comment = true
    else if (isBreak(node)) return comment && !atEnd
    else if (node.type !== 'text' || !isBlank(node.value)) return false
  }
  return comment && !nested
}

/**
 * C2-H-069: a comment-only line takes one line break around it with it: the one behind it, or the one before it
 * when the content ends with the comment. Each line is read at most twice, from the break on either side.
 */
export function isSkippedBreak(nodes: readonly Inline[], at: number, nested: boolean): boolean {
  return isCommentOnlyLine(nodes, at - 1, -1, false, nested) || isCommentOnlyLine(nodes, at + 1, 1, true, nested)
}

/** The HTML of `node` from the entry of WRITERS for its type, or undefined where it has none. */
function writeOwn<T extends keyof NodeOfType>(r: Render, type: T, node: NodeOfType[T]): string | undefined {
  return WRITERS[type]?.(node, r)
}

/** The HTML of `nodes`, the children of an inline node when `nested`, or else the inline content of a leaf. */
function inlineList(r: Render, nodes: readonly Inline[], nested: boolean): string {
  let out = ''
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    // Most nodes are text, which needs no writer.
    if (node.type === 'text') out += r.verse ? verseText(r, node.value, !nested && at === 0) : escapeTextNode(r, node.value)
    else if (r.settings.quotes !== null && node.type === 'smart_punctuation' && r.settings.smartTypography &&
      isApostrophe(node, nodes[at - 1], nodes[at + 1])) out += escapeText(smartGlyph(node))
    else if (!isBreak(node) || !isSkippedBreak(nodes, at, nested)) out += writeOwn(r, node.type, node) ?? ''
  }
  return out
}

const TAB_STOP = 4

const VERSE_RUN = /[ \t]+/g
const HIGH_SURROGATE = /[\uD800-\uDBFF]/g

/** The columns of `text` with no space or tab in it: one per code point. */
function verseColumns(text: string): number {
  return text.length - (text.match(HIGH_SURROGATE)?.length ?? 0)
}

/**
 * C2-H-043: the text of a line of a line block. Each run of spaces and tabs is written as one `&nbsp;` per column
 * when it leads the line (`lead`: the node is the line's first child, and the run starts it) or covers two or more
 * columns, and as one space otherwise.
 * Columns count code points from the start of the text node; a tab advances to the next multiple of 4.
 */
function verseText(r: Render, text: string, lead: boolean): string {
  const leads = lead && (text[0] === ' ' || text[0] === '\t')
  if (!leads && !text.includes('\t') && !text.includes('  ')) return escapeTextNode(r, text)
  let out = ''
  let column = 0
  let from = 0
  VERSE_RUN.lastIndex = 0
  for (let match = VERSE_RUN.exec(text); match !== null; match = VERSE_RUN.exec(text)) {
    const word = text.slice(from, match.index)
    out += escapeTextNode(r, word)
    column += verseColumns(word)
    const start = column
    for (const char of match[0]) column = char === '\t' ? column + TAB_STOP - column % TAB_STOP : column + 1
    out += (leads && match.index === 0) || column - start >= 2 ? '&nbsp;'.repeat(column - start) : ' '
    from = VERSE_RUN.lastIndex
  }
  return out + escapeTextNode(r, text.slice(from))
}

export function inlineHtml(r: Render, nodes: readonly Inline[]): string {
  return inlineList(r, nodes, false)
}

function children(r: Render, node: InlineParent): string {
  return inlineList(r, node.children, true)
}

function element(name: string, parts: TagParts = {}): InlineWriter {
  return (node, r) => `<${name}${attributes(r, node, parts)}>${children(r, node)}</${name}>`
}

const SPAN = element('span')

function authoredKey(node: Node, name: string): string | undefined {
  return node.attrs?.keyValues?.find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A copy of `node` without the keys `names`, which an element takes as its name; they match in lower case only (C2-H-075). */
function withoutKeys<N extends Node>(node: N, names: string[], caseInsensitive = false): N {
  const keyValues = (node.attrs?.keyValues ?? []).filter(([key]) => !names.includes(caseInsensitive ? key.toLowerCase() : key))
  return { ...node, attrs: { ...node.attrs, keyValues } }
}

const INSERT_REVISION_KEYS = ['author']
const COMMENT_REVISION_KEYS = ['author', 'datetime']

/** C2-H-210: a copy of `node` whose revision keys `names` are written as `data-` attributes, in place; an authored one wins (C2-H-013). */
function withRevisionKeys<N extends Node>(node: N, names: readonly string[]): N {
  const keyValues = node.attrs?.keyValues
  if (keyValues === undefined || !keyValues.some(([key]) => names.includes(key))) return node
  const authored = new Set(keyValues.map(([key]) => key.toLowerCase()))
  const mapped: [string, string][] = []
  for (const [key, value] of keyValues) {
    if (!names.includes(key)) mapped.push([key, value])
    else if (!authored.has(`data-${key}`)) mapped.push([`data-${key}`, value])
  }
  return { ...node, attrs: { ...node.attrs, keyValues: mapped } }
}

function revisionElement(name: string): InlineWriter {
  return (node, r) => `<${name}${attributes(r, withRevisionKeys(node, INSERT_REVISION_KEYS), {})}>${children(r, node)}</${name}>`
}

/** A closing single quote between two letters is an apostrophe, which locale quotes leave as it is. */
function isApostrophe(node: SmartPunctuationNode, before: Inline | undefined, after: Inline | undefined): boolean {
  return node.kind === 'right_single_quote' && before?.type === 'text' && after?.type === 'text' &&
    /\p{L}$/u.test(before.value) && /^\p{L}/u.test(after.value)
}

const QUOTE_KINDS = ['left_double_quote', 'right_double_quote', 'left_single_quote', 'right_single_quote']

/** The glyph of a smart punctuation node; a quote that carries the glyph of its kind takes that of a registered extension. */
function quoteGlyph(node: SmartPunctuationNode, r: Render): string {
  const glyph = smartGlyph(node)
  const at = r.settings.quotes === null ? -1 : QUOTE_KINDS.indexOf(node.kind)
  return at < 0 || glyph !== kindGlyph(node.kind) ? glyph : r.settings.quotes![at]!
}

/** C2-H-075: a span with the key `abbr`, `time` or `kbd` is that element; several nest, and the rest goes on the outermost. */
function span(node: SpanNode, r: Render): string {
  const found: (readonly [string, string | null, string])[] = []
  for (const [key, target] of r.settings.semanticKeys) {
    const value = node.attrs?.keyValues?.find(([name]) => name === key)?.[1]
    if (value !== undefined) found.push([key, target, value])
  }
  const first = found[0]
  if (first === undefined) return SPAN(node, r)
  const abbr = first[0] === 'abbr'
  if (abbr) r.abbrDepth++
  let html = children(r, node)
  if (abbr) r.abbrDepth--
  const rest = withoutKeys(node, found.map(([key]) => key))
  found.forEach(([key, target, value], index) => {
    const outermost = index === found.length - 1
    // An authored `title` or `datetime` wins over the derived one.
    const derived: [string, string][] = target === null || value === '' ||
      (outermost && authoredKey(node, target) !== undefined) ? [] : [[target, value]]
    html = `<${key}${attributes(r, outermost ? rest : null, { derived, origin: node })}>${html}</${key}>`
  })
  return html
}

/**
 * C2-H-141: the attributes of a link definition merge into a reference that resolves through it; the reference wins.
 * C2-H-020 merges those of a block image's paragraph the same way.
 */
export function mergedAttrs(own: Attrs, from: Attrs): Attrs {
  const ownKeyValues = own.keyValues ?? []
  const ownNames = new Set(ownKeyValues.map(([name]) => name.toLowerCase()))
  const keyValues = (from.keyValues ?? []).filter(([key]) => !ownNames.has(key.toLowerCase()))
  const attrs: Attrs = { classes: [...(from.classes ?? []), ...(own.classes ?? [])], keyValues: [...keyValues, ...ownKeyValues] }
  const id = own.id ?? from.id
  if (id !== undefined) attrs.id = id
  return attrs
}

function withDefinition<N extends LinkNode | ImageNode>(node: N, definition: LinkReferenceDefinitionNode | undefined): N {
  if (definition?.attrs === undefined && definition?.lang === undefined) return node
  const attrs = mergedAttrs(node.attrs ?? {}, definition.attrs ?? {})
  const lang = node.lang ?? definition.lang
  return lang === undefined ? { ...node, attrs } : { ...node, attrs, lang }
}

/** C2-H-085: the label part of an unresolved reference, written from its key. */
function unresolvedLabel(node: LinkNode | ImageNode, key: string): string {
  const label = node.refForm === 'shortcut' ? '' : node.refForm === 'collapsed' ? '[]' : `[${key}]`
  return escapeText(`${label}${attributeBlockText(node)}`)
}

function referenceCarriers(r: Render, node: LinkNode | ImageNode, key: string | undefined): Pair[] {
  if (!r.settings.roundtrip || key === undefined) return []
  const carriers: Pair[] = [['data-carve-ref', key]]
  if (node.refForm === 'collapsed') carriers.push(['data-carve-ref-collapsed', null])
  if (node.refForm === 'shortcut') carriers.push(['data-carve-ref-shortcut', null])
  return carriers
}

/**
 * C2-H-167: the one `rel` of a link, before the id: the authored words that pass C2-H-161, then the
 * words of the profile that are not among them. No word, no attribute. Returns the node without its `rel` key.
 */
function withRel<N extends Node>(r: Render, node: N, structural: Pair[]): N {
  const authored = authoredKey(node, 'rel')
  if (authored === undefined && r.linkRel === '') return node
  const words = authored === undefined ? [] : keyValue('rel', authored).split(/[\t\n\f\r ]+/).filter((word) => word !== '')
  for (const word of r.linkRel.split(' ')) if (word !== '' && !words.includes(word)) words.push(word)
  if (words.length > 0) structural.push(['rel', words.join(' ')])
  return authored === undefined ? node : withoutKeys(node, ['rel'], true)
}

/** C2-N-054: a reference in an included file takes the definition resolution chose for it. */
function definitionFor(r: Render, node: LinkNode | ImageNode, key: string | undefined): LinkReferenceDefinitionNode | undefined {
  if (key === undefined) return undefined
  return r.resolution.definitionOf.get(node) ?? r.resolution.definitions.get(key)
}

/** C2-H-163, C2-H-165: under `comment` a link the policy denies is the plain text of its children, and no `<a>`. */
function isDroppedLink(r: Render, href: string, node: Node): boolean {
  return r.settings.profile === 'comment' && isDenied(r, href, node)
}

/** C2-H-177: a reference with no target, or one that resolved to a heading the profile degraded, is written unresolved. */
function isUnresolvedLink(r: Render, href: string | undefined, definition: object | undefined): boolean {
  return href === undefined || (definition === undefined && r.resolution.goneTargets?.has(href) === true)
}

/**
 * C2-H-163, C2-H-165: whether `node`, standing outside any link, is written as the plain text of its children under
 * `comment` and that text is empty. Nothing is reported.
 */
export function isEmptyDroppedLink(r: Render, node: LinkNode): boolean {
  if (r.settings.profile !== 'comment') return false
  const key = node.key
  if (key !== undefined && isUnresolvedLink(r, node.href, definitionFor(r, node, key))) return false
  return deniesUrl(r, node.href ?? '') && inlinesText(node.children, r.resolution.xrefText) === ''
}

function link(node: LinkNode, r: Render): string {
  const html = linkHtml(node, r)
  // C2-H-215: a link that carries the carriers of its use but writes no `<a>` puts them on a span.
  if (!r.settings.roundtrip || html.startsWith('<a ') || !SNIPPET_CARRIERS.has(node)) return html
  return `<span${snippetCarriers(node)}>${html}</span>`
}

function linkHtml(node: LinkNode, r: Render): string {
  const key = node.key
  const href = node.href
  const definition = definitionFor(r, node, key)
  // C2-H-081, C2-H-085: an unresolved reference writes its ordinary text, inside link text too.
  if (key !== undefined && isUnresolvedLink(r, href, definition)) return `[${children(r, node)}]${unresolvedLabel(node, key)}`
  // C2-H-081: a link inside link text writes its content and no element.
  if (r.linkDepth > 0) return children(r, node)
  if (isDroppedLink(r, href ?? '', node)) return escapeText(inlinesText(node.children, r.resolution.xrefText))
  const title = node.tooltip ?? definition?.tooltip
  const structural: Pair[] = [['href', destination(r, href ?? '', node)]]
  if (title !== undefined) structural.push(['title', title])
  const merged = withRel(r, withDefinition(node, definition), structural)
  pushAll(structural, referenceCarriers(r, node, key))
  r.linkDepth++
  const outer = r.linkSnippet
  r.linkSnippet = SNIPPET_MARKS.get(node)
  const html = children(r, node)
  r.linkSnippet = outer
  r.linkDepth--
  const notes = r.linkNotes.length === 0 ? '' : r.linkNotes.join('')
  if (notes !== '') r.linkNotes.length = 0
  return `<a${attributes(r, merged, { structural, origin: node })}>${html}</a>${notes}`
}

function image(node: ImageNode, r: Render): string {
  if (node.longDescription !== undefined) r.longDescriptions.push(node.longDescription)
  const key = node.key
  const src = node.src
  const alt = node.alt ?? ''
  if (key !== undefined && src === undefined) return `![${escapeText(alt)}]${unresolvedLabel(node, key)}`
  const definition = definitionFor(r, node, key)
  const title = node.tooltip ?? definition?.tooltip
  const structural: Pair[] = [['src', destination(r, src ?? '', node)]]
  // C2-H-080: an unknown alt text, neither alt nor decorative, writes no alt attribute.
  if (node.alt !== undefined || node.decorative === true) structural.push(['alt', alt])
  if (title !== undefined) structural.push(['title', title])
  pushAll(structural, referenceCarriers(r, node, key))
  return `<img${attributes(r, withDefinition(node, definition), { structural, origin: node })}>`
}

function autolink(node: AutolinkNode, r: Render): string {
  const text = escapeText(node.text ?? node.href)
  if (r.linkDepth > 0 || isDroppedLink(r, node.href, node)) {
    // C2-H-215: as for a link, carriers with no `<a>` to stand on go on a span.
    return r.settings.roundtrip && SNIPPET_CARRIERS.has(node) ? `<span${snippetCarriers(node)}>${text}</span>` : text
  }
  const structural: Pair[] = [['href', destination(r, node.href, node)]]
  const written = withRel(r, node, structural)
  if (r.settings.roundtrip) structural.push(['data-carve-autolink', null])
  return `<a${attributes(r, written, { structural, origin: node })}>${text}</a>`
}

function xref(node: XrefNode, r: Render): string {
  const href = node.href
  // C2-H-086: unresolved, the characters as typed.
  if (href === undefined || r.resolution.goneTargets?.has(href) === true) return escapeText(`</#${node.key}>`)
  // C2-H-096: the generated text is plain text.
  const raw = r.resolution.xrefText.get(node) ?? ''
  let escaped: string
  let bytes: number | undefined
  // Short generated figure labels are usually unique, so caching each one costs more than counting its bytes.
  if (raw.length < 24) {
    escaped = escapeText(raw)
  } else {
    let cached = r.xrefTextCache.get(raw)
    if (cached === undefined) {
      const text = escapeText(raw)
      cached = { escaped: text, bytes: utf8Length(text) }
      r.xrefTextCache.set(raw, cached)
    }
    escaped = cached.escaped
    bytes = cached.bytes
  }
  // C2-H-201: past the budget the key stands for the generated text.
  const text = drawDerivedText(r, node, escaped, bytes) ? escaped : escapeText(node.key)
  if (r.linkDepth > 0) return text
  const structural: Pair[] = [['href', href]]
  if (r.settings.roundtrip) structural.push(['data-carve-xref', null])
  return `<a${attributes(r, node, { structural })}>${text}</a>`
}

function noteMark(r: Render, node: FootnoteRefNode | InlineFootnoteNode, number: number, structural: Pair[]): string {
  return `<a${attributes(r, node, { structural, id: r.resolution.refIds.get(node)!, idFirst: true })}><sup>${number}</sup></a>`
}

/** C2-H-088: the anchor of a footnote reference or of an inline footnote. */
function noteReference(node: FootnoteRefNode | InlineFootnoteNode, r: Render): string {
  const key = node.type === 'footnote_ref' ? node.key : undefined
  const note = r.resolution.noteOf.get(node)
  // C2-I-088: unresolved, its attribute blocks follow as one block in the fixed order (C2-I-085).
  if (note === undefined) return escapeText(`[^${key ?? ''}]${attributeBlockText(node)}`)
  const structural: Pair[] = [['href', `#${note.id}`], ['role', 'doc-noteref']]
  if (r.settings.roundtrip && key !== undefined) structural.push(['data-carve-footnote-label', key])
  if (r.linkDepth === 0) return noteMark(r, node, note.number, structural)
  const use = r.settings.roundtrip ? SNIPPET_MARKS.get(node) : undefined
  if (use !== undefined && use !== r.linkSnippet) structural.push(['data-carve-snippet-mark', String(use)])
  r.linkNotes.push(noteMark(r, node, note.number, structural))
  return ''
}

function math(node: MathNode, r: Render): string {
  const display = node.display
  const tag = attributes(r, node, { base: ['math', display ? 'display' : 'inline'], generated: [['role', 'math']] })
  const value = escapeText(node.value)
  // C2-H-151: the number of a numbered equation, which only a supplied tree holds.
  const number = node.number
  const numbered = number === undefined || !display
    ? ''
    : ` <span class="equation-number">${escapeText(`${node.numberPrefix ?? ''} ${number}`)}</span>`
  return `<span${tag}>${display ? `\\[${value}\\]` : `\\(${value}\\)`}</span>${numbered}`
}

/** C2-H-051, C2-H-053, C2-H-054: raw HTML is escaped unless `rawHtml` is on, and any other format is dropped. */
function rawInline(node: RawInlineNode, r: Render): string {
  if (node.format !== 'html') {
    loss(r, node, 'raw-format-dropped', `Dropped inline raw format "${node.format}" while rendering HTML`)
    return ''
  }
  // C2-H-051: with `rawHtml` on the payload is verbatim, with no carrier also under `roundtrip`.
  if (r.settings.rawHtml) return node.value
  // C2-H-172: the text of a roundtrip carrier keeps its bidirectional controls.
  if (r.settings.roundtrip) return `<span data-carve-raw="html">${escapeCarrierText(node.value)}</span>`
  return escapeText(node.value)
}

function templateUrl(template: string | undefined, name: string): string | null {
  return template === undefined ? null : template.replaceAll('{name}', encodeURIComponent(withoutUnpairedSurrogates(name)))
}

/** C2-H-126: the URL that `social` gives for a mention or a tag, or null. A resolver is final, and its error stays inside. */
function socialUrl(r: Render, kind: 'mention' | 'tag', name: string): string | null {
  const settings = r.settings.social
  if (settings === null) return null
  const resolver = kind === 'mention' ? settings.resolveMention : settings.resolveTag
  let url: string | null | undefined
  if (resolver === undefined) url = templateUrl(kind === 'mention' ? settings.mentionUrl : settings.tagUrl, name)
  else {
    const request: SocialRequest = Object.hasOwn(settings, 'context') ? { kind, name, context: settings.context } : { kind, name }
    try {
      url = resolver(request)
    } catch {
      url = null
    }
  }
  return typeof url !== 'string' || url === '' ? null : url
}

/** C2-H-100: a mention or a tag is an inert span, or a link when `social` gives a URL for it. */
function social(node: MentionNode | TagNode, r: Render): string {
  const mention = node.type === 'mention'
  const name = mention ? node.target : node.name
  const label = mention ? node.label : undefined
  const text = escapeText(label ?? `${mention ? '@' : '#'}${name}`)
  // C2-H-167: a linked mention or tag is a link for the profile, an inert span where the profile has no links.
  const url = r.linkDepth > 0 || !r.linksAllowed ? null : socialUrl(r, node.type, name)
  const parts: TagParts = { base: [node.type], classFirst: true }
  if (url === null) return `<span${attributes(r, node, parts)}><strong>${text}</strong></span>`
  const structural: Pair[] = [['href', destination(r, url, node)]]
  const written = withRel(r, node, structural)
  return `<a${attributes(r, written, { ...parts, structural })}>${text}</a>`
}

/** C2-H-101: the value of the `symbols` table verbatim, or the source; a span when it carries attributes. */
function symbol(node: SymbolNode, r: Render): string {
  const name = node.name
  const symbols = r.settings.symbols
  const value = (Object.hasOwn(symbols, name) ? symbols[name] : undefined) ?? escapeText(`:${name}:`)
  const tag = attributes(r, node, {})
  return tag === '' ? value : `<span${tag}>${value}</span>`
}

/** C2-H-049: a literal-text span is its escaped content, or a span when it carries attributes. */
function literal(node: LiteralInlineNode, r: Render): string {
  const tag = attributes(r, node, {})
  const value = escapeText(node.value)
  return tag === '' ? value : `<span${tag}>${value}</span>`
}

/** C2-H-098, C2-H-099. */
function abbreviation(node: AbbreviationNode, r: Render): string {
  const term = escapeText(node.key)
  const expansion = node.expansion ?? r.resolution.expansionOf.get(node)
  if (r.abbrDepth > 0 || expansion === undefined || !drawDerivedText(r, node, expansion)) return term
  return `<abbr${attributes(r, node, { structural: [['title', expansion]] })}>${term}</abbr>`
}

/** C2-H-066, C2-H-067: the number of the caption, or the mark itself where the caption takes none. */
function captionNumber(node: CaptionNumberNode, r: Render): string {
  const n = node.n
  if (n === undefined) return '#'
  return r.settings.roundtrip ? `<span data-carve-caption-number>${n}</span>` : String(n)
}

/** C2-H-142. */
function ruby(node: RubyNode, r: Render): string {
  let html = ''
  for (const pair of node.pairs) {
    html += `${inlineList(r, pair.base, true)}<rp>(</rp><rt>${inlineList(r, pair.annotation, true)}</rt><rp>)</rp>`
  }
  return `<ruby${attributes(r, node, {})}>${html}</ruby>`
}

/**
 * C2-H-076: an inline extension written in source has no renderer and is a span. C2-A-123,
 * C2-X-004: a name with a dot names a registered extension, which this engine does not know, so
 * it renders through its fallback and is reported.
 */
function inlineExtension(node: InlineExtensionNode, r: Render): string {
  const name = node.name
  if (!name.includes('.')) return `<span${attributes(r, node, { base: [`ext-${name}`] })}>${children(r, node)}</span>`
  const rendered = r.renderExtension(node)
  if (rendered !== null) return rendered
  loss(r, node, 'extension-fallback-rendered', `Rendered the fallback of the extension "${name}", which has no matching renderer`)
  const fallback = inlineList(r, node.fallback ?? node.children, true)
  // C2-X-035: the attributes of the node go on a span around its fallback.
  const tag = attributes(r, node, {})
  return tag === '' ? fallback : `<span${tag}>${fallback}</span>`
}

const SOFT_BREAKS = { newline: '\n', space: ' ', br: '<br>\n' } as const

const WRITERS: NodeHandlers<string, Render> = {
  text: (node, r) => escapeTextNode(r, node.value),
  span,
  link,
  image,
  autolink,
  xref,
  footnote_ref: noteReference,
  inline_footnote: noteReference,
  code: (node, r) => `<code${attributes(r, node, {})}>${escapeTextNode(r, node.value)}</code>`,
  literal_inline: literal,
  math,
  raw_inline: rawInline,
  critic_comment: (node, r) =>
    `<span${attributes(r, withRevisionKeys(node, COMMENT_REVISION_KEYS), { base: ['critic-comment'] })}>${escapeText(node.value)}</span>`,
  mention: social,
  tag: social,
  symbol,
  non_breaking_space: () => '&nbsp;',
  // C2-H-045.
  hard_break: () => '<br>\n',
  // C2-H-203.
  soft_break: (_node, r) => SOFT_BREAKS[r.settings.softBreak],
  // C2-H-078.
  smart_punctuation: (node, r) => escapeText(r.settings.smartTypography ? quoteGlyph(node, r) : node.source),
  abbreviation,
  caption_number: captionNumber,
  inline_extension: inlineExtension,
  small_caps: element('span', { base: ['smallcaps'] }),
  ruby,
  // C2-A-119: with no extension for citations the bracket text is written as text.
  citation_group: (node) => escapeText(node.raw),
  emphasis: element('em'),
  strong: element('strong'),
  underline: element('u'),
  strike: element('s'),
  highlight: element('mark'),
  superscript: element('sup'),
  subscript: element('sub'),
  insert: revisionElement('ins'),
  delete: revisionElement('del'),
}
