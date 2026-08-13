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

function renderBlock(node: BlockNode, ctx: MarkdownContext): string {
  switch (node.type) {
    case 'heading': {
      // A folded heading's line join takes PART 7's four characters. The class
      // was `\s` with one carve-out, so it swallowed a vertical tab beside the
      // newline that the HTML target kept.
      const text = trimNonNbsp(renderInlines(node.children, ctx).replace(/[ \t\r]*\n[ \t\r]*/g, ' '))
      const id = node.attrs?.id
      const suffix = id && ctx.referencedHeadingIds.has(id) ? ` {#${id}}` : ''
      return `${'#'.repeat(node.level)} ${text}${suffix}\n\n`
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
      const lines = trimNonNbsp(renderBlocks(node.children, ctx)).split('\n')
      const quoted = lines.map((line) => `> ${line}`).join('\n')
      // Markdown has no attribution slot, so the source follows the quote as an
      // ordinary paragraph rather than being dropped - the same treatment an
      // admonition title gets here.
      const attribution =
        node.attribution === undefined ? '' : `\n\n${renderInlines(node.attribution, ctx)}`
      return `${quoted}${attribution}\n\n`
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
    case 'image':
      // Block-level (standalone) image: emit the trailing block separator so a
      // following block is not glued to it, matching carve-php / carve-rs.
      return `${renderImage(node)}\n\n`
    case 'raw_block':
      // Escape, not emit: raw HTML in Markdown would be live again downstream.
      return node.format === 'html' ? `${escapeMdHtml(stripControls(node.content))}\n\n` : ''
    case 'abbreviation_def':
      // PART 10 §10a: a definition NOTHING references still reaches this
      // target. HTML drops it because it has nowhere to put one; Markdown,
      // plain text and the terminal do not get to drop content the author
      // wrote, and dropping it made the output depend on whether a reference
      // exists elsewhere in the document (carve#589).
      // The definition line goes through `escapeMdHtml` for the same reason the
      // `<abbr>` built from it does: an expansion is author content, and this
      // target's contract is that embedded HTML cannot become live markup
      // downstream. Writing the occurrence escaped and the definition raw made
      // one output disagree with itself (markup-carve/carve-js#894).
      return `*[${escapeMdHtml(stripControls(node.abbr))}]: ${escapeMdHtml(stripControls(node.expansion))}\n\n`
    case 'comment':
      return ''
    case 'link_reference_definition':
      // Renders nothing, same as carve-php on this target. The definition's
      // destination already reached every link that resolved it, and Markdown's
      // own reference form is not what this writer emits.
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
    const content = trimNonNbsp(renderListItem(item, ctx))
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
    out += `${prefix}${lines.shift() ?? ''}\n`
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
    for (const def of item.definitions) out += `: ${trimNonNbsp(renderBlocks(def, ctx))}\n`
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
  out += `${rows.join('\n')}\n\n`
  return out
}

function renderFigure(node: Figure, ctx: MarkdownContext): string {
  const target =
    node.target.type === 'image'
      ? renderImage(node.target)
      : node.target.type === 'table'
        ? trimNonNbsp(renderTable(node.target, ctx))
        : trimNonNbsp(renderBlock(node.target, ctx))
  // The caption sits on its own line directly under the figure (`\n`) - an
  // image target used to glue it on (`![a](/u)cap`). A blockquote target keeps
  // the blank-line separation; a table drops the caption entirely.
  const sep =
    node.target.type === 'block_quote' ? '\n\n' : node.target.type === 'table' ? '' : '\n'
  // End with the block separator so a following block is not glued to the
  // caption (matching every other block renderer and carve-php).
  return `${target}${sep}${renderInlines(node.caption, ctx)}\n\n`
}

function renderFootnoteDefs(ast: Document, ctx: MarkdownContext): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    // A label is author content, and it is reproduced verbatim in two places;
    // both escape, so a reference still matches its definition (carve-js#894).
    out += `[^${escapeMdHtml(stripControls(label))}]: ${trimNonNbsp(outsideLink(() => renderBlocks(blocks, ctx)))}\n`
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
      // Reproduce the author's escape. `\-\-` was written precisely so a
      // downstream processor with smart punctuation on would not read an en
      // dash; emitting the character bare loses exactly that (carve#350).
      //
      // NO SENTINEL HERE, and section 8a says why: M1b is a rule about a
      // character that reached this writer inside a TEXT node - one the Carve
      // grammar did not read as an opener and the author did not mark. This is
      // the other case. The author said which reading they meant, M2 gives it
      // back whatever the character, and the line test never sees it. The
      // underscore used to take the sentinel here and lose its backslash to
      // the intraword rule, which is M1b deciding a node M1 never governed.
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
      if (node.ref !== undefined && !node.href) return escapeText(node.rawRef ?? '')
      // Links never nest at the render seam (PART 12 §3a,
      // markup-carve/carve#817). The node stays in the tree as written, but
      // only the outermost destination reaches rendered Markdown.
      if (insideLink) return renderInlines(node.children, ctx)
      return renderLink(node, ctx)
    case 'image':
      return renderImage(node)
    case 'span':
      return renderInlines(node.children, ctx)
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
      return ctx.smartTypography === 'source'
        ? node.value
        : (node.glyph ?? SMART_PUNCTUATION_GLYPHS[node.kind] ?? node.value)
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
  if (node.ref !== undefined && !node.src) return escapeText(node.rawRef ?? '')
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
 * - the section 8a sentinels, which are this renderer's own: author content
 *   carrying one would reach normalize() and be read as an escape this
 *   renderer emitted.
 *
 * The ANSI target keeps the broad strip and MUST: it is the one consumer that
 * acts on the character (\u00a729 T4).
 */
function stripControls(s: string): string {
  return s.replace(/[\u000d\u007f-\u009f\ue004-\ue006]/gu, '')
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
 * the probe class is another, and this one also removes the sentinels the probe
 * has no reason to know about. Narrowing THIS call along with the emit path
 * would still be wrong, so the two remain separate functions rather than one
 * with a flag.
 */
function stripDestinationControls(s: string): string {
  return s.replace(/\p{Cc}|[\ue004-\ue006]/gu, (c) => (c === '\t' || c === '\n' ? c : ''))
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
 * Sentinels standing in for the escapes section 8a decides on the LINE.
 *
 * One per narrowed character. U+E000 is the NBSP sentinel and render-carve
 * claims U+E001..U+E003; this extends the scheme. Author content never carries
 * one: stripControls() drops the whole range on the way in, and every path to
 * the output runs through stripControls().
 */
const NARROWED_SENTINEL: Record<string, string> = {
  _: '\ue004',
  '#': '\ue005',
  '[': '\ue006',
}
const NARROWED_CHARACTER: Record<string, string> = {
  '\ue004': '_',
  '\ue005': '#',
  '\ue006': '[',
}
const RE_NARROWED_SENTINEL = /[\ue004-\ue006]/g
const HAS_NARROWED_SENTINEL = /[\ue004-\ue006]/

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
  const line = text.replace(RE_NARROWED_SENTINEL, (s) => NARROWED_CHARACTER[s]!)

  return text.replace(RE_NARROWED_SENTINEL, (s, offset: number) => {
    const ch = NARROWED_CHARACTER[s]!
    return adjacentToLiveDelimiter(line, offset, ch) ? `\\${ch}` : ch
  })
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
