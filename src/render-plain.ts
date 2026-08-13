import { AbbrBudget, budgetForDocument, utf8ByteLength } from './abbr-budget.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import type { BlockNode, DefinitionItem, Document, Figure, InlineNode, List, Table, Text } from './ast.js'
import { SMART_PUNCTUATION_GLYPHS } from './ast.js'
import { normalizeLegacyInline } from './legacy-nodes.js'
import type { SmartTypographyMode } from './render-markdown.js'
import { trimEndNonNbsp, trimNonNbsp } from './trim-non-nbsp.js'
import { stripBidiControls } from './bidi-controls.js'

export interface PlainTextRenderOptions {
  /**
   * `'source'` (or `false`) emits the run the author typed instead of the
   * resolved glyph. Accepted in both spellings because the HTML renderer took
   * the boolean and the Markdown one took the mode, so a caller passing the
   * shape it learned from one target silently got glyphs from another
   * (carve#560).
   */
  smartTypography?: SmartTypographyMode | boolean
}

/** Whether the switch asks for the authored run rather than the glyph. */
export function smartTypographyIsSource(
  value: SmartTypographyMode | boolean | undefined,
): boolean {
  return value === 'source' || value === false
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

export function renderPlainText(ast: Document, opts: PlainTextRenderOptions = {}): string {
  const ctx: PlainContext = {
    smartSource: smartTypographyIsSource(opts.smartTypography),
    listDepth: 0,
    blockDepth: 0,
    inlineDepth: 0,
    // This target expands a crossref label exactly as the other three do, so it
    // needs the same bound. It is the only expansion here - an abbreviation
    // renders as its key on this target - which is why there was no budget
    // until the crossref needed one (markup-carve/carve-js#892).
    abbrBudget: budgetForDocument(ast),
    definedFootnotes: new Set(Object.keys(ast.footnoteDefs ?? {})),
  }
  const out = renderBlocks(ast.children, ctx)
  const footnotes = renderFootnoteDefs(ast, ctx)
  return stripBidiControls(normalize(`${out}${footnotes}`))
}

interface PlainContext {
  smartSource: boolean
  listDepth: number
  blockDepth: number
  inlineDepth: number
  /** Per-render derived-text expansion budget (DoS guard). */
  abbrBudget: AbbrBudget
  /**
   * Labels that actually have a definition. A footnote reference without one did
   * not form a footnote, so it has to be reproduced as source text rather than
   * as a marker - which the HTML renderer does via `node.number`, a field this
   * path never populates because it does no numbering.
   */
  definedFootnotes: Set<string>
}

function renderBlocks(blocks: BlockNode[], ctx: PlainContext): string {
  if (ctx.blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderPlainText', MAX_RENDER_DEPTH)
  ctx.blockDepth++
  try {
    return blocks.map((b) => renderBlock(b, ctx)).join('')
  } finally {
    ctx.blockDepth--
  }
}

function renderBlock(node: BlockNode, ctx: PlainContext): string {
  switch (node.type) {
    case 'heading':
      return `${renderInlines(node.children, ctx)}\n\n`
    case 'paragraph':
      return `${renderInlines(node.children, ctx)}\n\n`
    case 'code_block':
      return `${stripControls(node.content)}\n\n`
    case 'block_quote': {
      const quoted = `"${trimNonNbsp(renderBlocks(node.children, ctx))}"`
      // The attribution is visible content, so a text target keeps it.
      // A BLANK LINE, not a single newline: the attribution is a separate block
      // in a text target, and the non-html parity test names that spacing.
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
      const body = renderBlocks(node.children, ctx)
      const title = node.title !== undefined ? renderInlines(node.title, ctx) : ''
      // Caption floor: surface an unconsumed grouping [label] as a standalone
      // line (title first when both are present).
      const labelLine = node.label ? `${stripControls(node.label)}\n\n` : ''
      if (title !== '') {
        return `${title}\n\n${labelLine}${body}`
      }
      return `${labelLine}${body}`
    }
    case 'div':
      return node.label
        ? `${stripControls(node.label)}\n\n${renderBlocks(node.children, ctx)}`
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
      return `${renderImageText(node)}\n\n`
    case 'abbreviation_def':
      // PART 10 §10a - see the note in render-markdown.
      return `*[${stripControls(node.abbr)}]: ${stripControls(node.expansion)}\n\n`
    case 'raw_block':
    case 'comment':
      return ''
    case 'link_reference_definition':
      // Renders nothing: a definition line is not prose.
      return ''
    default: {
      const t: never = node
      throw new Error(`renderPlainText: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderList(node: List, ctx: PlainContext): string {
  ctx.listDepth++
  let out = ''
  let counter = node.start ?? 1
  const indent = '  '.repeat(ctx.listDepth - 1)
  for (const item of node.items) {
    out += indent + (node.ordered ? `${counter}. ` : '- ')
    counter++
    let content = trimNonNbsp(renderBlocks(item.children, ctx))
    if (node.tight) {
      const nestedIndent = '  '.repeat(ctx.listDepth)
      content = content.replace(new RegExp(`\\n\\n(?=${nestedIndent}(?:-|\\d+[.)]) )`, 'g'), '\n')
    }
    out += `${content}\n`
  }
  ctx.listDepth--
  return `${out}\n`
}

function renderDefinitionList(items: DefinitionItem[], ctx: PlainContext, trailingBlank: boolean): string {
  let out = ''
  for (const item of items) {
    for (const term of item.terms) out += `${renderInlines(term, ctx)}\n`
    for (const def of item.definitions) out += `  ${trimNonNbsp(renderBlocks(def, ctx))}\n`
  }
  return trailingBlank ? `${out}\n` : out
}

function renderTable(node: Table, ctx: PlainContext): string {
  // Use the table's true column count (max cells across rows) so a row with
  // rowspan/colspan filler cells still emits every column (matches the HTML and
  // Markdown renderers and carve-php / carve-rs).
  const cols = node.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  let out = ''
  for (const row of node.rows) {
    const cells: string[] = []
    for (let i = 0; i < cols; i++) {
      cells.push(i < row.cells.length ? trimNonNbsp(renderInlines(row.cells[i]!.children, ctx)) : '')
    }
    // Drop only SYNTHETIC trailing padding (columns this row does not have, so
    // a short/rowspan row stays ragged: `A`, not `A | `), but KEEP a genuine
    // trailing empty cell the row authored (`| x || ` -> `x |`). Matches carve-rs.
    while (cells.length > row.cells.length && cells[cells.length - 1] === '') cells.pop()
    out += `${cells.join(' | ')}\n`
  }
  if (node.caption) out = `${trimEndNonNbsp(out)}\n${renderInlines(node.caption, ctx)}\n`
  return `${out}\n`
}

function renderFigure(node: Figure, ctx: PlainContext): string {
  const target =
    node.target.type === 'image'
      ? stripControls(node.target.alt)
      : node.target.type === 'table'
        ? trimNonNbsp(renderTable(node.target, ctx))
        : trimNonNbsp(renderBlock(node.target, ctx))
  // The caption sits on its own line directly under the figure (`\n`) - an
  // image target used to glue it on. A blockquote target keeps the blank-line
  // separation; a table drops the caption entirely. End with the block
  // separator so a following block is not glued (matching carve-php).
  const sep =
    node.target.type === 'block_quote' ? '\n\n' : node.target.type === 'table' ? '' : '\n'
  return `${target}${sep}${renderInlines(node.caption, ctx)}\n\n`
}

function renderFootnoteDefs(ast: Document, ctx: PlainContext): string {
  if (!ast.footnoteDefs) return ''
  let out = ''
  for (const [label, blocks] of Object.entries(ast.footnoteDefs)) {
    // The MARKER AS WRITTEN (PART 10 §10a): `[n]: …` is a link reference
    // definition, so emitting one where the author wrote a footnote definition
    // turns it into a different construct on the way back.
    out += `[^${stripControls(label)}]: ${trimNonNbsp(outsideLink(() => renderBlocks(blocks, ctx)))}\n`
  }
  return out
}

// An image contributes its alt text, EXCEPT when it is an unresolved reference
// (PART 12 §3a): there the document has no image, only the source the author
// wrote, and `alt` is the label out of its brackets.
function renderImageText(node: { alt: string; src?: string; ref?: string; rawRef?: string }): string {
  // UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
  // `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref
  // no longer answers this question (carve#596).
  if (node.ref !== undefined && !node.src) return stripControls(node.rawRef ?? '')

  return stripControls(node.alt)
}

function renderInlines(nodes: InlineNode[], ctx: PlainContext): string {
  if (ctx.inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderPlainText', MAX_RENDER_DEPTH)
  ctx.inlineDepth++
  try {
    return nodes.map((node) => renderInline(node, ctx)).join('')
  } finally {
    ctx.inlineDepth--
  }
}

/**
 * Is the renderer inside a link's text right now?
 *
 * Module-scoped rather than threaded through every signature: rendering is
 * synchronous and single-threaded. A footnote body renders outside any anchor,
 * so the flag is cleared for it.
 */
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

function renderInline(node: InlineNode, ctx: PlainContext): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  switch (node.type) {
    case 'text':
      return cleanEscapedText(node)
    case 'escaped_text':
      return node.value
    case 'emphasis':
    case 'strong':
    case 'underline':
    case 'superscript':
    case 'subscript':
    case 'highlight':
    case 'span':
    case 'insert':
    case 'strike':
      return renderInlines(node.children, ctx)
    case 'delete':
      return `~${renderInlines(node.children, ctx)}~`
    case 'code':
      return stripControls(node.value)
    case 'link':
      // An unresolved reference is literal source, not a link (PART 12 §3a):
      // the node survives serialization so the reference is not lost from the
      // tree, and every render target writes it back out as written.
      if (node.ref !== undefined && !node.href) return stripControls(node.rawRef ?? '')
      // Links never nest at the render seam (PART 12 §3a,
      // markup-carve/carve#817). The node stays in the tree as written, but
      // only the outermost link context applies while its label renders.
      if (insideLink) return renderInlines(node.children, ctx)
      return withinLink(() => renderInlines(node.children, ctx))
    case 'image':
      return renderImageText(node)
    case 'math':
      return stripControls(node.content)
    case 'raw_inline':
      return ''
    case 'literal_inline':
      // §27: always emitted (unlike raw passthrough above), as plain prose.
      return stripControls(node.content)
    case 'symbol':
      return `:${stripControls(node.name)}:`
    case 'autolink':
      // Raw autolink content: a URI autolink keeps its scheme, an email shows
      // the address; fall back to stripping an auto-added `mailto:`.
      if (insideLink) {
        const display = node.href.startsWith('mailto:') ? node.href.slice(7) : (node.text ?? node.href)
        return stripControls(display)
      }
      return stripControls(
        node.text ?? (node.href.startsWith('mailto:') ? node.href.slice(7) : node.href),
      )
    case 'mention':
      return `@${stripControls(node.user)}`
    case 'tag':
      return `#${stripControls(node.name)}`
    case 'inline_extension':
      return renderInlines(node.content, ctx)
    case 'abbreviation':
      return stripControls(node.abbr)
    case 'footnote_ref':
    case 'inline_footnote': {
      if (node.inline) {
        const inline = node.inline
        return `(${outsideLink(() => renderInlines(inline, ctx))})`
      }
      const id = stripControls(node.id ?? '')
      // An UNRESOLVED reference stays literal, exactly as the HTML target
      // renders it: the construct did not form, so `[^a]` is ordinary text and
      // dropping the caret invented a reference the document does not have.
      // carve-php already did this; carve-js and carve-rs both emitted `[a]`
      // (carve#352, corpus 132/133/157/161).
      return ctx.definedFootnotes.has(id) ? `[${id}]` : `[^${id}]`
    }
    case 'soft_break':
      return ' '
    case 'hard_break':
      return '\n'
    case 'substitution':
      // Keep both sides (old struck like critic-delete, then new).
      return `~${stripControls(node.oldText)}~${stripControls(node.newText)}`
      // A critic comment is VISIBLE content: the HTML target renders it as
      // `<span class="critic-comment"> note </span>`, so dropping it here made two
      // targets of one engine disagree about whether the document says it.
      // carve-php kept it (carve#352, corpus 33-editorial-markup).
    case 'critic_comment':
      return stripControls(node.text)
    case 'heading_ref':
      // Resolved: the target heading's text, which is what a reader of plain
      // text can act on. The authored `</#target>` stays in the tree.
      // Same expansion budget the other targets spend on this label, degrading
      // to the authored target (markup-carve/carve-js#892).
      if (node.href) {
        const label = renderInlines(node.resolvedText ?? [], ctx)
        return ctx.abbrBudget.charge(utf8ByteLength(label)) ? label : stripControls(node.target)
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
      // The node carries the source run in `value`, so honoring the switch
      // needs no parser cooperation (PART 9 §8).
      if (ctx.smartSource) return node.value
      return node.glyph ?? SMART_PUNCTUATION_GLYPHS[node.kind] ?? node.value
    default: {
      const t: never = node
      throw new Error(`renderPlainText: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

function normalize(text: string): string {
  // The internal non-breaking-space placeholder (U+E000) collapses to an
  // ordinary space in plain text. Done after trimming so placeholder-derived
  // leading indentation (e.g. in a line block) survives; a literal U+00A0 in
  // the author's text is left intact.
  // Trim only BLANK LINES, not the indentation of the first or last content line.
  // A document that opens with a fenced code block whose first line is indented had
  // that indentation eaten here, so a tab the HTML target emits inside `<code>`
  // vanished from plain text (carve#352, corpus 11-fenced-code-2). Code content is
  // data, and a document-level trim has no business reaching into it.
  // The two ends need different rules. At the START, trim blank lines only: the
  // indentation of the first content line is data - a document opening with a
  // fenced code block whose first line is indented had that eaten here, so a tab
  // the HTML target emits inside `<code>` vanished (carve#352, corpus
  // 11-fenced-code-2). At the END, trailing whitespace is trimmed as before,
  // because there it is layout rather than content: a table row ending in an empty
  // cell renders `x | ` and that space is an artifact of the separator.
  const body = trimEndNonNbsp(text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''))
  return `${body}\n`.replace(/\ue000/g, ' ')
}

function cleanEscapedText(node: Text): string {
  // The value is the literal text (the parser already resolved backslash
  // escapes), so a `\*` reaches here as `*`. Strip control bytes so attacker
  // text cannot inject terminal escape sequences (see stripControls).
  return stripControls(node.value)
}

/**
 * Drop what this target cannot carry, from author content on its way to the
 * output.
 *
 * THE NON-WHITESPACE C0 CONTROLS ARE CONTENT AND ARE EMITTED. PART 9 section 29
 * T3 rules that U+0000..U+0008, U+000B, U+000C and U+000E..U+001F are ordinary
 * content on this target, because after markup-carve/carve#963 the whitespace
 * of the language is exactly U+0020, U+0009, U+000A and U+000D. Plain text
 * follows Markdown here rather than the terminal, because it is a TEXT
 * SERIALIZATION and not a terminal format - section 29 records that half as a
 * judgement rather than a measurement (markup-carve/carve-js#896).
 *
 * What is still dropped, and why each one is not that class:
 *
 * - U+000D is WHITESPACE after carve#963, so section 29 excludes it.
 * - DEL (U+007F) and the C1 controls (U+0080..U+009F) sit outside section 29 by
 *   T5, and CSI (U+009B) and OSC (U+009D) are single-character forms of the
 *   sequences section 25 exists to stop.
 *
 * THE ANSI TARGET IS NOT THIS TARGET and keeps the broad strip - it is the one
 * consumer that acts on the character (section 29 T4). Narrowing `render-ansi.ts`
 * to match this is a security regression, not a consistency win.
 */
function stripControls(s: string): string {
  return s.replace(/[\u000d\u007f-\u009f]/gu, '')
}
