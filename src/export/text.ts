// The plain-text and ANSI exports. They share one walk; the ANSI target adds SGR styling, box tables and a quote bar.
import {
  type Block, type CaptionNode, type DocumentNode, type Inline, type ImageNode, type LinkNode, type ListNode, type Node,
  type NodeHandlers, type TableCellNode, type TableNode, type TableRowNode,
} from '../ast.ts'
import {
  allowedDestination, dispatch, drawDerived, eachNode, type Exporter, footnoteDefinitions, insideLink, isSkippedBreak, isUnresolved,
  loss, nested, noteNumber, rawDropped, referenceLabel, smartText, stripBidi, unexpandedInclude, xrefText,
} from './common.ts'
import { displayWidth, toSubscript, toSuperscript } from './terminal.ts'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALIC = '\x1b[3m'
const UNDERLINE = '\x1b[4m'
const STRIKE = '\x1b[9m'
const REVERSE = '\x1b[7m'
const FG_RED = '\x1b[31m'
const FG_GREEN = '\x1b[32m'
const FG_YELLOW = '\x1b[33m'
const FG_BLUE = '\x1b[34m'
const FG_MAGENTA = '\x1b[35m'
const FG_CYAN = '\x1b[36m'
const FG_BRIGHT_BLACK = '\x1b[90m'
const FG_BRIGHT_GREEN = '\x1b[92m'
const FG_BRIGHT_YELLOW = '\x1b[93m'
const FG_BRIGHT_BLUE = '\x1b[94m'
const FG_BRIGHT_MAGENTA = '\x1b[95m'
const FG_BRIGHT_CYAN = '\x1b[96m'
const FG_BRIGHT_WHITE = '\x1b[97m'
const HEADING_COLORS = [FG_BRIGHT_MAGENTA, FG_BRIGHT_CYAN, FG_BRIGHT_BLUE, FG_BRIGHT_GREEN, FG_BRIGHT_YELLOW, FG_BRIGHT_WHITE]

// U+0000 stands for a non-breaking space until the end, so the trims leave it alone; then it is a space.
const NBSP_HOLD = '\0'

interface TextState {
  x: Exporter
  ansi: boolean
  listDepth: number
  /** The list depth whose indentation an enclosing continuation prefix already wrote. */
  indentBase: number
  /** Above 0 while the children of an inline node are written. */
  inlineLevel: number
  /** Inside a span with an authored `abbr`, whose value is written instead of nested expansions. */
  abbrDepth: number
  /** Footnote definitions by key, for the references that found one. */
  footnotes: Set<string>
  /** Labels of the link reference definitions some reference used. */
  referenced: Set<string>
  /** The (term, expansion) pairs this run wrote, and the ones the first run wrote. */
  expanded: Set<string>
  expandedBefore: ReadonlySet<string>
}

function style(s: TextState, text: string, codes: string): string {
  return s.ansi ? `${codes}${text}${RESET}` : text
}

/**
 * Author text on its way out. The plain target keeps the C0 controls as content and drops CR, DEL and the C1 range;
 * the terminal acts on every control, so ANSI keeps only tab and line feed.
 */
function clean(s: TextState, text: string): string {
  return s.ansi ? text.replace(/\p{Cc}/gu, (c) => (c === '\t' || c === '\n' ? c : '')) : text.replace(/[\r\u007f-\u009f]/gu, '')
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/gu, '')
}

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d

/** Trims spaces, tabs and line breaks, keeping a held non-breaking space. */
function trim(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text.charCodeAt(start))) start++
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--
  return text.slice(start, end)
}

function trimEnd(text: string): string {
  let end = text.length
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end--
  return text.slice(0, end)
}

function prefixLines(content: string, prefix: string): string {
  return content.split('\n').map((line) => (line === '' ? line : `${prefix}${line}`)).join('\n')
}

/** The content of a line of a line block, whose own line end stands for a final hard break. */
function withoutFinalBreak(children: readonly Inline[]): readonly Inline[] {
  return children.at(-1)?.type === 'hard_break' ? children.slice(0, -1) : children
}

function pairKey(term: string, expansion: string): string {
  return `${term}\u0000${expansion}`
}

function blocks(s: TextState, list: readonly Node[]): string {
  return nested(s.x, () => {
    let out = ''
    for (const node of list) out += block(s, node)
    return out
  })
}

function inlines(s: TextState, list: readonly Inline[]): string {
  return nested(s.x, () => {
    const inside = s.inlineLevel > 0
    let out = ''
    s.inlineLevel++
    try {
      for (let at = 0; at < list.length; at++) {
        const node = list[at]!
        if ((node.type === 'soft_break' || node.type === 'hard_break') && isSkippedBreak(list, at, inside)) continue
        out += inline(s, node)
      }
    } finally {
      s.inlineLevel--
    }
    return out
  })
}

/** A caption on one line: its blocks with their breaks folded into spaces. */
function captionLine(s: TextState, caption: CaptionNode): string {
  return trim(blocks(s, caption.children)).replace(/[ \t\r]*(?:\n[ \t\r]*)+/gu, ' ')
}

function captionBlock(s: TextState, caption: CaptionNode): string {
  const line = captionLine(s, caption)
  return s.ansi ? `${style(s, line, ITALIC + DIM)}\n\n` : `${line}\n\n`
}

/** A captioned host: the host, then its caption on the next line, or after a blank line below a quote. */
function captioned(s: TextState, host: string, caption: CaptionNode | undefined, quote = false): string {
  if (caption === undefined) return host
  return `${trimEnd(host)}${quote ? '\n\n' : '\n'}${captionBlock(s, caption)}`
}

function titleLine(s: TextState, title: readonly Inline[] | undefined, groupLabel: string | undefined): string {
  let out = ''
  if (title !== undefined && title.length > 0) {
    const text = inlines(s, s.ansi ? unwrapStrong(title) : title)
    if (text !== '') out += `${style(s, text, BOLD)}\n\n`
  }
  if (groupLabel !== undefined && groupLabel !== '') out += `${style(s, clean(s, groupLabel), BOLD)}\n\n`
  return out
}

function block(s: TextState, node: Node): string {
  return dispatch(BLOCKS, node, s) ?? ''
}

const BLOCKS: NodeHandlers<string, TextState> = {
  section: (node, s) => blocks(s, node.children),
  heading: (node, s) => heading(s, node.level, inlines(s, node.children)),
  paragraph: (node, s) => captioned(s, `${inlines(s, node.children)}\n\n`, node.caption),
  code_block: (node, s) => captioned(s, codeBlock(s, node.value, node.syntax, node.title, node.groupLabel), node.caption),
  block_quote: (node, s) => captioned(s, blockQuote(s, node.children), node.caption, true),
  list: (node, s) => list(s, node),
  thematic_break: (_node, s) => s.ansi ? `${style(s, '─'.repeat(40), DIM)}\n\n` : '---\n\n',
  table: (node, s) => table(s, node),
  admonition: (node, s) => `${titleLine(s, node.title, node.groupLabel)}${blocks(s, node.children)}`,
  directive: (node, s) => `${titleLine(s, node.title, node.groupLabel)}${blocks(s, node.children)}`,
  div: (node, s) => `${titleLine(s, node.title, node.groupLabel)}${blocks(s, node.children)}`,
  line_block: (node, s) => {
    let out = ''
    for (const line of node.children) if (line.type === 'line') out += `${inlines(s, withoutFinalBreak(line.children))}\n`
    return `${out}\n`
  },
  definition_list: (node, s) => {
    let out = ''
    for (const child of node.children) {
      if (child.type === 'definition_term') out += `${style(s, inlines(s, child.children), BOLD + FG_YELLOW)}\n`
      else if (child.type === 'definition_description') out += `  ${trim(blocks(s, child.children))}\n`
    }
    return `${out}\n`
  },
  figure_group: (node, s) => {
    let out = node.caption === undefined ? '' : captionBlock(s, node.caption)
    for (const child of node.children) out += panel(s, child)
    return out
  },
  include: (node, s) => {
    if (node.children === undefined) return captioned(s, `${clean(s, unexpandedInclude(s.x, node))}\n\n`, node.caption)
    return captioned(s, blocks(s, node.children), node.caption)
  },
  block_extension: (node, s) => blocks(s, node.fallback.length > 0 ? node.fallback : node.children),
  raw_block: (node, s) => {
    // The payload without the line end that closes its last line.
    if (s.ansi) return `${style(s, `[raw:${clean(s, node.format)}] ${clean(s, node.value.replace(/\n$/u, ''))}`, DIM)}\n\n`
    rawDropped(s.x, node, true)
    return ''
  },
  abbreviation_def: (node, s) => {
    // A definition whose expansion this run writes beside its occurrences loses its line.
    if (s.expandedBefore.has(pairKey(node.key, node.expansion))) return ''
    return `${style(s, `*[${clean(s, node.key)}]: ${clean(s, node.expansion)}`, DIM)}\n\n`
  },
  link_reference_definition: (node, s) => {
    if (s.referenced.has(node.key)) return ''
    const href = allowedDestination(s.x, stripBidi(clean(s, node.href)), node)
    const title = node.tooltip === undefined ? '' : ` "${clean(s, node.tooltip)}"`
    return `${style(s, `[${clean(s, node.key)}]:${href === '' ? '' : ` ${href}`}${title}`, DIM)}\n\n`
  },
}

/** A panel of a figure group: its caption first, then the host, so the caption does not read as the next panel's. */
function panel(s: TextState, node: Block): string {
  const caption = node.type === 'paragraph' || node.type === 'code_block' || node.type === 'block_quote' ? node.caption : undefined
  if (caption === undefined) return block(s, node)
  const line = captionLine(s, caption)
  const host = trim(withoutCaption(node, () => block(s, node)))
  return `${s.ansi ? style(s, line, ITALIC + DIM) : line}\n${host}\n\n`
}

function heading(s: TextState, level: number, content: string): string {
  if (!s.ansi) return `${content}\n\n`
  const color = HEADING_COLORS[Math.min(level, 6) - 1] ?? FG_BRIGHT_WHITE
  let out = style(s, content, BOLD + color)
  if (level <= 2) out += `\n${style(s, (level === 1 ? '═' : '─').repeat(displayWidth(stripAnsi(content))), color)}`
  return `${out}\n\n`
}

function codeBlock(
  s: TextState, value: string, syntax: string | undefined, title: Inline[] | undefined, label: string | undefined,
): string {
  const content = clean(s, value)
  let out = ''
  if (title !== undefined && title.length > 0) out += `${style(s, inlines(s, title), BOLD)}\n\n`
  if (label !== undefined && label !== '') out += `${style(s, clean(s, label), BOLD)}\n\n`
  if (!s.ansi) return `${out}${content}\n`
  if (syntax !== undefined && syntax !== '') out += `${style(s, `┌── ${clean(s, syntax)} `, DIM)}\n`
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
  if (content === '') lines.length = 0
  for (const [index, line] of lines.entries()) {
    const ending = index < lines.length - 1 || content.endsWith('\n') ? '\n' : ''
    out += `${style(s, `  ${line}`, FG_BRIGHT_WHITE)}${ending}`
  }
  return `${out}\n`
}

function blockQuote(s: TextState, children: readonly Block[]): string {
  const body = blocks(s, children)
  if (!s.ansi) return `"${trim(body)}"\n\n`
  // The bar marks every line the quote contains, and none of the blank lines between its blocks.
  return prefixLines(body, `${style(s, '│', FG_CYAN + DIM)} `)
}

function isChecked(mark: string): boolean {
  return mark === 'x' || mark === 'X'
}

function itemMarker(s: TextState, ordered: boolean, counter: number, task: string | undefined): string {
  if (ordered) return s.ansi ? style(s, `${counter}.`, FG_YELLOW) : `${counter}.`
  if (!s.ansi) return '-'
  if (task === undefined) return style(s, '•', FG_CYAN)
  return isChecked(task) ? style(s, '☑', FG_GREEN) : style(s, '☐', FG_BRIGHT_BLACK)
}

/** The blocks of an item after its first: a sublist under the line above, any other block at the content column. */
function itemRest(s: TextState, rest: readonly Block[], tight: boolean, first: string): string {
  let content = first
  for (const child of rest) {
    if (child.type === 'list') {
      if (!s.ansi && tight && content.endsWith('\n\n')) content = content.slice(0, -1)
      content += blocks(s, [child])
      continue
    }
    const base = s.indentBase
    s.indentBase = s.listDepth
    try {
      content += prefixLines(blocks(s, [child]), '  '.repeat(s.listDepth - base))
    } finally {
      s.indentBase = base
    }
  }
  return content
}

function list(s: TextState, node: ListNode): string {
  s.listDepth++
  let out = ''
  let counter = node.marker.start ?? 1
  const ordered = node.marker.kind === 'ordered'
  for (const item of node.children) {
    const indent = '  '.repeat(s.listDepth - 1 - s.indentBase)
    const marker = itemMarker(s, ordered, counter++, item.task?.mark)
    // A comment writes nothing, so it does not take the marker line from the first visible block.
    const [first, ...rest] = item.children.filter((child) => child.type !== 'comment')
    const content = itemRest(s, rest, node.spacing === 'tight', first === undefined ? '' : blocks(s, [first]))
    out += `${indent}${marker} ${trim(content)}\n`
  }
  s.listDepth--
  return s.ansi && s.listDepth > 0 ? out : `${out}\n`
}

interface Cell {
  text: string
  header: boolean
}

function cellText(s: TextState, cell: TableCellNode): string {
  let out = ''
  for (const child of cell.children) {
    out += child.type === 'cell_paragraph' ? inlines(s, child.children) : `${blocks(s, [child])}\n`
  }
  return trim(out).replace(/[ \t\r]*(?:\n[ \t\r]*)+/gu, ' ')
}

function rowCells(s: TextState, row: TableRowNode): Cell[] {
  const cells: Cell[] = []
  for (const cell of row.children) {
    if ((cell.colspan ?? 1) > 1 || (cell.rowspan ?? 1) > 1) {
      loss(s.x, cell, 'table-span-flattened', `Flattened a spanned table cell while rendering ${s.x.target}`)
    }
    // A cell a span covers writes nothing in plain text, and an empty cell in a box.
    if (cell.span === undefined) cells.push({ text: cellText(s, cell), header: cell.header })
    else if (s.ansi) cells.push({ text: '', header: cell.header })
  }
  return cells
}

function tableRows(s: TextState, node: TableNode): Cell[][] {
  const rows: Cell[][] = []
  for (const section of node.children) {
    if (section.type === 'comment') continue
    for (const row of section.children) if (row.type !== 'comment') rows.push(rowCells(s, row))
  }
  return rows
}

function table(s: TextState, node: TableNode): string {
  const rows = tableRows(s, node)
  const out = s.ansi ? boxTable(s, rows) : rows.map((cells) => `${cells.map((cell) => cell.text).join(' | ')}\n`).join('')
  if (node.caption === undefined) return `${out}\n`
  return s.ansi ? `${out}${captionBlock(s, node.caption)}` : `${trimEnd(out)}\n${captionLine(s, node.caption)}\n\n`
}

function boxTable(s: TextState, rows: Cell[][]): string {
  if (rows.length === 0) return ''
  const columns = Math.max(...rows.map((row) => row.length))
  const widths: number[] = Array.from({ length: columns }, () => 0)
  for (const row of rows) row.forEach((cell, at) => { widths[at] = Math.max(widths[at]!, displayWidth(stripAnsi(cell.text))) })
  const border = (left: string, cross: string, right: string): string =>
    `${style(s, left + widths.map((w) => '─'.repeat(w + 2)).join(cross) + right, DIM)}\n`
  const bar = style(s, '│', DIM)
  let out = border('┌', '┬', '┐')
  let headed = false
  for (const row of rows) {
    const header = row.length > 0 && row.every((cell) => cell.header)
    const parts = widths.map((w, at) => {
      const text = row[at]?.text ?? ''
      const padded = text + ' '.repeat(w - displayWidth(stripAnsi(text)))
      return ` ${header ? style(s, padded, BOLD) : padded} `
    })
    out += `${bar}${parts.join(bar)}${bar}\n`
    if (header && !headed) {
      out += border('├', '┼', '┤')
      headed = true
    }
  }
  return out + border('└', '┴', '┘')
}

function link(s: TextState, node: LinkNode): string {
  const key = node.key
  if (key !== undefined && isUnresolved(node)) return `[${inlines(s, node.children)}]${clean(s, referenceLabel(node, key))}`
  // A link inside link text writes its content only.
  if (s.x.linkDepth > 0) return inlines(s, node.children)
  const label = insideLink(s.x, () => inlines(s, node.children))
  if (!s.ansi) return label
  const authored = stripBidi(clean(s, node.href ?? ''))
  let out = style(s, label, UNDERLINE + FG_BLUE)
  if (authored !== '' && !authored.startsWith('#') && authored !== stripAnsi(label)) {
    out += style(s, ` (${allowedDestination(s.x, authored, node)})`, DIM)
  }
  return out
}

function image(s: TextState, node: ImageNode): string {
  const key = node.key
  if (key !== undefined && isUnresolved(node)) return `![${clean(s, node.alt ?? '')}]${clean(s, referenceLabel(node, key))}`
  const alt = clean(s, node.alt ?? '')
  if (!s.ansi) return alt
  return `${style(s, '[img:', FG_MAGENTA)}${alt === '' ? '' : ` ${alt}`}${style(s, ']', FG_MAGENTA)}`
}

type NoteReference = Node & ({ type: 'footnote_ref', key: string } | { type: 'inline_footnote', children: Inline[] })

function noteRef(s: TextState, node: NoteReference): string {
  if (node.type === 'inline_footnote') {
    const depth = s.x.linkDepth
    s.x.linkDepth = 0
    try {
      return `(${inlines(s, node.children)})`
    } finally {
      s.x.linkDepth = depth
    }
  }
  const key = clean(s, node.key)
  // An unresolved reference stays as typed and unstyled: the construct did not form.
  if (noteNumber(s.x, node) === undefined && !s.footnotes.has(node.key)) return `[^${key}]`
  return style(s, `[${key}]`, FG_CYAN + BOLD)
}

function inline(s: TextState, node: Inline): string {
  return dispatch(INLINES, node, s) ?? ''
}

const INLINES: NodeHandlers<string, TextState> = {
  text: (node, s) => clean(s, node.value),
  emphasis: (node, s) => style(s, inlines(s, node.children), ITALIC),
  strong: (node, s) => {
    const only = node.children.length === 1 ? node.children[0] : undefined
    if (s.ansi && only?.type === 'emphasis') return style(s, inlines(s, only.children), BOLD + ITALIC)
    return style(s, inlines(s, node.children), BOLD)
  },
  underline: (node, s) => style(s, inlines(s, node.children), UNDERLINE),
  strike: (node, s) => style(s, inlines(s, node.children), STRIKE),
  highlight: (node, s) => style(s, inlines(s, node.children), REVERSE + FG_YELLOW),
  insert: (node, s) => style(s, inlines(s, node.children), FG_GREEN + UNDERLINE),
  delete: (node, s) => s.ansi ? style(s, inlines(s, node.children), STRIKE + FG_RED) : `~${inlines(s, node.children)}~`,
  subscript: (node, s) => s.ansi ? toSubscript(inlines(s, node.children)) : inlines(s, node.children),
  superscript: (node, s) => s.ansi ? toSuperscript(inlines(s, node.children)) : inlines(s, node.children),
  small_caps: (node, s) => inlines(s, node.children),
  span: (node, s) => span(s, node.children, node.attrs?.keyValues?.find(([key]) => key === 'abbr')?.[1]),
  code: (node, s) => style(s, clean(s, node.value), FG_BRIGHT_YELLOW),
  literal_inline: (node, s) => clean(s, node.value),
  math: (node, s) => {
    const number = node.display && node.number !== undefined ? ` ${clean(s, node.numberPrefix ?? '')} ${node.number}` : ''
    return style(s, clean(s, node.value), FG_BRIGHT_MAGENTA) + number
  },
  link: (node, s) => link(s, node),
  image: (node, s) => image(s, node),
  autolink: (node, s) => {
    const text = clean(s, node.text ?? node.href)
    return s.x.linkDepth > 0 ? text : style(s, text, UNDERLINE + FG_BLUE)
  },
  xref: (node, s) => {
    const { text, resolved } = xrefText(s.x, node)
    return resolved && s.x.linkDepth === 0 ? style(s, clean(s, text), UNDERLINE + FG_BLUE) : clean(s, text)
  },
  footnote_ref: (node, s) => noteRef(s, node),
  inline_footnote: (node, s) => noteRef(s, node),
  abbreviation: (node, s) => {
    const term = clean(s, node.key)
    const expansion = node.expansion ?? s.x.resolution.expansionOf.get(node)
    if (s.abbrDepth > 0 || expansion === undefined || !drawDerived(s.x, node, expansion)) return term
    s.expanded.add(pairKey(node.key, expansion))
    return `${term}${style(s, ` (${clean(s, expansion)})`, DIM)}`
  },
  ruby: (node, s) => {
    loss(s.x, node, 'ruby-flattened', `Flattened ruby annotation while rendering ${s.x.target}`)
    return node.pairs.map((pair) => `${inlines(s, pair.base)}(${inlines(s, pair.annotation)})`).join('')
  },
  raw_inline: (node, s) => {
    rawDropped(s.x, node, false)
    return ''
  },
  symbol: (node, s) => `:${clean(s, node.name)}:`,
  mention: (node, s) => clean(s, node.label ?? `@${node.target}`),
  tag: (node, s) => `#${clean(s, node.name)}`,
  inline_extension: (node, s) => inlines(s, node.name.includes('.') && node.fallback !== undefined ? node.fallback : node.children),
  critic_comment: (node, s) => {
    loss(s.x, node, 'editorial-comment-flattened', `Flattened an editorial comment while rendering ${s.x.target}`)
    return clean(s, node.value)
  },
  caption_number: (node, _s) => node.n === undefined ? '#' : String(node.n),
  citation_group: (node, s) => clean(s, node.raw),
  smart_punctuation: (node, s) => smartText(s.x, node),
  non_breaking_space: (_node, _s) => NBSP_HOLD,
  soft_break: (_node, _s) => ' ',
  hard_break: (_node, _s) => '\n',
  comment: (_node, _s) => '',
}

/** A span with an authored `abbr` writes its value after the content, and no expansion nested in it. */
function span(s: TextState, children: readonly Inline[], abbr: string | undefined): string {
  if (abbr === undefined) return inlines(s, children)
  s.abbrDepth++
  let inner: string
  try {
    inner = inlines(s, children)
  } finally {
    s.abbrDepth--
  }
  if (abbr === '' || !drawDerived(s.x, { type: 'text', value: abbr }, abbr)) return inner
  return `${inner}${style(s, ` (${clean(s, abbr)})`, DIM)}`
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

/** Bold in a bold title line is a no-op, and its reset would end the title's styling early. */
function unwrapStrong(nodes: readonly Inline[]): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    if (node.type === 'strong') return unwrapStrong(node.children)
    if ('children' in node && Array.isArray(node.children)) {
      return [{ ...node, children: unwrapStrong(node.children as Inline[]) } as Inline]
    }
    return [node]
  })
}

function footnoteSection(s: TextState, document: DocumentNode): string {
  let out = ''
  for (const child of footnoteDefinitions(document)) {
    {
      const depth = s.x.linkDepth
      s.x.linkDepth = 0
      let body: string
      try {
        body = trim(blocks(s, child.children))
      } finally {
        s.x.linkDepth = depth
      }
      const key = clean(s, child.key)
      out += s.ansi ? `${style(s, `[^${key}]`, FG_CYAN + DIM)} ${body}\n` : `[^${key}]: ${body}\n`
    }
  }
  return out
}

function collectKeys(document: DocumentNode): { footnotes: Set<string>, referenced: Set<string>, abbreviations: boolean } {
  const footnotes = new Set<string>()
  const referenced = new Set<string>()
  let abbreviations = false
  eachNode(document, (node) => {
    if (node.type === 'footnote') footnotes.add(node.key)
    else if (node.type === 'abbreviation_def') abbreviations = true
    else if ((node.type === 'link' || node.type === 'image') && node.key !== undefined && !isUnresolved(node)) referenced.add(node.key)
  })
  return { footnotes, referenced, abbreviations }
}

type Keys = ReturnType<typeof collectKeys>

function run(x: Exporter, ansi: boolean, keys: Keys, before: ReadonlySet<string>): { text: string, expanded: Set<string> } {
  const s: TextState = {
    x, ansi, listDepth: 0, indentBase: 0, abbrDepth: 0, inlineLevel: 0, footnotes: keys.footnotes, referenced: keys.referenced,
    expanded: new Set(), expandedBefore: before,
  }
  const body = `${blocks(s, x.document.children)}${footnoteSection(s, x.document)}`.replace(/\n{3,}/gu, '\n\n')
  // The plain target keeps the indentation of its first line, which may be code; ANSI trims both ends.
  const text = ansi ? trim(body) : trimEnd(body.replace(/^\n+/u, ''))
  return { text: stripBidi(`${text}\n`.replaceAll(NBSP_HOLD, ' ')), expanded: s.expanded }
}

/** The text of a resolved tree: plain, or styled for a terminal. */
export function exportText(x: Exporter, ansi: boolean): string {
  const keys = collectKeys(x.document)
  // A definition's line depends on whether the occurrences after it wrote its expansion, so a document with one
  // runs twice, the first time only to learn that, with its losses and budget thrown away.
  if (!keys.abbreviations) return run(x, ansi, keys, new Set()).text
  const entries = x.losses.entries.length
  const budget = x.derivedLeft
  const probe = run(x, ansi, keys, new Set())
  x.losses.entries.length = entries
  x.losses.nodes.length = entries
  x.derivedLeft = budget
  x.derivedReported = false
  return run(x, ansi, keys, probe.expanded).text
}
