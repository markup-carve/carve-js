import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import type { BlockNode, DefinitionItem, Document, Figure, InlineNode, List, Table, Text } from './ast.js'
import { SMART_PUNCTUATION_GLYPHS } from './ast.js'
import { AbbrBudget, budgetForDocument, utf8ByteLength } from './abbr-budget.js'
import { abbreviationPairKey, documentHasAbbreviationDef } from './abbr-expansion-emitted.js'
import { normalizeLegacyInline } from './legacy-nodes.js'
import { blankDeniedDestination } from './deny-listed-destination.js'
import { smartTypographyIsSource } from './render-plain.js'
import type { SmartTypographyMode } from './render-markdown.js'
import { trimEndNonNbsp, trimNonNbsp } from './trim-non-nbsp.js'
import { stripBidiControls } from './bidi-controls.js'
import { isUnresolvedReference } from './unresolved-reference.js'

// Set while rendering a span that carries an authored `abbr`, so a resolved
// abbreviation inside it contributes only its visible text (carve#1127).
let suppressAutomaticAbbreviation = false

/** No definition has been found expanded yet - the first pass, or no definition. */
const NO_EXPANDED_DEFINITIONS: ReadonlySet<string> = new Set()

export interface AnsiRenderOptions {
  /** See `PlainTextRenderOptions.smartTypography` (carve#560). */
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

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALIC = '\x1b[3m'
const UNDERLINE = '\x1b[4m'
const STRIKE = '\x1b[9m'
const FG_BLUE = '\x1b[34m'
const FG_MAGENTA = '\x1b[35m'
const FG_CYAN = '\x1b[36m'
const FG_YELLOW = '\x1b[33m'
const FG_GREEN = '\x1b[32m'
const FG_BRIGHT_BLACK = '\x1b[90m'
const FG_BRIGHT_YELLOW = '\x1b[93m'
const FG_BRIGHT_MAGENTA = '\x1b[95m'
const FG_BRIGHT_CYAN = '\x1b[96m'
const FG_BRIGHT_BLUE = '\x1b[94m'
const FG_BRIGHT_GREEN = '\x1b[92m'
const FG_BRIGHT_WHITE = '\x1b[97m'

export function renderAnsi(ast: Document, opts: AnsiRenderOptions = {}): string {
  // PART 11 §10f, and see the twin comment in render-plain.ts: the definition
  // lines come before the occurrences that decide whether they survive, so a
  // document holding a definition is rendered once to find out which pairs were
  // actually expanded and once for real.
  if (!documentHasAbbreviationDef(ast)) return renderPass(ast, opts, NO_EXPANDED_DEFINITIONS).text
  const probe = renderPass(ast, opts, NO_EXPANDED_DEFINITIONS)
  return renderPass(ast, opts, probe.expanded).text
}

function renderPass(
  ast: Document,
  opts: AnsiRenderOptions,
  expandedDefinitions: ReadonlySet<string>,
): { text: string; expanded: Set<string> } {
  const ctx: AnsiContext = {
    smartSource: smartTypographyIsSource(opts.smartTypography),
    listDepth: 0,
    blockQuoteDepth: 0,
    ordered: [],
    blockDepth: 0,
    inlineDepth: 0,
    abbrBudget: budgetForDocument(ast),
    definedFootnotes: new Set(Object.keys(ast.footnoteDefs ?? {})),
    expandedDefinitions,
    expanded: new Set(),
  }
  const out = renderBlocks(ast.children, ctx)
  const footnotes = renderFootnoteDefs(ast, ctx)
  return { text: stripBidiControls(normalize(`${out}${footnotes}`)), expanded: ctx.expanded }
}

interface AnsiContext {
  smartSource: boolean
  listDepth: number
  blockQuoteDepth: number
  ordered: number[]
  blockDepth: number
  inlineDepth: number
  /** Per-render abbreviation-expansion budget (DoS guard). */
  abbrBudget: AbbrBudget
  /**
   * Labels that actually have a definition. A reference without one did not form
   * a footnote, so it is source text rather than a marker - and must not be
   * styled as one. The HTML renderer decides this on `node.number`, which this
   * path never populates because it does no numbering.
   */
  definedFootnotes: Set<string>
  /**
   * The `(term, expansion)` pairs the FIRST pass expanded, so an
   * `abbreviation_def` can tell whether ITS OWN expansion is emitted. PART 11
   * §10f, and see abbr-expansion-emitted.ts for why that is the test rather
   * than "is the term referenced". Empty on the first pass, where every
   * definition line is written and thrown away with the rest of the string.
   */
  expandedDefinitions: ReadonlySet<string>
  /** The pairs THIS pass expanded, which is what the first pass is run for. */
  expanded: Set<string>
}

/**
 * Charge a rendered cross-reference label against the per-render expansion
 * budget, degrading an over-budget label to the authored target. Same rule and
 * same budget as the abbreviation expansion below; see abbr-budget.ts.
 */
function chargeCrossrefLabel(label: string, target: string, ctx: AnsiContext): string {
  return ctx.abbrBudget.charge(utf8ByteLength(label)) ? label : stripControls(target)
}

function style(text: string, codes: string): string {
  return `${codes}${text}${RESET}`
}

function renderBlocks(blocks: BlockNode[], ctx: AnsiContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderAnsi', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return blocks.map((b) => renderBlock(b, ctx)).join('')
  } finally {
    ctx.blockDepth--
  }
}

function renderBlock(node: BlockNode, ctx: AnsiContext): string {
  switch (node.type) {
    case 'heading':
      return renderHeading(node.level, renderInlines(node.children, ctx))
    case 'paragraph': {
      let content = renderInlines(node.children, ctx)
      const prefix = blockQuotePrefix(ctx)
      if (prefix) content = prefixLines(content, prefix)
      return `${content}\n\n`
    }
    case 'code_block':
      return renderCodeBlock(
        stripControls(node.content),
        node.lang ? stripControls(node.lang) : node.lang,
        node.header ? stripControls(node.header) : undefined,
        node.label ? stripControls(node.label) : undefined,
      )
    case 'block_quote':
      ctx.blockQuoteDepth++
      {
        const out = renderBlocks(node.children, ctx)
        ctx.blockQuoteDepth--
        return out
      }
    case 'list':
      return renderList(node, ctx)
    case 'thematic_break':
      return `${style('─'.repeat(40), DIM)}\n\n`
    case 'table':
      return renderTable(node, ctx)
    case 'admonition': {
      const body = renderBlocks(node.children, ctx)
      const title =
        node.title !== undefined ? renderInlines(unwrapStrong(node.title), ctx) : ''
      // Carry the blockquote `│` prefix onto a bold line, matching how the
      // paragraph renderer prefixes body content in a quote. `styled` is
      // already a styled string (title) or raw label text.
      const prefix = blockQuotePrefix(ctx)
      const boldLine = (styled: string): string =>
        prefix ? prefixLines(styled, prefix) : styled
      // Caption floor: surface an unconsumed grouping [label] as a bold line
      // (title first when both are present).
      const labelLine = node.label
        ? `${boldLine(style(stripControls(node.label), BOLD))}\n\n`
        : ''
      if (title !== '') {
        return `${boldLine(style(title, BOLD))}\n\n${labelLine}${body}`
      }
      return `${labelLine}${body}`
    }
    case 'line_block':
      return renderBlocks(node.children, ctx)
    case 'div': {
      if (!node.label) return renderBlocks(node.children, ctx)
      // Caption floor: a bold label line, prefixed with the blockquote `│` when
      // inside a quote (matching the admonition label/title and the div body).
      const prefix = blockQuotePrefix(ctx)
      const styled = style(stripControls(node.label), BOLD)
      const labelLine = prefix ? prefixLines(styled, prefix) : styled
      return `${labelLine}\n\n${renderBlocks(node.children, ctx)}`
    }
    case 'definition_list':
      return renderDefinitionList(node.items, ctx, true)
    case 'figure':
      return renderFigure(node, ctx)
    case 'figure_group': {
      // PART 11 degradation (D8), matching the plain-text shape: the GROUP
      // caption line first (styled like every caption on this target), a blank
      // line, then each child in source order - a panel as its caption line
      // over its host degradation, stray content as usual.
      let out = ''
      if (node.caption !== undefined) out += renderCaption(node.caption, ctx)
      for (const child of node.children) {
        out += child.type === 'figure' ? renderPanelFigure(child, ctx) : renderBlock(child, ctx)
      }
      return out
    }
    case 'image':
      // Block-level (standalone) image: emit the trailing block separator so a
      // following block is not glued to it, matching carve-php / carve-rs.
      return `${renderImage(node)}\n\n`
    case 'raw_block':
      return `${style(`[raw:${node.format}] ${stripControls(node.content)}`, DIM)}\n\n`
    case 'abbreviation_def':
      // PART 11 §10f: this target DROPS a definition whose own expansion it
      // emits, because the words would otherwise appear twice - once as this
      // dim line and once beside every occurrence. A definition whose expansion
      // reaches no output keeps its line, which is §10a and is what the pair
      // lookup answers; see abbr-expansion-emitted.ts.
      if (ctx.expandedDefinitions.has(abbreviationPairKey(node.abbr, node.expansion))) return ''
      return `${style(`*[${stripControls(node.abbr)}]: ${stripControls(node.expansion)}`, DIM)}\n\n`
    case 'comment':
      return ''
    case 'link_reference_definition':
    case 'citation_definition':
      // Renders nothing: a definition line is not prose. PART 12 §18 gave the
      // citation line a node without moving output on any target.
      return ''
    default: {
      const t: never = node
      throw new Error(`renderAnsi: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderHeading(level: number, content: string): string {
  const color =
    level === 1
      ? FG_BRIGHT_MAGENTA
      : level === 2
        ? FG_BRIGHT_CYAN
        : level === 3
          ? FG_BRIGHT_BLUE
          : level === 4
            ? FG_BRIGHT_GREEN
            : level === 5
              ? FG_BRIGHT_YELLOW
              : FG_BRIGHT_WHITE
  let out = style(content, BOLD + color)
  if (level <= 2) {
    const char = level === 1 ? '═' : '─'
    out += `\n${style(char.repeat(width(content)), color)}`
  }
  return `${out}\n\n`
}

function renderCodeBlock(content: string, lang?: string, header?: string, label?: string): string {
  let out = ''
  // PART 11 §10e T1: a fence's title (`"src/app.js"`) and grouping label
  // (`[Node]`) render the way a fenced div's already do on this target - a bold
  // standalone line each, above the block, the title always before the label.
  // Both are authored text, and docs/graceful-degradation.md forbids dropping
  // it. Folding them into the rule line instead was considered and rejected:
  // the rule line exists only when the fence has a LANGUAGE, so a titled fence
  // without one would have needed a rule line invented for it, and a fence
  // carrying both tokens would have needed a separator invented too.
  if (header) out += `${style(header, BOLD)}\n\n`
  if (label) out += `${style(label, BOLD)}\n\n`
  // The language keeps the slot this target already gave it, unchanged.
  if (lang) out += `${style(`┌── ${lang} `, DIM)}\n`
  for (const line of content.replace(/\n$/, '').split('\n')) {
    out += `${style(`  ${line}`, FG_BRIGHT_WHITE)}\n`
  }
  return `${out}\n`
}

function blockQuotePrefix(ctx: AnsiContext): string {
  return ctx.blockQuoteDepth > 0 ? `${style('│', FG_CYAN + DIM)} `.repeat(ctx.blockQuoteDepth) : ''
}

function prefixLines(content: string, prefix: string): string {
  return content.split('\n').map((line) => `${prefix}${line}`).join('\n')
}

function renderList(node: List, ctx: AnsiContext): string {
  ctx.listDepth++
  if (node.ordered) ctx.ordered[ctx.listDepth] = node.start ?? 1
  const out = node.items
    .map((item) => {
      const indent = '  '.repeat(ctx.listDepth - 1)
      let marker: string
      if (node.ordered) {
        const n = ctx.ordered[ctx.listDepth] ?? 1
        ctx.ordered[ctx.listDepth] = n + 1
        marker = style(`${n}.`, FG_YELLOW)
      } else if (item.checked !== undefined) {
        marker = item.checked ? style('☑', FG_GREEN) : style('☐', FG_BRIGHT_BLACK)
      } else {
        marker = style('•', FG_CYAN)
      }
      return `${indent}${marker} ${trimNonNbsp(renderBlocks(item.children, ctx))}\n`
    })
    .join('')
  ctx.listDepth--
  return ctx.listDepth === 0 ? `${out}\n` : out
}

function renderDefinitionList(items: DefinitionItem[], ctx: AnsiContext, trailingBlank: boolean): string {
  let out = ''
  for (const item of items) {
    for (const term of item.terms) out += `${style(renderInlines(term, ctx), BOLD + FG_YELLOW)}\n`
    for (const def of item.definitions) out += `  ${trimNonNbsp(renderBlocks(def, ctx))}\n`
  }
  return trailingBlank ? `${out}\n` : out
}

function renderTable(node: Table, ctx: AnsiContext): string {
  // Use the table's true column count (max cells across rows) so a row with
  // rowspan/colspan filler cells still emits every column and stays aligned
  // with the borders (matches the HTML/Markdown renderers and carve-php/rs).
  const cols = node.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  const rows = node.rows.map((row) => {
    const isHeader = row.cells.length > 0 && row.cells.every((c) => c.header)
    return Array.from({ length: cols }, (_, i) => {
      const cell = row.cells[i]
      const content = cell ? trimNonNbsp(renderInlines(cell.children, ctx)) : ''
      return { content, plain: stripAnsi(content), isHeader }
    })
  })
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell.plain))
    })
  }

  let out = ''
  let headerRendered = false
  if (rows.length) out += tableBorder(widths, 'top')
  for (const row of rows) {
    out += tableRow(row, widths)
    if (row[0]?.isHeader && !headerRendered) {
      out += tableBorder(widths, 'middle')
      headerRendered = true
    }
  }
  if (rows.length) out += tableBorder(widths, 'bottom')
  if (node.caption) out += renderCaption(node.caption, ctx)
  return `${out}\n`
}

function tableBorder(widths: number[], pos: 'top' | 'middle' | 'bottom'): string {
  const left = pos === 'top' ? '┌' : pos === 'middle' ? '├' : '└'
  const right = pos === 'top' ? '┐' : pos === 'middle' ? '┤' : '┘'
  const cross = pos === 'top' ? '┬' : pos === 'middle' ? '┼' : '┴'
  return `${style(left + widths.map((w) => '─'.repeat(w + 2)).join(cross) + right, DIM)}\n`
}

function tableRow(
  cells: Array<{ content: string; plain: string; isHeader: boolean }>,
  widths: number[],
): string {
  const sep = style('│', DIM)
  const parts = cells.map((cell, i) => {
    const padding = (widths[i] ?? 0) - width(cell.plain)
    const content = cell.isHeader
      ? style(cell.content + ' '.repeat(padding), BOLD)
      : cell.content + ' '.repeat(padding)
    return ` ${content} `
  })
  return `${sep}${parts.join(sep)}${sep}\n`
}

function renderFigure(node: Figure, ctx: AnsiContext): string {
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? trimEndNonNbsp(renderTable(node.target, ctx))
        : trimEndNonNbsp(renderBlock(node.target, ctx))
  const sep = node.target.type === 'block_quote' ? '\n\n' : '\n'
  return `${target}${sep}${renderCaption(node.caption, ctx)}`
}

function renderCaption(nodes: InlineNode[], ctx: AnsiContext): string {
  return `${style(trimNonNbsp(renderInlines(nodes, ctx)), ITALIC + DIM)}\n\n`
}

/**
 * A composite figure's PANEL on this target: caption line first, then the host
 * degradation (D8) - see the plain-text twin for why the order inverts.
 */
function renderPanelFigure(node: Figure, ctx: AnsiContext): string {
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? trimEndNonNbsp(renderTable(node.target, ctx))
        : trimEndNonNbsp(renderBlock(node.target, ctx))
  return `${style(trimNonNbsp(renderInlines(node.caption, ctx)), ITALIC + DIM)}\n${target}\n\n`
}

function renderFootnoteDefs(ast: Document, ctx: AnsiContext): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    // The marker as written (PART 10 §10a): the caret is part of the construct.
    out += `${style(`[^${stripControls(label)}]`, FG_CYAN + DIM)} ${trimNonNbsp(outsideLink(() => renderBlocks(blocks, ctx)))}\n`
  }
  return out
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

function renderInlines(nodes: InlineNode[], ctx: AnsiContext): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderAnsi', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    return nodes.map((node) => renderInline(node, ctx)).join('')
  } finally {
    ctx.inlineDepth--
  }
}

function renderInline(node: InlineNode, ctx: AnsiContext): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  switch (node.type) {
    case 'text':
      return cleanEscapedText(node)
    case 'escaped_text':
      return node.value
    case 'emphasis':
      return style(renderInlines(node.children, ctx), ITALIC)
    case 'strong': {
      // The combined bold-italic form is ONE construct, so it gets one style run
      // and one reset. Rendering it as nested strong-around-emphasis emitted a
      // reset per level (`ESC[1m ESC[3m x ESC[0m ESC[0m`); the second is
      // redundant, since a reset clears every attribute. carve-rs, which carries
      // bold-italic as a single kind, always emitted one (carve#352, corpus
      // 01-emphasis and both 128-bold-italic cases).
      const inner = node.children[0]
      if (node.boldItalic === true && node.children.length === 1 && inner?.type === 'emphasis') {
        return style(renderInlines(inner.children, ctx), BOLD + ITALIC)
      }
      return style(renderInlines(node.children, ctx), BOLD)
    }
    case 'underline':
      return style(renderInlines(node.children, ctx), UNDERLINE)
    case 'strike':
      return style(renderInlines(node.children, ctx), STRIKE)
    case 'subscript':
      // Subscript is NOT strikethrough; map to Unicode subscripts (mirrors
      // super), unmapped chars pass through.
      return toSubscript(renderInlines(node.children, ctx))
    case 'superscript':
      return toSuperscript(renderInlines(node.children, ctx))
    case 'highlight':
      return style(renderInlines(node.children, ctx), '\x1b[7m' + FG_YELLOW)
    case 'code':
      return style(stripControls(node.value), FG_BRIGHT_YELLOW)
    case 'link': {
      // An unresolved reference is literal source, not a link (PART 12 §3a):
      // the node survives serialization so the reference is not lost from the
      // tree, and every render target writes it back out as written.
      if (isUnresolvedReference(node)) return stripControls(node.rawRef ?? '')
      // Links never nest at the render seam (PART 12 §3a,
      // markup-carve/carve#817). The node stays in the tree as written, but
      // only the outermost destination gets ANSI link styling.
      if (insideLink) return renderInlines(node.children, ctx)
      const text = withinLink(() => renderInlines(node.children, ctx))
      // PART 9 §25 binds every target that emits a resolvable URL, and this
      // parenthetical IS the destination: a terminal autolinks it and hands the
      // scheme to the OS handler on click, which is the same "deferred by one
      // step" the clause describes for Markdown. It printed `javascript:` and
      // the OS protocol-handler schemes verbatim, in all three engines, where
      // Markdown already blanked them (carve#765).
      //
      // The destination is blanked, not the parenthetical dropped: §25 says to
      // emit an EMPTY value, and the empty parenthetical is what tells a reader
      // a destination was withheld rather than never written. The link TEXT is
      // untouched, exactly as in HTML - where a denied autolink still shows its
      // URL as text inside `<a href="">`.
      // WHETHER to show the parenthetical is decided from the AUTHORED
      // destination, and WHAT goes in it from the sanitized one. Deciding both
      // from the sanitized value turns a denied autolink - where the text IS the
      // URL, so no parenthetical was ever shown - into `javascript:alert(1) ()`.
      const authored = stripControls(node.href)
      const shows = authored && !authored.startsWith('#') && authored !== stripAnsi(text)
      let out = style(text, UNDERLINE + FG_BLUE)
      if (shows) {
        out += style(` (${blankDeniedDestination(authored)})`, DIM)
      }
      return out
    }
    case 'image':
      return renderImage(node)
    case 'span': {
      // carve#1127 again: the authored value wins, and the nested expansion is
      // not emitted. ANSI has no markup to carry a title, so the expansion is
      // parenthetical text - the same shape this target already uses for an
      // ordinary abbreviation, carrying the AUTHORED text (carve#1176).
      const authoredAbbr = node.attrs?.keyValues?.abbr
      if (authoredAbbr !== undefined) {
        const previous = suppressAutomaticAbbreviation
        suppressAutomaticAbbreviation = true
        try {
          const inner = renderInlines(node.children, ctx)
          if (authoredAbbr === '') return inner
          if (!ctx.abbrBudget.charge(utf8ByteLength(authoredAbbr))) return inner

          return `${inner}${style(` (${stripControls(authoredAbbr)})`, DIM)}`
        } finally {
          suppressAutomaticAbbreviation = previous
        }
      }

      return renderInlines(node.children, ctx)
    }
    case 'math':
      return style(stripControls(node.content), FG_BRIGHT_MAGENTA)
    case 'raw_inline':
      return ''
    case 'literal_inline':
      // §27: always emitted (unlike raw passthrough above). It is prose, not
      // code, so it carries no code styling.
      return stripControls(node.content)
    case 'symbol':
      return `:${stripControls(node.name)}:`
    case 'autolink':
      // Inside a link it is plain text, not a second styled link. Strip an
      // auto-added `mailto:` so the displayed label stays unchanged
      // (markup-carve/carve#817).
      if (insideLink) {
        const display = node.href.startsWith('mailto:') ? node.href.slice(7) : (node.text ?? node.href)
        return stripControls(display)
      }
      return style(
        stripControls(
          node.text ?? (node.href.startsWith('mailto:') ? node.href.slice(7) : node.href),
        ),
        UNDERLINE + FG_BLUE,
      )
    case 'mention':
      return `@${stripControls(node.user)}`
    case 'tag':
      return `#${stripControls(node.name)}`
    case 'inline_extension':
      return renderInlines(node.content, ctx)
    case 'abbreviation': {
      // Inside a span carrying its own `abbr`, only the visible text (carve#1127).
      if (suppressAutomaticAbbreviation) return stripControls(node.abbr)
      // DoS guard: once cumulative expansion bytes exceed the budget, degrade
      // to the plain key text only (no ` (EXPANSION)` suffix).
      // A degraded occurrence emits no expansion, so it records no pair and the
      // definition it came from keeps its line (PART 11 §10f).
      if (!ctx.abbrBudget.charge(utf8ByteLength(node.expansion)))
        return stripControls(node.abbr)
      ctx.expanded.add(abbreviationPairKey(node.abbr, node.expansion))
      return `${stripControls(node.abbr)}${style(` (${stripControls(node.expansion)})`, DIM)}`
    }
    case 'footnote_ref':
    case 'inline_footnote': {
      if (node.inline) {
        const inline = node.inline
        return `(${outsideLink(() => renderInlines(inline, ctx))})`
      }
      const id = stripControls(node.id ?? '')
      // An UNRESOLVED reference stays literal and UNSTYLED, exactly as the HTML
      // target renders it: the construct did not form, so `[^a]` is ordinary
      // text. Styling it cyan-bold and dropping the caret announced a footnote
      // the document does not have. carve-php already did this (carve#352,
      // corpus 132/133/157/161).
      if (!ctx.definedFootnotes.has(id)) return `[^${id}]`
      return style(`[${id}]`, FG_CYAN + BOLD)
    }
    case 'soft_break':
      return ' '
    case 'hard_break':
      return '\n'
    case 'insert':
      return style(renderInlines(node.children, ctx), FG_GREEN + UNDERLINE)
    case 'delete':
      return style(renderInlines(node.children, ctx), STRIKE + '\x1b[31m')
    case 'substitution':
      // Show BOTH sides; dropping oldText loses content.
      return (
        style(stripControls(node.oldText), STRIKE + '\x1b[31m') +
        style(stripControls(node.newText), FG_GREEN + UNDERLINE)
      )
      // A critic comment is VISIBLE content: the HTML target renders it as
      // `<span class="critic-comment"> note </span>`, so dropping it here made two
      // targets of one engine disagree about whether the document says it.
      // carve-php kept it (carve#352, corpus 33-editorial-markup).
    case 'critic_comment':
      return stripControls(node.text)
    case 'heading_ref':
      // Already inside a link's text: no second styling run, matching the HTML
      // target's suppression of the nested anchor.
      // Same expansion budget the abbreviation arm spends, degrading to the
      // authored target (markup-carve/carve-js#892). See abbr-budget.ts.
      if (node.href && insideLink)
        return chargeCrossrefLabel(renderInlines(node.resolvedText ?? [], ctx), node.target, ctx)
      // Resolved: styled like the link this crossref always rendered as. The
      // href is a same-document `#id`, which the link arm above deliberately
      // does not print, so neither does this.
      // Rendered IN the link context, because the styled run below is this
      // crossref's own link: a link cloned in from the target heading may not
      // nest inside it, and the resolver no longer unwraps the clone before the
      // renderer sees it (PART 12 §3a, markup-carve/carve#817).
      if (node.href) {
        return style(
          chargeCrossrefLabel(
            withinLink(() => renderInlines(node.resolvedText ?? [], ctx)),
            node.target,
            ctx,
          ),
          UNDERLINE + FG_BLUE,
        )
      }
      return `</#${stripControls(node.target)}>`
    case 'caption_number':
      return node.n === undefined ? '#' : String(node.n)
    case 'citation_group':
      // Tier-2 ext node; the core renderer has no numbering, so emit the source.
      return stripControls(node.raw)
    case 'comment':
      return ''
    case 'smart_punctuation':
      // Same rule as every other target: the switch asks for the authored run.
      if (ctx.smartSource) return node.value
      return node.glyph ?? SMART_PUNCTUATION_GLYPHS[node.kind] ?? node.value
    default: {
      const t: never = node
      throw new Error(`renderAnsi: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

function renderImage(node: { alt: string; src?: string; ref?: string; rawRef?: string }): string {
  // An unresolved reference image writes back as its source, like the link
  // arm above; `[img: alt]` would announce an image the document never had.
  // UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
  // `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref
  // no longer answers this question (carve#596).
  // Spelled out rather than shared: this arm takes the STRUCTURAL shape an
  // image writes back from, which carries no `type` for the shared predicate
  // to key on.
  if (node.ref !== undefined && !node.src) return stripControls(node.rawRef ?? '')
  const alt = stripControls(node.alt)
  return `${style('[img:', FG_MAGENTA)}${alt ? ` ${alt}` : ''}${style(']', FG_MAGENTA)}`
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

// East-Asian Wide / Fullwidth code points occupy two terminal columns; every
// other code point occupies one. Mirrors PHP's `mb_strwidth` for real content
// (CJK, Kana, Hangul, fullwidth forms, most emoji) so an ANSI table with CJK
// cells aligns with its box borders.
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

function width(text: string): number {
  // The §26 bidi controls are stripped from this target's output, but that
  // happens once over the assembled string at the end of renderAnsi. Every
  // width here is computed BEFORE that, so counting them measured characters
  // that were about to be deleted: a heading `A<U+202E>B<U+200B>C` drew a
  // five-cell rule under four cells, and carve-rs and carve-php drew four
  // because they strip per text node (carve#1085).
  //
  // Measuring the stripped text fixes all three callers at once - the heading
  // rule and both table-column computations - and is right independently of
  // the ordering: an override is a zero-width formatting character, so it
  // contributes nothing to display width whether or not it survives.
  let w = 0
  for (const ch of stripBidiControls(stripAnsi(text))) {
    w += isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1
  }
  return w
}

function toSuperscript(text: string): string {
  const map: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
    '=': '⁼',
    '(': '⁽',
    ')': '⁾',
    n: 'ⁿ',
    i: 'ⁱ',
  }
  return mapOutsideAnsi(text, map)
}

// Apply a per-character map, but leave ANSI escape sequences (e.g. `\x1b[4m`
// from a styled inline child) untouched — mapping their digits would corrupt
// the control codes and the terminal output.
function mapOutsideAnsi(text: string, map: Record<string, string>): string {
  return text
    .split(/(\x1b\[[0-9;]*m)/)
    .map((seg, i) =>
      i % 2 === 1 // odd segments are the captured escape sequences
        ? seg
        : Array.from(seg)
            .map((ch) => map[ch] ?? ch)
            .join(''),
    )
    .join('')
}

function toSubscript(text: string): string {
  const map: Record<string, string> = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
    '+': '₊',
    '-': '₋',
    '=': '₌',
    '(': '₍',
    ')': '₎',
    a: 'ₐ',
    e: 'ₑ',
    o: 'ₒ',
    x: 'ₓ',
  }
  return mapOutsideAnsi(text, map)
}

function normalize(text: string): string {
  // The internal non-breaking-space placeholder (U+E000) collapses to an
  // ordinary space in terminal output. Done after trimming so placeholder-
  // derived leading indentation survives; a literal U+00A0 is left intact.
  return `${trimNonNbsp(text.replace(/\n{3,}/g, '\n\n'))}\n`.replace(/\ue000/g, ' ')
}

function cleanEscapedText(node: Text): string {
  // The value is the literal text (the parser already resolved backslash
  // escapes), so a `\*` reaches here as `*`. Strip control bytes so attacker
  // text cannot inject terminal escape sequences (see stripControls).
  return stripControls(node.value)
}

/** Drop C0/C1 control characters (keeping tab and newline) from author content
 *  so attacker ESC / OSC sequences cannot inject into ANSI terminal output. The
 *  renderer's own styling escapes are added separately and are not affected. */
function stripControls(s: string): string {
  return s.replace(/\p{Cc}/gu, (c) => (c === '\t' || c === '\n' ? c : ''))
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
