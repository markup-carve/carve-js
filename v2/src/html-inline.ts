// The inline elements of C2-H-072 to C2-H-101.
import {
  type AbbreviationNode, type Attrs, type AutolinkNode, type CaptionNumberNode, type FootnoteRefNode, handle, type ImageNode,
  type Inline, type InlineExtensionNode, type InlineFootnoteNode, type InlineParent, isBreak, type LinkNode,
  type LinkReferenceDefinitionNode, type LiteralInlineNode, type MathNode, type MentionNode, type Node, type NodeHandlers,
  type RawInlineNode, type RubyNode, type SpanNode, type SymbolNode, type TagNode, type XrefNode,
} from './ast.ts'
import {
  attributeBlockText, attributes, destination, escapeCarrierText, escapeText, escapeTextNode, keyValue, loss, type Pair, type Render,
  type TagParts,
} from './html-attributes.ts'

type InlineWriter = (node: InlineParent, r: Render) => string

// C2-H-075: the keys that name an element, from inside out, and the attribute the value of each becomes.
const SEMANTIC_KEYS: readonly (readonly [string, string | null])[] = [['abbr', 'title'], ['time', 'datetime'], ['kbd', null]]

function isLineComment(node: Inline | undefined): boolean {
  return node?.type === 'comment' && node.form === 'line'
}

/**
 * C2-B-137: a comment-only line is skipped, so one line break around it is not written: the one
 * behind it, or the one before it when the content ends with the comment.
 */
function isSkippedBreak(nodes: readonly Inline[], at: number): boolean {
  const before = nodes[at - 2]
  if (isLineComment(nodes[at - 1]) && (before === undefined || isBreak(before))) return true
  const after = nodes[at + 2]
  return isLineComment(nodes[at + 1]) && (after === undefined || !isBreak(after))
}

export function inlineHtml(r: Render, nodes: readonly Inline[]): string {
  let out = ''
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    // Most nodes are text, which needs no writer.
    if (node.type === 'text') out += escapeTextNode(r, node.value)
    else if (!isBreak(node) || !isSkippedBreak(nodes, at)) out += handle(WRITERS, node.type, node, r) ?? ''
  }
  return out
}

function children(r: Render, node: InlineParent): string {
  return inlineHtml(r, node.children)
}

function element(name: string, parts: TagParts = {}): InlineWriter {
  return (node, r) => `<${name}${attributes(r, node, parts)}>${children(r, node)}</${name}>`
}

const SPAN = element('span')

function authoredKey(node: Node, name: string): string | undefined {
  return node.attrs?.keyValues?.find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A copy of `node` without the keys `names`, which an element takes as its name. */
function withoutKeys<N extends Node>(node: N, names: string[]): N {
  const keyValues = (node.attrs?.keyValues ?? []).filter(([key]) => !names.includes(key.toLowerCase()))
  return { ...node, attrs: { ...node.attrs, keyValues } }
}

/** C2-H-075: a span with the key `abbr`, `time` or `kbd` is that element; several nest, and the rest goes on the outermost. */
function span(node: SpanNode, r: Render): string {
  const found: (readonly [string, string | null, string])[] = []
  for (const [key, target] of SEMANTIC_KEYS) {
    const value = authoredKey(node, key)
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
    const derived: Pair[] = target === null || (outermost && authoredKey(node, target) !== undefined) ? [] : [[target, value]]
    html = `<${key}${attributes(r, outermost ? rest : null, { structural: derived, origin: node })}>${html}</${key}>`
  })
  return html
}

/** C2-H-141: the attributes of a link definition merge into a reference that resolves through it; the reference wins. */
/** The attributes of a reference and of its definition, merged: the reference decides a key, the id and the language both carry. */
function mergedAttrs(own: Attrs, from: Attrs): Attrs {
  const ownKeyValues = own.keyValues ?? []
  const keyValues = (from.keyValues ?? []).filter(([key]) => !ownKeyValues.some(([name]) => name.toLowerCase() === key.toLowerCase()))
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
  return escapeText(`${node.form === 'collapsed' ? '[]' : `[${key}]`}${attributeBlockText(node)}`)
}

function referenceCarriers(r: Render, node: LinkNode | ImageNode, key: string | undefined): Pair[] {
  if (!r.settings.roundtrip || key === undefined) return []
  const carriers: Pair[] = [['data-carve-ref', key]]
  if (node.form === 'collapsed') carriers.push(['data-carve-ref-collapsed', null])
  return carriers
}

/**
 * C2-H-167: the one `rel` of a link, before the id: the authored words that pass C2-H-161, then the
 * words of the profile that are not among them. No word, no attribute. Returns the node without its `rel` key.
 */
function withRel<N extends Node>(r: Render, node: N, structural: Pair[]): N {
  const authored = authoredKey(node, 'rel')
  if (authored === undefined && r.linkRel === '') return node
  const words = authored === undefined ? [] : keyValue('rel', authored).split(' ').filter((word) => word !== '')
  for (const word of r.linkRel.split(' ')) if (word !== '' && !words.includes(word)) words.push(word)
  if (words.length > 0) structural.push(['rel', words.join(' ')])
  return authored === undefined ? node : withoutKeys(node, ['rel'])
}

function link(node: LinkNode, r: Render): string {
  // C2-H-081: a link inside link text writes its content and no element.
  if (r.linkDepth > 0) return children(r, node)
  const key = node.key
  const href = node.href
  if (key !== undefined && href === undefined) return `[${children(r, node)}]${unresolvedLabel(node, key)}`
  const definition = key === undefined ? undefined : r.resolution.definitions.get(key)
  const title = node.tooltip ?? definition?.title
  const structural: Pair[] = [['href', destination(r, href ?? '', node)]]
  if (title !== undefined) structural.push(['title', title])
  const merged = withRel(r, withDefinition(node, definition), structural)
  structural.push(...referenceCarriers(r, node, key))
  r.linkDepth++
  const html = children(r, node)
  r.linkDepth--
  return `<a${attributes(r, merged, { structural, origin: node })}>${html}</a>`
}

function image(node: ImageNode, r: Render): string {
  const key = node.key
  const src = node.src
  const alt = node.alt ?? ''
  if (key !== undefined && src === undefined) return `![${escapeText(alt)}]${unresolvedLabel(node, key)}`
  const definition = key === undefined ? undefined : r.resolution.definitions.get(key)
  const title = node.tooltip ?? definition?.title
  const structural: Pair[] = [['src', destination(r, src ?? '', node)], ['alt', alt]]
  if (title !== undefined) structural.push(['title', title])
  structural.push(...referenceCarriers(r, node, key))
  return `<img${attributes(r, withDefinition(node, definition), { structural, origin: node })}>`
}

function autolink(node: AutolinkNode, r: Render): string {
  const text = escapeText(node.text ?? node.href)
  if (r.linkDepth > 0) return text
  const structural: Pair[] = [['href', destination(r, node.href, node)]]
  const written = withRel(r, node, structural)
  if (r.settings.roundtrip) structural.push(['data-carve-autolink', null])
  return `<a${attributes(r, written, { structural })}>${text}</a>`
}

function xref(node: XrefNode, r: Render): string {
  const href = node.href
  // C2-H-086: unresolved, the characters as typed.
  if (href === undefined) return escapeText(`</#${node.key}>`)
  // C2-H-097: the generated text is plain text.
  const text = escapeText(r.resolution.xrefText.get(node) ?? '')
  if (r.linkDepth > 0) return text
  const structural: Pair[] = [['href', href]]
  if (r.settings.roundtrip) structural.push(['data-carve-xref', null])
  return `<a${attributes(r, node, { structural })}>${text}</a>`
}

/** C2-H-088: the anchor of a footnote reference or of an inline footnote. */
function noteReference(node: FootnoteRefNode | InlineFootnoteNode, r: Render): string {
  const key = node.type === 'footnote_ref' ? node.key : undefined
  const note = r.resolution.noteOf.get(node)
  if (note === undefined) return escapeText(`[^${key ?? ''}]`)
  const structural: Pair[] = [['href', `#fn${note.number}`], ['role', 'doc-noteref']]
  if (r.settings.roundtrip && key !== undefined) structural.push(['data-carve-footnote-label', key])
  const tag = attributes(r, node, { structural, id: r.resolution.refIds.get(node)!, idFirst: true })
  return `<a${tag}><sup>${note.number}</sup></a>`
}

function math(node: MathNode, r: Render): string {
  // C2-H-122: static output has no client renderer, so an equation is its source as code.
  if (r.settings.mode === 'static') return `<code${attributes(r, node, { base: ['language-math'] })}>${escapeText(node.value)}</code>`
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
    loss(r, node, 'raw-format-dropped', `raw content in the format ${node.format} is not written to HTML`)
    return ''
  }
  if (r.settings.rawHtml) return r.settings.roundtrip ? `<span data-carve-raw="html">${node.value}</span>` : node.value
  // C2-H-172: the text of a roundtrip carrier keeps its bidirectional controls.
  if (r.settings.roundtrip) return `<span data-carve-raw="html">${escapeCarrierText(node.value)}</span>`
  return escapeText(node.value)
}

function templateUrl(template: string | undefined, name: string): string | null {
  return template === undefined ? null : template.replaceAll('{name}', encodeURIComponent(name))
}

/** C2-H-126: the URL that `social` gives for a mention or a tag, or null. */
function socialUrl(r: Render, type: 'mention' | 'tag', name: string): string | null {
  const settings = r.settings.social
  if (settings === null) return null
  const resolver = type === 'mention' ? settings.resolveMention : settings.resolveTag
  const url = resolver?.(name) ?? templateUrl(type === 'mention' ? settings.mentionUrl : settings.tagUrl, name)
  return url === undefined || url === '' ? null : url
}

/** C2-H-100: a mention or a tag is an inert span, or a link when `social` gives a URL for it. */
function social(node: MentionNode | TagNode, r: Render): string {
  const mention = node.type === 'mention'
  const name = mention ? node.target : node.name
  const label = mention ? node.label : undefined
  const text = `<strong>${escapeText(label ?? `${mention ? '@' : '#'}${name}`)}</strong>`
  const url = r.linkDepth > 0 ? null : socialUrl(r, node.type, name)
  const parts: TagParts = { base: [node.type], classFirst: true }
  if (url === null) return `<span${attributes(r, node, parts)}>${text}</span>`
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
  const expansion = node.expansion
  if (r.abbrDepth > 0 || expansion === undefined) return term
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
    html += `${inlineHtml(r, pair.base)}<rp>(</rp><rt>${inlineHtml(r, pair.annotation)}</rt><rp>)</rp>`
  }
  return `<ruby${attributes(r, node, {})}>${html}</ruby>`
}

/**
 * C2-H-076: an inline extension written in source has no renderer and is a span. C2-A-123,
 * C2-A-127: a name with a dot names a registered extension, which this engine does not know, so
 * it renders through its fallback and is reported.
 */
function inlineExtension(node: InlineExtensionNode, r: Render): string {
  const name = node.name
  if (!name.includes('.')) return `<span${attributes(r, node, { base: [`ext-${name}`] })}>${children(r, node)}</span>`
  loss(r, node, 'extension-fallback-rendered', `the extension ${name} is rendered through its fallback`)
  return inlineHtml(r, node.fallback ?? node.children)
}

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
  critic_comment: (node, r) => `<span${attributes(r, node, { base: ['critic-comment'] })}>${escapeText(node.value)}</span>`,
  mention: social,
  tag: social,
  symbol,
  non_breaking_space: () => '&nbsp;',
  // C2-H-045.
  hard_break: () => '<br>\n',
  soft_break: () => '\n',
  // C2-H-078.
  smart_punctuation: (node, r) => escapeText((r.settings.smartTypography ? node.glyph : undefined) ?? node.source),
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
  insert: element('ins'),
  delete: element('del'),
}
