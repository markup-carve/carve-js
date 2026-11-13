// The inline elements of C2-H-072 to C2-H-101.
import { type AstNode } from './ast.ts'
import {
  attributeBlockText, attributes, destination, escapeText, loss, type Pair, type Render, type TagParts,
} from './html-attributes.ts'

type InlineWriter = (r: Render, node: AstNode) => string

const ELEMENTS = new Map([
  ['emphasis', 'em'], ['strong', 'strong'], ['underline', 'u'], ['strike', 's'], ['highlight', 'mark'],
  ['superscript', 'sup'], ['subscript', 'sub'], ['insert', 'ins'], ['delete', 'del'],
])
// C2-H-075: the keys that name an element, from inside out, and the attribute the value of each becomes.
const SEMANTIC_KEYS: readonly (readonly [string, string | null])[] = [['abbr', 'title'], ['time', 'datetime'], ['kbd', null]]

function isBreak(node: AstNode): boolean {
  return node.type === 'soft_break' || node.type === 'hard_break'
}

function isLineComment(node: AstNode | undefined): boolean {
  return node?.type === 'comment' && node.form === 'line'
}

/**
 * C2-B-137: a comment-only line is skipped, so one line break around it is not written: the one
 * behind it, or the one before it when the content ends with the comment.
 */
function isSkippedBreak(nodes: AstNode[], at: number): boolean {
  const before = nodes[at - 2]
  if (isLineComment(nodes[at - 1]) && (before === undefined || isBreak(before))) return true
  const after = nodes[at + 2]
  return isLineComment(nodes[at + 1]) && (after === undefined || !isBreak(after))
}

export function inlineHtml(r: Render, nodes: AstNode[]): string {
  let out = ''
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    if (isBreak(node) && isSkippedBreak(nodes, at)) continue
    out += WRITERS.get(node.type)?.(r, node) ?? ''
  }
  return out
}

function children(r: Render, node: AstNode): string {
  return inlineHtml(r, node.children ?? [])
}

function element(name: string, parts: TagParts = {}): InlineWriter {
  return (r, node) => `<${name}${attributes(r, node, parts)}>${children(r, node)}</${name}>`
}

function authoredKey(node: AstNode, name: string): string | undefined {
  return node.attrs?.keyValues?.find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A copy of `node` without the keys `names`, which an element takes as its name. */
function withoutKeys(node: AstNode, names: string[]): AstNode {
  const keyValues = (node.attrs?.keyValues ?? []).filter(([key]) => !names.includes(key.toLowerCase()))
  return { ...node, attrs: { ...node.attrs, keyValues } }
}

/** C2-H-075: a span with the key `abbr`, `time` or `kbd` is that element; several nest, and the rest goes on the outermost. */
function span(r: Render, node: AstNode): string {
  const found = SEMANTIC_KEYS.filter(([key]) => authoredKey(node, key) !== undefined)
  if (found.length === 0) return element('span')(r, node)
  const abbr = found[0]![0] === 'abbr'
  if (abbr) r.abbrDepth++
  let html = children(r, node)
  if (abbr) r.abbrDepth--
  const rest = withoutKeys(node, found.map(([key]) => key))
  found.forEach(([key, target], index) => {
    const outermost = index === found.length - 1
    const value = authoredKey(node, key)!
    // An authored `title` or `datetime` wins over the derived one.
    const derived: Pair[] = target === null || (outermost && authoredKey(node, target) !== undefined) ? [] : [[target, value]]
    html = `<${key}${attributes(r, outermost ? rest : null, { structural: derived })}>${html}</${key}>`
  })
  return html
}

/** C2-H-141: the attributes of a link definition merge into a reference that resolves through it; the reference wins. */
function withDefinition(node: AstNode, definition: AstNode | undefined): AstNode {
  if (definition?.attrs === undefined && definition?.lang === undefined) return node
  const own = node.attrs ?? {}
  const from = definition.attrs ?? {}
  const keys = (from.keyValues ?? []).filter(([key]) => !(own.keyValues ?? []).some(([name]) => name.toLowerCase() === key.toLowerCase()))
  const merged: AstNode = {
    ...node,
    attrs: { classes: [...(from.classes ?? []), ...(own.classes ?? [])], keyValues: [...keys, ...(own.keyValues ?? [])] },
  }
  const id = own.id ?? from.id
  if (id !== undefined) merged.attrs!.id = id
  const lang = node.lang ?? definition.lang
  if (lang !== undefined) merged.lang = lang
  return merged
}

/** C2-H-085: the label part of an unresolved reference, written from the key. */
function labelText(node: AstNode): string {
  return escapeText(`${node.form === 'collapsed' ? '[]' : `[${node.key ?? ''}]`}${attributeBlockText(node)}`)
}

function referenceCarriers(r: Render, node: AstNode): Pair[] {
  if (!r.settings.roundtrip || node.key === undefined) return []
  const carriers: Pair[] = [['data-carve-ref', node.key]]
  if (node.form === 'collapsed') carriers.push(['data-carve-ref-collapsed', null])
  return carriers
}

function link(r: Render, node: AstNode): string {
  // C2-H-081: a link inside link text writes its content and no element.
  if (r.linkDepth > 0) return children(r, node)
  if (node.key !== undefined && node.href === undefined) return `[${children(r, node)}]${labelText(node)}`
  const definition = node.key === undefined ? undefined : r.resolution.definitions.get(node.key)
  const title = node.tooltip ?? definition?.title
  const structural: Pair[] = [['href', destination(r, node.href ?? '')]]
  if (typeof title === 'string') structural.push(['title', title])
  structural.push(...referenceCarriers(r, node))
  r.linkDepth++
  const html = children(r, node)
  r.linkDepth--
  return `<a${attributes(r, withDefinition(node, definition), { structural })}>${html}</a>`
}

function image(r: Render, node: AstNode): string {
  if (node.key !== undefined && node.src === undefined) return `![${escapeText(node.alt ?? '')}]${labelText(node)}`
  const definition = node.key === undefined ? undefined : r.resolution.definitions.get(node.key)
  const title = node.tooltip ?? definition?.title
  const structural: Pair[] = [['src', destination(r, node.src ?? '')], ['alt', node.alt ?? '']]
  if (typeof title === 'string') structural.push(['title', title])
  structural.push(...referenceCarriers(r, node))
  return `<img${attributes(r, withDefinition(node, definition), { structural })}>`
}

function autolink(r: Render, node: AstNode): string {
  const text = escapeText(node.text ?? node.href ?? '')
  if (r.linkDepth > 0) return text
  const structural: Pair[] = [['href', destination(r, node.href ?? '')]]
  if (r.settings.roundtrip) structural.push(['data-carve-autolink', null])
  return `<a${attributes(r, node, { structural })}>${text}</a>`
}

function xref(r: Render, node: AstNode): string {
  // C2-H-086: unresolved, the characters as typed.
  if (node.href === undefined) return escapeText(`</#${node.key ?? ''}>`)
  // C2-H-097: the generated text is plain text.
  const text = escapeText(r.resolution.xrefText.get(node) ?? '')
  if (r.linkDepth > 0) return text
  const structural: Pair[] = [['href', node.href]]
  if (r.settings.roundtrip) structural.push(['data-carve-xref', null])
  return `<a${attributes(r, node, { structural })}>${text}</a>`
}

/** C2-H-088: the anchor of a footnote reference or of an inline footnote. */
function noteReference(r: Render, node: AstNode): string {
  const note = r.resolution.noteOf.get(node)
  if (note === undefined) return escapeText(`[^${node.key ?? ''}]`)
  const structural: Pair[] = [['href', `#fn${note.number}`], ['role', 'doc-noteref']]
  if (r.settings.roundtrip && node.key !== undefined) structural.push(['data-carve-footnote-label', node.key])
  const tag = attributes(r, node, { structural, id: r.resolution.refIds.get(node)!, idFirst: true })
  return `<a${tag}><sup>${note.number}</sup></a>`
}

function math(r: Render, node: AstNode): string {
  const display = node.display === true
  const tag = attributes(r, node, { base: ['math', display ? 'display' : 'inline'], generated: [['role', 'math']] })
  const value = escapeText(node.value ?? '')
  return `<span${tag}>${display ? `\\[${value}\\]` : `\\(${value}\\)`}</span>`
}

/** C2-H-051, C2-H-053, C2-H-054: raw HTML is escaped unless `rawHtml` is on, and any other format is dropped. */
function rawInline(r: Render, node: AstNode): string {
  if (node.format !== 'html') {
    loss(r, 'raw-format-dropped', `raw content in the format ${node.format ?? ''} is not written to HTML`)
    return ''
  }
  const html = r.settings.rawHtml ? node.value ?? '' : escapeText(node.value ?? '')
  return r.settings.roundtrip ? `<span data-carve-raw="html">${html}</span>` : html
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
function social(sigil: string, type: 'mention' | 'tag'): InlineWriter {
  return (r, node) => {
    const name = (type === 'mention' ? node.target : node.name) ?? ''
    const text = `<strong>${escapeText(node.label ?? `${sigil}${name}`)}</strong>`
    const url = r.linkDepth > 0 ? null : socialUrl(r, type, name)
    const parts: TagParts = { base: [type], classFirst: true }
    if (url === null) return `<span${attributes(r, node, parts)}>${text}</span>`
    return `<a${attributes(r, node, { ...parts, structural: [['href', destination(r, url)]] })}>${text}</a>`
  }
}

/** C2-H-101: the value of the `symbols` table verbatim, or the source; a span when it carries attributes. */
function symbol(r: Render, node: AstNode): string {
  const name = node.name ?? ''
  const value = Object.hasOwn(r.settings.symbols, name) ? r.settings.symbols[name]! : escapeText(`:${name}:`)
  const tag = attributes(r, node, {})
  return tag === '' ? value : `<span${tag}>${value}</span>`
}

/** C2-H-049: a literal-text span is its escaped content, or a span when it carries attributes. */
function literal(r: Render, node: AstNode): string {
  const tag = attributes(r, node, {})
  const value = escapeText(node.value ?? '')
  return tag === '' ? value : `<span${tag}>${value}</span>`
}

/** C2-H-098, C2-H-099. */
function abbreviation(r: Render, node: AstNode): string {
  const term = escapeText(node.key ?? '')
  if (r.abbrDepth > 0 || node.expansion === undefined) return term
  return `<abbr${attributes(r, node, { structural: [['title', node.expansion]] })}>${term}</abbr>`
}

/** C2-H-066, C2-H-067: the number of the caption, or the mark itself where the caption takes none. */
function captionNumber(r: Render, node: AstNode): string {
  if (node.n === undefined) return '#'
  return r.settings.roundtrip ? `<span data-carve-caption-number>${node.n}</span>` : String(node.n)
}

/** C2-H-142. */
function ruby(r: Render, node: AstNode): string {
  let html = ''
  for (const pair of node.pairs ?? []) {
    html += `${inlineHtml(r, pair.base)}<rp>(</rp><rt>${inlineHtml(r, pair.annotation)}</rt><rp>)</rp>`
  }
  return `<ruby${attributes(r, node, {})}>${html}</ruby>`
}

/**
 * C2-H-076: an inline extension written in source has no renderer and is a span. C2-A-123,
 * C2-A-127: a name with a dot names a registered extension, which this engine does not know, so
 * it renders through its fallback and is reported.
 */
function inlineExtension(r: Render, node: AstNode): string {
  const name = node.name ?? ''
  if (!name.includes('.')) return element('span', { base: [`ext-${name}`] })(r, node)
  loss(r, 'extension-fallback-rendered', `the extension ${name} is rendered through its fallback`)
  return inlineHtml(r, node.fallback ?? node.children ?? [])
}

const WRITERS = new Map<string, InlineWriter>([
  ['text', (_r, node) => escapeText(node.value ?? '')],
  ['span', span],
  ['link', link],
  ['image', image],
  ['autolink', autolink],
  ['xref', xref],
  ['footnote_ref', noteReference],
  ['inline_footnote', noteReference],
  ['code', (r, node) => `<code${attributes(r, node, {})}>${escapeText(node.value ?? '')}</code>`],
  ['literal_inline', literal],
  ['math', math],
  ['raw_inline', rawInline],
  ['critic_comment', (r, node) => `<span${attributes(r, node, { base: ['critic-comment'] })}>${escapeText(node.value ?? '')}</span>`],
  ['mention', social('@', 'mention')],
  ['tag', social('#', 'tag')],
  ['symbol', symbol],
  ['non_breaking_space', () => '&nbsp;'],
  // C2-H-045.
  ['hard_break', () => '<br>\n'],
  ['soft_break', () => '\n'],
  // C2-H-078.
  ['smart_punctuation', (r, node) => escapeText((r.settings.smartTypography ? node.glyph : undefined) ?? node.source ?? '')],
  ['abbreviation', abbreviation],
  ['caption_number', captionNumber],
  ['inline_extension', inlineExtension],
  ['small_caps', element('span', { base: ['smallcaps'] })],
  ['ruby', ruby],
  // C2-A-119: with no extension for citations the bracket text is written as text.
  ['citation_group', (_r, node) => escapeText(node.raw ?? '')],
])
for (const [type, name] of ELEMENTS) WRITERS.set(type, element(name))
