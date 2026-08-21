import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import type {
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
import { collectStrings, pickSentinelRun } from './sentinel-run.js'

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

export interface MarkdownRenderOptions {
  /** Defaults to `'glyph'`. */
  smartTypography?: SmartTypographyMode | boolean
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
  const headingIds = new Set<string>()
  const referencedHeadingIds = new Set<string>()

  // Footnote definition bodies are rendered as block content too, so both
  // prepasses have to see them. Without this, a heading referenced ONLY from a
  // footnote lost its `{#id}` suffix while the reference still rendered as a
  // link, leaving a dangling anchor in the Markdown output (carve#352).
  const allBlocks = [...ast.children, ...Object.values(ast.footnoteDefs ?? {}).flat()]

  walkBlocks(allBlocks, (node) => {
    if (node.type === 'heading' && node.attrs?.id) headingIds.add(node.attrs.id)
  })
  walkBlocks(allBlocks, (_node, inlines) => {
    if (!inlines) return
    walkInlines(inlines, (node, insideLink) => {
      // A crossref is its own node type (PART 12 §3a), so a scan that only
      // looked at links stopped seeing `</#id>` references - and the heading
      // lost the `{#id}` anchor its own reference still pointed at.
      //
      // A crossref INSIDE a link renders as its display text, not as a link
      // (anchors do not nest), so it is not a reference in the output and must
      // not pull an anchor onto the heading. Counting it left `# H {#H}` in a
      // document whose only `</#H>` had rendered as the word `H` - a dangling
      // anchor, which is the same defect carve#352 fixed from the other side.
      if (insideLink) return
      const href = node.type === 'link' || node.type === 'heading_ref' ? node.href : undefined
      if (href === undefined) return
      const id = fragmentId(href)
      if (id && headingIds.has(id)) referencedHeadingIds.add(id)
    })
  })

  const ctx: MarkdownContext = {
    headingIds,
    referencedHeadingIds,
    listDepth: 0,
    blockDepth: 0,
    inlineDepth: 0,
    abbrBudget: budgetForDocument(ast),
    smartTypography: opts.smartTypography === false || opts.smartTypography === 'source' ? 'source' : 'glyph',
    definedFootnotes: new Set(Object.keys(ast.footnoteDefs ?? {})),
    authoredHashes: 0,
  }
  const out = renderBlocks(ast.children, ctx)
  const footnotes = renderFootnoteDefs(ast, ctx)
  return stripBidiControls(normalize(`${out}${footnotes}`))
}

interface MarkdownContext {
  headingIds: Set<string>
  referencedHeadingIds: Set<string>
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
  /**
   * Authored hashes emitted since the enclosing block started, so a block that
   * emitted none skips the M2b pass entirely rather than scanning its subtree.
   */
  authoredHashes: number
}

/**
 * The finished content of a container, trimmed and with PART 11 section 8b M2b
 * ANSWERED ON IT, ready for the caller to put its prefix in front.
 *
 * Every call site is a place the writer prefixes a container's lines, and that
 * is the whole of the list: the block quote marker, the list and task marker
 * with the alignment section 10 gives the lines under it, the footnote
 * definition marker, the definition marker. M2b measures on the EMITTED LINE
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
function containerContent(ctx: MarkdownContext, render: () => string): string {
  const before = ctx.authoredHashes
  const content = trimNonNbsp(render())
  if (ctx.authoredHashes === before) return content
  ctx.authoredHashes = before

  return decideAuthoredHashes(content)
}

function renderBlocks(blocks: BlockNode[], ctx: MarkdownContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return blocks.map((b) => renderBlock(b, ctx)).join('')
  } finally {
    ctx.blockDepth--
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
    case 'heading': {
      // A folded heading's line join takes PART 7's four characters. The class
      // was `\s` with one carve-out, so it swallowed a vertical tab beside the
      // newline that the HTML target kept.
      const text = trimNonNbsp(renderInlines(node.children, ctx).replace(/[ \t\r]*\n[ \t\r]*/g, ' '))
      const id = node.attrs?.id
      const suffix = id && ctx.referencedHeadingIds.has(id) ? ` {#${id}}` : ''
      return `${withMarker(`${'#'.repeat(node.level)} `, `${text}${suffix}`)}\n\n`
    }
    case 'paragraph':
      return `${protectParagraphListMarkers(renderInlines(node.children, ctx))}\n\n`
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
      const lines = containerContent(ctx, () => renderBlocks(node.children, ctx)).split('\n')
      return `${lines.map((line) => withMarker('> ', line)).join('\n')}\n\n`
    }
    case 'list':
      return renderList(node, ctx)
    case 'thematic_break':
      return '---\n\n'
    case 'table':
      return renderTable(node, ctx)
    case 'admonition': {
      // Markdown has no admonition; preserve the title (otherwise lost) as a
      // leading bold line, then an unconsumed grouping [label] (also bold, the
      // caption floor; title first when both are present), then the body.
      const body = renderBlocks(node.children, ctx)
      const title =
        node.title !== undefined ? renderInlines(unwrapStrong(node.title), ctx) : ''
      // Escape the label the same way text is escaped (HTML + Markdown
      // metacharacters), not just strip controls: a label like `[<img …>]`
      // must not emit live HTML when the Markdown is re-rendered.
      const labelLine = node.label ? `**${escapeText(node.label)}**\n\n` : ''
      if (title !== '') {
        return `**${title}**\n\n${labelLine}${body}`
      }
      return `${labelLine}${body}`
    }
    case 'div':
      return node.label
        ? `**${escapeText(node.label)}**\n\n${renderBlocks(node.children, ctx)}`
        : renderBlocks(node.children, ctx)
    case 'line_block':
      return renderBlocks(node.children, ctx)
    case 'definition_list':
      return renderDefinitionList(node.items, ctx, true)
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
        out += `**${trimNonNbsp(renderInlines(node.caption, ctx))}**\n\n`
      }
      return out
    }
    case 'image':
      // Block-level (standalone) image: emit the trailing block separator so a
      // following block is not glued to it, matching carve-php / carve-rs.
      return `${renderImage(node)}\n\n`
    case 'raw_block':
      // Escape, not emit: raw HTML in Markdown would be live again downstream.
      return node.format === 'html' ? `${escapeMdHtml(stripControls(node.content))}\n\n` : ''
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

function renderList(node: List, ctx: MarkdownContext): string {
  ctx.listDepth++
  let out = ''
  let counter = node.start ?? 1
  // The authored bullet, not a normalized one. A change of bullet is what
  // SEPARATES two adjacent lists in CommonMark, so emitting `-` for a `*` list
  // merges lists the source kept apart - the same section 11 rule the AST
  // records `bulletChar` for and `renderCarve` already honors (carve#352).
  const bullet = node.bulletChar ?? '-'
  // The authored ordered-list delimiter, for the same reason as the bullet above:
  // in CommonMark a change of delimiter SEPARATES two adjacent lists, so emitting
  // `1.` for a `1)` list merges lists the source kept apart. Measured against
  // commonmark.js - `1. a` followed by `1) c` gives two `<ol>` elements, the same
  // input with one delimiter gives one. The AST records `delim` and `renderCarve`
  // already reproduces it (carve#352, corpus 31).
  const delim = node.delim === ')' ? ')' : '.'
  for (const item of node.items) {
    let prefix: string
    if (node.ordered) {
      prefix = `${counter}${delim} `
      counter++
    } else if (item.checked !== undefined) {
      prefix = `${bullet} ${item.checked ? '[x]' : '[ ]'} `
    } else {
      prefix = `${bullet} `
    }
    const content = containerContent(ctx, () => renderListItem(item, ctx))
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
    const continuation = ' '.repeat(prefix.length)
    // A line with no content takes no pad: PART 11 section 7 emits such a line
    // empty, and trailing whitespace is what editors and `git apply
    // --whitespace=fix` rewrite behind the writer.
    for (const line of lines) out += `${line === '' ? '' : continuation + line}\n`
  }
  ctx.listDepth--
  return out + (ctx.listDepth === 0 ? '\n' : '')
}

function renderListItem(item: ListItem, ctx: MarkdownContext): string {
  return renderBlocks(item.children, ctx)
}

function renderDefinitionList(items: DefinitionItem[], ctx: MarkdownContext, trailingBlank: boolean): string {
  let out = ''
  for (const item of items) {
    for (const term of item.terms) out += `**${renderInlines(term, ctx)}**\n`
    for (const def of item.definitions)
      out += `${withMarker(': ', containerContent(ctx, () => renderBlocks(def, ctx)))}\n`
  }
  return trailingBlank ? `${out}\n` : out
}

function renderTable(node: Table, ctx: MarkdownContext): string {
  let header: string | undefined
  let headerColumns = 0
  const rows: string[] = []
  // Per-column alignment for the Markdown delimiter row, which is the only place
  // Markdown can express it.
  //
  // COLUMN alignment is declared on the HEADER cells - that is where `|=> Age`
  // puts it, and the HTML renderer applies it to every cell in the column. This
  // used to read the first NON-header row instead, where `align` is set only by a
  // per-CELL override, so ordinary aligned tables lost their alignment entirely
  // and a table with one overridden cell reported that cell's alignment as the
  // whole column's (carve#352, corpus 48/49/52/53).
  //
  // A per-cell override cannot be expressed in a Markdown table at all, so it is
  // deliberately not consulted here; the column keeps what the header declared.
  const aligns: (('left' | 'right' | 'center') | undefined)[] = []
  for (const row of node.rows) {
    const cells = row.cells.map((cell) => trimNonNbsp(renderInlines(cell.children, ctx)))
    const rendered = `| ${cells.join(' | ')} |`
    if (row.cells.every((cell) => cell.header)) {
      header = rendered
      headerColumns = cells.length
      row.cells.forEach((cell, i) => {
        if (aligns[i] === undefined) aligns[i] = cell.align
      })
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

function renderFigure(node: Figure, ctx: MarkdownContext): string {
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? trimNonNbsp(renderTable(node.target, ctx))
        : trimNonNbsp(renderBlock(node.target, ctx))
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
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? trimNonNbsp(renderTable(node.target, ctx))
        : trimNonNbsp(renderBlock(node.target, ctx))
  // A BLANK line before the caption, for every host: the emphasized caption is
  // its own paragraph (carve-php / carve-rs parity; the ticket's degradation
  // example). The single-newline glue is the standalone figure's shape, not
  // the panel's.
  return `${target}\n\n*${trimNonNbsp(renderInlines(node.caption, ctx))}*\n\n`
}

function renderFootnoteDefs(ast: Document, ctx: MarkdownContext): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    // A label is author content, and it is reproduced verbatim in two places;
    // both escape, so a reference still matches its definition (carve-js#894).
    out += `${withMarker(`[^${escapeMdHtml(stripControls(label))}]: `, containerContent(ctx, () => outsideLink(() => renderBlocks(blocks, ctx))))}\n`
  }
  return out
}

function renderInlines(nodes: InlineNode[], ctx: MarkdownContext): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    return nodes.map((node) => renderInline(node, ctx)).join('')
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
      if (node.value in AUTHORED_SENTINEL) {
        ctx.authoredHashes++

        return AUTHORED_SENTINEL[node.value]!
      }
      return '\\' + node.value
    case 'emphasis':
      return `*${renderInlines(node.children, ctx)}*`
    case 'strong':
      return `**${renderInlines(node.children, ctx)}**`
    case 'underline':
      return `<u>${renderInlines(node.children, ctx)}</u>`
    case 'strike':
      return `~~${renderInlines(node.children, ctx)}~~`
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
    case 'math': {
      // Escaped, exactly as the HTML target escapes the same content: a
      // consumer decodes the entity back to the character before its math
      // renderer sees it, so `a < b` still reaches KaTeX as `a < b` while
      // `<script>` cannot become a tag (markup-carve/carve-js#894).
      const math = escapeMdHtml(stripControls(node.content))

      return node.display ? `$$${math}$$` : `$${math}$`
    }
    case 'raw_inline':
      return node.format === 'html' ? escapeMdHtml(stripControls(node.content)) : ''
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
    case 'soft_break':
      return '\n'
    case 'hard_break':
      // A BACKSLASH, not two trailing spaces (PART 11 section 9). Both mean
      // `<br />` to a CommonMark reader, but trailing whitespace is removed by
      // editors that strip on save, by `git apply --whitespace=fix` and by CI
      // whitespace checks - and losing ONE of the two spaces is enough for the
      // break to vanish rather than degrade, silently, in a file nobody edited.
      return '\\\n'
    case 'insert':
      return `<ins>${renderInlines(node.children, ctx)}</ins>`
    case 'delete':
      return `<del>${renderInlines(node.children, ctx)}</del>`
    case 'substitution':
      // Emit BOTH sides like the HTML renderer; dropping oldText loses content.
      return `<del>${escapeText(node.oldText)}</del><ins>${escapeText(node.newText)}</ins>`
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
      if (insideLink || !crossrefId || !ctx.headingIds.has(crossrefId)) return crossrefText
      // Resolved: the Markdown link this crossref always rendered as. The
      // authored `</#target>` stays in the tree (PART 12 §3a); only this
      // target's OUTPUT resolves it.
      return `[${crossrefText}](${markdownFragmentDestination(crossrefId)})`
    }
    case 'caption_number':
      return node.n === undefined ? '#' : String(node.n)
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

function renderLink(node: Link, ctx: MarkdownContext): string {
  // Markdown has no nested links either: `[see [H](#H)](/outer)` is not a link
  // with a link inside, it is broken. A crossref in the label renders as its
  // text, the same suppression the HTML target makes.
  const text = withinLink(() => renderInlines(node.children, ctx))
  const id = fragmentId(node.href)
  if (id && !ctx.headingIds.has(id)) return text
  const destination = id ? markdownFragmentDestination(id) : markdownDestination(node.href)
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

function markdownFragmentDestination(id: string): string {
  if (!/[\s()<>]/.test(id)) return `#${id}`
  return `<#${id.replace(/[\\<>]/g, (ch) => `\\${ch}`)}>`
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
  // 1. Strip first, probe second, and strip BROADLY. The strip drops all of
  //    `\p{Cc}`, the probe skips only up to U+001F plus whitespace, so
  //    `java<DEL>script:` and the C1 range walked straight through and came out
  //    clean on the far side. This is why the destination has its own strip and
  //    does not share the emit path's: PART 9 section 29 narrowed that one to
  //    let the non-whitespace C0 controls through as content, which is a
  //    statement about TEXT and not about a URL heading for a scheme probe.
  //    The ANSI target of this same engine already strips before it probes
  //    (`render-ansi.ts`), and carve-php strips inside its probe.
  //
  // 1b. PROBE the broad form, EMIT the narrow one. PART 9 section 29 makes the
  //    non-whitespace C0 controls content on this target, and a destination is
  //    content too - carve-php and carve-rs both emit `/u<SOH>v` where this
  //    writer deleted the character. Emitting the authored bytes is safe
  //    precisely because the probe ran on the stripped form: stripping only
  //    REMOVES characters, so a denied scheme in the authored form is still
  //    denied in the stripped one, and a consumer that ignores the controls
  //    sees exactly the string that was already dismissed. Sharing one strip
  //    between the two would have to pick a side, and either side is a defect.
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
  text = text.replace(/[\\`*_[\]#]/g, (ch) => NARROWED_SENTINEL[ch] ?? `\\${ch}`)
  // PART 11 section 8a M1e: a `<` is escaped only where the emitted line would
  // read it as markup - before an ASCII letter, `/`, `!` or `?`, the four
  // things that open raw HTML. Everything else is inert, and so is `>`
  // mid-line; at line start `>` is a block quote marker M1 already covers.
  //
  // A BACKSLASH, not an entity. This wrote `&lt;`/`&gt;` unconditionally with no
  // clause behind it (carve#1148), and that is precisely because an entity is
  // not the operation this section describes: M2 and M3 protect a character so
  // it survives as itself, and `&lt;` replaces it instead. Escaping the `<`
  // alone suffices - a tag that cannot open cannot be closed.
  //
  // AFTER the metacharacter pass, so the backslash this inserts is not itself
  // escaped by it.
  return text.replace(/<(?=[A-Za-z/!?])/g, '\\<')
}

/** Keep paragraph continuation lines from becoming lists in Markdown readers. */
function protectParagraphListMarkers(text: string): string {
  let codeFence = 0
  const lines = text.split('\n')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex]!
    if (codeFence === 0) {
      line = line
        .replace(/^([ \t]{0,3})([-+])(?=[ \t])/, '$1\\$2')
        .replace(/^([ \t]{0,3}\d{1,9})([.)])(?=[ \t])/, '$1\\$2')
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
 *
 * THE NON-WHITESPACE C0 CONTROLS ARE CONTENT AND ARE EMITTED. PART 9 \u00a729 T2
 * rules that U+0000..U+0008, U+000B, U+000C and U+000E..U+001F are ordinary
 * content on this target, because after markup-carve/carve#963 the whitespace
 * of the language is exactly U+0020, U+0009, U+000A and U+000D. This renderer
 * deleted the whole `\p{Cc}` block, which made Carve the lossy party: four
 * Markdown readers were measured - the CommonMark reference implementation and
 * markdown-it in default, commonmark and typographer modes - and all four KEEP
 * these characters inline, on a lone line, in a code span, after a list marker
 * and after an ATX hash. `-<VT>item` opens no list in any of them
 * (markup-carve/carve-js#896).
 *
 * What is still dropped, and why each one is not that class:
 *
 * - U+000D is WHITESPACE after carve#963, so \u00a729 excludes it.
 * - DEL (U+007F) and the C1 controls (U+0080..U+009F) sit outside \u00a729 by T5,
 *   and CSI (U+009B) and OSC (U+009D) are single-character forms of the
 *   sequences \u00a725 exists to stop.
 * The section 8a carriers were dropped here too, and that was the defect
 * carve-js#1281: they are this renderer's own markers, and deleting the range
 * they occupied was how author content was kept off them. They are picked per
 * document now, so no authored character can be one and nothing has to be
 * deleted to keep it that way.
 *
 * The ANSI target keeps the broad strip and MUST: it is the one consumer that
 * acts on the character (\u00a729 T4).
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
 * PART 11 section 8b M2b: read as markup only at a line's CONTENT POSITION.
 *
 * A second sentinel family, extending the run above. Separate from
 * NARROWED_SENTINEL because the two are decided by DIFFERENT tests: M1b asks
 * about an adjacent delimiter of the same character, M2b asks where on the
 * line the character stands.
 */
let AUTHORED_SENTINEL: Record<string, string> = {}

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
 * The carriers this document uses, one run of five.
 *
 * Slots, in order: the three section 8a narrowings - `_`, `#`, `[` - then M2b's
 * undecided hash and the same hash once M2b has decided to KEEP its escape. The
 * last two are one character apart on purpose; see AUTHORED_KEPT above.
 *
 * The run is picked from code points the DOCUMENT does not contain, so no
 * authored character can be read as one and none has to be deleted to make that
 * true. The canonical writer's run is picked the same way and is deliberately
 * NOT the same run: the two never overlap in time, and one shared run would make
 * a slot added on either side a renumbering on the other (see sentinel-run.ts).
 */
const CARRIER_BASE = 0xe004
const CARRIER_COUNT = 5

function setCarriers(run: string[]): void {
  const [underscore, hash, bracket, undecidedHash, keptHash] = run as [
    string,
    string,
    string,
    string,
    string,
  ]

  NARROWED_SENTINEL = { _: underscore, '#': hash, '[': bracket }
  NARROWED_CHARACTER = { [underscore]: '_', [hash]: '#', [bracket]: '[' }
  AUTHORED_SENTINEL = { '#': undecidedHash }
  AUTHORED_KEPT = keptHash
  AUTHORED_CHARACTER = { [undecidedHash]: '#', [keptHash]: '#' }
  RE_NARROWED_SENTINEL = new RegExp(`[${run[0]}-${run[CARRIER_COUNT - 1]}]`, 'g')
  HAS_NARROWED_SENTINEL = new RegExp(`[${run[0]}-${run[CARRIER_COUNT - 1]}]`)
  RE_UNDECIDED_HASH = new RegExp(undecidedHash, 'g')
  HAS_UNDECIDED_HASH = new RegExp(undecidedHash)
}

/** Pick this document's carriers. Called once, before anything is rendered. */
function chooseCarriers(ast: Document): void {
  setCarriers(pickSentinelRun(collectStrings(ast), CARRIER_BASE, CARRIER_COUNT))
}

setCarriers(pickSentinelRun('', CARRIER_BASE, CARRIER_COUNT))

/** The bare character a sentinel stands for, for both passes that build a line view. */
function sentinelCharacter(s: string): string {
  return NARROWED_CHARACTER[s] ?? AUTHORED_CHARACTER[s]!
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
        : adjacentToLiveDelimiter(line, offset, ch))

    return keep ? `\\${ch}` : ch
  })
}

/**
 * Answer PART 11 section 8b M2b for every authored hash in one block's text,
 * on the line THAT BLOCK writes (markup-carve/carve#1330).
 *
 * M2b's position is measured on the emitted line, and A LINE'S CONTENT
 * POSITION IS AFTER ITS CONTAINER PREFIX - the block quote marker, the list or
 * task marker, the definition marker, the alignment section 10 gives a
 * continuation line, in whatever combination and to whatever depth. Deriving
 * that from the finished document would mean parsing the prefixes back off it,
 * and the item-alignment case cannot be recovered that way at all: a
 * continuation line under `10. ` carries four spaces of pad, which reads as an
 * over-indent to anything that does not already know the marker's width. That
 * is section 10's own reason for refusing to reason about the content alone.
 *
 * So it is not derived. The pass runs where the writer HAS the answer: a block
 * emits its own line, this decides on it, and everything the containers add
 * afterwards is a prefix by construction, without any of them being named. A
 * heading is not a container and its `## ` belongs to the block's own line, so
 * a hash behind it is mid-line and loses the escape - which is the reading
 * CommonMark gives it.
 *
 * THE NARROWING IS UNTOUCHED, and that is the half a correction like this
 * loses first. Standing behind a prefix is not enough on its own: a hash mid
 * line still drops its escape inside a quote, and one at the content position
 * whose run is closed by a letter drops it too, because M2b's reading is
 * CommonMark's and neither of those opens a heading.
 */
function decideAuthoredHashes(text: string): string {
  if (!HAS_UNDECIDED_HASH.test(text)) return text
  const line = text.replace(RE_NARROWED_SENTINEL, sentinelCharacter)

  return text.replace(RE_UNDECIDED_HASH, (_s, offset: number) =>
    opensAnAtxHeading(line, offset) ? AUTHORED_KEPT : '#',
  )
}

/**
 * Whether the `#` at `offset` would open an ATX heading (PART 11 section 8b
 * M2b).
 *
 * `line` is the assembled output with every candidate resolved to its BARE
 * character, the same view M1b decides on. The offset carries across directly
 * because a sentinel is one UTF-16 unit exactly like the character it stands
 * for - carve-php cannot do that, since its sentinel is three bytes and the
 * character is one.
 *
 * Three conditions, all of them CommonMark's: the character stands at the
 * line's content position, which admits up to three leading spaces; the run of
 * hashes starting there is one to six long; and the run is closed by a space, a
 * tab or the end of the line. A tag, an issue reference and a hex colour fail
 * the third even at a line's start, which is why the test is spelled on the run
 * rather than on the position alone.
 *
 * BOTH CONDITIONS ARE ANSWERED WITHOUT READING THE LINE (carve#1331). The
 * first spelling searched backward for the line's newline and counted the whole
 * run of hashes, so a candidate cost O(line) and a line of adjacent authored
 * hashes - which is all candidates - cost O(n^2): 128KB took 3.3s against 0.1s
 * before section 8b existed. Neither answer needs the line, because both
 * conditions are bounded:
 *
 * - At most three spaces may precede the character, so the walk back stops
 *   after four steps and the fourth decides. Anything else standing there means
 *   the content position is elsewhere on the line, whatever the rest of it
 *   holds.
 * - The run has to be six or shorter, so counting stops at seven. The seventh
 *   hash settles the question and the eight-thousandth cannot change it.
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
  const collapsed = `${trimNonNbsp(text.replace(/\n{3,}/g, '\n\n'))}\n`.replace(
    /\ue000/g,
    '\u00a0',
  )

  return resolveNarrowedEscapes(collapsed)
}

/**
 * Bounded by `MAX_RENDER_DEPTH`, like the render pass it runs ahead of: §25
 * requires the resolve passes to be bounded too, and a pre-pass that overflows
 * the host stack refuses nothing (carve#526).
 */
function walkBlocks(
  blocks: BlockNode[],
  visit: (node: BlockNode, inlines?: InlineNode[]) => void,
  depth = 0,
): void {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  for (const block of blocks) {
    visit(block)
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        visit(block, block.children)
        break
      case 'block_quote':
      case 'admonition':
      case 'div':
      case 'line_block':
        walkBlocks(block.children, visit, depth + 1)
        break
      case 'list':
        for (const item of block.items) walkBlocks(item.children, visit, depth + 1)
        break
      case 'definition_list':
        for (const item of block.items) {
          for (const term of item.terms) visit(block, term)
          for (const def of item.definitions) walkBlocks(def, visit, depth + 1)
        }
        break
      case 'table':
        if (block.caption) visit(block, block.caption)
        for (const row of block.rows) for (const cell of row.cells) visit(block, cell.children)
        break
      case 'figure':
        visit(block, block.caption)
        if (block.target.type === 'block_quote') walkBlocks(block.target.children, visit, depth + 1)
        else if (block.target.type === 'table') walkBlocks([block.target], visit, depth + 1)
        break
      case 'figure_group':
        // The prepass feeds the heading-id index and the reference scan; a
        // heading inside a composite figure is a crossref target like any
        // other, and the group caption carries references of its own.
        if (block.caption) visit(block, block.caption)
        walkBlocks(block.children, visit, depth + 1)
        break
      default:
        break
    }
  }
}

function walkInlines(
  nodes: InlineNode[],
  visit: (node: InlineNode, insideLink: boolean) => void,
  depth = 0,
  insideLink = false,
): void {
  if (depth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderMarkdown', MAX_RENDER_DEPTH)
  for (const node of nodes) {
    visit(node, insideLink)
    switch (node.type) {
      case 'emphasis':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'superscript':
      case 'subscript':
      case 'highlight':
      case 'link':
      case 'span':
      case 'insert':
      case 'delete':
        // A link's own label is inside a link; everything else inherits.
        walkInlines(node.children, visit, depth + 1, insideLink || node.type === 'link')
        break
      case 'inline_extension':
        walkInlines(node.content, visit, depth + 1, insideLink)
        break
      case 'footnote_ref':
      case 'inline_footnote':
        // A note body renders in the endnotes, outside any anchor, so a
        // reference in it IS a reference in the output.
        if (node.inline) walkInlines(node.inline, visit, depth + 1, false)
        break
      default:
        break
    }
  }
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
