// The Markdown export: CommonMark with the GFM tables, task lists, strikethrough and footnotes. What Markdown cannot
// spell falls back to inline HTML (escaped where it is author content) or flattens, and the flattening is reported.
import { trimSpaceTabEnd } from '../source.ts'
import {
  type Attrs, type Block, type CaptionNode, type CodeBlockNode, type DocumentNode, type HeadingNode, type ImageNode, type Inline,
  type LinkNode, type ListNode, type Node, type NodeHandlers, type TableCellNode, type TableNode, type TableRowNode,
} from '../ast.ts'
import { slugify } from '../slug.ts'
import {
  allowedDestination, dispatch, drawDerived, eachNode, type Exporter, footnoteDefinitions, insideLink, isSkippedBreak, isUnresolved,
  loss, nested, noteNumber, plainInlineText, rawDropped, referenceLabel, smartText, stripBidi, unexpandedInclude, xrefText,
} from './common.ts'

interface MarkdownState {
  x: Exporter
  /** Heading slugs by the id the document gave each heading: GFM has no id syntax, so a link uses the GFM slug. */
  slugs: Map<string, string>
  footnotes: Set<string>
  referenced: Set<string>
  abbrDepth: number
  /** Above 0 while the children of an inline node are written. */
  inlineLevel: number
  /** The delimiter runs open around the inline being written. */
  open: string[]
  /** Inside a table cell or a heading, which hold one line: a hard break is `<br>` and a soft break a space. */
  singleLine: number
}

/** Drops what the target cannot carry: CR, DEL and the C1 range. The other C0 controls are content. */
function clean(text: string): string {
  return text.replace(/[\r\u007f-\u009f]/gu, '')
}

function escapeHtml(text: string): string {
  return clean(text).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/gu, '&quot;')
}

const WORD = /[\p{L}\p{N}]/u

/**
 * Backslash-escapes the characters that would read as Markdown inside a line. An underscore between two letters or
 * digits cannot open or close emphasis, so it stays as written; a `<` is escaped only where it could open HTML. An
 * escaped `]` already keeps a bracket from forming a link, so `[` is escaped only inside a link label, where an
 * unbalanced one would take the label's closing bracket.
 */
function escapeText(text: string, label = false): string {
  let out = ''
  const value = clean(text)
  for (let at = 0; at < value.length; at++) out += escapedCharacter(value, at, label)
  return out
}

const REFERENCE_OPENER = /^&(?:#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]*;)/u

function escapedCharacter(value: string, at: number, label: boolean): string {
  const ch = value[at]!
  if (ch === '_') return WORD.test(value[at - 1] ?? '') && WORD.test(value[at + 1] ?? '') ? ch : '\\_'
  if ('\\`*~]'.includes(ch) || (ch === '[' && label)) return `\\${ch}`
  if (ch === '<') return /[A-Za-z/!?]/u.test(value[at + 1] ?? '') ? '\\<' : ch
  if (ch === '&') return REFERENCE_OPENER.test(value.slice(at, at + 40)) ? '\\&' : ch
  return ch
}

function escapeTitle(title: string): string {
  return clean(title).replace(/[\\"]/gu, '\\$&')
}

/**
 * A link or image destination: spaces, angle brackets and pipes percent-encoded, parentheses escaped, and every
 * ampersand that opens a character reference escaped, since a reader decodes those before it reads the scheme.
 */
function destinationText(url: string): string {
  const value = clean(url)
  const pipes = value.includes('|')
  return value.replace(/[ ()<>\\|\n]/gu, (ch) => {
    switch (ch) {
      case '\\': return pipes ? '%5C' : ch
      case '|': return '%7C'
      case ' ': return '%20'
      case '\n': return '%0A'
      case '<': return '%3C'
      case '>': return '%3E'
      default: return `\\${ch}`
    }
  }).replace(/&(?=#[0-9]{1,8};|#[xX][0-9a-fA-F]{1,8};|[a-zA-Z][a-zA-Z0-9]{0,31};)/gu, '&amp;')
}

/** The HTML attributes of `attrs`, for an element this target writes as inline HTML. */
function htmlAttributes(attrs: Attrs | undefined, base: readonly string[] = []): string {
  let out = ''
  if (attrs?.id !== undefined) out += ` id="${escapeAttribute(attrs.id)}"`
  const classes = [...base, ...(attrs?.classes ?? []).filter((name) => !base.includes(name))]
  if (classes.length > 0) out += ` class="${escapeAttribute(classes.join(' '))}"`
  for (const [key, value] of attrs?.keyValues ?? []) {
    if (/^[A-Za-z_:][A-Za-z0-9_.:-]*$/u.test(key) && !/^on/iu.test(key)) out += ` ${key}="${escapeAttribute(value)}"`
  }
  return out
}

function hasAttributes(attrs: Attrs | undefined): boolean {
  return attrs !== undefined && (attrs.id !== undefined || (attrs.classes?.length ?? 0) > 0 || (attrs.keyValues?.length ?? 0) > 0)
}

const EDGE_SPACE = /^([\p{White_Space}]*)([\s\S]*?)([\p{White_Space}]*)$/u

/**
 * A delimiter run followed by whitespace does not open emphasis (CommonMark 6.2), so the spaces at the edges of the
 * content move outside the delimiters. Content of spaces only has no delimiter form and takes the HTML element.
 */
function delimited(inner: string, delimiter: string, tag: string): string {
  const [, lead = '', core = '', trail = ''] = EDGE_SPACE.exec(inner) ?? []
  if (core === '') return inner === '' ? '' : `<${tag}>${inner}</${tag}>`
  // A final hard break after a closing delimiter would end the paragraph and read as a backslash.
  if (core.endsWith('\\') && trail.startsWith('\n')) return `${lead}<${tag}>${core}</${tag}>${trail}`
  return `${lead}${delimiter}${core}${delimiter}${trail}`
}

function inlines(m: MarkdownState, list: readonly Inline[]): string {
  return nested(m.x, () => {
    const inside = m.inlineLevel > 0
    let out = ''
    m.inlineLevel++
    try {
      for (let at = 0; at < list.length; at++) {
        const node = list[at]!
        if ((node.type === 'soft_break' || node.type === 'hard_break') && isSkippedBreak(list, at, inside)) continue
        const written = inline(m, node)
        out += flankingSafe(node, written, out.at(-1) ?? '', () => firstCharacter(m, list, at + 1))
      }
    } finally {
      m.inlineLevel--
    }
    return out
  })
}

/** The first character the inlines from `from` on would write, without reporting anything twice. */
function firstCharacter(m: MarkdownState, list: readonly Inline[], from: number): string {
  for (let at = from; at < list.length; at++) {
    const node = list[at]!
    if (node.type === 'comment' || (node.type === 'text' && node.value === '')) continue
    return leadingCharacter(m, node)
  }
  return ''
}

function leadingCharacter(m: MarkdownState, node: Inline): string {
  if (node.type === 'text') return node.value[0]!
  if (node.type === 'soft_break' || node.type === 'hard_break') return '\n'
  if (node.type === 'code') return '`'
  if (node.type === 'smart_punctuation') return smartText(m.x, node)[0] ?? ''
  if (node.type === 'link' || node.type === 'image' || node.type === 'autolink') return '['
  // Every other inline starts with markup or a letter of its own; a letter stands for both.
  return 'a'
}

function singleLine<T>(m: MarkdownState, run: () => T): T {
  m.singleLine++
  try {
    return run()
  } finally {
    m.singleLine--
  }
}

function element(m: MarkdownState, tag: string, node: Node & { children: Inline[] }, base: readonly string[] = []): string {
  return `<${tag}${htmlAttributes(node.attrs, base)}>${inlines(m, node.children)}</${tag}>`
}

/** A delimiter run inside a run of the same delimiter would close the outer one, so it takes the HTML element. */
function delimitedNode(m: MarkdownState, node: Node & { children: Inline[] }, delimiter: string, tag: string): string {
  if (hasAttributes(node.attrs) || m.open.includes(delimiter)) return element(m, tag, node)
  m.open.push(delimiter)
  try {
    return delimited(inlines(m, node.children), delimiter, tag)
  } finally {
    m.open.pop()
  }
}

const SPACE = /[\p{White_Space}]/u
const PUNCTUATION = /[\p{P}\p{S}]/u

/** CommonMark 6.2: whether a run between `before` and `after` (empty at a line edge) can open or close. */
function flanks(before: string, after: string, opening: boolean): boolean {
  const inside = opening ? after : before
  const outside = opening ? before : after
  if (inside === '' || SPACE.test(inside)) return false
  return !PUNCTUATION.test(inside) || outside === '' || SPACE.test(outside) || PUNCTUATION.test(outside)
}

/**
 * A delimiter run written next to a letter on one side and punctuation inside does not flank (CommonMark 6.2), so
 * such an emphasis is written with its HTML element instead.
 */
function flankingSafe(node: Inline, written: string, before: string, next: () => string): string {
  if (node.type !== 'emphasis' && node.type !== 'strong' && node.type !== 'strike') return written
  const delimiter = node.type === 'emphasis' ? '*' : node.type === 'strong' ? '**' : '~~'
  if (!written.startsWith(delimiter) || !written.endsWith(delimiter) || written.length <= delimiter.length * 2) return written
  const core = written.slice(delimiter.length, -delimiter.length)
  const after = next()
  if (flanks(before, core.at(0) ?? '', true) && flanks(core.at(-1) ?? '', after, false)) return written
  const tag = node.type === 'emphasis' ? 'em' : node.type === 'strong' ? 'strong' : 'del'
  return `<${tag}>${core}</${tag}>`
}

/** A code span whose fence is longer than any backtick run inside; a tab or a line break needs the HTML element. */
function codeSpan(value: string): string {
  const content = clean(value)
  if (content === '') return '<code></code>'
  // Markdown reads the text between two HTML tags, so every ASCII punctuation character is a reference there; an
  // empty comment around a line break keeps the line from opening a block, and after `@` from forming an autolink.
  if (/[\n\t]/u.test(content)) {
    return `<code>${content.replace(/[\n\t\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/gu, (ch) =>
      ch === '\n' ? '<!---->&#10;<!---->' : `&#${ch.charCodeAt(0)};${ch === '@' ? '<!---->' : ''}`)}</code>`
  }
  let longest = 0
  for (const match of content.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(longest + 1)
  const spaced = content.startsWith(' ') && content.endsWith(' ') && /[^ ]/u.test(content)
  const pad = content.startsWith('`') || content.endsWith('`') || spaced
  return pad ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`
}

function linkDestination(m: MarkdownState, href: string, node: Node): string {
  const allowed = allowedDestination(m.x, stripBidi(clean(href)), node)
  if (allowed.startsWith('#')) {
    const slug = m.slugs.get(safeDecode(allowed.slice(1)))
    if (slug !== undefined) return `#${slug}`
  }
  return destinationText(allowed)
}

function safeDecode(fragment: string): string {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

function link(m: MarkdownState, node: LinkNode): string {
  const key = node.key
  if (key !== undefined && isUnresolved(node)) return `[${inlines(m, node.children)}\\]${escapeText(referenceLabel(node, key))}`
  if (m.x.linkDepth > 0) return inlines(m, node.children)
  const destination = linkDestination(m, node.href ?? '', node)
  const text = insideLink(m.x, () => inlines(m, node.children))
  const title = node.tooltip ?? m.x.resolution.definitions.get(key ?? '')?.tooltip
  return title === undefined ? `[${text}](${destination})` : `[${text}](${destination} "${escapeTitle(title)}")`
}

function image(m: MarkdownState, node: ImageNode): string {
  const key = node.key
  const alt = escapeText(node.alt ?? '', true)
  if (key !== undefined && isUnresolved(node)) return `![${alt}\\]${escapeText(referenceLabel(node, key))}`
  const src = destinationText(allowedDestination(m.x, stripBidi(clean(node.src ?? '')), node))
  const title = node.tooltip ?? m.x.resolution.definitions.get(key ?? '')?.tooltip
  return title === undefined ? `![${alt}](${src})` : `![${alt}](${src} "${escapeTitle(title)}")`
}

function autolink(m: MarkdownState, node: Node & { type: 'autolink', href: string, text?: string }): string {
  const label = clean(node.text ?? node.href)
  if (m.x.linkDepth > 0) return escapeText(label)
  const href = allowedDestination(m.x, stripBidi(clean(node.href)), node)
  if (href === label && /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s\\]+$/u.test(label)) return `<${label}>`
  if (href === `mailto:${label}` && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(label)) return `<${label}>`
  return `[${escapeText(label)}](${destinationText(href)})`
}

function inline(m: MarkdownState, node: Inline): string {
  return dispatch(INLINES, node, m) ?? ''
}

const INLINES: NodeHandlers<string, MarkdownState> = {
  text: (node, m) => escapeText(node.value, m.x.linkDepth > 0),
  emphasis: (node, m) => delimitedNode(m, node, '*', 'em'),
  strong: (node, m) => delimitedNode(m, node, '**', 'strong'),
  strike: (node, m) => delimitedNode(m, node, '~~', 'del'),
  underline: (node, m) => element(m, 'u', node),
  subscript: (node, m) => element(m, 'sub', node),
  superscript: (node, m) => element(m, 'sup', node),
  highlight: (node, m) => element(m, 'mark', node),
  insert: (node, m) => element(m, 'ins', node),
  delete: (node, m) => element(m, 'del', node, ['critic-delete']),
  small_caps: (node, m) => element(m, 'span', node, ['smallcaps']),
  span: (node, m) => {
    const abbr = node.attrs?.keyValues?.find(([key]) => key === 'abbr')?.[1]
    if (abbr === undefined) return inlines(m, node.children)
    m.abbrDepth++
    let inner: string
    try {
      inner = inlines(m, node.children)
    } finally {
      m.abbrDepth--
    }
    if (abbr === '' || !drawDerived(m.x, node, abbr)) return inner
    return `<abbr title="${escapeAttribute(abbr)}">${inner}</abbr>`
  },
  code: (node, _m) => codeSpan(node.value),
  literal_inline: (node, _m) => escapeText(node.value),
  math: (node, _m) => {
    const value = escapeHtml(node.value)
    const number = node.display && node.number !== undefined ? ` ${escapeText(node.numberPrefix ?? '')} ${node.number}` : ''
    return `${node.display ? `$$${value}$$` : `$${value}$`}${number}`
  },
  link: (node, m) => link(m, node),
  image: (node, m) => image(m, node),
  autolink: (node, m) => autolink(m, node),
  xref: (node, m) => {
    const { text, resolved } = xrefText(m.x, node)
    if (!resolved) return `</#${escapeHtml(node.key)}>`
    const slug = m.slugs.get(safeDecode((node.href ?? '').slice(1)))
    if (m.x.linkDepth > 0 || slug === undefined) return escapeText(text)
    return `[${escapeText(text)}](#${slug})`
  },
  footnote_ref: (node, m) => {
    const key = escapeHtml(node.key)
    if (noteNumber(m.x, node) === undefined && !m.footnotes.has(node.key)) return `\\[^${key.replaceAll('\\', '\\\\')}\\]`
    return `[^${key}]`
  },
  inline_footnote: (node, m) => {
    const depth = m.x.linkDepth
    m.x.linkDepth = 0
    try {
      return `^[${inlines(m, node.children)}]`
    } finally {
      m.x.linkDepth = depth
    }
  },
  abbreviation: (node, m) => {
    const term = escapeHtml(node.key)
    const expansion = node.expansion
    if (m.abbrDepth > 0 || expansion === undefined || !drawDerived(m.x, node, expansion)) return term
    return `<abbr title="${escapeAttribute(expansion)}">${term}</abbr>`
  },
  ruby: (node, m) => {
    return `<ruby${htmlAttributes(node.attrs)}>${node.pairs.map((pair) =>
      `${inlines(m, pair.base)}<rp>(</rp><rt>${inlines(m, pair.annotation)}</rt><rp>)</rp>`).join('')}</ruby>`
  },
  raw_inline: (node, m) => {
    if (node.format !== 'html') {
      rawDropped(m.x, node, false)
      return ''
    }
    loss(m.x, node, 'raw-html-escaped', 'Escaped raw HTML in Markdown')
    return escapeHtml(node.value)
  },
  symbol: (node, _m) => `:${clean(node.name)}:`,
  mention: (node, _m) => escapeText(node.label ?? `@${node.target}`),
  tag: (node, _m) => escapeText(`#${node.name}`),
  inline_extension: (node, m) => inlines(m, node.name.includes('.') && node.fallback !== undefined ? node.fallback : node.children),
  critic_comment: (node, _m) => `<span class="critic-comment">${escapeText(node.value)}</span>`,
  caption_number: (node, _m) => node.n === undefined ? '\\#' : String(node.n),
  citation_group: (node, _m) => escapeText(node.raw),
  smart_punctuation: (node, m) => escapeText(smartText(m.x, node)),
  non_breaking_space: (_node, _m) => ' ',
  soft_break: (_node, m) => m.singleLine > 0 ? ' ' : '\n',
  hard_break: (_node, m) => m.singleLine > 0 ? '<br>' : '\\\n',
  comment: (_node, _m) => '',
}

/**
 * Keeps a paragraph line from reading as a block of its own: a list marker, a quote, a heading, a thematic break, a
 * setext underline, or code by its indentation. Spaces and tabs at the edges of a line are layout and go.
 */
function protectLine(line: string, first: boolean): string {
  let text = line.replace(/^[ \t]+/u, '')
  text = trimSpaceTabEnd(text)
  // A hard break keeps its backslash as the last character of the line, with no space before it.
  let backslashes = 0
  while (text[text.length - 1 - backslashes] === '\\') backslashes++
  if (backslashes % 2 === 1) text = `${trimSpaceTabEnd(text.slice(0, -1))}\\`
  if (text === '') return text
  text = text
    .replace(first ? /^([-+])(?=[ \t]|$)/u : /^([-+])(?=[ \t]+\S)/u, '\\$1')
    .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/u, '$1\\$2')
    .replace(/^>/u, '\\>')
    .replace(/^(#{1,6})(?=[ \t]|$)/u, '\\$1')
  if (/^([-_*])(?:[ \t]*\1){2,}[ \t]*$/u.test(text)) text = `\\${text}`
  else if (!first && /^(?:=+|-+)[ \t]*$/u.test(text)) text = `\\${text}`
  return text
}

function paragraphText(text: string): string {
  return text.split('\n').map((line, at) => protectLine(line, at === 0)).filter((line, at, lines) =>
    line !== '' || at === 0 || at === lines.length - 1).join('\n')
}

/**
 * The blocks of a container. Two lists in a row keep apart only where their markers differ, so the second of two
 * lists with the same bullet or delimiter takes the other one.
 */
function blocks(m: MarkdownState, list: readonly Node[]): string {
  return nested(m.x, () => {
    let out = ''
    let previous: string | undefined
    for (const node of list) {
      if (node.type !== 'list') {
        const written = block(m, node)
        if (written !== '') previous = undefined
        out += written
        continue
      }
      const mark = listMark(node)
      const used = previous === mark ? alternateMark(mark) : mark
      out += block(m, node, used)
      previous = used
    }
    return out
  })
}

function listMark(node: ListNode): string {
  if (node.marker.kind === 'ordered') return node.marker.delimiter === ')' ? ')' : '.'
  return node.marker.char === '*' || node.marker.char === '+' ? node.marker.char : '-'
}

function alternateMark(mark: string): string {
  return mark === '.' ? ')' : mark === ')' ? '.' : mark === '-' ? '*' : '-'
}

const ATTRIBUTE_BLOCKS: ReadonlySet<string> = new Set([
  'heading', 'paragraph', 'code_block', 'block_quote', 'list', 'table', 'thematic_break', 'admonition', 'directive', 'line_block',
  'definition_list', 'figure_group',
])

function block(m: MarkdownState, node: Node, mark?: string): string {
  if (ATTRIBUTE_BLOCKS.has(node.type) && hasAttributes(node.attrs)) {
    loss(m.x, node, 'markdown-attributes-dropped', 'Dropped block attributes in Markdown')
  }
  if (node.type === 'list' && mark !== undefined) return list(m, node, mark)
  return dispatch(BLOCKS, node, m) ?? ''
}

const BLOCKS: NodeHandlers<string, MarkdownState> = {
  section: (node, m) => blocks(m, node.children),
  heading: (node, m) => heading(m, node),
  paragraph: (node, m) => captioned(m, node, `${paragraphText(inlines(m, node.children))}\n\n`, node.caption, '\n'),
  code_block: (node, m) => captioned(m, node, codeBlock(m, node), node.caption, '\n'),
  block_quote: (node, m) => captioned(m, node, quote(blocks(m, node.children)), node.caption, '\n\n'),
  list: (node, m) => list(m, node, listMark(node)),
  thematic_break: (_node, _m) => '---\n\n',
  table: (node, m) => table(m, node),
  admonition: (node, m) => `${titleLines(m, node.title, node.groupLabel)}${blocks(m, node.children)}`,
  directive: (node, m) => `${titleLines(m, node.title, node.groupLabel)}${blocks(m, node.children)}`,
  div: (node, m) => {
    loss(m.x, node, 'markdown-container-flattened', 'Flattened a container in Markdown')
    return `${titleLines(m, node.title, node.groupLabel)}${blocks(m, node.children)}`
  },
  line_block: (node, m) => {
    const lines = node.children.filter((line) => line.type === 'line').map((line) =>
      paragraphText(inlines(m, line.children.at(-1)?.type === 'hard_break' ? line.children.slice(0, -1) : line.children)))
    return lines.length === 0 ? '' : `${lines.join('\\\n')}\n\n`
  },
  definition_list: (node, m) => {
    let out = ''
    for (const child of node.children) {
      if (child.type === 'definition_term') out += strongLine(inlines(m, child.children))
      else if (child.type === 'definition_description') out += blocks(m, child.children)
    }
    return out
  },
  figure_group: (node, m) => {
    let out = ''
    for (const child of node.children) out += panel(m, child)
    if (node.caption !== undefined) {
      loss(m.x, node, 'markdown-caption-flattened', 'Flattened a caption in Markdown')
      out += strongLine(captionText(m, node.caption))
    }
    return out
  },
  include: (node, m) => {
    if (node.children === undefined) {
      return captioned(m, node, `${paragraphText(escapeText(unexpandedInclude(m.x, node)))}\n\n`, node.caption, '\n')
    }
    return captioned(m, node, blocks(m, node.children), node.caption, '\n\n')
  },
  block_extension: (node, m) => blocks(m, node.fallback.length > 0 ? node.fallback : node.children),
  raw_block: (node, m) => {
    if (node.format !== 'html') {
      rawDropped(m.x, node, true)
      return ''
    }
    loss(m.x, node, 'raw-html-escaped', 'Escaped raw HTML in Markdown')
    return `${escapeHtml(node.value)}\n\n`
  },
  abbreviation_def: (node, _m) => `*[${escapeHtml(node.key)}]: ${escapeHtml(node.expansion)}\n\n`,
  link_reference_definition: (node, m) => {
    if (m.referenced.has(node.key)) return ''
    const allowed = allowedDestination(m.x, stripBidi(clean(node.href)), node)
    const href = allowed === '' ? '<>' : destinationText(allowed)
    const title = node.tooltip === undefined ? '' : ` "${escapeTitle(node.tooltip)}"`
    return `[${node.key.replace(/[[\]\\]/gu, '\\$&')}]: ${href}${title}\n\n`
  },
}

/** `text` on a line of its own in bold, or nothing where it is empty. */
function strongLine(text: string): string {
  const run = delimited(text.replace(/\n/gu, ' '), '**', 'strong').trim()
  return run === '' ? '' : `${run}\n\n`
}

function titleLines(m: MarkdownState, title: readonly Inline[] | undefined, groupLabel: string | undefined): string {
  let out = title === undefined ? '' : strongLine(singleLine(m, () => inlines(m, unwrapStrong(title))))
  if (groupLabel !== undefined && groupLabel !== '') out += strongLine(escapeText(groupLabel))
  return out
}

function captionText(m: MarkdownState, caption: CaptionNode): string {
  return singleLine(m, () => caption.children.map((child) =>
    child.type === 'paragraph' ? inlines(m, child.children) : blocks(m, [child]).trim()).join(' ').trim())
}

/** A host with its caption after it, as a paragraph of its own; Markdown has no caption, so this is reported. */
function captioned(m: MarkdownState, host: Node, written: string, caption: CaptionNode | undefined, separator: string): string {
  if (caption === undefined) return written
  loss(m.x, host, 'markdown-caption-flattened', 'Flattened a caption in Markdown')
  return `${written.trimEnd()}${separator}${captionText(m, caption)}\n\n`
}

/** A panel of a figure group: the host, then its caption emphasized, subordinate to the group's bold one. */
function panel(m: MarkdownState, node: Block): string {
  const caption = node.type === 'paragraph' || node.type === 'code_block' || node.type === 'block_quote' ? node.caption : undefined
  if (caption === undefined) return block(m, node)
  loss(m.x, node, 'markdown-caption-flattened', 'Flattened a caption in Markdown')
  const text = delimited(captionText(m, caption), '*', 'em').trim()
  return `${withoutCaption(node, () => block(m, node))}${text === '' ? '' : `${text}\n\n`}`
}

function heading(m: MarkdownState, node: HeadingNode): string {
  let text = singleLine(m, () => inlines(m, node.children)).replace(/[ \t\n]+/gu, ' ').trim()
  // A closing run of `#` would be read as the optional closing sequence.
  text = text.replace(/(^|[ \t])(#+)$/u, '$1\\$2')
  return `${'#'.repeat(Math.min(node.level, 6))}${text === '' ? '' : ` ${text}`}\n\n`
}

function fence(content: string, marker: string): string {
  let longest = 0
  for (const match of content.matchAll(marker === '`' ? /^ {0,3}(`+)/gmu : /^ {0,3}(~+)/gmu)) longest = Math.max(longest, match[1]!.length)
  return marker.repeat(Math.max(3, longest + 1))
}

/** The info string of a fence: the language, the title in quotes where there is a language, and the group label. */
function fenceInfo(m: MarkdownState, node: CodeBlockNode): string {
  const token = clean(node.syntax ?? '').split(/[ \t\n]/u)[0] ?? ''
  // An attribute line's title wins over the one in the fence header, as in HTML.
  const keyTitle = node.attrs?.keyValues?.find(([key]) => key === 'title')?.[1]
  const title = keyTitle ?? (node.title === undefined ? undefined : plainInlineText(m.x, node.title))
  let info = token
  if (title !== undefined && token !== '') info += ` "${escapeTitle(title)}"`
  else if (title !== undefined) loss(m.x, node, 'fence-title-dropped', 'Dropped a code fence title without a language in Markdown')
  const label = node.groupLabel ?? ''
  return label === '' ? info : `${info} [${clean(label).replace(/[[\]]/gu, '')}]`
}

function codeBlock(m: MarkdownState, node: CodeBlockNode): string {
  const content = clean(node.value)
  const info = fenceInfo(m, node)
  const delimiter = fence(content, info.includes('`') ? '~' : '`')
  const body = content === '' || content.endsWith('\n') ? content : `${content}\n`
  return `${delimiter}${info}\n${body}${delimiter}\n\n`
}

function quote(inner: string): string {
  const lines = inner.replace(/\n+$/u, '').split('\n')
  return `${lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')}\n\n`
}

/** Puts `marker` before the first line and indents the others by `pad`; an empty line takes no indentation. */
function withMarker(marker: string, content: string, pad: number): string {
  const lines = content.replace(/\n+$/u, '').split('\n')
  const indent = ' '.repeat(pad)
  return `${lines.map((line, at) => (at === 0 ? `${marker}${line}`.trimEnd() : line === '' ? '' : `${indent}${line}`)).join('\n')}\n`
}

function list(m: MarkdownState, node: ListNode, mark: string): string {
  const marker = node.marker
  const ordered = marker.kind === 'ordered'
  if (ordered && marker.style !== undefined && marker.style !== '1') {
    loss(m.x, node, 'list-style-dropped', `Dropped the ordered list style "${marker.style}" in Markdown`)
  }
  const tight = node.spacing === 'tight'
  const bullet = mark
  const delimiter = mark
  let counter = marker.start ?? 1
  let out = ''
  for (const [at, item] of node.children.entries()) {
    if (!tight && at > 0) out += '\n'
    let prefix: string
    if (ordered) prefix = `${counter++}${delimiter} `
    else prefix = `${bullet} `
    const pad = prefix.length
    if (!ordered && item.task !== undefined) prefix += item.task.mark === 'x' || item.task.mark === 'X' ? '[x] ' : '[ ] '
    out += withMarker(prefix, itemContent(m, item.children, tight), pad)
  }
  return `${out}\n`
}

const INTERRUPTERS = [/^>/u, /^#{1,6}(?:[ \t]|$)/u, /^(?:`{3,}|~{3,})/u, /^[-*+][ \t]+\S/u, /^1[.)][ \t]+\S/u, /^(?:\*[ \t]*){3,}$/u]
const DELIMITER_ROW = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+$/u
const TABLE_MAY_FOLLOW: ReadonlySet<string> = new Set(['paragraph', 'heading', 'code_block', 'thematic_break'])

function lastLine(text: string): string {
  return text.split('\n').filter((line) => line.trim() !== '').at(-1) ?? ''
}

/** Whether a tight item may write `written` right under the block above, with no blank line that makes it loose. */
function separatorCanGo(written: string, above: string | undefined, aboveWritten: string): boolean {
  const [first = '', second = ''] = written.split('\n')
  if (first.startsWith('|')) return DELIMITER_ROW.test(second) && above !== undefined && TABLE_MAY_FOLLOW.has(above)
  if (above === 'code_block' || above === 'thematic_break' || above === 'heading') return true
  if (first.startsWith('>') && lastLine(aboveWritten).startsWith('>')) return false
  return INTERRUPTERS.some((opener) => opener.test(first))
}

/** The blocks of an item; a tight item drops the blank line between two blocks wherever the second interrupts. */
function itemContent(m: MarkdownState, children: readonly Block[], tight: boolean): string {
  let out = ''
  let above: string | undefined
  let aboveWritten = ''
  for (const child of children) {
    let written = block(m, child)
    if (written === '') continue
    if (tight && child.type === 'thematic_break' && (above === 'paragraph' || above === 'block_quote')) written = '***\n\n'
    if (tight && out.endsWith('\n\n') && separatorCanGo(written, above, aboveWritten)) out = out.slice(0, -1)
    out += written
    above = child.type
    aboveWritten = written
  }
  return out
}

function cellText(m: MarkdownState, cell: TableCellNode): string {
  const text = singleLine(m, () => cell.children.map((child) =>
    child.type === 'cell_paragraph' ? inlines(m, child.children) : blocks(m, [child]).trim().replace(/\n+/gu, ' ')).join(' '))
  return escapePipes(text.replace(/[\r\n]/gu, ' ').trim())
}

/** GFM splits a row on every `|` that no backslash escapes, code spans included. */
function escapePipes(cell: string): string {
  let out = ''
  for (let at = 0; at < cell.length; at++) {
    const ch = cell[at]!
    if (ch === '\\' && at + 1 < cell.length) {
      out += ch + cell[++at]!
      continue
    }
    out += ch === '|' ? '\\|' : ch
  }
  return out
}

function tableCells(m: MarkdownState, row: TableRowNode, isHeader: boolean): string[] {
  return row.children.map((cell) => {
    if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
      loss(m.x, cell, 'table-span-flattened', 'Flattened a spanned table cell while rendering markdown')
    }
    if (!isHeader && cell.header) loss(m.x, cell, 'table-header-cell-demoted', 'Wrote a header cell as an ordinary cell in Markdown')
    return cell.span === undefined ? cellText(m, cell) : ''
  })
}

/** The rows of a table in order, each with whether it is all header cells. */
function rowsOf(node: TableNode): { row: TableRowNode, isHeader: boolean }[] {
  const found: { row: TableRowNode, isHeader: boolean }[] = []
  for (const section of node.children) {
    if (section.type === 'comment') continue
    for (const row of section.children) {
      if (row.type === 'comment') continue
      found.push({ row, isHeader: row.children.length > 0 && row.children.every((cell) => cell.header || cell.span !== undefined) })
    }
  }
  return found
}

/** The header row, the first row when it is all header cells, and the other rows. */
function tableRows(m: MarkdownState, node: TableNode): { header: string[] | undefined, rows: string[][] } {
  let header: string[] | undefined
  const rows: string[][] = []
  for (const { row, isHeader } of rowsOf(node)) {
    const cells = tableCells(m, row, isHeader)
    if (isHeader && header === undefined && rows.length === 0) header = cells
    else {
      if (isHeader) loss(m.x, row, 'table-header-row-demoted', 'Wrote a header row as an ordinary row in Markdown')
      rows.push(cells)
    }
  }
  return { header, rows }
}

const ALIGN_ROW: Readonly<Record<string, string>> = { left: ':---', center: ':---:', right: '---:' }

function table(m: MarkdownState, node: TableNode): string {
  const { header, rows } = tableRows(m, node)
  const width = Math.max(node.columns.length, header?.length ?? 0, ...rows.map((row) => row.length))
  const pad = (cells: string[]): string[] => [...cells, ...Array.from({ length: width - cells.length }, () => '')]
  const line = (cells: string[]): string => `| ${pad(cells).join(' | ')} |`
  const align = (at: number): string => {
    const column = node.columns[at]
    return ALIGN_ROW[column?.align ?? column?.resolvedAlign ?? ''] ?? '---'
  }
  let out = `${line(header ?? [])}\n| ${Array.from({ length: width }, (_, at) => align(at)).join(' | ')} |\n`
  for (const row of rows) out += `${line(row)}\n`
  return captioned(m, node, `${out}\n`, node.caption, '\n\n')
}

/** Runs `write` with the caption of `node` taken off; the node belongs to the export's own copy of the tree. */
function withoutCaption<T>(node: Block & { caption?: CaptionNode }, write: () => T): T {
  const caption = node.caption
  delete node.caption
  try {
    return write()
  } finally {
    if (caption !== undefined) node.caption = caption
  }
}

/** Bold in a bold title line would close the run early. */
function unwrapStrong(nodes: readonly Inline[]): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    if (node.type === 'strong' && !hasAttributes(node.attrs)) return unwrapStrong(node.children)
    if ('children' in node && Array.isArray(node.children)) {
      return [{ ...node, children: unwrapStrong(node.children as Inline[]) } as Inline]
    }
    return [node]
  })
}

function footnoteSection(m: MarkdownState, document: DocumentNode): string {
  let out = ''
  for (const child of footnoteDefinitions(document)) {
    const depth = m.x.linkDepth
    m.x.linkDepth = 0
    try {
      out += withMarker(`[^${escapeHtml(child.key)}]: `, blocks(m, child.children), 4)
    } finally {
      m.x.linkDepth = depth
    }
  }
  return out
}

function frontmatter(document: DocumentNode): string {
  const node = document.children.find((child) => child.type === 'frontmatter')
  if (node === undefined) return ''
  const value = node.value.endsWith('\n') ? node.value.slice(0, -1) : node.value
  return `---${node.format === 'yaml' ? '' : node.format}\n${value}\n---\n\n`
}

const SLUG_CONTAINERS: ReadonlySet<string> = new Set([
  'section', 'include', 'block_quote', 'div', 'admonition', 'directive', 'list', 'list_item', 'footnote',
])

/** GFM's slug of the text of a heading: lower case, punctuation dropped, spaces as hyphens. */
function gfmSlug(x: Exporter, heading: HeadingNode): string {
  return slugify(plainInlineText(x, heading.children), 'keep-case').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /gu, '-')
}

/** The GFM slug of each heading with an id, in document order, with GFM's numbering of repeats. */
function headingSlugs(x: Exporter, document: DocumentNode): Map<string, string> {
  const slugs = new Map<string, string>()
  const counts = new Map<string, number>()
  const visit = (children: readonly Node[]): void => {
    for (const child of children) {
      if (child.type === 'heading') {
        const id = child.attrs?.id ?? child.generatedId
        const base = gfmSlug(x, child)
        const seen = counts.get(base) ?? 0
        counts.set(base, seen + 1)
        if (id !== undefined && !slugs.has(id)) slugs.set(id, seen === 0 ? base : `${base}-${seen}`)
      } else if (SLUG_CONTAINERS.has(child.type) && 'children' in child && Array.isArray(child.children)) {
        visit(child.children as Node[])
      }
    }
  }
  visit(document.children)
  return slugs
}

function collectKeys(document: DocumentNode): { footnotes: Set<string>, referenced: Set<string> } {
  const footnotes = new Set<string>()
  const referenced = new Set<string>()
  eachNode(document, (node) => {
    if (node.type === 'footnote') footnotes.add(node.key)
    else if ((node.type === 'link' || node.type === 'image') && node.key !== undefined && !isUnresolved(node)) referenced.add(node.key)
  })
  return { footnotes, referenced }
}

/** The Markdown of a resolved tree. */
export function exportMarkdown(x: Exporter): string {
  const keys = collectKeys(x.document)
  const m: MarkdownState = { x, slugs: headingSlugs(x, x.document), abbrDepth: 0, inlineLevel: 0, open: [], singleLine: 0, ...keys }
  const written = `${blocks(m, x.document.children)}${footnoteSection(m, x.document)}`
  const body = written.replace(/\n{3,}/gu, '\n\n').replace(/^\n+/u, '').trimEnd()
  const head = frontmatter(x.document)
  if (body === '') return head === '' ? '' : `${head.trimEnd()}\n`
  return stripBidi(`${head}${body}\n`)
}
