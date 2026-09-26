import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import type {
  Attrs,
  BlockNode,
  DefinitionItem,
  Document,
  Figure,
  Image,
  InlineNode,
  Link,
  List,
  ListItem,
  Table,
  Text,
} from './ast.js'
import { SMART_PUNCTUATION_GLYPHS } from './ast.js'
import { AbbrBudget, budgetForDocument, utf8ByteLength } from './abbr-budget.js'
import { blankDeniedDestination } from './deny-listed-destination.js'
import { normalizeLegacyInline } from './legacy-nodes.js'
import { trimNonNbsp } from './trim-non-nbsp.js'
import { stripBidiControls } from './bidi-controls.js'
import { isUnresolvedReference, referenceSourceText } from './unresolved-reference.js'
import { occupiedPrivateUse, pickSentinelRun } from './sentinel-run.js'
import { rawFormatDropped, type RenderLossSinkOptions } from './render-loss.js'
import { footnoteDefsInSourceOrder } from './footnote-numbering.js'
import { inlineText } from './heading-ids.js'
import { isDangerousAttrName, renderedAttrValue } from './render-html.js'

// Set while rendering a span that carries an authored `abbr`, so a resolved
// abbreviation inside it contributes only its visible text (carve#1127).
let suppressAutomaticAbbreviation = false

/**
 * Whether smart typography renders as its glyph or as the source run the author
 * typed.
 *
 * Presentation output wants the glyph. Output written for a machine to read is
 * usually better off with the characters that were actually typed: the glyph is
 * a presentation choice the consumer did not ask for and cannot undo, and a
 * search for the source spelling misses it.
 */
export type SmartTypographyMode = 'glyph' | 'source'

export interface MarkdownRenderOptions extends RenderLossSinkOptions {
  /** Defaults to `'glyph'`. */
  smartTypography?: SmartTypographyMode | boolean
}

function renderHtmlAttrs(attrs: Attrs | undefined): string {
  if (!attrs) return ''
  const entries: Array<[string, string]> = []
  if (attrs.id !== undefined) entries.push(['id', attrs.id])
  if (attrs.classes?.length) entries.push(['class', [...new Set(attrs.classes)].join(' ')])
  for (const [name, value] of Object.entries(attrs.keyValues ?? {})) {
    if (isDangerousAttrName(name) || !/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(name)) continue
    entries.push([name, renderedAttrValue(name, value)])
  }
  return entries.map(([name, value]) => ` ${name}="${escapeMdHtml(stripControls(value)).replace(/"/g, '&quot;')}"`).join('')
}

/**
 * The renderer's recursion bound, and it must sit ABOVE the parser's.
 *
 * The guard is for hand-built ASTs, which nest without limit. It is not a
 * language rule, and the parser's own number made it one: a document nested at
 * exactly `MAX_NESTING_DEPTH` parses fine, and this renderer then emitted
 * nothing for its innermost blocks, so the same document kept its content in
 * HTML and lost it here (issue 517). Same reasoning as `MAX_AST_JSON_DEPTH` in
 * ast-json.ts, which is above the parser cap because the two counts measure
 * different things.
 */

export function renderMarkdown(ast: Document, opts: MarkdownRenderOptions = {}): string {
  // Choose the escape carriers before anything is rendered, so every pass that
  // introduces one and every pass that resolves one agrees on them.
  chooseCarriers(ast)
  const smartTypography: SmartTypographyMode =
    opts.smartTypography === false || opts.smartTypography === 'source' ? 'source' : 'glyph'
  // PART 11 section 11: GFM has no heading-id syntax, so a heading is linked by
  // the slug a GFM reader derives from its written text.
  const headingSlugs = gfmHeadingSlugs(
    [...ast.children, ...footnoteDefsInSourceOrder(ast).map(([, blocks]) => blocks).flat()],
    smartTypography,
  )

  const ctx: MarkdownContext = {
    options: opts,
    headingSlugs,
    lastList: undefined,
    listDepth: 0,
    blockDepth: 0,
    inlineDepth: 0,
    abbrBudget: budgetForDocument(ast),
    smartTypography,
    definedFootnotes: new Set(Object.keys(ast.footnoteDefs ?? {})),
  }
  const out = renderBlocks(ast.children, ctx)
  const footnotes = renderFootnoteDefs(ast, ctx)
  return stripBidiControls(normalize(`${out}${footnotes}`))
}

interface MarkdownContext {
  options: MarkdownRenderOptions
  /** Carve heading id -> the GFM slug of the heading the target writes. */
  headingSlugs: Map<string, string>
  /** The list written last in the current container, if nothing followed it. */
  lastList: { ordered: boolean; mark: string } | undefined
  listDepth: number
  blockDepth: number
  inlineDepth: number
  /** Per-render abbreviation-expansion budget (DoS guard). */
  abbrBudget: AbbrBudget
  smartTypography: SmartTypographyMode
  /**
   * Labels that actually have a definition. A reference without one did not form
   * a footnote, so it is ordinary text - and its brackets are Markdown
   * metacharacters that section 8 M1 requires escaping.
   */
  definedFootnotes: Set<string>
}

/**
 * The finished content of a container, trimmed and with PART 11 section 8a M1f
 * and section 8b M2b ANSWERED ON IT, ready for the caller to put its prefix in
 * front.
 *
 * Every call site is a place the writer prefixes a container's lines, and that
 * is the whole of the list: the block quote marker, the list and task marker
 * with the alignment section 10 gives the lines under it, the footnote
 * definition marker, the definition marker. Both clauses measure on the EMITTED LINE
 * and a line's content position is after its container prefix
 * (markup-carve/carve#1330), so the question has to be settled here - after the
 * trim, which is part of the shape of the line, and before the prefix, which is
 * what the position is measured past.
 *
 * A HEADING IS NOT A CONTAINER and does not call this. Its `## ` belongs to the
 * block's own line, so the hash behind it stays mid-line and loses the escape,
 * which is the reading CommonMark gives it. Neither is a table cell: `| ` opens
 * no container either. Both are left to the resolve pass at the end, which
 * measures on the finished document - the right answer for a line no container
 * encloses, and the wrong one for a line inside a container, which is why these
 * sites exist.
 *
 * DECIDING EARLIER DOES NOT WORK, and the trim is why. A block does not know
 * whether the whitespace it wrote at the start of its first line survives:
 * a paragraph opening with four spaces keeps them mid-document and loses them
 * as the first block of a quote or of the document. Answering M2b before that
 * trim scored the hash as over-indented and emitted it bare, and the trim then
 * put it at column 0 - a heading where the author wrote text.
 *
 * The counter is what keeps this from costing anything. A nested container
 * decides on its own way out and leaves the count where it found it, so an
 * outer one that added no hash of its own never touches the text - which
 * matters for exactly the shape carve-js#701 fixed, where re-scanning a subtree
 * once per enclosing level is quadratic in the nesting depth.
 */
function containerContent(render: () => string): string {
  const before = hashesEmitted
  const content = trimNonNbsp(render())
  if (hashesEmitted === before) return content
  hashesEmitted = before

  return decideAuthoredHashes(content)
}

function renderBlocks(blocks: BlockNode[], ctx: MarkdownContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    let out = ''
    for (const b of blocks) out += renderTracked(b, ctx)
    return out
  } finally {
    ctx.blockDepth--
  }
}

/**
 * Two lists of one kind written back to back are one list to a Markdown
 * reader, so the second takes the other marker of its kind (PART 11 section
 * 10o). "Back to back" is decided on the output: a block that writes nothing
 * does not separate them, and neither does a wrapper this target writes no
 * marker for, so the last list written is tracked on the context.
 */
const UNMARKED_WRAPPERS = new Set(['section', 'div', 'line_block', 'admonition', 'directive', 'definition_list'])

function renderTracked(block: BlockNode, ctx: MarkdownContext): string {
  if (block.type !== 'list') {
    const rendered = renderBlock(block, ctx)
    if (rendered !== '' && !UNMARKED_WRAPPERS.has(block.type)) ctx.lastList = undefined
    return rendered
  }
  let mark = block.ordered ? (block.delim === ')' ? ')' : '.') : (block.bulletChar ?? '-')
  const previous = ctx.lastList
  if (previous !== undefined && previous.ordered === block.ordered && previous.mark === mark) {
    mark = block.ordered ? (mark === '.' ? ')' : '.') : mark === '-' ? '*' : '-'
  }
  const rendered = renderList(block, ctx, mark)
  if (rendered !== '') ctx.lastList = { ordered: block.ordered, mark }
  return rendered
}

/** Render inside a container that prefixes its lines, which starts a fresh run of lists. */
function inOwnContainer<T>(ctx: MarkdownContext, render: () => T): T {
  const outer = ctx.lastList
  ctx.lastList = undefined
  try {
    return render()
  } finally {
    ctx.lastList = outer
  }
}

/**
 * A block MARKER joined to the content it introduces, with the space that
 * separates the two dropped when there IS no content.
 *
 * Every marker this target emits carries that separator - `> `, `- `, `1. `,
 * `- [ ] `, `: `, `## `, `[^a]: `, `*[X]: `. Where the content is empty the
 * separator is all that is left on the line, and a line ending in whitespace is
 * not stable: editors that strip it on save, `git apply --whitespace=fix` and CI
 * whitespace checks all rewrite it, so the renderer produces output that
 * ordinary tooling changes behind it. That is the argument PART 11 section 9
 * makes ON THIS TARGET when it forbids the two-trailing-space hard break, and
 * the one section 7 makes for the canonical writer; `renderList`'s continuation
 * pad already applied it here, and this extends it to the marker lines.
 *
 * The separator carries no meaning to a reader either: `> ` and `>`, `- ` and
 * `-`, `## ` and `##`, `1. ` and `1.` parse to the same document in commonmark
 * 0.31.2, and PART 2's NO TRAILING WHITESPACE clause drops the run on every
 * content line - so the dropped byte is one Carve's own parser would not read
 * back.
 *
 * THE TEST IS ON THE CONTENT, not on the finished line, and that is what keeps
 * VERBATIM payload intact. A fenced code block's body is the block's payload,
 * not a content line (PART 2, WHERE IT DOES NOT REACH), so a body line of
 * `abc<SP>` - or one that is a single space - keeps its bytes even inside a
 * quote, where it arrives here as non-empty content behind a `> `. Corpus case
 * 268-trailing-whitespace-on-a-content-line-is-dropped-9 pins that. A sweep over
 * the emitted LINE, or over the finished document, would corrupt it; the
 * canonical writer runs such a sweep and needs a verbatim-sentinel scheme to do
 * it safely, which this target has no need of.
 */
function withMarker(marker: string, content: string): string {
  if (content !== '') return `${marker}${content}`

  // A SPACE, not PART 2's two-character `whitespace` terminal. Every marker
  // above separates itself from its content with a space and none of them uses
  // a tab, so a `[ \t]` class here would carry a branch no input can reach -
  // and an unreachable branch reads as a rule that is wider than it is. The
  // sibling helper in the canonical writer does take the full terminal, because
  // that one sweeps AUTHOR lines, where a tab is reachable.
  return marker.replace(/ +$/, '')
}

function renderBlock(node: BlockNode, ctx: MarkdownContext): string {
  switch (node.type) {
    case 'section':
      return renderBlocks(node.children, ctx)
    case 'heading': {
      // A folded heading's line join takes PART 7's four characters. The class
      // was `\s` with one carve-out, so it swallowed a vertical tab beside the
      // newline that the HTML target kept.
      const text = trimNonNbsp(renderInlines(node.children, ctx).replace(/[ \t\r]*\n[ \t\r]*/g, ' '))
      const line = escapeTrailingAtxRun(text)
      return `${withMarker(`${'#'.repeat(node.level)} `, line)}\n\n`
    }
    case 'paragraph':
      return `${protectParagraphListMarkers(trimParagraphLines(renderInlines(node.children, ctx)))}\n\n`
    case 'code_block': {
      const content = stripControls(node.content)
      const fence = safeFence(content, 3)
      // The EFFECTIVE title, not the authored header. An attribute line above the
      // fence overrides a title written in the header, and the HTML target uses
      // the winner - so emitting `node.header` here described the document
      // differently in the two targets, announcing a title that had lost
      // (carve#352, corpus 11-fenced-code-10). The parser resolves the override
      // into `attrs`, so that is where the answer already is.
      const effectiveTitle = node.attrs?.keyValues?.['title'] ?? node.header
      const info = markdownFenceInfo(node.lang, effectiveTitle, node.label)
      return `${fence}${info}\n${content}\n${fence}\n\n`
    }
    case 'block_quote': {
      const lines = containerContent(() => inOwnContainer(ctx, () => renderBlocks(node.children, ctx))).split('\n')
      return `${lines.map((line) => withMarker('> ', line)).join('\n')}\n\n`
    }
    case 'list':
      return renderList(node, ctx)
    case 'thematic_break':
      return '---\n\n'
    case 'table':
      return renderTable(node, ctx)
    case 'admonition':
    case 'directive': {
      // Markdown has no admonition; preserve the title (otherwise lost) as a
      // leading bold line, then an unconsumed grouping [label] (also bold, the
      // caption floor; title first when both are present), then the body.
      const hasLead = (node.title !== undefined && node.title.length > 0) || Boolean(node.label)
      if (hasLead) ctx.lastList = undefined
      const body = renderBlocks(node.children, ctx)
      const title =
        node.title !== undefined ? renderInlines(unwrapStrong(node.title), ctx) : ''
      // Escape the label the same way text is escaped (HTML + Markdown
      // metacharacters), not just strip controls: a label like `[<img …>]`
      // must not emit live HTML when the Markdown is re-rendered.
      const labelLine = node.label ? wrapperLine(escapeText(node.label), '**', 'strong') : ''
      if (title !== '') {
        return `${wrapperLine(title, '**', 'strong')}${labelLine}${body}`
      }
      return `${labelLine}${body}`
    }
    case 'div':
      if (node.label) ctx.lastList = undefined
      return node.label
        ? `${wrapperLine(escapeText(node.label), '**', 'strong')}${renderBlocks(node.children, ctx)}`
        : renderBlocks(node.children, ctx)
    case 'line_block':
      return renderBlocks(node.children, ctx)
    case 'definition_list':
      return renderDefinitionList(node.items, ctx)
    case 'figure':
      return renderFigure(node, ctx)
    case 'figure_group': {
      // PART 11 degradation (D8): the panels in source order, each host
      // degraded as usual with its caption as an EMPHASIZED paragraph after
      // it; stray content in place; the group caption as a BOLD paragraph at
      // the end. A table panel's caption is the table's own and stays where
      // that renderer puts it.
      let out = ''
      for (const child of node.children) {
        out += child.type === 'figure' ? renderPanelFigure(child, ctx) : renderBlock(child, ctx)
      }
      if (node.caption !== undefined) {
        out += wrapperLine(trimNonNbsp(renderInlines(node.caption, ctx)), '**', 'strong')
      }
      return out
    }
    case 'image':
      // Block-level (standalone) image: emit the trailing block separator so a
      // following block is not glued to it, matching carve-php / carve-rs.
      return `${renderImage(node)}\n\n`
    case 'raw_block':
      // Escape, not emit: raw HTML in Markdown would be live again downstream.
      if (node.format !== 'html') {
        rawFormatDropped(ctx.options, node, 'markdown')
        return ''
      }
      return `${escapeMdHtml(stripControls(node.content))}\n\n`
    case 'abbreviation_def':
      // PART 11 §10a: a definition NOTHING references still reaches this
      // target. HTML drops it because it has nowhere to put one; Markdown,
      // plain text and the terminal do not get to drop content the author
      // wrote, and dropping it made the output depend on whether a reference
      // exists elsewhere in the document (carve#589).
      // The definition line goes through `escapeMdHtml` for the same reason the
      // `<abbr>` built from it does: an expansion is author content, and this
      // target's contract is that embedded HTML cannot become live markup
      // downstream. Writing the occurrence escaped and the definition raw made
      // one output disagree with itself (markup-carve/carve-js#894).
      return `${withMarker(`*[${escapeMdHtml(stripControls(node.abbr))}]: `, escapeMdHtml(stripControls(node.expansion)))}\n\n`
    case 'comment':
      return ''
    case 'link_reference_definition':
      // Renders nothing, same as carve-php on this target. The definition's
      // destination already reached every link that resolved it, and Markdown's
      // own reference form is not what this writer emits.
      return ''
    case 'citation_definition':
      // Renders nothing, which is what the line has always produced here: the
      // entry belongs to the references list, and PART 12 §18 gave the line a
      // node without moving output on any target.
      return ''
    default: {
      const t: never = node
      throw new Error(`renderMarkdown: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderList(node: List, ctx: MarkdownContext, mark?: string): string {
  ctx.listDepth++
  let out = ''
  let counter = node.start ?? 1
  // The authored bullet, not a normalized one. A change of bullet is what
  // SEPARATES two adjacent lists in CommonMark, so emitting `-` for a `*` list
  // merges lists the source kept apart - the same section 11 rule the AST
  // records `bulletChar` for and `renderCarve` already honors (carve#352).
  const bullet = mark ?? node.bulletChar ?? '-'
  // The authored ordered-list delimiter, for the same reason as the bullet above:
  // in CommonMark a change of delimiter SEPARATES two adjacent lists, so emitting
  // `1.` for a `1)` list merges lists the source kept apart. Measured against
  // commonmark.js - `1. a` followed by `1) c` gives two `<ol>` elements, the same
  // input with one delimiter gives one. The AST records `delim` and `renderCarve`
  // already reproduces it (carve#352, corpus 31).
  const delim = mark ?? (node.delim === ')' ? ')' : '.')
  let first = true
  for (const item of node.items) {
    // A loose list is loose in CommonMark because blank lines separate its
    // items, so the separator is what carries the looseness across.
    if (!node.tight && !first) out += '\n'
    first = false
    let prefix: string
    // The pad is the item's CONTENT COLUMN, which is only the same as the
    // printed prefix where the whole prefix is the marker. A task item's `[x] `
    // is the first inline of its first paragraph, so padding by it puts every
    // block below four columns past where a reader looks for them (carve-js#2085).
    let pad: number
    if (node.ordered) {
      prefix = `${counter}${delim} `
      pad = prefix.length
      counter++
    } else if (item.checked !== undefined) {
      prefix = `${bullet} ${item.checked ? '[x]' : '[ ]'} `
      pad = bullet.length + 1
    } else {
      prefix = `${bullet} `
      pad = prefix.length
    }
    const content = containerContent(() => inOwnContainer(ctx, () => renderListItem(item, node.tight, ctx)))
    const lines = content.split('\n')
    // NESTING COMES FROM THE PARENT'S CONTINUATION PAD ALONE. This used to add
    // `'  '.repeat(listDepth - 1)` as well, and the enclosing item then padded
    // the same lines again by its marker width, so every level was indented
    // twice: two levels landed at four spaces and three at ten. Ten spaces
    // under a marker whose content column is six is four PAST it, which is
    // where a reader opens an indented verbatim block - so a third level
    // stopped being a list for every reader that is not Carve itself. Carve's
    // own content-column model is lenient enough to read it back as a list,
    // which is why this was invisible from inside the engine and only pandoc
    // showed it (carve#1069, carve-php#1142).
    out += `${withMarker(prefix, lines.shift() ?? '')}\n`
    const continuation = ' '.repeat(pad)
    // A line with no content takes no pad: PART 11 section 7 emits such a line
    // empty, and trailing whitespace is what editors and `git apply
    // --whitespace=fix` rewrite behind the writer.
    for (const line of lines) out += `${line === '' ? '' : continuation + line}\n`
  }
  ctx.listDepth--
  return out + (ctx.listDepth === 0 ? '\n' : '')
}

/*
 * The openers this target can emit that interrupt a paragraph, asked of the
 * EMITTED LINE. A node kind cannot answer it: `thematic_break` emits `---`,
 * which under a paragraph line is a SETEXT HEADING and changes what that
 * paragraph is rather than interrupting it, and an empty bullet is a setext
 * underline too. `***` and `___` would interrupt, and no node emits them.
 */
const PARAGRAPH_INTERRUPTERS = [
  /^>/, // a block quote
  /^#{1,6}(?:[ \t]|$)/, // an ATX heading
  /^(?:`{3,}|~{3,})/, // a fenced code block
  /^[-*+][ \t]+\S/, // a bullet item, content and all
  /^1[.)][ \t]+\S/, // an ordered item - only a `1` interrupts a paragraph
]

/** A GFM delimiter row, which is what promotes the row above it to a header. */
const DELIMITER_ROW = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+$/

/** The blocks a table row may follow with no blank line between them. */
const A_TABLE_MAY_FOLLOW = new Set(['paragraph', 'heading', 'code_block', 'thematic_break'])

/**
 * Whether the separator between two of a tight item's blocks can go.
 *
 * `CARVE-P11-047` asks whether the block below OPENS with something that
 * interrupts a paragraph, and the two spellings the clause names are examples of
 * that property, not the whole of it (carve-js#2056). Every answer here comes
 * from the emitted lines, because that is what a reader sees.
 */
function separatorCanGo(rendered: string, above: BlockNode | undefined, aboveRendered: string): boolean {
  const [firstLine = '', secondLine = ''] = rendered.split('\n')
  if (firstLine.startsWith('|')) {
    // A row is paragraph continuation text until a delimiter row promotes it, so
    // a headerless table glues itself to the block above instead of opening one,
    // and a container above takes the row lazily - a table above takes it as
    // another row of its own.
    return DELIMITER_ROW.test(secondLine) && above !== undefined && A_TABLE_MAY_FOLLOW.has(above.type)
  }
  // An unseparated `>` under an open quote continues THAT quote.
  if (firstLine.startsWith('>') && lastNonBlankLine(aboveRendered).startsWith('>')) return false
  return PARAGRAPH_INTERRUPTERS.some((opener) => opener.test(firstLine))
}

const lastNonBlankLine = (rendered: string): string =>
  rendered
    .split('\n')
    .filter((line) => line.trim() !== '')
    .at(-1) ?? ''

/** A list marker with nothing after it: `-`, `*`, `1.`, `1)`. */
const BARE_MARKER = /^(?:[-*+]|\d+[.)]) *$/

/** A run of three or more of one break character, which closes what is above it. */
const THEMATIC_BREAK_LINE = /^(-+|\*+|_+)[ \t]*$/

/** A line's content with one list marker taken off, for the line a nested list ends on. */
const markerContent = (line: string): string => line.replace(/^(?:[-*+]|\d+[.)]) +/, '')

/** The blocks whose Markdown spelling opens with plain text, so a reader can take them lazily. */
const SWALLOWED_BY_A_LAZY_LINE = new Set(['paragraph', 'table', 'definition_list'])

/**
 * Whether the block below is read as more text of the block above because no
 * blank line separates them and its own spelling opens with plain text.
 *
 * A nested list is the only block this target writes with no blank line behind
 * it, so this is the seam `separatorCanGo` cannot reach: that decides whether to
 * TAKE a blank away, and here there is none to take. A table is in the swallowed
 * set even though a delimiter row promotes a paragraph at the same level,
 * because a lazy continuation line cannot open one - the rows arrive as the last
 * nested item's text and the table does not reach the output at all.
 *
 * The tail has to be able to TAKE lazy text, which a bare marker and a heading
 * cannot, so those pairs stay glued and the item stays tight.
 */
function swallowedByALazyLine(aboveRendered: string, below: BlockNode): boolean {
  if (!SWALLOWED_BY_A_LAZY_LINE.has(below.type)) return false
  const tail = lastNonBlankLine(aboveRendered).replace(/^[ \t]+/, '')
  if (BARE_MARKER.test(tail) || THEMATIC_BREAK_LINE.test(tail)) return false
  const text = markerContent(tail)
  return text !== '' && !'#>|`~='.includes(text[0] ?? '')
}

function renderListItem(item: ListItem, tight: boolean, ctx: MarkdownContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    let out = ''
    // The block the separator hangs off is the last child that WROTE something:
    // a comment and a raw block for another format render nothing here, so the
    // sibling above can be two positions back (carve-php#2406).
    let above: BlockNode | undefined
    let aboveRendered = ''
    for (const child of item.children) {
      const rendered = renderTracked(child, ctx)
      // A blank between a tight item's blocks makes the item loose in
      // CommonMark, so drop the separator the block above left wherever the
      // child below opens a construct of its own under it.
      if (tight && out.endsWith('\n\n') && separatorCanGo(rendered, above, aboveRendered)) {
        out = out.slice(0, -1)
      } else if (out.endsWith('\n') && !out.endsWith('\n\n') && swallowedByALazyLine(out, child)) {
        out += '\n'
      }
      out += rendered
      if (rendered !== '') {
        above = child
        aboveRendered = rendered
      }
    }
    return out
  } finally {
    ctx.blockDepth--
  }
}

/**
 * GFM has no definition list and reads a `: ` marker as text, so each entry is
 * its terms as strong paragraphs followed by its descriptions' blocks (PART 11
 * section 10p).
 */
function renderDefinitionList(items: DefinitionItem[], ctx: MarkdownContext): string {
  let out = ''
  for (const item of items) {
    for (const term of item.terms) {
      out += wrapperLine(renderInlines(term, ctx), '**', 'strong')
      ctx.lastList = undefined
    }
    for (const def of item.definitions) out += renderBlocks(def, ctx)
  }
  return out
}

function renderCellBlocks(blocks: BlockNode[], ctx: MarkdownContext, depth = 0): string {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  const parts: string[] = []
  const descend = (children: BlockNode[]) => {
    const content = renderCellBlocks(children, ctx, depth + 1)
    if (content) parts.push(content)
  }
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        parts.push(renderInlines(block.children, ctx))
        break
      case 'block_quote':
      case 'div':
      case 'section':
      case 'line_block':
      case 'admonition':
      case 'directive':
      case 'figure_group':
        descend(block.children)
        break
      case 'list':
        for (const item of block.items) descend(item.children)
        break
      case 'definition_list':
        for (const item of block.items) {
          for (const term of item.terms) parts.push(renderInlines(term, ctx))
          for (const definition of item.definitions) descend(definition)
        }
        break
      case 'table':
        for (const row of block.rows) for (const cell of row.cells) {
          if (cell.blocks) descend(cell.blocks)
          else parts.push(renderInlines(cell.children ?? [], ctx))
        }
        break
      case 'figure':
        parts.push(renderInlines(block.caption, ctx))
        if (block.target.type === 'block_quote') descend(block.target.children)
        else if (block.target.type === 'table') descend([block.target])
        else descend([block.target])
        break
      case 'image':
        // An image IS inline content, so the cell takes the inline spelling.
        // Rendering the block and escaping it as text wrote `![a\](u)`, whose
        // escaped bracket is no longer an image (carve-js#2125).
        parts.push(renderInlines([block], ctx))
        break
      case 'code_block':
        // PART 12 §27 (CARVE-P12-049): a code block contributes its PAYLOAD.
        // The fence, the info string, the quoted header and the bracketed label
        // are its spelling, and the cell takes none of them. HTML shows the
        // same: the payload is the `<pre>`'s text, the header rides as an
        // attribute.
        parts.push(renderInlines([{ type: 'text', value: block.content }], ctx))
        break
      case 'thematic_break':
        // No inline content to contribute, and §27 admits no markers: `---` in
        // the cell was block decoration, not content.
        break
      case 'raw_block':
        // Raw HTML is text here (PART 12 §27): the escaping keeps it inert
        // without spelling it as entities a reader would show verbatim.
        if (block.format === 'html') {
          parts.push(renderInlines([{ type: 'text', value: stripControls(block.content) }], ctx))
          break
        }
        parts.push(renderInlines([{ type: 'text', value: renderBlock(block, ctx).trim() }], ctx))
        break
      case 'abbreviation_def':
        // The one pair whose content no inline node holds. Each keeps the
        // target's own spelling, because dropping it would lose the only place
        // the Markdown output carries it (carve#589 for the definition).
        parts.push(renderInlines([{ type: 'text', value: renderBlock(block, ctx).trim() }], ctx))
        break
      case 'link_reference_definition':
      case 'citation_definition':
      case 'comment':
        // Each renders nothing on this target at block level, in the cell too.
        break
      default: {
        // Exhaustive on purpose: a new block kind must decide what it
        // contributes rather than fall through to its own source spelling.
        const t: never = block
        throw new Error(`renderMarkdown: unknown block in a table cell ${(t as { type: string }).type}`)
      }
    }
  }
  // ONE SPACE between blocks, not `<br>` (PART 12 §27, CARVE-P12-049): the cell
  // reaches an inline-only slot and flattens under PART 11 §1b. A hard break is
  // the separate case and still writes `<br>`, from the inline renderer.
  return parts.filter(Boolean).map((part) => part.replace(/\\*[ \t\r]*(?:\n[ \t\r]*)+/g, ' ')).join(' ')
}

function renderTable(node: Table, ctx: MarkdownContext): string {
  let header: string | undefined
  let headerColumns = 0
  const rows: string[] = []
  const aligns: (('left' | 'right' | 'center') | undefined)[] = []
  for (const row of node.rows) {
    const cells = row.cells.map((cell) =>
      escapeCellPipes(
        withinTableCell(() => {
          if (cell.blocks === undefined) return trimNonNbsp(renderInlines(cell.children ?? [], ctx))
          return trimNonNbsp(renderCellBlocks(cell.blocks, ctx))
        }),
      ),
    )
    const rendered = `| ${cells.join(' | ')} |`
    // A span placeholder belongs to the cell that covers it (PART 11 section 10n).
    if (row.cells.every((cell) => cell.header || cell.span !== undefined) && row.cells.some((cell) => cell.header)) {
      if (header === undefined) aligns.length = 0
      row.cells.forEach((cell, i) => {
        // Multiple header rows collapse to Markdown's one header row. The
        // last header that specifies a column alignment wins in Carve, so the
        // delimiter must use the same effective value.
        if (cell.align !== undefined) aligns[i] = cell.align
      })
      if (header === undefined) {
        header = rendered
        headerColumns = cells.length
      } else {
        // Markdown cannot keep this row as another header, but dropping it
        // would violate the presentation target's content floor.
        rows.push(rendered)
      }
    } else {
      rows.push(rendered)
      // A headerless table still declares its columns somewhere, so fall back to
      // the first row that carries an alignment.
      if (header === undefined) {
        row.cells.forEach((cell, i) => {
          if (aligns[i] === undefined) aligns[i] = cell.align
        })
      }
    }
  }
  const separator = (i: number): string => {
    switch (aligns[i]) {
      case 'left':
        return ':---'
      case 'center':
        return ':---:'
      case 'right':
        return '---:'
      default:
        return '---'
    }
  }
  let out = ''
  if (header === undefined) {
    // GFM reads a pipe table only below a header row, so a headerless table
    // gets an empty one as wide as its widest row (PART 11 section 10n).
    headerColumns = Math.max(0, ...node.rows.map((row) => row.cells.length))
    if (headerColumns > 0) header = `| ${Array.from({ length: headerColumns }, () => '').join(' | ')} |`
  }
  if (header !== undefined) {
    out += `${header}\n`
    // The delimiter promotes the header row, so its width must match that row,
    // not a wider body row. A wider delimiter makes common Markdown readers
    // reject the entire table (carve#1042, PART 11 §10b).
    out += `| ${Array.from({ length: headerColumns }, (_, i) => separator(i)).join(' | ')} |\n`
  }
  out += `${rows.join('\n')}\n`
  // PART 11 §10e T2: a caption is authored text, and Markdown has no
  // table-caption syntax - so it survives as body text AFTER the table,
  // separated by one blank line, the position an image caption and a listing
  // caption already take on this target. The blank line is not cosmetic: a GFM
  // reader takes a line written directly after the last row as ANOTHER ROW, so
  // the caption comes back as a fabricated data cell, which is worse than
  // losing it. Adjacency attaches only where it does not change what the
  // adjacent block is - the move a caption cannot make on this target, whatever
  // it could make on another.
  if (node.caption && node.caption.length > 0) {
    out += `\n${trimNonNbsp(renderInlines(node.caption, ctx))}\n`
  }
  return `${out}\n`
}

/**
 * GFM splits a row on every unescaped `|` before it reads any inline, a code
 * span included, and reads `\|` back as `|` there (PART 11 section 8h).
 */
function escapeCellPipes(cell: string): string {
  return cell.replace(/(\\*)\|/g, (match, backslashes: string) =>
    backslashes.length % 2 === 0 ? `${backslashes}\\|` : match,
  )
}

function renderFigure(node: Figure, ctx: MarkdownContext): string {
  const target = renderFigureTarget(node, ctx)
  // The caption sits on its own line directly under the figure (`\n`) - an
  // image target used to glue it on (`![a](/u)cap`). A block quote keeps the
  // blank-line separation, and so does a table: PART 11 §10e T2 requires one
  // blank line there, because a line directly after the last row is read as
  // another row. The empty separator this branch used to take was only ever
  // right while a table dropped its caption outright.
  const sep =
    node.target.type === 'block_quote' || node.target.type === 'table' ? '\n\n' : '\n'
  // End with the block separator so a following block is not glued to the
  // caption (matching every other block renderer and carve-php).
  return `${target}${sep}${renderInlines(node.caption, ctx)}\n\n`
}

/**
 * A composite figure's PANEL: the host degraded exactly as `renderFigure`
 * degrades it, with the caption emphasized rather than plain - the D8 shape
 * that keeps a panel caption visually subordinate to the group's bold one.
 */
function renderPanelFigure(node: Figure, ctx: MarkdownContext): string {
  const target = renderFigureTarget(node, ctx)
  // A BLANK line before the caption, for every host: the emphasized caption is
  // its own paragraph (carve-php / carve-rs parity; the ticket's degradation
  // example). The single-newline glue is the standalone figure's shape, not
  // the panel's.
  return `${target}\n\n${wrapperLine(trimNonNbsp(renderInlines(node.caption, ctx)), '*', 'em')}`
}

function renderFigureTarget(node: Figure, ctx: MarkdownContext): string {
  return node.target.type === 'image'
    ? renderImage(node.target)
    : node.target.type === 'table'
      ? trimNonNbsp(renderTable(node.target, ctx))
      : trimNonNbsp(renderBlock(node.target, ctx))
}

function renderFootnoteDefs(ast: Document, ctx: MarkdownContext): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of footnoteDefsInSourceOrder(ast)) {
    // A label is author content, and it is reproduced verbatim in two places;
    // both escape, so a reference still matches its definition (carve-js#894).
    out += `${withMarker(`[^${escapeMdHtml(stripControls(label))}]: `, containerContent(() => inOwnContainer(ctx, () => outsideLink(() => renderBlocks(blocks, ctx)))))}\n`
  }
  return out
}

function renderInlines(nodes: InlineNode[], ctx: MarkdownContext): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    const parts = nodes.map((node) => renderInline(node, ctx))

    return reflankRuns(nodes, parts)
  } finally {
    ctx.inlineDepth--
  }
}

function renderInline(node: InlineNode, ctx: MarkdownContext): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  switch (node.type) {
    case 'text':
      return escapeUnresolvedCrossrefs(cleanEscapedText(node))
    case 'escaped_text':
      // Reproduce the author's escape where it protects something ON THIS
      // TARGET. `\-\-` was written precisely so a downstream processor with
      // smart punctuation on would not read an en dash; emitting the character
      // bare loses exactly that (carve#350), so the triggers section 8 names
      // are kept whatever their position.
      //
      // PART 11 section 8b narrows the rest, on the finding section 8a already
      // states. M2a: a character this target's readers never read as markup is
      // emitted BARE, which is Carve's own delimiters. M2b: the hash is read
      // as markup only where it would open an ATX heading, so it takes a
      // sentinel and is decided on the line like M1b's candidates.
      //
      // Every character Markdown CAN read keeps M2 as written. The bracket in
      // particular keeps its escape at every position, which is what leaves
      // section 8a's argument about the two link grammars standing: an author
      // who meant `[a](b)` as text still gets it back.
      if (AUTHORED_INERT.has(node.value)) return node.value
      if (node.value in AUTHORED_SENTINEL) return positionalHash()
      return '\\' + node.value
    case 'emphasis':
    case 'strong':
    case 'strike': {
      const run = DELIMITER_RUN[node.type]!

      return padOutside(renderInlines(node.children, ctx), run.delimiter, run.tag)
    }
    case 'underline':
      return `<u>${renderInlines(node.children, ctx)}</u>`
    case 'subscript':
      // Subscript is NOT strikethrough; mirror super's inline-HTML fallback.
      return `<sub>${renderInlines(node.children, ctx)}</sub>`
    case 'superscript':
      return `<sup>${renderInlines(node.children, ctx)}</sup>`
    case 'highlight':
      return `<mark>${renderInlines(node.children, ctx)}</mark>`
    case 'code':
      return renderCode(stripControls(node.value))
    case 'link':
      // An unresolved reference is literal source, not a link (PART 12 §3a):
      // the node survives serialization so the reference is not lost from the
      // tree, and every render target writes it back out as written.
      if (isUnresolvedReference(node)) return escapeText(referenceSourceText(node.rawRef))
      // Links never nest at the render seam (PART 12 §3a,
      // markup-carve/carve#817). The node stays in the tree as written, but
      // only the outermost destination reaches rendered Markdown.
      if (insideLink) return renderInlines(node.children, ctx)
      return renderLink(node, ctx)
    case 'image':
      return renderImage(node)
    case 'span': {
      // PART 9 §10 + carve#1127: an authored `abbr` OUTRANKS automatic
      // expansion, and a resolved abbreviation inside such a span contributes
      // only its visible text - a renderer must not emit the nested expansion.
      // The HTML target already did this; markdown and ansi emitted the
      // DEFINITION's text instead, so `[HTML]{abbr="Custom"}` under a
      // `*[HTML]: Hyper Text Markup Language` line came out with the wrong
      // title on two of five targets (carve#1176).
      const authoredAbbr = node.attrs?.keyValues?.abbr
      if (authoredAbbr !== undefined) {
        const previous = suppressAutomaticAbbreviation
        suppressAutomaticAbbreviation = true
        try {
          const inner = renderInlines(node.children, ctx)
          if (authoredAbbr === '') return inner
          if (!ctx.abbrBudget.charge(utf8ByteLength(authoredAbbr))) return inner
          const title = escapeMdHtml(stripControls(authoredAbbr)).replace(/"/g, '&quot;')

          return `<abbr title="${title}">${inner}</abbr>`
        } finally {
          suppressAutomaticAbbreviation = previous
        }
      }

      return renderInlines(node.children, ctx)
    }
    case 'ruby': {
      const attrs = renderHtmlAttrs(node.attrs)
      return `<ruby${attrs}>${node.pairs.map((pair) => `${renderInlines(pair.base, ctx)}<rp>(</rp><rt>${renderInlines(pair.annotation, ctx)}</rt><rp>)</rp>`).join('')}</ruby>`
    }
    case 'small_caps': {
      const attrs: Attrs = {
        ...node.attrs,
        classes: ['smallcaps', ...(node.attrs?.classes ?? []).filter((name) => name !== 'smallcaps')],
      }
      return `<span${renderHtmlAttrs(attrs)}>${renderInlines(node.children, ctx)}</span>`
    }
    case 'math': {
      // Escaped, exactly as the HTML target escapes the same content: a
      // consumer decodes the entity back to the character before its math
      // renderer sees it, so `a < b` still reaches KaTeX as `a < b` while
      // `<script>` cannot become a tag (markup-carve/carve-js#894).
      const math = escapeMdHtml(stripControls(node.content))

      const suffix = node.number === undefined ? '' : ` ${escapeText(stripControls(node.label!))} ${node.number}`
      return (node.display ? `$$${math}$$` : `$${math}$`) + suffix
    }
    case 'raw_inline':
      if (node.format !== 'html') {
        rawFormatDropped(ctx.options, node, 'markdown')
        return ''
      }
      return escapeMdHtml(stripControls(node.content))
    case 'literal_inline':
      // §27: emitted by EVERY renderer, never dropped. It is prose, not code,
      // so no code fence -- the content becomes literal text, with Markdown
      // metacharacters escaped so `*not bold*` stays visible as authored.
      return escapeText(node.content)
    case 'symbol':
      return `:${stripControls(node.name)}:`
    case 'autolink': {
      // Visible text is the raw autolink content (an email autolink shows the
      // address, not the `mailto:` href); fall back to href for older nodes.
      const label = stripControls(node.text ?? node.href)
      // Same render-seam rule as nested links above. Strip an auto-added
      // `mailto:` so the label matches what the author saw
      // (markup-carve/carve#817).
      if (insideLink) {
        const display = node.href.startsWith('mailto:') ? node.href.slice(7) : label
        return escapeText(stripControls(display))
      }
      return `[${label}](${markdownDestination(node.href)})`
    }
    case 'mention':
      return `@${stripControls(node.user)}`
    case 'tag':
      return escapeText(`#${stripControls(node.name)}`)
    case 'inline_extension':
      return renderInlines(node.content, ctx)
    case 'abbreviation': {
      // Markdown has no abbreviation syntax; emit an HTML `<abbr>` so the title
      // survives (markdown allows inline HTML), matching carve-php. Dropping it
      // to plain text would lose the expansion.
      const text = escapeMdHtml(stripControls(node.abbr))
      // Inside a span carrying its own `abbr`, only the visible text (carve#1127).
      if (suppressAutomaticAbbreviation) return text
      // DoS guard: once cumulative expansion bytes exceed the budget, degrade
      // to the plain key text only (no <abbr>, no title).
      if (!ctx.abbrBudget.charge(utf8ByteLength(node.expansion))) return text
      // The attribute context needs the quote too; the other three characters
      // come from the one helper.
      const title = escapeMdHtml(stripControls(node.expansion)).replace(/"/g, '&quot;')
      return `<abbr title="${title}">${text}</abbr>`
    }
    case 'footnote_ref':
    case 'inline_footnote': {
      if (node.inline) {
        const inline = node.inline
        return `^[${outsideLink(() => renderInlines(inline, ctx))}]`
      }
      const id = stripControls(node.id ?? '')
      // An UNRESOLVED reference did not form a footnote, so what is emitted is
      // ordinary text -- and its brackets are Markdown metacharacters, which
      // PART 11 section 8 M1 escapes UNCONDITIONALLY. Emitting them bare handed
      // the re-parser markup the document never had. carve-php already did this
      // (carve#352, corpus 132/133/157/161).
      // Escaped like the definition above, so the pair still matches. The
      // UNRESOLVED branch escaped its BRACKETS, because they are Markdown
      // metacharacters, and skipped the HTML - the escape decision was being
      // made for one and not the other (carve-js#894).
      if (!ctx.definedFootnotes.has(id)) return `\\[^${escapeMdHtml(id)}\\]`
      return `[^${escapeMdHtml(id)}]`
    }
    case 'non_breaking_space':
      return '\u00a0'
    case 'soft_break':
      return '\n'
    case 'hard_break':
      // A BACKSLASH, not two trailing spaces (PART 11 section 9). Both mean
      // `<br />` to a CommonMark reader, but trailing whitespace is removed by
      // editors that strip on save, by `git apply --whitespace=fix` and by CI
      // whitespace checks - and losing ONE of the two spaces is enough for the
      // break to vanish rather than degrade, silently, in a file nobody edited.
      // In a table cell the newline would end the GFM row (PART 11 section 9a).
      return insideTableCell ? '<br>' : '\\\n'
    case 'insert':
      return `<ins>${renderInlines(node.children, ctx)}</ins>`
    case 'delete':
      return `<del>${renderInlines(node.children, ctx)}</del>`
    case 'substitution':
      // Emit BOTH sides like the HTML renderer; dropping the old half loses content.
      return `<del>${renderInlines(node.old, ctx)}</del><ins>${renderInlines(node.new, ctx)}</ins>`
    case 'critic_comment':
      // Visible content: the HTML target renders it as
      // `<span class="critic-comment"> note </span>`, so dropping it here made two
      // targets of one engine disagree about whether the document says it. Markdown
      // has no critic syntax, so the text is what degrades gracefully -- and it is
      // escaped like any other text, since it lands in a Markdown document.
      // carve-php kept it (carve#352, corpus 33-editorial-markup); the plain and
      // ANSI targets were fixed in carve-js#429.
      return escapeText(node.text)
    case 'heading_ref': {
      // UNRESOLVED: the authored marker, kept readable rather than escaped into
      // noise - a reader can still act on `</#nope>`. The TARGET inside it is
      // author content and can hold a `<`, and `</#a<script>` is a complete
      // opening tag once this Markdown is rendered, so the target takes the
      // HTML pass while the writer's own delimiters stay literal (carve-js#894).
      if (!node.href) return `</#${escapeMdHtml(stripControls(node.target))}>`
      // IN THE LINK CONTEXT, always: the display text either lands inside this
      // crossref's own Markdown link below, or inside an enclosing one. Either
      // way a link cloned in from the target heading may not nest, and the
      // resolver no longer unwraps the clone before the renderer sees it
      // (PART 12 §3a, markup-carve/carve#817).
      // Same expansion budget the abbreviation arm spends, degrading to the
      // authored target (markup-carve/carve-js#892). See abbr-budget.ts.
      const rendered = withinLink(() => renderInlines(node.resolvedText ?? [], ctx))
      const crossrefText = ctx.abbrBudget.charge(utf8ByteLength(rendered))
        ? rendered
        : escapeText(node.target)
      // Inside a link's text, and for a target this format cannot anchor: the
      // display text alone. Markdown can carry `{#id}` on a heading and
      // nothing else, so a crossref to a figure or a table renders as the
      // words it resolved to - the same rule `renderLink` applies to an
      // ordinary `#fragment` link.
      const crossrefId = fragmentId(node.href)
      const crossrefSlug = crossrefId === undefined ? undefined : ctx.headingSlugs.get(crossrefId)
      if (insideLink || crossrefSlug === undefined) return crossrefText
      // Resolved: the Markdown link this crossref always rendered as. The
      // authored `</#target>` stays in the tree (PART 12 §3a); only this
      // target's OUTPUT resolves it.
      return `[${crossrefText}](#${crossrefSlug})`
    }
    case 'caption_number':
      // An unnumbered placeholder is a literal `#`, and M1f decides it like one.
      return node.n === undefined ? positionalHash() : String(node.n)
    case 'citation_group':
      // Tier-2 ext node; the core renderer has no numbering, so emit the source.
      return stripControls(node.raw)
    case 'comment':
      return ''
    case 'smart_punctuation':
      // Source mode reproduces what the author typed; the glyph is a
      // presentation choice a machine consumer cannot reverse.
      // STRIPPED LIKE EVERY OTHER AUTHOR FIELD. Both branches emit a value
      // off the node, and a stored tree can carry anything in it - including a
      // sentinel from the range below, which the resolve pass would then read
      // as an escape decision and write out as a backslash the document never
      // held. `code` has always stripped for the same reason.
      return stripControls(
        ctx.smartTypography === 'source'
          ? node.value
          : (node.glyph ?? SMART_PUNCTUATION_GLYPHS[node.kind] ?? node.value),
      )
    default: {
      const t: never = node
      throw new Error(`renderMarkdown: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

/** See the note on the same pair in render-html.ts. */
let insideLink = false

function withinLink<T>(fn: () => T): T {
  const previous = insideLink
  insideLink = true
  try {
    return fn()
  } finally {
    insideLink = previous
  }
}

function outsideLink<T>(fn: () => T): T {
  const previous = insideLink
  insideLink = false
  try {
    return fn()
  } finally {
    insideLink = previous
  }
}

let insideTableCell = false

function withinTableCell<T>(fn: () => T): T {
  const previous = insideTableCell
  insideTableCell = true
  try {
    return fn()
  } finally {
    insideTableCell = previous
  }
}

function renderLink(node: Link, ctx: MarkdownContext): string {
  // Markdown has no nested links either: `[see [H](#H)](/outer)` is not a link
  // with a link inside, it is broken. A crossref in the label renders as its
  // text, the same suppression the HTML target makes.
  const text = withinLink(() => renderInlines(node.children, ctx))
  // A fragment that names no heading is still the author's destination, so the
  // link is kept (PART 11 section 11a).
  const id = fragmentId(node.href)
  const slug = id === undefined ? undefined : ctx.headingSlugs.get(id)
  const destination = slug !== undefined ? `#${slug}` : markdownDestination(node.href)
  return node.title === undefined
    ? `[${text}](${destination})`
    : `[${text}](${destination} "${escapeMdTitle(node.title)}")`
}

function renderImage(node: Image): string {
  // An unresolved reference image writes back as its source, like the link
  // arm above; `![alt]()` would claim an image the document never had.
  // UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
  // `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref
  // no longer answers this question (carve#596).
  if (isUnresolvedReference(node)) return escapeText(referenceSourceText(node.rawRef))
  const src = markdownDestination(node.src)
  const alt = escapeMarkdownLabel(node.alt)
  return node.title === undefined
    ? `![${alt}](${src})`
    : `![${alt}](${src} "${escapeMdTitle(node.title)}")`
}

function markdownFenceInfo(
  lang: string | undefined,
  header: string | undefined,
  label: string | undefined,
): string {
  // Keep only the first whitespace-delimited token (the language word); drop it
  // if it still contains a backtick (would break the fence).
  // The info token ends at PART 7's four characters, as it does in the
  // canonical writer's escapeFenceToken.
  const rawToken = lang === undefined ? '' : (stripControls(lang).split(/[ \t\n\r]/)[0] ?? '')
  const token = rawToken.includes('`') ? '' : rawToken
  // A grouping `[label]` rides along after the language and title. Dropping it
  // was silent data loss: an info string is free-form after the first word, so
  // every consumer ignores what it does not understand, and carve-php was
  // already emitting it (carve#352).
  const grouping =
    label === undefined || label === '' ? '' : ` [${stripControls(label).replace(/[[\]`]/g, '')}]`
  // A title needs a LANGUAGE in front of it. In Markdown the info string's first
  // token IS the language, so `` ``` "notes.txt" `` makes a CommonMark reader
  // emit `class="language-&quot;notes.txt&quot;"` -- measured against
  // commonmark.js. Markdown has no way to express a fence title on its own, so
  // dropping it beats emitting a bogus language; with a language present the
  // title is ignored by every consumer and rides along safely. carve-php had this
  // guard and was right about it (carve#352, corpus 11-fenced-code-8).
  if (header === undefined || token === '') return `${token}${grouping}`
  return `${token} "${escapeMdTitle(header)}"${grouping}`
}

function escapeMarkdownLabel(text: string): string {
  return stripControls(text).replace(/[\\[\]]/g, '\\$&')
}

function escapeMdTitle(title: string): string {
  return stripControls(title).replace(/[\\"]/g, '\\$&')
}

function safeFence(content: string, min: number): string {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(min, longest + 1))
}

function renderCode(content: string): string {
  const fence = safeFence(content, 1)
  return content.startsWith('`') || content.endsWith('`')
    ? `${fence} ${content} ${fence}`
    : `${fence}${content}${fence}`
}

/**
 * The GFM slug of every heading this target writes, keyed by the Carve id the
 * document assigned it (PART 11 section 11, G1-G5). The walk follows the
 * written order and skips table cells, which flatten their headings.
 */
function gfmHeadingSlugs(blocks: BlockNode[], typography: SmartTypographyMode): Map<string, string> {
  const slugs = new Map<string, string>()
  const counts = new Map<string, number>()
  const taken = new Set<string>()
  const visit = (nodes: BlockNode[], depth: number): void => {
    if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
    for (const block of nodes) {
      switch (block.type) {
        case 'heading': {
          const base = gfmSlugBase(inlineText(writtenTypography(block.children, typography)))
          let slug = base
          if (taken.has(slug)) {
            let count = counts.get(base) ?? 0
            do {
              count++
              slug = `${base}-${count}`
            } while (taken.has(slug))
            counts.set(base, count)
          }
          taken.add(slug)
          const id = block.attrs?.id
          if (id !== undefined && !slugs.has(id)) slugs.set(id, slug)
          break
        }
        case 'block_quote':
        case 'admonition':
        case 'directive':
        case 'div':
        case 'section':
        case 'line_block':
        case 'figure_group':
          visit(block.children, depth + 1)
          break
        case 'list':
          for (const item of block.items) visit(item.children, depth + 1)
          break
        case 'definition_list':
          for (const item of block.items) for (const def of item.definitions) visit(def, depth + 1)
          break
        case 'figure':
          if (block.target.type === 'block_quote') visit(block.target.children, depth + 1)
          break
        default:
          break
      }
    }
  }
  visit(blocks, 0)
  return slugs
}

/** G1-G4: the text a GFM reader slugs, lowercased, stripped and hyphenated. */
function gfmSlugBase(text: string): string {
  return text
    .normalize('NFC')
    .replace(/^[ \t\n]+|[ \t\n]+$/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** A heading's inlines with smart punctuation spelled the way this target writes it. */
function writtenTypography(nodes: InlineNode[], typography: SmartTypographyMode): InlineNode[] {
  if (typography !== 'source') return nodes
  return JSON.parse(JSON.stringify(nodes), (_key, value) =>
    value && value.type === 'smart_punctuation' ? { type: 'text', value: value.value } : value,
  ) as InlineNode[]
}

/**
 * Encode a destination for the Markdown output, refusing a denied scheme.
 *
 * The order is the whole point. This writer NORMALIZES the destination before
 * it emits it - it drops control characters, and its consumer decodes character
 * references - so the probe has to run on the normalized form. Probing the
 * authored form and normalizing afterwards means the writer itself
 * manufactures the live URL out of one the probe had already dismissed
 * (markup-carve/carve-js#893).
 */
function markdownDestination(url: string): string {
  const probed = sanitizeMdUrl(stripDestinationControls(url))
  const encoded = (probed === '' ? probed : stripControls(url)).replace(/[ ()<>]/g, (ch) => {
    switch (ch) {
      case ' ':
        return '%20'
      case '(':
        return '%28'
      case ')':
        return '%29'
      case '<':
        return '%3C'
      case '>':
        return '%3E'
      default:
        return ch
    }
  })

  // 2. Neutralize character references, so the bytes the consumer resolves are
  //    the bytes probed in step 1.
  return neutralizeCharRefs(encoded)
}

/**
 * Escape every ampersand that OPENS an HTML character reference.
 *
 * A CommonMark consumer decodes character references inside a link
 * destination, so `&#106;avascript:alert1` reaches the browser as
 * `javascript:alert1` - a scheme the probe never saw, because the probe reads
 * the authored bytes. `&#x6A;` and `javascript&colon;alert1` are the same trick
 * (the second hides the colon, so there is no scheme to find at all).
 *
 * Escaping the ampersand rather than percent-encoding it is what keeps this
 * honest: percent-encoding `&` would corrupt every legitimate query string,
 * while `&amp;` decodes back to `&` in the consumer, so the URL it resolves is
 * byte-for-byte the one probed here. It also stops the consumer from silently
 * rewriting an authored `&#106;` into `j`. An ampersand that opens nothing
 * (`?a=1&b=2`) is left exactly as authored.
 *
 * The three forms a consumer decodes are `&#DIGITS;`, `&#xHEXDIGITS;` and
 * `&NAME;`. An unknown NAME counts too - a consumer leaves it alone either way,
 * so escaping it changes nothing a reader sees, and guessing which names are
 * known would be a second denylist to keep in step with three engines.
 */
const CHAR_REF_OPENER_RE = /&(?=#[0-9]{1,8};|#[xX][0-9a-fA-F]{1,8};|[a-zA-Z][a-zA-Z0-9]{0,31};)/g

function neutralizeCharRefs(url: string): string {
  return url.replace(CHAR_REF_OPENER_RE, '&amp;')
}

function fragmentId(href: string): string | undefined {
  return href.startsWith('#') ? href.slice(1) : undefined
}

/**
 * Escape a text value, leaving any UNRESOLVED crossref in it verbatim.
 *
 * `</#nope>` is source the resolver declined, and escaping it to
 * `&lt;/\#nope&gt;` turns a marker a reader can still act on into noise.
 *
 * The test used to be anchored - the whole text node had to BE the crossref -
 * which quietly depended on the resolver leaving it in a text node of its own.
 * PART 12 §1a coalesces adjacent runs, so it is now one node with the crossref
 * in the middle of it (carve-js#549), and an anchored test stopped matching.
 * Scanning the value works either way and does not care how the run was split.
 */
function escapeUnresolvedCrossrefs(value: string): string {
  // The SAME production as the parser's RE_CROSSREF, so the same class: the id
  // ends at PART 7's four characters. Two producers for one production is how
  // this class of defect starts, so they are narrowed together.
  const pattern = /<\/#[^> \t\n\r]+>/g
  let out = ''
  let last = 0
  for (const match of value.matchAll(pattern)) {
    out += escapeText(value.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + escapeText(value.slice(last))
}

function escapeText(text: string): string {
  text = stripControls(text)
  // Neutralize embedded HTML so Markdown re-rendered to HTML cannot execute it:
  // carve's "HTML is text" guarantee holds for the Markdown target too.
  //
  // ONLY `<` AND `>` DO THAT WORK. A bare `&` cannot open a tag: an entity in
  // Markdown TEXT decodes to a CHARACTER, and a character in text content is
  // escaped again by whatever writes the HTML. Measured against pandoc 3.5,
  // commonmark.js and marked with raw HTML ALLOWED - the entity and bare forms
  // came out byte-identical and inert, while a bare `<` was live in all three.
  //
  // Escaping every ampersand cost every document its spelling for nothing:
  // `Aktionen & Reaktionen` came back as `Aktionen &amp; Reaktionen`, and on one
  // real corpus 324 of 423 escaped characters were ampersands (carve#1071).
  //
  // NO EXCEPTION FOR A CHARACTER-REFERENCE OPENER, deliberately. Text authored
  // as `&#65;` is emitted as itself and a consumer may decode it. Escaping it
  // here would answer the question one node too early: whether an `&` opens a
  // reference depends on the EMITTED LINE, and Carve parses `#65` as a tag, so
  // this renderer sees `"a &"` and `"; b"` as separate text nodes. That is the
  // mistake section 8a documents for `_`, `#` and `[`, which is why those three
  // are emitted as sentinels and decided in normalize().
  // Escape Markdown metacharacters (none overlap with the angle brackets
  // handled below).
  // `_`, `#` and `[` are emitted as SENTINELS rather than as backslashes:
  // section 8a decides those three on the EMITTED LINE, which only normalize()
  // can see. `*` and everything else keep M1 here and unconditionally.
  //
  // THE HASH TAKES M1f's CARRIER, not M1b's. Its test is positional rather
  // than adjacency, and a container settles it at the prefix site.
  //
  // `~` IS ONE OF THEM. GFM's strikethrough extension pairs a run of ONE OR
  // TWO tildes, so a literal tilde in text is a Markdown metacharacter, and
  // 8a narrows only `_`, `#`, `[` and `<` - M1d leaves every other one on M1.
  // Unescaped, two literal tildes anywhere in one paragraph pair across
  // whatever markup stands between them and the tags interleave
  // (carve-js#1710); a single one pairs the same way for a reader that takes
  // the one-tilde form, which pulldown-cmark does.
  text = text.replace(/[\\`*_~[\]#]/g, (ch) => {
    if (ch === '#') return positionalHash()

    return NARROWED_SENTINEL[ch] ?? `\\${ch}`
  })
  // PART 11 section 8a M1e: a `<` is escaped only where the emitted line would
  // read it as markup - before an ASCII letter, `/`, `!` or `?`, the four
  // things that open raw HTML. Everything else is inert, and so is `>`
  // mid-line; at line start `>` is a block quote marker, escaped per line by
  // protectParagraphListMarkers.
  //
  // A BACKSLASH, not an entity. This wrote `&lt;`/`&gt;` unconditionally with no
  // clause behind it (carve#1148), and that is precisely because an entity is
  // not the operation this section describes: M2 and M3 protect a character so
  // it survives as itself, and `&lt;` replaces it instead. Escaping the `<`
  // alone suffices - a tag that cannot open cannot be closed.
  //
  // AFTER the metacharacter pass, so the backslash this inserts is not itself
  // escaped by it.
  //
  // PART 11 section 8d: the decision reads the EMITTED line, so a character
  // whose deciding neighbors run past the end of this text is left as a
  // carrier for `resolveContextEscapes`. Deciding everything else here keeps
  // the carriers rare, which matters on long runs of `!` or `&`.
  const hash = `[#${AUTHORED_SENTINEL['#']}]`
  text = text
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(new RegExp(`&(?=${hash}[0-9]{1,7};|${hash}[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]*;)`, 'g'), '\\&')
    .replace(/<$/, CONTEXT_SENTINEL['<']!)
    .replace(/!$/, CONTEXT_SENTINEL['!']!)
  const openReference = new RegExp(`&((?:${hash}(?:[0-9]{0,7}|[xX][0-9a-fA-F]{0,6})|[A-Za-z][A-Za-z0-9]*)?)$`)

  return text.replace(openReference, `${CONTEXT_SENTINEL['&']}$1`)
}

/**
 * No space or tab at either edge of a paragraph line (PART 11 section 10m): four
 * leading columns open an indented code block and two trailing spaces make a
 * hard break. A trailing hard-break backslash stays the line's last character,
 * and a line left empty is dropped, since it would end the paragraph.
 */
function trimParagraphLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')
      const run = /\\+$/.exec(trimmed)?.[0] ?? ''
      if (run.length % 2 === 0) return trimmed

      return `${trimmed.slice(0, -1).replace(/[ \t]+$/, '')}\\`
    })
    .filter((line, i, lines) => line !== '' || i === 0 || i === lines.length - 1)
    .join('\n')
}

/**
 * Keep paragraph lines from opening a list or a block quote in Markdown readers.
 * A `>` opens a quote with or without a following space.
 */
function protectParagraphListMarkers(text: string): string {
  let codeFence = 0
  const lines = text.split('\n')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex]!
    if (codeFence === 0) {
      line = line
        .replace(/^([ \t]{0,3})([-+])(?=[ \t])/, '$1\\$2')
        .replace(/^([ \t]{0,3}\d{1,9})([.)])(?=[ \t])/, '$1\\$2')
        .replace(/^([ \t]{0,3})>/, '$1\\>')
      line = protectBlockShapes(line, lineIndex === 0)
      lines[lineIndex] = line
    }

    for (let i = 0; i < line.length; ) {
      if (line[i] !== '`') {
        i++
        continue
      }
      let backslashes = 0
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++
      let run = 1
      while (line[i + run] === '`') run++
      if (backslashes % 2 === 0) {
        if (codeFence === 0) codeFence = run
        else if (codeFence === run) codeFence = 0
      }
      i += run
    }
  }

  return lines.join('\n')
}

/**
 * PART 11 section 8g: a paragraph line must not read as a thematic break (T1),
 * a setext underline (T2, below the first line) or an empty list item (T3, on
 * the first line). `_` and `#` are still carriers here, so they are read as the
 * characters they stand for.
 */
function protectBlockShapes(line: string, first: boolean): string {
  const view = line.replace(RE_ANY_SENTINEL, sentinelCharacter)
  const match = /^([ \t]{0,3})(\S)/.exec(view)
  if (!match) return line
  const at = match[1]!.length
  const content = view.slice(at)
  const thematic = /^([-_*])(?:[ \t]*\1){2,}[ \t]*$/.test(content)
  const setext = !first && /^(?:=+|-+)[ \t]*$/.test(content)
  if (thematic || setext) return `${line.slice(0, at)}\\${sentinelCharacter(line[at]!)}${line.slice(at + 1)}`
  if (first) {
    const bare = /^(?:([-+])|\d{1,9}([.)]))[ \t]*$/.exec(content)
    if (bare) {
      const escapeAt = bare[1] !== undefined ? at : at + content.search(/[.)]/)

      return `${line.slice(0, escapeAt)}\\${line.slice(escapeAt)}`
    }
  }
  return line
}

/**
 * Dangerous URL schemes blanked on Markdown link/image destinations.
 *
 * The set and the probe come from the HTML renderer rather than being restated
 * here. A local copy listed only the four script/inline-content/local-file
 * schemes and probed with an ASCII-only strip, so the twenty OS
 * protocol-handler schemes -- `ms-msdt`, `search-ms`, `jar`, `vscode` and the
 * rest -- survived into Markdown, and from there into whatever renders it. That
 * is not a narrower policy, it is the same sink one step removed (PART 9 §25,
 * carve#385).
 */
function sanitizeMdUrl(url: string): string {
  return blankDeniedDestination(url)
}

/**
 * Drop what this target cannot carry, from author content on its way to the
 * output.
 */
function stripControls(s: string): string {
  return s.replace(/[\u000d\u007f-\u009f]/gu, '')
}

/**
 * The BROAD strip, for a URL on its way through the denied-scheme probe.
 *
 * This is not the emit path and does not answer \u00a729. It exists because the probe
 * once skipped only up to U+001F plus whitespace, so a destination had to reach
 * it with DEL and the C1 range already gone or `java<DEL>script:` walked through
 * - the defect markup-carve/carve-js#893 fixed by strip-then-probe.
 *
 * The probe class itself now spans DEL and the C1 block
 * (markup-carve/carve-js#915), so this call is no longer the only thing standing
 * between a split scheme and the denylist. It stays anyway: it is one layer and
 * the probe class is another. Narrowing THIS call along with the emit path would
 * still be wrong, so the two remain separate functions rather than one with a
 * flag.
 */
function stripDestinationControls(s: string): string {
  return s.replace(/\p{Cc}/gu, (c) => (c === '\t' || c === '\n' ? c : ''))
}

/** Escape `<>&` so embedded raw HTML cannot become live markup downstream. */
function escapeMdHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cleanEscapedText(node: Text): string {
  // The value is the literal text (the parser already resolved backslash
  // escapes), so a `\*` reaches here as `*`. Return it verbatim -- dropping the
  // character would lose data. Markdown re-escapes specials via escapeText;
  // plain/ansi need no escaping.
  return node.value
}

/**
 * Carriers standing in for the escapes section 8a decides on the LINE.
 *
 * One per narrowed character, and they are CHOSEN PER DOCUMENT from code points
 * it does not contain.
 *
 * They used to be the fixed U+E004..U+E008, and author content was kept off them
 * by DELETING that range on the way in - so an author who wrote one of the five
 * lost it, on this target and no other. PART 9 section 29 had already settled
 * that question for the C0 controls: every character that is not one of the four
 * whitespace characters is content (PART 7), and a target that silently deletes
 * content is the lossy party rather than the safe one (carve-js#1281).
 *
 * Picking them removes the collision instead of deleting around it, and takes
 * the strip with it: a code point the document does not contain cannot arrive in
 * author content, so there is nothing on the way in to drop.
 */
let NARROWED_SENTINEL: Record<string, string> = {}
let NARROWED_CHARACTER: Record<string, string> = {}

/**
 * PART 11 section 8b M2a: characters this target's readers never read as
 * markup, at ANY position on the line.
 *
 * An `escaped_text` node holding one of these is emitted BARE. They are
 * Carve's own delimiters and Markdown has no reading for them, so the escape
 * protects nothing and lands inside an identifier.
 *
 * The tilde is NOT here: GFM reads a single-tilde pair as strikethrough. Nor
 * are the smart-punctuation triggers, which section 8b keeps whatever their
 * position, because a processor with substitution on rewrites the TEXT rather
 * than reading markup.
 */
const AUTHORED_INERT = new Set(['{', '}', '^', ',', '%', ':', '/', '@'])

/**
 * PART 11 section 8a M1f and section 8b M2b: a `#` is read as markup only at a
 * line's CONTENT POSITION, where it opens an ATX heading.
 *
 * A second sentinel family, extending the run above. Separate from
 * NARROWED_SENTINEL because the two are decided by DIFFERENT tests: M1b asks
 * about an adjacent delimiter of the same character, M1f and M2b ask where on
 * the line the character stands.
 */
let AUTHORED_SENTINEL: Record<string, string> = {}

/**
 * Hashes emitted since the enclosing container started, so a container that
 * emitted none skips the position pass instead of scanning its subtree.
 *
 * Module state, like the carriers above, because every producer must be
 * counted and `escapeText` has no context to reach for.
 */
let hashesEmitted = 0

/** Emit a `#` as the undecided carrier, counted. */
function positionalHash(): string {
  hashesEmitted++

  return AUTHORED_SENTINEL['#']!
}

/**
 * The same hash once M2b HAS decided to keep its escape.
 *
 * A second state rather than a second character, and the state is what makes
 * the decision survive its containers. M2b measures on the EMITTED LINE, so it
 * is answered where the block writes its own line and BEFORE any enclosing
 * container puts a prefix in front of it. A container that renders inlines of
 * its own - an admonition title, a table cell, a definition term - runs the
 * decision pass again over text that already holds its children's answers, and
 * by then the line it would measure on carries the prefix. An undecided
 * sentinel would be re-read there and the quote marker would take the escape
 * straight back off (markup-carve/carve#1330). This one is inert to the pass.
 *
 * IT IS ONE UTF-16 UNIT, exactly like the undecided form and like the bare
 * character both stand for. The pass rewrites in place, so every offset in the
 * text is unchanged and M1b's view of the line is the view it had before -
 * spelling the decision as the two characters `\#` instead would shift every
 * later candidate on the line and change M1b's answers with it.
 */
let AUTHORED_KEPT = ''
let AUTHORED_CHARACTER: Record<string, string> = {}
let RE_NARROWED_SENTINEL = /(?!)/g
let HAS_NARROWED_SENTINEL = /(?!)/
let RE_UNDECIDED_HASH = /(?!)/g
let HAS_UNDECIDED_HASH = /(?!)/

/**
 * The carriers this document uses, one run of four.
 *
 * Slots, in order: section 8a M1b's two adjacency narrowings - `_` and `[` -
 * then the undecided hash and the same hash once its position test has decided
 * to KEEP the escape. The last two are one character apart on purpose; see
 * AUTHORED_KEPT above.
 *
 * ONE HASH CARRIER SERVES BOTH SIDES. M1f and M2b ask the same positional
 * question, so a `#` from a text node and one from an `escaped_text` node are
 * decided alike and need no separate slot.
 *
 * The run is picked from code points the DOCUMENT does not contain, so no
 * authored character can be read as one and none has to be deleted to make that
 * true. The canonical writer's run is picked the same way and is deliberately
 * NOT the same run: the two never overlap in time, and one shared run would make
 * a slot added on either side a renumbering on the other (see sentinel-run.ts).
 */
/**
 * Carriers for the escapes decided by the characters that FOLLOW on the emitted
 * line, whichever node writes them (PART 11 section 8d): `<` before a tag or
 * autolink opener (M1e), `&` completing a character reference (section 8e) and
 * `!` before a link opener the writer emits (section 8f).
 */
let CONTEXT_SENTINEL: Record<string, string> = {}
let CONTEXT_CHARACTER: Record<string, string> = {}
let RE_CONTEXT_SENTINEL = /(?!)/g
let HAS_CONTEXT_SENTINEL = /(?!)/
let RE_ANY_SENTINEL = /(?!)/g

const CARRIER_BASE = 0xe004
const CARRIER_COUNT = 7

function setCarriers(run: string[]): void {
  const [underscore, bracket, undecidedHash, keptHash, lt, amp, bang] = run as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  CONTEXT_SENTINEL = { '<': lt, '&': amp, '!': bang }
  CONTEXT_CHARACTER = { [lt]: '<', [amp]: '&', [bang]: '!' }
  RE_CONTEXT_SENTINEL = new RegExp(`[${lt}${amp}${bang}]`, 'g')
  HAS_CONTEXT_SENTINEL = new RegExp(`[${lt}${amp}${bang}]`)
  RE_ANY_SENTINEL = new RegExp(`[${run[0]}-${run[CARRIER_COUNT - 1]}]`, 'g')

  NARROWED_SENTINEL = { _: underscore, '[': bracket }
  NARROWED_CHARACTER = { [underscore]: '_', [bracket]: '[' }
  AUTHORED_SENTINEL = { '#': undecidedHash }
  AUTHORED_KEPT = keptHash
  AUTHORED_CHARACTER = { [undecidedHash]: '#', [keptHash]: '#' }
  RE_NARROWED_SENTINEL = new RegExp(`[${run[0]}-${run[3]}]`, 'g')
  HAS_NARROWED_SENTINEL = new RegExp(`[${run[0]}-${run[3]}]`)
  RE_UNDECIDED_HASH = new RegExp(undecidedHash, 'g')
  HAS_UNDECIDED_HASH = new RegExp(undecidedHash)
}

/** Pick this document's carriers. Called once, before anything is rendered. */
function chooseCarriers(ast: Document): void {
  setCarriers(pickSentinelRun(occupiedPrivateUse(ast), CARRIER_BASE, CARRIER_COUNT))
  hashesEmitted = 0
}

setCarriers(pickSentinelRun(new Set(), CARRIER_BASE, CARRIER_COUNT))

/** The bare character a sentinel stands for, for every pass that builds a line view. */
function sentinelCharacter(s: string): string {
  return NARROWED_CHARACTER[s] ?? AUTHORED_CHARACTER[s] ?? CONTEXT_CHARACTER[s] ?? s
}


const CHARACTER_REFERENCE = /^&(?:#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]*;)/

function resolveContextEscapes(text: string): string {
  if (!HAS_CONTEXT_SENTINEL.test(text)) return text
  const line = text.replace(RE_ANY_SENTINEL, sentinelCharacter)

  return text.replace(RE_CONTEXT_SENTINEL, (s, offset: number) => {
    const ch = CONTEXT_CHARACTER[s]!
    let keep: boolean
    if (ch === '<') keep = /[A-Za-z/!?]/.test(line[offset + 1] ?? '')
    else if (ch === '&') keep = CHARACTER_REFERENCE.test(line.slice(offset, offset + 40))
    // A `[` still standing in the output is markup: a text bracket is a carrier
    // here and an authored one is behind its backslash.
    else keep = text[offset + 1] === '['

    return keep ? `\\${ch}` : ch
  })
}

/**
 * Whether the candidate at `i` is ADJACENT to an unescaped delimiter of the
 * same character, on the line the writer is building (PART 11 section 8a M1b).
 *
 * `line` is the assembled output with every candidate resolved to its BARE
 * character, so it is the line as it reads if nothing is escaped, and an offset
 * in it is an offset in the text being rewritten. "On the emitted line" needs
 * no line splitting: a neighbour across a newline is a newline, which is never
 * the same character.
 *
 * A neighbour BEFORE the candidate counts only if it is not itself behind a
 * backslash - the clause's "not behind a backslash" - so the run of backslashes
 * in front of it is counted and an odd run disqualifies it. A neighbour AFTER
 * never can be: the character in front of it is the candidate itself.
 */
/**
 * Every live `_` on the line a reader could pair into emphasis, by CommonMark
 * 6.2 read for the underscore: a run that both flanks can neither open nor
 * close, which is what leaves `company_id` alone.
 *
 * ONE SCAN FOR THE WHOLE LINE, taken by the caller before it walks the
 * candidates. Asking per candidate costs a walk of the line each time, and a
 * memo keyed on the line only moves that cost into the comparison.
 */
function pairableUnderscores(line: string): Set<number> {
  const open: number[] = []
  const close: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '_' || !liveAt(line, i)) continue
    const before = lastCharacter(line.slice(Math.max(0, i - 2), i))
    const after = firstCharacter(line.slice(i + 1, i + 3))
    const beforeSpace = before === '' || FLANK_SPACE.test(before)
    const afterSpace = after === '' || FLANK_SPACE.test(after)
    const beforePunct = before !== '' && FLANK_PUNCT.test(before)
    const afterPunct = after !== '' && FLANK_PUNCT.test(after)
    const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct)
    const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct)
    if (left && (!right || beforePunct)) open.push(i)
    if (right && (!left || afterPunct)) close.push(i)
  }
  // A pair needs an opener BEFORE a closer, so `x_ _y` has none: its closer
  // stands first. The two bounds are what decides it.
  const pairs = new Set<number>()
  const firstOpen = open.length > 0 ? open[0]! : Infinity
  const lastClose = close.length > 0 ? close[close.length - 1]! : -Infinity
  for (const i of open) if (i < lastClose) pairs.add(i)
  for (const i of close) if (i > firstOpen) pairs.add(i)

  return pairs
}

/**
 * M1b's pair condition is asked over the inline content the underscore is
 * emitted in - a paragraph, heading or table cell - so the scan is taken per
 * block (markup-carve/carve#2046, markup-carve/carve-js#1755).
 */
function pairableUnderscoresPerBlock(line: string): Set<number> {
  const pairs = new Set<number>()
  for (const block of inlineBlocks(line)) {
    // The ranges are joined by one space, which is what a line or cell
    // boundary is to the reader, and the offsets are mapped back.
    const chars: string[] = []
    const origin: number[] = []
    for (const [start, end] of block) {
      if (chars.length > 0) {
        chars.push(' ')
        origin.push(-1)
      }
      for (let i = start; i < end; i++) {
        chars.push(line[i]!)
        origin.push(i)
      }
    }
    for (const i of pairableUnderscores(chars.join(''))) {
      const at = origin[i]!
      if (at >= 0) pairs.add(at)
    }
  }

  return pairs
}

/**
 * The emitted document cut into the blocks M1b reads, each as the content
 * ranges of its lines: a blank line ends a block, a new list item starts one,
 * and every table cell is one of its own.
 *
 * A HEADING NEEDS NO CASE OF ITS OWN HERE, which carve-rs's port of this does
 * carry. This writer separates a heading from the block below it with a blank
 * line in every container except a tight list item, where the item marker is
 * the separator - so both rules above already cut there, and a heading case
 * would be a branch that cannot fire.
 */
function inlineBlocks(line: string): Array<Array<[number, number]>> {
  const blocks: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  const flush = () => {
    if (current.length > 0) {
      blocks.push(current)
      current = []
    }
  }

  let lineStart = 0
  while (lineStart <= line.length) {
    const newline = line.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? line.length : newline
    const content = Math.min(contentPosition(line, lineStart), lineEnd)
    const body = line.slice(content, lineEnd)
    if (/^ *$/.test(body)) {
      flush()
    } else if (body.startsWith('|')) {
      flush()
      let cell = content + 1
      for (let i = cell; i < lineEnd; i++) {
        if (line[i] === '\\') {
          i++
          continue
        }
        if (line[i] === '|') {
          blocks.push([[cell, i]])
          cell = i + 1
        }
      }
      if (cell < lineEnd) blocks.push([[cell, lineEnd]])
    } else if (startsAListItem(line, lineStart)) {
      flush()
      current.push([content, lineEnd])
    } else {
      current.push([content, lineEnd])
    }
    lineStart = lineEnd + 1
  }
  flush()

  return blocks
}

/** Where a line's own content begins, past every container prefix in front. */
function contentPosition(line: string, lineStart: number): number {
  let at = lineStart
  for (;;) {
    while (line[at] === ' ') at++
    const end = containerPrefixEnd(line, at)
    if (end === null) return at
    at = end
  }
}

/** One container prefix at `at`, and where it ends. See {@link contentPosition}. */
function containerPrefixEnd(line: string, at: number): number | null {
  const ch = line[at]
  if (ch === undefined) return null

  // A quote marker takes ONE following space, the separator this writer emits.
  // A blank quote line is written bare (`>`), so the space is optional.
  if (ch === '>') return line[at + 1] === ' ' ? at + 2 : at + 1

  // A bullet. The task box after it - `- [ ] ` - needs no case of its own: it
  // is bracketed by spaces, so no candidate can stand beside it, and whether it
  // counts as prefix or as content changes no answer.
  if ((ch === '-' || ch === '*' || ch === '+') && line[at + 1] === ' ') return at + 2

  // An ordered marker: digits, then the authored delimiter, then the separator.
  // A number no writer emits is not a marker, so the digit run is bounded.
  if (ch >= '0' && ch <= '9') {
    let end = at
    while (end - at < 9 && line[end] !== undefined && line[end]! >= '0' && line[end]! <= '9') end++
    if ((line[end] === '.' || line[end] === ')') && line[end + 1] === ' ') return end + 2

    return null
  }

  // A footnote definition's label, which this writer emits as `[^id]: `. An
  // abbreviation definition (`*[X]: `) is NOT one: its body is not a container.
  if (ch === '[' && line[at + 1] === '^') {
    let end = at + 2
    while (end < line.length && line[end] !== '\n' && line[end] !== ']') end++
    if (line[end] === ']' && line[end + 1] === ':' && line[end + 2] === ' ') return end + 3
  }

  return null
}

/** Whether the line opens a list item, past any quote markers in front of it. */
function startsAListItem(line: string, lineStart: number): boolean {
  let at = lineStart
  for (;;) {
    while (line[at] === ' ') at++
    if (line[at] === undefined) return false
    if (line[at] === '>') {
      const end = containerPrefixEnd(line, at)
      if (end === null) return false
      at = end
      continue
    }

    return containerPrefixEnd(line, at) !== null
  }
}

/** Whether the character at `i` is not covered by an odd run of backslashes. */
function liveAt(line: string, i: number): boolean {
  let backslashes = 0
  for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++

  return backslashes % 2 === 0
}

function adjacentToLiveDelimiter(line: string, i: number, ch: string): boolean {
  if (line[i + 1] === ch) return true
  if (line[i - 1] !== ch) return false
  let backslashes = 0
  for (let j = i - 2; j >= 0 && line[j] === '\\'; j--) backslashes++

  return backslashes % 2 === 0
}

/**
 * Resolve the narrowed escapes: PART 11 section 8a, M1b.
 *
 * `_`, `#` and `[` are escaped IF AND ONLY IF the character is adjacent on the
 * emitted line to an unescaped delimiter of the same character. Adjacent, and
 * unescaping would MERGE THE TWO INTO ONE RUN, which every Markdown reader this
 * target answers to resolves by run length - so that escape is holding a run
 * boundary apart under all of them at once, and it is kept. Not adjacent, and
 * the escape protects nothing under any of them: `company_id`, `C#` and
 * `issue #123` are written as the author typed them, and a backslash inside an
 * identifier no longer breaks exact-match search in the published document.
 *
 * THE ASTERISK IS NOT HERE, and that is M1a rather than an omission. This
 * writer spells emphasis with `*`, so a literal asterisk is not a character
 * that MIGHT meet markup on the line - it is the character the line's markup is
 * made of. `*\*\**` unescaped to `****`, and a CommonMark reader publishes
 * emphasis-containing-two-asterisks as a thematic break.
 *
 * IT RUNS ON THE ASSEMBLED OUTPUT because the test is over the line and not
 * over the node: the parser splits `company_id` into the text nodes `company`
 * and `_id`, so at escape time the underscore looks like it starts a word.
 *
 * IT DECIDES ON THE SENTINEL rather than on a `\_` in the output, because the
 * assembled document also contains regions this renderer must reproduce
 * byte-exact - code spans, code blocks, link destinations, titles, raw HTML -
 * and a backslash there is content, not an escape. Matching `\_` rewrote those
 * too (issue 400). It also keeps M2 out of the question: an author-escaped
 * character is an `escaped_text` node emitted AS AN ESCAPE, and it never
 * carries a sentinel, so nothing here can unescape it.
 */
function resolveNarrowedEscapes(text: string): string {
  if (!HAS_NARROWED_SENTINEL.test(text)) return text
  const character = sentinelCharacter
  const line = text.replace(RE_NARROWED_SENTINEL, character)
  const pairs = line.includes('_') ? pairableUnderscoresPerBlock(line) : null

  return text.replace(RE_NARROWED_SENTINEL, (s, offset: number) => {
    const ch = character(s)
    // TWO FAMILIES, TWO TESTS, AND A THIRD CASE THAT IS ALREADY SETTLED. M1b
    // asks whether a delimiter of the same character stands beside the
    // candidate. M2b asks WHERE ON THE LINE the candidate stands, and this is
    // the finished document, so the answer it gets here is the answer for a
    // line NO CONTAINER ENCLOSES - which is the only kind that reaches it
    // undecided. A line inside a container had its position settled at the
    // prefix site, where the prefix was still separable from the content
    // (markup-carve/carve#1330), and arrives carrying that answer.
    const keep =
      s === AUTHORED_KEPT ||
      (s in AUTHORED_CHARACTER
        ? opensAnAtxHeading(line, offset)
        : adjacentToLiveDelimiter(line, offset, ch) ||
          (ch === '_' && pairs !== null && pairs.has(offset)))

    return keep ? `\\${ch}` : ch
  })
}

/**
 * Answer PART 11 section 8b M2b for every authored hash in one block's text,
 * on the line THAT BLOCK writes (markup-carve/carve#1330).
 */
function decideAuthoredHashes(text: string): string {
  if (!HAS_UNDECIDED_HASH.test(text)) return text
  const line = text.replace(RE_NARROWED_SENTINEL, sentinelCharacter)

  return text.replace(RE_UNDECIDED_HASH, (_s, offset: number) =>
    opensAnAtxHeading(line, offset) ? AUTHORED_KEPT : '#',
  )
}

/**
 * Escape the first hash of a heading line's trailing run (PART 11 section 8a
 * M1f). After a space or tab, a reader takes that run as the ATX closing
 * sequence and drops it.
 */
function escapeTrailingAtxRun(line: string): string {
  const undecided = AUTHORED_SENTINEL['#']!
  let i = line.length
  while (i > 0 && (line[i - 1] === undecided || line[i - 1] === AUTHORED_KEPT)) i--
  if (i === line.length) return line
  const before = line[i - 1]
  if (before !== ' ' && before !== '\t') return line

  return line.slice(0, i) + AUTHORED_KEPT + line.slice(i + 1)
}

/**
 * Whether the `#` at `offset` would open an ATX heading (PART 11 section 8b
 * M2b).
 */
function opensAnAtxHeading(line: string, offset: number): boolean {
  // The walk back over the indent, bounded at the four positions that can
  // decide it. `i` lands on the first character of the run of spaces, so the
  // line must either start there or carry its newline immediately before it.
  let i = offset
  while (i > 0 && line[i - 1] === ' ') {
    if (offset - i >= 3) return false
    i--
  }
  if (i > 0 && line[i - 1] !== '\n') return false

  let run = 0
  while (run <= 6 && line[offset + run] === '#') run++
  if (run > 6) return false

  const after = line[offset + run] ?? '\n'

  return after === ' ' || after === '\t' || after === '\n'
}

function normalize(text: string): string {
  // The internal non-breaking-space placeholder (U+E000) becomes a literal
  // non-breaking space (U+00A0). Markdown is a re-parseable round-trip format,
  // so unlike the display renderers it keeps the real nbsp: it survives a
  // re-render as `&nbsp;` and is never mistaken for an indented code-block
  // prefix the way ordinary leading spaces would be. Done after trimming so
  // placeholder-derived leading indentation survives.
  const collapsed = `${trimNonNbsp(text.replace(/\n{3,}/g, '\n\n'))}\n`

  return resolveNarrowedEscapes(resolveContextEscapes(collapsed))
}

/**
 * The Unicode `White_Space` property, not CommonMark 2.1's narrower class: the
 * READER decides whether a run flanks, and pulldown-cmark counts U+000B, U+2028
 * and U+2029 as whitespace, so a run left beside one never opens
 * (markup-carve/carve#2023). U+E000 is in because it is the internal placeholder
 * for an escaped `\ `, which `normalize` only resolves to a real nbsp at the very
 * end of the render (carve-js#1688).
 */
const PAD_SPACE = /^([\p{White_Space}]*)([\s\S]*?)([\p{White_Space}]*)$/u

/**
 * A delimiter run only opens emphasis while it is left-flanking, which a run
 * followed by whitespace never is (CommonMark 6.2), so `** x**` reads back as
 * literal text. The padding is content, so it moves outside the delimiters
 * rather than being trimmed away.
 */
function padOutside(inner: string, delimiter: string, tag: string): string {
  const match = PAD_SPACE.exec(inner)
  if (!match) return `${delimiter}${inner}${delimiter}`
  const [, lead = ''] = match
  let [, , core = '', trail = ''] = match
  // A hard break is spelled a backslash then a newline. Moving only the
  // newline out leaves the backslash escaping the delimiter behind it, so
  // `**t\**` reads as text with a stray `*`. The backslash belongs to the
  // break and moves with it.
  if (trail.startsWith('\n') && /(?:^|[^\\])(?:\\\\)*\\$/.test(core)) {
    core = core.slice(0, -1)
    trail = '\\' + trail
  }
  if (core !== '') return `${lead}${delimiter}${core}${delimiter}${trail}`
  // Whitespace-only content has no delimiter form; every other inline this
  // renderer cannot spell falls back to inline HTML, so this one does too.
  return inner === '' ? '' : `<${tag}>${inner}</${tag}>`
}

/**
 * The three inlines this writer spells with a delimiter run, and the inline-HTML
 * form each falls back to. Everything else is inline HTML already and carries no
 * flanking question.
 */
const DELIMITER_RUN: Record<string, { delimiter: string; tag: string }> = {
  emphasis: { delimiter: '*', tag: 'em' },
  strong: { delimiter: '**', tag: 'strong' },
  strike: { delimiter: '~~', tag: 'del' },
}

const FLANK_SPACE = /[\p{White_Space}]/u

/**
 * CommonMark 0.31 punctuation: ASCII punctuation plus the Unicode P* and S*
 * categories. The S* half is the reason to spell it rather than reuse an ASCII
 * set - 0.30 left the symbol categories out, so a reader on either version
 * agrees about `!` and disagrees about `©`, and taking the WIDER class is the
 * answer that is right under both: it can only move a construct to inline HTML,
 * which every reader reads the same way.
 */
const FLANK_PUNCT = /[\p{P}\p{S}]/u

const lastCharacter = (s: string): string =>
  /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(s.slice(-2)) ? s.slice(-2) : s.slice(-1)

const firstCharacter = (s: string): string =>
  /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(s.slice(0, 2)) ? s.slice(0, 2) : s.slice(0, 1)

/**
 * A sentinel stands for `_`, `#` or `[`, all three of them punctuation, and it
 * is a private-use code point that no punctuation property matches. The flanking
 * test therefore has to ask about the character the reader will see, not the
 * carrier that is standing in for it until `resolveNarrowedEscapes` runs.
 */
const flankCharacter = (ch: string): string => (ch === '' ? ch : sentinelCharacter(ch))

/**
 * One side of CommonMark 6.2, and it really is ONE side: left-flanking and
 * right-flanking are the same test read in opposite directions. A run is
 * left-flanking if the character INSIDE it is not whitespace and, when that
 * character is punctuation, the character OUTSIDE is whitespace or punctuation;
 * right-flanking swaps which end is inside. `padOutside` has already moved every
 * space out of the run, so the inside character is never whitespace and only the
 * punctuation clause is left to decide.
 *
 * No neighbour at all counts as whitespace: the enclosing text either starts or
 * ends the line, or it is a delimiter, a bracket or a tag belonging to whatever
 * encloses the run - punctuation in every case this writer can produce.
 */
function flanks(inside: string, outside: string): boolean {
  const inner = flankCharacter(inside)
  if (!FLANK_PUNCT.test(inner)) return true
  const outer = flankCharacter(outside)

  return outer === '' || FLANK_SPACE.test(outer) || FLANK_PUNCT.test(outer)
}

/**
 * Take a rendered part back apart into the pieces `padOutside` built it from, or
 * `null` when it is not a delimiter run - an empty render, or the inline-HTML
 * form `padOutside` falls back to for whitespace-only content.
 */
function splitRun(part: string, delimiter: string): { lead: string; core: string; trail: string } | null {
  const match = PAD_SPACE.exec(part)
  if (!match) return null
  const [, lead = '', body = '', trail = ''] = match
  if (body.length <= delimiter.length * 2) return null
  if (!body.startsWith(delimiter) || !body.endsWith(delimiter)) return null

  return { lead, core: body.slice(delimiter.length, -delimiter.length), trail }
}

/**
 * Whether a run can flank is a property of the SEAM, not of the emphasis node,
 * so it cannot be answered where the run is built: the character that decides it
 * belongs to the sibling on the other side. Here is the one place both
 * neighbours are known, so a run that cannot open or cannot close where it
 * stands is re-spelled as inline HTML - the same fallback every inline this
 * writer cannot spell with delimiters already takes (carve-js#1705).
 *
 * The neighbour is read off the parts as they stand, so a part already re-spelled
 * on this pass contributes its `>` or `<` rather than its delimiter. That only
 * ever makes a later run MORE able to flank, so the pass needs no second round;
 * a run decided against an earlier neighbour can at worst take inline HTML it
 * would not have needed.
 */
function reflankRuns(nodes: InlineNode[], parts: string[]): string {
  // Three passes, because each one wants to see the parts the one before it
  // settled. A part re-spelled as inline HTML contributes a `<` or a `>` where
  // it used to contribute a delimiter, which can only make a later run MORE able
  // to flank and can only REMOVE a merge - so no pass has to run twice, and a
  // later pass never undoes an earlier one.
  for (let i = 0; i < parts.length; i++) {
    const piece = delimiterPiece(nodes, parts, i)
    if (piece && contentGrowsRun(piece, nodes[i]!)) parts[i] = spellAsHtml(piece)
  }
  for (let i = 0; i < parts.length; i++) {
    const piece = delimiterPiece(nodes, parts, i)
    if (!piece) continue
    const ch = piece.run.delimiter[0]!
    const before = piece.lead !== '' ? lastCharacter(piece.lead) : neighbourBefore(parts, i)
    const after = piece.trail !== '' ? firstCharacter(piece.trail) : neighbourAfter(parts, i)
    // The INSIDE character is the one past everything the merged run swallowed.
    // A child's delimiter at the edge of the core is part of the run the reader
    // lexes, not content beside it, so reading it as the inside character calls
    // `a***x***b` unable to flank when it flanks perfectly well.
    if (flanks(afterRunInCore(piece.core, ch), before) && flanks(beforeRunInCore(piece.core, ch), after)) continue
    parts[i] = spellAsHtml(piece)
  }
  for (let i = 0; i < parts.length; i++) {
    const piece = delimiterPiece(nodes, parts, i)
    if (!piece || !seamMergesRun(nodes, parts, i, piece)) continue
    // ONE SEAM, ONE FALLBACK, AND IT IS THE RUN ON THE RIGHT that takes it
    // (markup-carve/carve#2045). A tilde seam is decided from both sides and
    // already reports against the right-hand strike, so only the asterisk seam,
    // which looks right only, moves its fallback across.
    const j = piece.run.delimiter[0] === '~' ? -1 : nextRendered(parts, i)
    const next = j < 0 ? null : delimiterPiece(nodes, parts, j)
    if (next && next.run.delimiter[0] === piece.run.delimiter[0]) parts[j] = spellAsHtml(next)
    else parts[i] = spellAsHtml(piece)
  }

  return parts.join('')
}

interface DelimiterPiece {
  run: { delimiter: string; tag: string }
  lead: string
  core: string
  trail: string
}

function delimiterPiece(nodes: InlineNode[], parts: string[], i: number): DelimiterPiece | null {
  const run = DELIMITER_RUN[nodes[i]!.type]
  if (!run) return null
  const piece = splitRun(parts[i]!, run.delimiter)

  return piece ? { run, ...piece } : null
}

const spellAsHtml = (piece: DelimiterPiece): string =>
  `${piece.lead}<${piece.run.tag}>${piece.core}</${piece.run.tag}>${piece.trail}`

const runAtStart = (s: string, ch: string): number => {
  let n = 0
  while (n < s.length && s[n] === ch) n++

  return n
}

/**
 * A backslash escape makes the character it covers a literal, and a literal
 * breaks a delimiter run rather than lengthening it. The writer escapes every
 * asterisk it means literally, so counting raw characters would read the `*` of
 * `x\*` as part of a run and get the summed length wrong by one.
 */
const runAtEnd = (s: string, ch: string): number => {
  let n = 0
  while (n < s.length && s[s.length - 1 - n] === ch) n++
  if (n === 0) return 0
  let slashes = 0
  while (n + slashes < s.length && s[s.length - 1 - n - slashes] === '\\') slashes++

  return slashes % 2 === 1 ? n - 1 : n
}

/**
 * CommonMark 6.2's rule of 3, as a permission rather than a prohibition: when a
 * delimiter can both open and close, an opening run of `open` and a closing run
 * of `close` may not match if their lengths sum to a multiple of three, unless
 * both lengths are themselves multiples of three. A run this writer joins at a
 * seam has content on both sides of it, so it can always both open and close and
 * the clause always applies.
 */
function ruleOfThreeAllows(open: number, close: number): boolean {
  if ((open + close) % 3 !== 0) return true

  return open % 3 === 0 && close % 3 === 0
}

/**
 * Whether the run the writer emitted is the run the READER lexes. Runs of the
 * same character that touch are ONE run to the reader, of their summed length,
 * and the length is what decides what that run can do - so adjacency is not the
 * question, and no flanking test can answer it (carve-js#1706).
 *
 * This half is what the CONTENT contributes: a child's own delimiter, or a
 * literal the writer did not escape. The reader re-pairs the merged run by its
 * own rule rather than by the nesting the document had, so the parent takes the
 * inline-HTML spelling and the child keeps its delimiters. An ESCAPED character
 * at the edge reaches nothing, because a backslash breaks a run rather than
 * lengthening it.
 */
function contentGrowsRun(piece: DelimiterPiece, node: InlineNode): boolean {
  const ch = piece.run.delimiter[0]!
  if (runAtStart(piece.core, ch) === 0 && runAtEnd(piece.core, ch) === 0) return false

  return !edgeChildNests(piece, node)
}

/**
 * Whether every run the CONTENT adds at an edge belongs to a nested child of a
 * different strength, which the reader re-pairs as the nesting the document
 * has: `*italic **bold***` comes back as an emphasis holding a strong.
 *
 * EQUAL strengths do not nest - the runs collapse into one element of the wrong
 * kind - and a run that is not a child's delimiter at all, a literal the writer
 * did not escape, reaches the reader as part of the writer's own run. Both take
 * the inline-HTML spelling instead.
 *
 * `***x***`, where the child spans the whole parent, is the case PART 11
 * section 10k's round-trip normalization list already allowed: the emphasis
 * comes back outside either way, and the two nestings are the same document.
 */
function edgeChildNests(piece: DelimiterPiece, node: InlineNode): boolean {
  if (piece.run.delimiter[0] !== '*') return false
  // The padding text nodes are not content: `padOutside` has already moved them
  // outside the delimiters, so a child at an edge of the core is still the node
  // whose delimiter stands there.
  const kids = ((node as { children?: InlineNode[] }).children ?? []).filter(
    (kid) => kid.type !== 'text' || /\S/.test((kid as { value?: string }).value ?? ''),
  )
  const nests = (kid: InlineNode | undefined): boolean => {
    const child = DELIMITER_RUN[kid?.type ?? '']

    return child?.delimiter[0] === '*' && child.delimiter.length !== piece.run.delimiter.length
  }
  if (runAtStart(piece.core, '*') > 0 && !nests(kids[0])) return false

  return runAtEnd(piece.core, '*') === 0 || nests(kids[kids.length - 1])
}

/**
 * And this half is what the SIBLING across the seam contributes.
 *
 * For an asterisk the only thing that can reach the run from outside is another
 * run's delimiter, because a literal asterisk is escaped. Two delimiters that
 * touch are one run of their summed length, and three questions decide whether
 * the reader still resolves it the way the writer meant: the merged run has to
 * be able to close for the left node and open for the right one, which is
 * CommonMark 6.2 read against the neighbours the MERGED run has rather than the
 * ones either half was built with; and the rule of 3 has to allow both matches.
 * `*x*` against `*y*` sums to two and the rule of 3 refuses it; `**x**` against
 * `*y*` sums to three and it is allowed; `*x~*` against `**y**` also sums to
 * three and still fails, because a run whose inner character is `~` needs an
 * outer character that is not alphanumeric.
 *
 * A tilde run is not governed by the rule of 3 at all, and the readers do not
 * agree on it either: markdown-it pairs `~~` and splits a run of four, while
 * pulldown-cmark matches the run and does not. So no merged length survives -
 * any LIVE tilde reaching the run re-spells the strike as inline HTML.
 */
function seamMergesRun(
  nodes: InlineNode[],
  parts: string[],
  i: number,
  piece: DelimiterPiece,
): boolean {
  const ch = piece.run.delimiter[0]!
  if (ch === '~') return tildeSeamMerges(nodes, parts, i, piece, -1) || tildeSeamMerges(nodes, parts, i, piece, 1)
  if (piece.trail !== '') return false
  const j = nextRendered(parts, i)
  if (j < 0 || firstCharacter(parts[j]!) !== ch) return false
  const next = delimiterPiece(nodes, parts, j)
  if (!next || next.run.delimiter[0] !== ch || next.lead !== '') return true
  const closing = runAtEnd(piece.core, ch) + piece.run.delimiter.length
  const opening = next.run.delimiter.length + runAtStart(next.core, ch)
  const inner = beforeRunInCore(piece.core, ch)
  const outer = afterRunInCore(next.core, ch)
  if (inner === '' || outer === '' || !mergedRunFlanks(inner, outer)) return true
  const merged = closing + opening

  return !(ruleOfThreeAllows(closing, merged) && ruleOfThreeAllows(merged, opening))
}

function tildeSeamMerges(
  nodes: InlineNode[],
  parts: string[],
  i: number,
  piece: DelimiterPiece,
  direction: -1 | 1,
): boolean {
  if ((direction < 0 ? piece.lead : piece.trail) !== '') return false
  const j = direction < 0 ? previousRendered(parts, i) : nextRendered(parts, i)
  if (j < 0) return false
  // A backslash in front of the neighbour's last tilde makes it a literal, which
  // breaks the run rather than lengthening it; a tilde the neighbour PRESENTS
  // first is never escaped, because the backslash would stand there instead.
  if (direction < 0) return runAtEnd(parts[j]!, '~') > 0
  if (firstCharacter(parts[j]!) !== '~') return false
  // One seam needs one fallback, and the strike on the right takes it: it reaches
  // the same seam from its own side, so leaving it there keeps the left node in
  // delimiters.
  const other = delimiterPiece(nodes, parts, j)

  return !(other?.run.delimiter === '~~' && other.lead === '')
}

/**
 * The character on the far side of everything the merged run swallowed. The
 * delimiter's own neighbour is no use here: for `***x***` against `*y*` it is
 * another asterisk, which is INSIDE the merged run, and reading it as the outer
 * neighbour would call a run unable to flank that flanks perfectly well.
 */
const beforeRunInCore = (core: string, ch: string): string =>
  lastCharacter(core.slice(0, core.length - runAtEnd(core, ch)))

const afterRunInCore = (core: string, ch: string): string =>
  firstCharacter(core.slice(runAtStart(core, ch)))

/**
 * CommonMark 6.2 read against the neighbours the MERGED run has. Each half was
 * built against a neighbour that is no longer there: the character outside the
 * merged run is the content of the sibling across the seam. The run has to be
 * able to close for the node on its left and open for the node on its right,
 * which is the same test in both directions.
 */
const mergedRunFlanks = (inner: string, outer: string): boolean =>
  flanks(inner, outer) && flanks(outer, inner)

function nextRendered(parts: string[], i: number): number {
  for (let j = i + 1; j < parts.length; j++) if (parts[j] !== '') return j

  return -1
}

function previousRendered(parts: string[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (parts[j] !== '') return j

  return -1
}

function neighbourBefore(parts: string[], i: number): string {
  for (let j = i - 1; j >= 0; j--) if (parts[j] !== '') return lastCharacter(parts[j]!)

  return ''
}

function neighbourAfter(parts: string[], i: number): string {
  for (let j = i + 1; j < parts.length; j++) if (parts[j] !== '') return firstCharacter(parts[j]!)

  return ''
}

/**
 * One wrapper line - an admonition title, a container label, a definition term,
 * a figure caption - with its block separator.
 *
 * These six sites built the delimiter run themselves, so none of them got the
 * flanking repair the inline arms get, and a whitespace-only admonition title
 * went out as `** **`: a THEMATIC BREAK in the reader, with the title gone
 * (carve-js#1688). An empty run emits nothing rather than a bare separator.
 */
function wrapperLine(inner: string, delimiter: string, tag: string, suffix = '\n\n'): string {
  const run = padOutside(inner, delimiter, tag)

  return run === '' ? '' : `${run}${suffix}`
}

/**
 * The admonition-title line is emitted inside a bold wrapper; nested `strong`
 * nodes would produce degenerate output (`**a **b****` in Markdown, a
 * mid-title SGR reset in ANSI), and bold-in-bold is visually a no-op anyway,
 * so strong nodes unwrap to their children inside the title only.
 */
function unwrapStrong(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((n): InlineNode[] => {
    const kids = (n as { children?: InlineNode[] }).children
    if (n.type === 'strong') return unwrapStrong(kids ?? [])
    if (Array.isArray(kids)) return [{ ...n, children: unwrapStrong(kids) } as InlineNode]
    return [n]
  })
}
