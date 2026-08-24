/*
 * Lint for silent-failure problems in Carve documents.
 *
 * djotMigrationWarnings (djot-migrate.ts) catches *source-level* delimiter
 * collisions. This module catches markup that parses without error but
 * renders as the wrong thing, so nothing throws:
 *
 *   - references that degrade to literal text at resolve() time: broken
 *     `</#id>` cross-references, unresolved `[text][ref]` links, missing
 *     footnotes, and duplicate heading ids;
 *   - footnote definitions that are duplicate or never referenced;
 *   - a trailing `{…}` on a heading, which is literal text under
 *     heading-strict, not an attribute block;
 *   - a ```raw FORMAT fence (the Carve raw block is ```=FORMAT; the wrong
 *     form fails to open and desyncs the rest of the document's fences);
 *   - a line that begins with a block marker (`:::`, `{#`, `{.`) yet parsed
 *     as a paragraph because the block never opened; a fence opener whose
 *     trailing text is an unquoted, curly-quoted, or `{…}`-shaped title gets
 *     a targeted "did you mean" hint instead of the generic warning.
 *
 * The id/crossref checks mirror resolveHeadingIds so they agree with what the
 * resolver actually does - they do not re-run resolve (which would discard the
 * very nodes we want to flag by turning a broken crossref or unresolved ref
 * into a Text node). The remaining checks read the source line at each node's
 * position and skip verbatim regions (code/raw blocks) the parser already
 * accounts for.
 */
import {
  parse,
  isTableRow,
  readCellAttributeBlock,
  rowAttrsFromLine,
  splitTableRowSpans,
  stripContainerPrefixesKeepIndent,
  RE_AFTER_TERM,
  TABLE_ALIGNMENT_MARKERS,
  type UnclosedContainer,
} from './parse.js'
import {
  slugify,
  inlineText,
  headingIdSlugOpts,
  normalizeHeadingRefLabel,
  headingRefKeyFromLabel,
  isCollapsedRef,
  figureGroupPanels,
  type AsciiHeadingIdMode,
} from './heading-ids.js'
import { readStamp, compareSpecVersions } from './stamp.js'
import { SPEC_VERSION } from './version.js'
import { hasOwnKey } from './own-property.js'
import { isBidiControl } from './bidi-controls.js'
import { renderedAttrValue, escapeAttrValue } from './render-html.js'
import type { Attrs, BlockNode, Document, Heading, Table } from './ast.js'

export interface LintWarning {
  /** 1-based line number. */
  line: number
  /** 1-based column number. */
  column: number
  /** Stable rule id, e.g. "broken-crossref". */
  rule: string
  /** Human-readable explanation of the silent degradation. */
  message: string
  /**
   * 0-based start offset in the source, inclusive, in UTF-16 code units - the
   * unit a JavaScript caller slices a string with.
   *
   * Deliberately NOT the codepoint positions PART 12 section 4 pins for a
   * serialized AST: this struct is a diagnostic for JS consumers (carve-lsp,
   * editors), and handing them codepoint offsets would silently highlight the
   * wrong text on any document containing an astral character.
   */
  start: number
  /** 0-based end offset in the source, exclusive, in UTF-16 code units. */
  end: number
}

interface Positioned {
  pos?: {
    startLine: number
    endLine?: number
    startColumn?: number
    startOffset?: number
    endOffset?: number
  }
}

/**
 * Parser offset -> UTF-16 offset into the source the CALLER passed.
 *
 * Two things separate the two units, and the map has to undo both:
 *
 *   ASTRAL CHARACTERS. The AST carries codepoint positions (PART 12 section 4);
 *   a LintWarning reports the unit its JavaScript consumers index a string with.
 *   UTF-16 and codepoints agree across the whole Basic Multilingual Plane, so
 *   this only matters above it.
 *
 * CRLF USED TO BE A SECOND CONCERN HERE AND NO LONGER IS. The parser measured
 * offsets over line-ending-normalized text, so every preceding CRLF line made a
 * raw offset undercount by one against the original string, and this map
 * compensated by skipping the `\r` of each pair. The undercount was missed for
 * a long time because the map returned identity whenever the document had no
 * astral character - exactly the CRLF case (carve-js#545).
 *
 * The parser now measures the source as given (carve#876), so the compensation
 * would double-count and this is a plain codepoint-to-UTF-16 map again. The
 * CRLF tests in `test/lint-offsets-crlf.test.ts` still hold, which is what says
 * the fix moved rather than disappeared.
 */
function codepointToUtf16Map(source: string): Uint32Array | undefined {
  let needsMap = false
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      needsMap = true
      break
    }
  }
  if (!needsMap) return undefined

  // One entry per codepoint OF THE SOURCE AS GIVEN - the unit the parser now
  // counts in - each holding the UTF-16 index of that codepoint.
  const utf16At: number[] = []
  for (let i = 0; i < source.length; ) {
    const code = source.charCodeAt(i)
    utf16At.push(i)
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < source.length ? 2 : 1
  }
  utf16At.push(source.length)
  return Uint32Array.from(utf16At)
}

function locate(
  node: Positioned,
  toUtf16: (offset: number) => number,
): Pick<LintWarning, 'line' | 'column' | 'start' | 'end'> {
  const p = node.pos
  return {
    line: p?.startLine ?? 1,
    column: p?.startColumn ?? 1,
    start: toUtf16(p?.startOffset ?? 0),
    end: toUtf16(p?.endOffset ?? p?.startOffset ?? 0),
  }
}

function walkDocument(doc: Document, visitNode: (node: Record<string, unknown>) => void): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    visitNode(node)
    for (const key of Object.keys(node)) {
      if (key !== 'pos' && key !== 'attrs') visit(node[key])
    }
  }
  visit(doc.children)
  if (doc.footnoteDefs) visit(Object.values(doc.footnoteDefs))
}

/** Every `crossref` node anywhere under the document, with its raw target. */
function collectCrossrefs(doc: Document): Array<{ target: string; node: Positioned }> {
  const found: Array<{ target: string; node: Positioned }> = []
  walkDocument(doc, (node) => {
    if (node.type === 'heading_ref' && typeof node.target === 'string') {
      found.push({ target: node.target, node: node as Positioned })
    }
  })
  return found
}

function collectUnresolvedRefLinks(
  doc: Document,
): Array<{ ref: string; rawRef: string; collapsed: boolean; node: Positioned }> {
  const found: Array<{ ref: string; rawRef: string; collapsed: boolean; node: Positioned }> = []
  walkDocument(doc, (node) => {
    // UNRESOLVED means no destination. PART 12 §3a keeps `ref` and `rawRef` on
    // a RESOLVED reference too, so a ref alone no longer answers this
    // (carve#596) - flagging on it reported every working reference link.
    if (node.type !== 'link' || typeof node.ref !== 'string') return
    if (typeof node.href === 'string' && node.href !== '') return
    found.push({
      ref: node.ref,
      rawRef: typeof node.rawRef === 'string' ? node.rawRef : `[${node.ref}]`,
      // The SPELLING, read off the same field the resolver reads it off, so the
      // mirror below cannot disagree with resolveHeadingIds about which
      // references the heading index is even offered to.
      collapsed: isCollapsedRef(
        node.ref,
        typeof node.rawRef === 'string' ? node.rawRef : undefined,
      ),
      node: node as Positioned,
    })
  })
  return found
}

function collectFootnoteRefs(doc: Document): Array<{ id: string; node: Positioned }> {
  const found: Array<{ id: string; node: Positioned }> = []
  walkDocument(doc, (node) => {
    if ((node.type === 'footnote_ref' || node.type === 'inline_footnote') && typeof node.id === 'string') {
      found.push({ id: node.id, node: node as Positioned })
    }
  })
  return found
}

function captionHasNumber(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (node) =>
        node &&
        typeof node === 'object' &&
        (node as { type?: string }).type === 'caption_number',
    )
  )
}

/**
 * Lint a Carve document for silent-failure problems: duplicate heading ids,
 * `</#id>` cross-references with no target, unresolved reference links,
 * missing/duplicate/unused footnotes, trailing heading attribute blocks,
 * legacy `raw FORMAT` fences, and block markers that leaked as paragraph text.
 *
 * `asciiHeadingIds` must match the value passed to `resolve()`, since it
 * changes how heading slugs (and therefore the valid id set) are computed.
 */

/**
 * Warn when a document declares a Carve spec version this engine does not
 * implement, so a construct the author is relying on may be silently absent.
 *
 * The DECLARATION is frontmatter `carve-version:`, which is the author-facing
 * field - a trailing `%% carve-version:` marker is tool-written provenance, not
 * something anyone hand-writes. When there is no frontmatter declaration the
 * marker is used as a fallback, so a stamped document still gets the check.
 * Neither present means no diagnostic: declaring a version stays optional.
 *
 * Frontmatter is raw uninterpreted text by design (the application decides what
 * the declared format means), so the key is read with a line-anchored match
 * rather than by parsing YAML.
 */
function checkDeclaredVersion(source: string, doc: Document, push: (w: LintWarning) => void): void {
  const declared = declaredVersion(source, doc)
  if (!declared) return

  const { version, offset } = declared
  const known = /^\d+(\.\d+)*$/.test(version)
  if (known && compareSpecVersions(version, SPEC_VERSION) <= 0) return

  const before = source.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - (before.lastIndexOf('\n') + 1) + 1
  push({
    line,
    column,
    rule: 'carve-version-unsupported',
    message: known
      ? `document declares Carve ${version}; this engine implements ${SPEC_VERSION}, ` +
        'so constructs added after that version will not render as intended'
      : `document declares an unrecognized Carve version ${JSON.stringify(version)}; ` +
        `this engine implements ${SPEC_VERSION}`,
    start: offset,
    end: offset + version.length,
  })
}

/** The declared version and the offset of the version text itself, or null. */
function declaredVersion(source: string, doc: Document): { version: string; offset: number } | null {
  const front = doc.frontmatter
  if (front) {
    const match = /^[ \t]*carve-version[ \t]*:[ \t]*(\S+)[ \t]*$/m.exec(front.content)
    if (match) {
      // Frontmatter opens the document, so its raw content appears verbatim in
      // the source and the offset of the value is findable without re-parsing.
      const blockAt = source.indexOf(front.content)
      const valueInBlock = match.index + match[0].lastIndexOf(match[1]!)
      if (blockAt >= 0) return { version: match[1]!, offset: blockAt + valueInBlock }
    }
  }

  const stamp = readStamp(source)
  if (!stamp) return null
  const at = source.lastIndexOf(stamp.version)
  return { version: stamp.version, offset: at >= 0 ? at : 0 }
}

export function lintCarve(
  source: string,
  opts: {
    asciiHeadingIds?: AsciiHeadingIdMode
    lowercaseHeadingIds?: boolean
    /** Deprecated compatibility option; blockquote marker spacing is now core syntax. */
    portable?: boolean
    /**
     * Hosts to additionally check for bare tokens they re-linkify in published
     * output (markup-carve/carve#297). EMPTY BY DEFAULT, and that is the ruled
     * behavior: every other rule here reports a silent failure in Carve, while
     * these are target-specific, so `lintCarve(source)` never emits one for any
     * input.
     */
    platforms?: readonly LintPlatform[]
    /**
     * The extensions the caller actually renders with, so the semantic-attribute
     * rules can describe the output the author will get (markup-carve/carve#1167).
     *
     * PART 9 §9 splits the reserved names by tier: core renders `abbr`, `time`
     * and `kbd` as elements, and `samp`, `var`, `cite` and `dfn` only become
     * elements once the SemanticSpan extension is enabled. In a core render
     * those four stay ORDINARY attributes and their value reaches the output
     * intact, so reporting it as discarded reports a loss that is not
     * happening - the same defect these rules exist to catch, pointed the other
     * way. With the extension on, the value IS dropped and the report is right.
     *
     * Pass what you pass to `carveToHtml`. Omitted means a core render.
     */
    extensions?: readonly { name?: string; semanticSpanNames?: readonly string[] }[]
  } = {},
): LintWarning[] {
  const unclosedContainers: UnclosedContainer[] = []
  const doc = parse(source, {
    positions: true,
    onUnclosedContainer: (container) => unclosedContainers.push(container),
  })
  // The AST carries codepoint positions over line-ending-normalized text; a
  // LintWarning reports UTF-16 into the source the caller passed, so a JS
  // consumer can slice it. Identity only when neither differs.
  const utf16At = codepointToUtf16Map(source)
  const toUtf16 = (offset: number): number => (utf16At ? (utf16At[offset] ?? source.length) : offset)
  const slugOpts = headingIdSlugOpts(opts)
  // Cross-references resolve case-insensitively, so the broken-crossref check
  // folds case the same way resolveHeadingIds does.
  const foldId = (s: string): string =>
    Array.from(s, (c) => c.toLowerCase()).join('')
  const out: LintWarning[] = []

  // Canonical Carve deliberately preserves these source characters for a
  // lossless round trip. Presentation targets strip them, so make that quiet
  // target difference visible to authors without making the writer lossy.
  let line = 1
  let column = 1
  for (let i = 0; i < source.length; ) {
    const codePoint = source.codePointAt(i)!
    const width = codePoint > 0xffff ? 2 : 1
    if (isBidiControl(codePoint)) {
      out.push({
        line,
        column,
        rule: 'bidi-control-in-source',
        message:
          `Bidi override/isolate control U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ` +
          'is preserved by canonical Carve but stripped from presentation output; remove it unless intentional.',
        start: i,
        end: i + width,
      })
    }
    if (codePoint === 0x0d) {
      if (source.charCodeAt(i + width) === 0x0a) i++
      line++
      column = 1
    } else if (codePoint === 0x0a) {
      line++
      column = 1
    } else {
      column++
    }
    i += width
  }

  for (const container of unclosedContainers) {
    out.push({
      line: container.line,
      column: container.column,
      rule: 'unclosed-container-fence',
      message:
        `This ${container.fenceWidth}-colon ${container.kind} has no closer; it runs to ` +
        `the end of the document. Add a bare fence of ${container.fenceWidth} colons to close it.`,
      start: container.startOffset,
      end: container.endOffset,
    })
  }

  checkDeclaredVersion(source, doc, (w) => out.push(w))

  // A template tag and PART 9 §21a deliberately have the same surface shape.
  // Template hosts normally run first, but `{% raw %}` hands the converter bare
  // tags; once parsed, those tags are indistinguishable from comments. Report
  // the collision and leave the source untouched.
  // ONE WARNING PER TAG-SHAPED COMMENT, not one per document and not one for
  // every braced comment in a document that has one. The report points at the
  // constructs that vanish; an ordinary note in the same file is not one of
  // them, and the file's second `{% endif %}` is (carve validation.md).
  const templateTag = /^(?:raw|endraw|endif|endfor|endblock|if\s+.+|for\s+.+|block\s+.+)$/s
  walkDocument(doc, (node) => {
    if (node.type !== 'comment' || node.delimited !== true) return
    if (typeof node.content !== 'string' || !templateTag.test(node.content.trim())) return
    out.push({
      ...locate(node as Positioned, toUtf16),
      rule: 'braced-comment-in-a-template-source',
      message:
        'This braced comment is a template tag. Liquid, Nunjucks, or Twig source may have reached Carve as text; the tag is parsed as an invisible comment.',
    })
  })

  // Build the final heading-id set exactly as resolveHeadingIds does
  // (explicit ids win; colliding slugs get a `-2`, `-3`, … suffix), and warn
  // on every collision along the way.
  const used = new Set<string>()
  const headingRefs = new Map<string, string>()
  // Mirror resolveHeadingIds: a heading inside a list/blockquote/div/etc. also
  // gets an id and is a valid crossref target, so the lint index must walk the
  // same containers in document order. A blockquote ancestor suppresses the
  // implicit `[label][]` reference target (matching the resolver / carve-php).
  const indexHeadings = (blocks: BlockNode[], inBlockquote: boolean): void => {
    for (const block of blocks) {
      switch (block.type) {
        case 'heading': {
          const heading = block as Heading
          const explicit = heading.attrs?.id
          let id: string
          if (explicit !== undefined) {
            id = explicit
            if (used.has(explicit)) {
              out.push({
                ...locate(heading, toUtf16),
                rule: 'duplicate-heading-id',
                message: `Duplicate heading id "${explicit}": the repeated HTML id is invalid, and cross-references to it resolve to the first occurrence.`,
              })
            }
            used.add(explicit)
          } else {
            const base = slugify(inlineText(heading.children), slugOpts)
            if (used.has(base)) {
              let n = 2
              while (used.has(`${base}-${n}`)) n++
              id = `${base}-${n}`
              out.push({
                ...locate(heading, toUtf16),
                rule: 'duplicate-heading-id',
                message: `Heading slug "${base}" collides with an earlier heading; its auto id becomes "${id}", and ambiguous references to "${base}" resolve to the first occurrence.`,
              })
              used.add(id)
            } else {
              id = base
              used.add(base)
            }
          }
          if (!inBlockquote) {
            const key = normalizeHeadingRefLabel(inlineText(heading.children))
            if (key && !headingRefs.has(key)) headingRefs.set(key, id)
          }
          break
        }
        case 'block_quote':
          indexHeadings(block.children, true)
          break
        case 'admonition':
        case 'div':
        case 'figure_group':
          indexHeadings(block.children, inBlockquote)
          break
        case 'list':
          for (const it of block.items) indexHeadings(it.children, inBlockquote)
          break
        case 'definition_list':
          for (const it of block.items)
            for (const d of it.definitions) indexHeadings(d, inBlockquote)
          break
        case 'figure':
          if (block.target.type === 'block_quote')
            indexHeadings(block.target.children, true)
          break
        default:
          break
      }
    }
  }
  indexHeadings(doc.children, false)

  // Captioned tables/figures with a `#` caption-number placeholder and an id
  // are also valid cross-reference targets after resolve() numbers captions.
  walkDocument(doc, (node) => {
    const attrs = node.attrs as { id?: string } | undefined
    if (attrs?.id === undefined) return
    if (node.type === 'table' && captionHasNumber(node.caption)) used.add(attrs.id)
    if (node.type === 'figure' && captionHasNumber(node.caption)) used.add(attrs.id)
  })

  // Composite figures (PART 9 §4c): register the crossref targets a NUMBERED
  // group creates - its own id and its panels' ids (resolved as "Figure Na") -
  // and report the shapes that silently do less than they look like they do.
  const checkFigureGroups = (blocks: BlockNode[]): void => {
    for (const b of blocks) {
      switch (b.type) {
        case 'admonition':
          // A bare `::: figure` only parses as an admonition when an OPEN
          // group's body demoted it (groups do not nest); one carrying a
          // title or [label] never matched the figure production at all.
          if (b.kind === 'figure') {
            if (b.title !== undefined || b.label !== undefined) {
              out.push({
                ...locate(b, toUtf16),
                rule: 'figure-group-opener-metadata',
                message:
                  'A "::: figure" opener carrying a quoted title or [label] is not a composite figure; it renders as a generic container. Drop the title/label to open a figure group.',
              })
            } else {
              out.push({
                ...locate(b, toUtf16),
                rule: 'figure-group-nested',
                message:
                  'A "::: figure" inside a composite figure does not nest; it renders as a generic container. Move it out of the enclosing group.',
              })
            }
          }
          checkFigureGroups(b.children)
          break
        case 'figure_group': {
          // The panel predicate has ONE spelling (figureGroupPanels), shared
          // with the numbering pass, so the lint cannot drift from what the
          // resolver registers.
          const panels = figureGroupPanels(b)
          if (panels.length === 0) {
            out.push({
              ...locate(b, toUtf16),
              rule: 'figure-group-empty',
              message:
                'This "::: figure" group holds no captionable panel; the panels wrapper renders around the preserved content only.',
            })
          } else if (panels.length === 1) {
            out.push({
              ...locate(b, toUtf16),
              rule: 'figure-group-single-panel',
              message:
                'This "::: figure" group holds a single panel; a plain captioned figure renders the same content without the group wrapper.',
            })
          }
          const numbered = captionHasNumber(b.caption)
          if (numbered && b.attrs?.id !== undefined) used.add(b.attrs.id)
          for (const panel of panels) {
            if (captionHasNumber(panel.caption)) {
              out.push({
                ...locate(panel, toUtf16),
                rule: 'figure-group-panel-number',
                message:
                  'A "#" placeholder in a panel caption stays literal: panels are not numbering units, the group caption carries the number (and panel ids resolve with its letter).',
              })
            }
            if (numbered && panel.attrs?.id !== undefined) used.add(panel.attrs.id)
          }
          checkFigureGroups(b.children)
          break
        }
        case 'block_quote':
        case 'div':
          checkFigureGroups(b.children)
          break
        case 'list':
          for (const it of b.items) checkFigureGroups(it.children)
          break
        case 'definition_list':
          for (const it of b.items) for (const d of it.definitions) checkFigureGroups(d)
          break
        case 'figure':
          if (b.target.type === 'block_quote') checkFigureGroups(b.target.children)
          break
        default:
          break
      }
    }
  }
  checkFigureGroups(doc.children)
  for (const body of Object.values(doc.footnoteDefs ?? {})) checkFigureGroups(body)

  // `used` now holds every valid id. A crossref to anything else degrades to
  // literal text in resolveHeadingIds.
  const usedFolded = new Set([...used].map(foldId))
  for (const { target, node } of collectCrossrefs(doc)) {
    if (used.has(target) || usedFolded.has(foldId(target))) continue
    out.push({
      ...locate(node, toUtf16),
      rule: 'broken-crossref',
      message: `Cross-reference </#${target}> has no matching heading id; it renders as the literal text "</#${target}>".`,
    })
  }

  // Reference links that survived parse() have no explicit link definition.
  // resolve() may still turn them into implicit heading links; anything else
  // renders as its literal source text.
  for (const { ref, rawRef, collapsed, node } of collectUnresolvedRefLinks(doc)) {
    // BOTH keys, in resolveHeadingIds' order: the label as written, then its
    // rendered plain text (PART 9R R1). Checking only the first reported a
    // reference that resolves - `[*bold* heading][]` under `# *bold* heading` -
    // as unresolved, which is the failure mode this whole block exists to
    // avoid. This mirror has to move with the resolver or it lies about it.
    //
    // And only for the COLLAPSED spelling, for the same reason: R1 offers the
    // index to `[text][]` alone (markup-carve/carve#742), so an explicit
    // `[text][Some Heading]` IS unresolved and this rule has to say so.
    if (
      collapsed &&
      (headingRefs.has(normalizeHeadingRefLabel(ref)) ||
        headingRefs.has(headingRefKeyFromLabel(ref)))
    ) {
      continue
    }
    out.push({
      ...locate(node, toUtf16),
      rule: 'unresolved-reference-link',
      message: `Reference link ${rawRef} has no matching link definition or heading; it renders as literal text.`,
    })
  }

  const footnoteRefs = collectFootnoteRefs(doc)
  const footnoteDefs = doc.footnoteDefs ?? {}
  const referencedFootnotes = new Set<string>()
  // Definitions grouped by their whitespace-insensitive key, so a miss can name
  // the definition the author probably meant. Built once, not per reference.
  const defsByWhitespaceKey = new Map<string, string[]>()
  for (const label of Object.keys(footnoteDefs)) {
    const key = whitespaceKey(label)
    const bucket = defsByWhitespaceKey.get(key)
    if (bucket) bucket.push(label)
    else defsByWhitespaceKey.set(key, [label])
  }
  for (const { id, node } of footnoteRefs) {
    referencedFootnotes.add(id)
    if (hasOwnKey(footnoteDefs, id)) continue
    // A near miss is worth naming. "No matching definition" is true but leaves
    // the reader hunting for a difference they cannot see - the definition is
    // RIGHT THERE and differs by a space. Saying which one, and that matching
    // is exact, turns a hunt into a fix.
    const near = (defsByWhitespaceKey.get(whitespaceKey(id)) ?? []).filter((label) => label !== id)
    const hint =
      near.length === 1
        ? ` Definition [^${near[0]}] differs only in whitespace; footnote labels are matched exactly.`
        : near.length > 1
          ? ` ${near.length} definitions differ from it only in whitespace; footnote labels are matched exactly.`
          : ''
    out.push({
      ...locate(node, toUtf16),
      rule: 'unresolved-footnote',
      message: `Footnote reference [^${id}] has no matching definition; it renders as literal text.${hint}`,
    })
  }

  // Verbatim (code/raw-block) line numbers are needed by both source-line
  // collectors below. Build the set once and share it: an O(1) membership test
  // per line replaces a per-line scan over a growing range list (was O(n^2),
  // and was computed twice).
  const verbatimLines = collectVerbatimLines(doc)
  // The source-line rules skip a COMMENT body as well as a verbatim one. A
  // comment is discarded text - it reaches no output at all - so a report that
  // some construct inside it silently degraded is describing something that was
  // never going to render. Raised by codex review against the new table-cell
  // rule; `fence-delimiter-indentation` beside it had the same false positive.
  const unrendered = new Set(verbatimLines)
  for (const ln of collectCommentLines(doc)) unrendered.add(ln)
  collectSemanticAttributeWarnings(doc, out, toUtf16, semanticElementNames(opts.extensions))
  const listIndentLines = collectListItemIndentWarnings(source, doc, unrendered, out)
  collectSilentFailures(source, doc, unrendered, out, toUtf16, listIndentLines)
  collectFootnoteDefinitionWarnings(source, doc, verbatimLines, referencedFootnotes, out)
  if (opts.platforms?.length) {
    // Fenced code blocks and raw blocks are reliably safe; comments are never
    // published at all. Inline code spans are NOT in this set, deliberately -
    // some host surfaces linkify inside them.
    const skip = new Set(verbatimLines)
    for (const ln of collectCommentLines(doc)) skip.add(ln)
    for (const ln of collectUnpublishedLines(source, doc, referencedFootnotes)) skip.add(ln)
    // ...but a captioned listing's CAPTION is published. `collectVerbatimLines`
    // marks the whole wrapping figure verbatim, because a captioned code block
    // carries no position of its own, and the caption rides along inside that
    // range. Raised by codex review.
    for (const ln of collectListingCaptionLines(doc)) skip.delete(ln)
    collectPlatformAutolinks(source, opts.platforms, skip, out)
  }
  out.sort((a, b) => a.start - b.start || a.line - b.line || a.column - b.column)
  return out
}

/** A trailing `{.class}` / `{#id}` attribute block at the end of a line. The
 *  leading `(^|\s)` keeps a valid inline span like `[t]{.c}` (brace abuts `]`,
 *  no space) from matching. */
const TRAILING_HEADING_ATTR = /(^|\s)(\{\s*[.#][^{}]*\})\s*$/
/** A fenced block whose info string is the legacy `raw FORMAT` form. */
const LEGACY_RAW_FENCE = /^(\s*)(`{3,}|~{3,})\s*raw\s+(\S+)/

/** A line that looks like the old tight blockquote spelling. */
const BLOCKQUOTE_WITHOUT_SPACE = /^(>)([^ ].*)$/
/** A line that opens like a block construct (`:::`, `{#`, `{.`). */
const LEAKED_BLOCK_MARKER = /^(\s*)(:{3,}|\{[.#])/
// A fenced-code delimiter (opener or closer) with leading whitespace. A Carve
// fence is column-exact, so an indented delimiter the parser did not fold into
// a verbatim region is a silent degradation.
const INDENTED_FENCE = /^([ \t]+)(`{3,}|~{3,})/

const LINT_LIST_ITEM = /^([ \t]*)(?:([-+*])|(\d+|[A-Za-z]+)([.)]))(\{[^\n{}]*\})?( +)(?:\[[ xX]\] +)?/
const LINT_BLOCK_OPENER = /^(?:#{1,6} +\S|>(?: |$)|`{3,}|~{3,}|::(?: |$)|:{3,}(?: |$)|\[\^[^\]]+\]: +\S|\[[^\]]+\]: +\S|(?:-{3,}|\*{3,}|_{3,})[ \t]*$)/
const LINT_BLOCK_ATTRIBUTE = /^(?:\{[^{}\n]+\})+[ \t]*$/
/**
 * A footnote definition line. Mirrors parse.ts.
 *
 * It did not. `\s+` accepts a TAB as the separator, and the parser has always
 * required a literal space there - `[^f]:<TAB>note` is a paragraph, not a
 * definition - so this mirror was wider than what it claimed to mirror before
 * carve#892 was written. The separator is `\"]:\", space+`: one mandatory ASCII
 * space, then a run of them, and the first character that is not one begins
 * the content.
 */
const FOOTNOTE_DEF = /^\[\^([^\]]+)\]: +(.+)$/

interface LintItemColumn {
  startLine: number
  endLine: number
  baseColumn: number
  contentColumn: number
  legacyAttributeColumn?: number
  quoteDepth: number
}

/**
 * Report block-shaped lines on either side of a list item's exact content
 * column. The AST supplies item ownership/ranges; source is read only for the
 * marker width and the authored indentation. That keeps this diagnostic in
 * lockstep with the parser instead of implementing a second list parser.
 */
function collectListItemIndentWarnings(
  source: string,
  doc: Document,
  unrendered: ReadonlySet<number>,
  out: LintWarning[],
): Set<number> {
  const lines = source.split(/\r\n?|\n/)
  const starts: number[] = []
  for (let offset = 0, i = 0; i < lines.length; i++) {
    starts[i] = offset
    offset += lines[i]!.length + (source.slice(offset + lines[i]!.length, offset + lines[i]!.length + 2) === '\r\n' ? 2 : 1)
  }
  const visualIndent = (line: string): { column: number; chars: number; rest: string } => {
    let column = 0
    let chars = 0
    while (chars < line.length) {
      if (line[chars] === ' ') column++
      else if (line[chars] === '\t') column = Math.floor(column / 4 + 1) * 4
      else break
      chars++
    }
    return { column, chars, rest: line.slice(chars) }
  }
  const visualColumnAt = (line: string, end: number): number => {
    let column = 0
    for (let i = 0; i < end; i++) {
      column = line[i] === '\t' ? Math.floor(column / 4 + 1) * 4 : column + 1
    }
    return column
  }
  const blockView = (line: string, quoteDepth: number): { column: number; chars: number; rest: string } => {
    let prefixChars = 0
    let view = line
    // Quotes are source containers, not indentation. Peel only quote prefixes;
    // list prefixes are deliberately retained because the AST item range below
    // decides which list owns the candidate.
    for (let depth = 0; depth < quoteDepth; depth++) {
      const quote = /^[ \t]*>(?: |$)/.exec(view)
      if (!quote) break
      prefixChars += quote[0].length
      view = view.slice(quote[0].length)
    }
    const indent = visualIndent(view)
    const chars = prefixChars + indent.chars
    return { column: visualColumnAt(line, chars), chars, rest: indent.rest }
  }
  const items: LintItemColumn[] = []
  walkDocument(doc, (node) => {
    if (node.type !== 'list_item') return
    const pos = (node as Positioned).pos
    if (!pos) return
    const markerLine = lines[pos.startLine - 1] ?? ''
    const markerOffset = Math.max(0, (pos.startColumn ?? 1) - 1)
    const marker = LINT_LIST_ITEM.exec(markerLine.slice(markerOffset))
    if (!marker) return
    const baseColumn = visualColumnAt(markerLine, markerOffset) + visualIndent(marker[1]!).column
    const markerWidth = marker[2] ? 1 : marker[3]!.length + marker[4]!.length
    const bareWidth = markerWidth + marker[6]!.length
    const legacyAttributeColumn = marker[5] ? baseColumn + bareWidth + marker[5]!.length : undefined
    items.push({
      startLine: pos.startLine,
      endLine: pos.endLine ?? pos.startLine,
      baseColumn,
      contentColumn: baseColumn + bareWidth,
      quoteDepth: (markerLine.slice(0, markerOffset).match(/>/g) ?? []).length,
      ...(legacyAttributeColumn === undefined ? {} : { legacyAttributeColumn }),
    })
  })
  items.sort((a, b) => a.startLine - b.startLine || b.contentColumn - a.contentColumn)

  const reported = new Set<number>()
  const active: LintItemColumn[] = []
  const ambiguousFences = new Map<LintItemColumn, { kind: 'code' | 'colon'; run: string }>()
  let nextItem = 0
  let lastEnded: LintItemColumn | undefined
  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1
    while (nextItem < items.length && items[nextItem]!.startLine < lineNo) {
      active.push(items[nextItem++]!)
    }
    for (let j = active.length - 1; j >= 0; j--) {
      if (active[j]!.endLine >= lineNo) continue
      const ended = active.splice(j, 1)[0]!
      if (!lastEnded || ended.endLine >= lastEnded.endLine) lastEnded = ended
    }
    const containing = active.reduce<LintItemColumn | undefined>(
      (deepest, candidate) => !deepest || candidate.contentColumn > deepest.contentColumn
        ? candidate
        : deepest,
      undefined,
    )
    if (unrendered.has(lineNo)) continue
    const owner = containing ?? lastEnded
    const authored = blockView(lines[index]!, owner?.quoteDepth ?? 0)
    const openFence = owner ? ambiguousFences.get(owner) : undefined
    if (openFence) {
      const closes = openFence.kind === 'code'
        ? new RegExp(`^${openFence.run[0] === '`' ? '`' : '~'}{${openFence.run.length},}[ \\t]*$`).test(authored.rest)
        : new RegExp(`^:{${openFence.run.length}}[ \\t]*$`).test(authored.rest)
      if (closes) ambiguousFences.delete(owner!)
      reported.add(lineNo)
      continue
    }
    if (authored.column === 0 ||
        (!LINT_BLOCK_OPENER.test(authored.rest) &&
         !LINT_BLOCK_ATTRIBUTE.test(authored.rest) &&
         !isTableRow(authored.rest))) continue
    let item: LintItemColumn | undefined = containing
    let rule: string | undefined
    if (item && authored.column > item.contentColumn) {
      rule = 'list-item-block-overindented'
    } else if (!item) {
      const candidate = lastEnded
      if (candidate && candidate.baseColumn < authored.column &&
          authored.column < candidate.contentColumn &&
          lines.slice(candidate.endLine, index).every((between) => between.trim() === '')) {
        item = candidate
      }
      if (item) rule = 'list-item-body-detached'
    }
    if (!item || !rule) continue

    const first = authored.chars
    const start = (starts[index] ?? 0) + first
    const legacy = item.legacyAttributeColumn === authored.column
    out.push({
      line: lineNo,
      column: first + 1,
      rule,
      message: rule === 'list-item-body-detached'
        ? `This block-shaped line is below the preceding list item's content column ${item.contentColumn}; it parsed outside the item. Indent it to column ${item.contentColumn} to make it part of the item, or escape the opener to preserve literal text.`
        : `${legacy ? 'This line uses the attributed item’s former full-prefix column. ' : ''}This block-shaped line is past the list item's exact content column ${item.contentColumn}; it parsed as literal item text. Dedent it to column ${item.contentColumn} to make it structural, or escape the opener to preserve literal text explicitly.`,
      start,
      end: start + Math.max(1, authored.rest.match(/^\S+/)?.[0].length ?? 1),
    })
    const codeFence = /^(`{3,}|~{3,})/.exec(authored.rest)
    const colonFence = /^(:{3,})(?: |$)/.exec(authored.rest)
    if (codeFence) ambiguousFences.set(item, { kind: 'code', run: codeFence[1]! })
    else if (colonFence) ambiguousFences.set(item, { kind: 'colon', run: colonFence[1]! })
    reported.add(lineNo)
  }
  return reported
}

/**
 * PART 9 §10's nine reserved names, in the order the renderer nests them.
 *
 * Mirrors SEMANTIC_SPAN_ORDER in render-html.ts. A name added there and not
 * here goes unreported by both rules below.
 */
// The seven names PART 9 §9 and §10 reserve between them: three in core, four
// in the SemanticSpan extension.
const SEMANTIC_SPAN_NAMES = ['abbr', 'time', 'samp', 'var', 'kbd', 'cite', 'dfn'] as const

/** The three core renders as elements with no extension enabled (PART 9 §9). */
const CORE_SEMANTIC_NAMES = new Set<string>(['abbr', 'time', 'kbd'])

/**
 * The names whose authored value reaches the output, as `title` or `datetime`.
 * On every other name that becomes an element the value only selects that
 * element and is dropped.
 */
const SEMANTIC_NAMES_KEEPING_A_VALUE = new Set<string>(['abbr', 'dfn', 'time'])

/**
 * The names that will actually become an ELEMENT in the caller's render.
 *
 * Core's three, plus whatever the enabled extensions add. A name outside this
 * set stays an ordinary attribute, so its value reaches the output and nothing
 * is lost - see the `extensions` option above for why that distinction is the
 * whole point of these two rules.
 */
function semanticElementNames(
  extensions?: readonly { semanticSpanNames?: readonly string[] }[],
): ReadonlySet<string> {
  const names = new Set(CORE_SEMANTIC_NAMES)
  for (const extension of extensions ?? []) {
    for (const name of extension.semanticSpanNames ?? []) names.add(name)
  }
  return names
}

/**
 * Reserved names that ARE valid HTML attributes on a given element, so finding
 * one there is the author getting what they asked for rather than a silent
 * failure.
 *
 * `cite` on a blockquote is the case that matters: it is a URL attribute of
 * `blockquote` and `q` in HTML, and `{cite="https://…"}` on a quote renders
 * `<blockquote cite="https://…">`. Reporting that would be telling an author
 * their correct markup is wrong.
 */
const VALID_ATTRIBUTE_ON: Record<string, ReadonlySet<string>> = {
  block_quote: new Set(['cite']),
}

/**
 * Longest authored value quoted back whole, in CODEPOINTS.
 *
 * Past it the diagnostic keeps its head and marks the cut, so a pasted
 * paragraph in an attribute cannot push the sentence explaining the problem off
 * the reader's screen. Counted in codepoints rather than UTF-16 units so the
 * cut never lands between the halves of a surrogate pair.
 */
const QUOTED_VALUE_LIMIT = 120

/** Marks a value the diagnostic cut, inside the quotes it was cut from. */
const QUOTED_VALUE_ELLIPSIS = '…'

/**
 * The rendered value as the diagnostic quotes it: what the renderer writes,
 * cut if it is long, escaped as the renderer escapes it.
 *
 * The three steps run in exactly that order and none of them commutes. The
 * sanitizer reads the WHOLE value, so cutting first could quote a long
 * `javascript:…` back as a harmless-looking prefix while the output holds an
 * empty attribute. Escaping last is what keeps the cut off the middle of an
 * entity, which would quote `&qu` at an author who wrote a quote.
 */
function quotedAttrValue(name: string, value: string): string {
  const rendered = renderedAttrValue(name, value)
  const chars = Array.from(rendered)
  if (chars.length <= QUOTED_VALUE_LIMIT) return escapeAttrValue(rendered)

  return escapeAttrValue(chars.slice(0, QUOTED_VALUE_LIMIT).join('')) + QUOTED_VALUE_ELLIPSIS
}

/**
 * Two rules about the compact semantic-span names (PART 9 §10).
 *
 * Neither describes an engine defect - all three engines render these
 * byte-identically and exactly as the clause says. They report the two places
 * where the clause's own scope loses something an author wrote, with nothing
 * else marking it (markup-carve/carve#1131, markup-carve/carve#1132).
 */
function collectSemanticAttributeWarnings(
  doc: Document,
  out: LintWarning[],
  toUtf16: (offset: number) => number,
  elementNames: ReadonlySet<string>,
): void {
  walkDocument(doc, (node) => {
    const attrs = (node as { attrs?: Attrs }).attrs
    const values = attrs?.keyValues
    if (!values) return
    const type = node.type as string | undefined
    if (typeof type !== 'string') return

    for (const name of SEMANTIC_SPAN_NAMES) {
      const value = values[name]
      if (value === undefined) continue

      if (type === 'span') {
        // §10 applies only to a name that becomes an ELEMENT in this render.
        // One that does not stays an ordinary attribute and carries its value
        // to the output, so there is nothing to report.
        if (
          value !== '' &&
          elementNames.has(name) &&
          !SEMANTIC_NAMES_KEEPING_A_VALUE.has(name)
        ) {
          out.push({
            ...locate(node as Positioned, toUtf16),
            rule: 'semantic-attribute-value-ignored',
            message:
              `Value on the semantic attribute "${name}" is discarded: it selects the <${name}> element ` +
              'and reaches no output. Only abbr, dfn and time carry a value (as title or datetime).',
          })
        }
        continue
      }

      // Same tier test for the other rule: a name this render leaves an
      // ordinary attribute is an ordinary attribute everywhere, so it is not
      // "outside the span" - it is exactly what the author asked for.
      if (!elementNames.has(name)) continue

      // §10 is scoped to an ordinary span, so the same name anywhere else
      // stays a raw attribute - ``c`{kbd}` renders `<code kbd="">`, and
      // ``c`{kbd="keyboard"}` renders `<code kbd="keyboard">`.
      if (VALID_ATTRIBUTE_ON[type]?.has(name)) continue
      out.push({
        ...locate(node as Positioned, toUtf16),
        rule: 'semantic-attribute-outside-span',
        message:
          `"${name}" is a semantic span attribute (PART 9 \u00a710) and only applies to an ordinary ` +
          `[content]{attrs} span; on ${type} it stays a raw attribute and renders as ` +
          // The value the RENDERER writes, not a fixed empty one. The boolean
          // form does render an empty value, which is why this read true until
          // a value was authored; naming it unconditionally made the sentence
          // false on exactly the inputs it exists to explain
          // (markup-carve/carve-js#1058).
          `${name}="${quotedAttrValue(name, value)}".`,
      })
    }
  })
}

/**
 * The key Djot would match a label on: ends trimmed, interior whitespace runs
 * collapsed.
 *
 * Carve matches labels EXACTLY (PART 9 §16), so this is NEVER used to resolve
 * anything - only to explain a miss. Two labels sharing this key are the pair a
 * reader is most likely to have meant as one, and the difference between them
 * is invisible in rendered output and usually in the editor too.
 */
function whitespaceKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

/**
 * The set of 1-based source line numbers that fall inside a verbatim region
 * (a code or raw block, including the captioned-figure form). Membership is
 * O(1), so callers can skip verbatim lines without scanning a range list.
 */
function collectVerbatimLines(doc: Document): Set<number> {
  const verbatim = new Set<number>()
  const add = (pos: Positioned['pos'], endLine: number | undefined): void => {
    if (!pos) return
    const end = endLine ?? pos.startLine
    for (let ln = pos.startLine; ln <= end; ln++) verbatim.add(ln)
  }
  walkDocument(doc, (node) => {
    const pos = (node as Positioned).pos
    const endLine = (pos as { endLine?: number } | undefined)?.endLine
    if (node.type === 'code_block' || node.type === 'raw_block') {
      add(pos, endLine)
    } else if (node.type === 'figure') {
      // A captioned code/raw block is a figure wrapping a position-less
      // code-block target, so the block itself never reports a range. Use the
      // figure's range so its verbatim body is still skipped.
      const target = (node.target as { type?: string } | undefined)?.type
      if (target === 'code_block' || target === 'raw_block') add(pos, endLine)
    }
  })
  return verbatim
}

/**
 * Source-line checks for constructs that parsed into the wrong node. Each is
 * anchored to a parsed node so verbatim regions (code/raw blocks) are skipped
 * automatically: only real headings/paragraphs are inspected, and the
 * raw-fence scan ignores lines inside a code/raw block.
 */
function collectSilentFailures(
  source: string,
  doc: Document,
  verbatimLines: Set<number>,
  out: LintWarning[],
  toUtf16: (offset: number) => number,
  listIndentLines: ReadonlySet<number>,
): void {
  const lines = source.split('\n')
  const lineStart: number[] = []
  for (let off = 0, i = 0; i < lines.length; i++) {
    lineStart[i] = off
    off += lines[i]!.length + 1
  }
  const push = (lineNo: number, col: number, len: number, rule: string, message: string): void => {
    const start = (lineStart[lineNo - 1] ?? 0) + (col - 1)
    out.push({ line: lineNo, column: col, rule, message, start, end: start + len })
  }

  const headings: Positioned[] = []
  const paragraphs: Positioned[] = []
  const tables: Table[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'heading') headings.push(node as Positioned)
    else if (node.type === 'paragraph') paragraphs.push(node as Positioned)
    else if (node.type === 'table') tables.push(node as unknown as Table)
    for (const key of Object.keys(node)) {
      if (key !== 'pos' && key !== 'attrs') walk(node[key])
    }
  }
  walk(doc.children)

  // 1. Trailing attribute block on a heading: literal text, not attributes.
  for (const h of headings) {
    const ln = (h.pos as { endLine?: number } | undefined)?.endLine ?? h.pos?.startLine
    if (!ln) continue
    const line = lines[ln - 1] ?? ''
    // Guard against position drift: only flag if this really is a heading line.
    if (!/^\s*#{1,6}\s/.test(line)) continue
    const m = TRAILING_HEADING_ATTR.exec(line)
    if (!m) continue
    const col = m.index + m[1]!.length + 1
    push(
      ln,
      col,
      m[2]!.length,
      'heading-trailing-attribute',
      `Trailing "${m[2]}" on a heading is literal text in Carve, not an attribute block. ` +
        `Move it to a "${m[2]}" line directly above the heading.`,
    )
  }

  // 2. Legacy `raw FORMAT` fence: never opens, and desyncs later fences.
  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    const m = LEGACY_RAW_FENCE.exec(lines[i]!)
    if (!m) continue
    push(
      i + 1,
      m[1]!.length + 1,
      lines[i]!.length - m[1]!.length,
      'raw-block-syntax',
      `"${m[2]}raw ${m[3]}" is not a Carve raw block; it fails to open and desyncs the ` +
        `document's fences. Use "${m[2]}=${m[3]}" to pass content through to ${m[3]}.`,
    )
  }

  // 3. The pre-0.1.x tight blockquote spelling. `>` must be bare or followed
  //    by a literal space, so `>quote`, `>>=`, and `>\tquote` are prose.
  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    const m = BLOCKQUOTE_WITHOUT_SPACE.exec(lines[i]!)
    if (!m) continue
    push(
      i + 1,
      1,
      lines[i]!.length,
      'blockquote-marker-without-space',
      `A blockquote marker must be either bare ">" or followed by a space. ` +
        `This line renders as literal text; write "> ${m[2]}" to quote it.`,
    )
  }

  // 4. A paragraph whose first inline text opens like a block construct: the
  //    block never opened, so the marker leaked as plain text. Gating on the
  //    text content (not the source line) avoids a false positive when a valid
  //    container's child paragraph reports its parent's start line.
  for (const p of paragraphs) {
    const first = (p as { children?: unknown[] }).children?.[0] as
      | { type?: string; value?: string }
      | undefined
    if (first?.type !== 'text' || typeof first.value !== 'string') continue
    const m = LEAKED_BLOCK_MARKER.exec(first.value)
    if (!m) continue
    const loc = locate(first as Positioned, toUtf16)
    if (listIndentLines.has(loc.line)) continue
    // 4a. The common authoring mistakes on a fence opener get a targeted
    //     hint instead of the generic marker warning: an unquoted trailing
    //     title (the VitePress/Docusaurus habit), typographic quotes (a CMS
    //     "smart quote" filter rewrote the source before Carve saw it), or a
    //     trailing `{…}` attribute block.
    if (m[2]!.startsWith(':')) {
      // Analyze the raw source line, not the text node: smart punctuation has
      // already rewritten straight quotes to typographic ones in the AST text,
      // which would make an unterminated straight quote look like a curly one.
      const lineText = lines[loc.line - 1] ?? ''
      const fm = /^(:{3,})[ \t]+([a-zA-Z_][\w-]*)[ \t]+(.+?)[ \t]*$/.exec(lineText)
      if (fm) {
        const fence = fm[1]!
        const type = fm[2]!
        const trailing = fm[3]!
        // A trailing [label] is valid on its own - split it off so the
        // suggested fix quotes only the title part and keeps the label.
        const lm = /^(.*?)[ \t]+(\[[^\]\n]*\])$/.exec(trailing)
        const titlePart = lm ? lm[1]! : trailing
        const label = lm ? ` ${lm[2]!}` : ''
        let message: string | undefined
        const curly = /^[“”](.*)[“”]$/.exec(titlePart)
        if (curly) {
          message =
            `The title after "${type}" uses typographic quotes - usually a CMS ` +
            `"smart quote" filter rewrote the source before Carve parsed it. A fence ` +
            `title needs straight double quotes: ${fence} ${type} "${curly[1]}"${label}.`
        } else if (titlePart.startsWith('{')) {
          message =
            `A "{…}" on the fence line is not an attribute block - it makes the whole ` +
            `line plain text. Put attributes on their own line directly above the ` +
            `":::" opener.`
        } else if (!titlePart.startsWith('"') && !titlePart.startsWith('[')) {
          message =
            `Text after the "${type}" fence type must be a quoted "title" or a ` +
            `[label] - unquoted it makes the whole line plain text. Did you mean ` +
            `${fence} ${type} "${titlePart}"${label}?`
        }
        if (message) {
          out.push({
            line: loc.line,
            column: loc.column,
            rule: 'fence-title-syntax',
            message,
            start: loc.start,
            end: loc.start + lineText.length,
          })
          continue
        }
      }
    }
    const what = m[2]!.startsWith(':')
      ? `an admonition/div fence ("${m[2]}")`
      : `a block-attribute line ("${m[2]}…")`
    out.push({
      line: loc.line,
      column: loc.column,
      rule: 'block-marker-as-text',
      message:
        `This line begins like ${what} but parsed as plain text - the block did not open. ` +
        `Check this line's syntax and any unterminated fence above it.`,
      start: loc.start,
      end: loc.start + m[2]!.length,
    })
  }

  // 5. An indented fenced-code OPENER. A Carve fence is column-exact - it sits
  //    at its container's content column (column 0 at the top level), like every
  //    other block opener. An indented run of backticks/tildes therefore does
  //    NOT open a code block; the opener degrades to a paragraph (its run
  //    becomes an inline code span) and the body to plain text. Lines inside a
  //    real verbatim region are skipped, so a fence legitimately opened at a
  //    list item's content column, and an indented ``` shown as sample text
  //    inside a code block, are both left alone.
  //    SCOPE: this deliberately catches OPENERS only. An indented delimiter
  //    INSIDE an open fence is structurally identical whether it is a
  //    mis-indented closer or valid indented sample text (an indented ``` is a
  //    supported way to show a fence inside a fence), so the linter cannot tell
  //    intent and must not flag it - that would false-positive on the sample-
  //    text feature. A mis-indented closer is also loud (the fence runs on
  //    visibly), unlike the silent opener case this rule targets.
  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    if (listIndentLines.has(i + 1)) continue
    const m = INDENTED_FENCE.exec(lines[i]!)
    if (!m) continue
    // a legacy `raw FORMAT` fence is already reported by rule 2; do not
    // double-flag the same line for its indentation.
    if (LEGACY_RAW_FENCE.test(lines[i]!)) continue
    const fence = m[2]!
    // Skip an inline code span: a same-line closing run of the fence char (>=
    // the opening length) makes `  ```x```` verbatim text, not a mis-indented
    // fence delimiter -- de-indenting it would not open a code block either.
    if (lines[i]!.slice(m[1]!.length + fence.length).includes(fence)) continue
    push(
      i + 1,
      m[1]!.length + 1,
      fence.length,
      'fence-delimiter-indentation',
      `This ${fence[0] === '`' ? 'backtick' : 'tilde'} fence is indented; a Carve ` +
        `fenced-code delimiter is column-exact and must sit at its container's content ` +
        `column (column 0 at the top level). Indented, it does not open a code block - the ` +
        `run renders as inline code and the body as plain text. Move it to column 0, or to ` +
        `the enclosing list item's content column.`,
    )
  }

  // 6. A cell attribute block written BEFORE an alignment marker, which is the
  //    order §5 T10 retired. `|{#x}< content |` used to be read as attributes
  //    plus a left-alignment marker; the marker run now comes first, so the `<`
  //    is literal content. Under §5 T11 the block is part of that run and ends
  //    at a space, so this spelling has no run at all and the braces reach the
  //    output too - which is what the message now says.
  //
  //    REPORTED, NOT REWRITTEN. `fmt` must not turn `|{#x}< content |` into
  //    `|<{#x} content |` in its default path: that ADDS `text-align: left` and
  //    REMOVES a literal `<` from the content, so it would break
  //    `toHtml(fmt(x)) == toHtml(x)` on a document that is currently correct.
  //    Every engine measured renders this source as attributes plus a literal
  //    `<` today, which is exactly why the author has to be the one to choose.
  //    The message therefore names both spellings.
  //
  //    SPLIT WITH THE PARSER'S OWN SPLITTER, not with a pipe regex. A pipe
  //    inside a code span or behind a backslash does not open a cell, so a
  //    regex over the raw line reported `| a \|{#x}< b |` - where the block is
  //    ordinary content and there is no cell to align.
  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    const line = lines[i]!
    // A table opens inside a blockquote and inside a list item too, so the row
    // is found through the container prefixes rather than only at the top
    // level. Every strip is anchored at the start, so what it removed is a
    // prefix and its WIDTH maps the column back onto the source line.
    const stripped = stripContainerPrefixesKeepIndent(line)
    const prefixWidth = line.length - stripped.length
    const indent = stripped.length - stripped.trimStart().length
    const row = stripped.slice(indent)
    // A COMPLETE row, gated by the parser's own predicate. A leading `|` with
    // no closing one is a paragraph (`|{#x}< content` renders as text), and
    // reporting cell syntax there would be reporting a cell that does not
    // exist. A `+` continuation row is out of scope for the same reason the
    // parser only reads one inside an open table: whether it is a row at all is
    // a question about the lines above it.
    if (!isTableRow(row)) continue
    const { body } = rowAttrsFromLine(row)
    for (const { text, start } of splitTableRowSpans(body)) {
      // The run's terminator is a space, and the attribute block is INSIDE the
      // run rather than after it (§5 T11) - so `|>{#x}value |` is as unpadded as
      // `|>value |` is, and reporting only the second left the first silent.
      const unpadded = /^(?:=)?([<>~^v?]{1,2})(?![<>~^v?\s])/.exec(text)
      if (unpadded) {
        const at = text.startsWith('=') ? 1 : 0
        const marksEnd = at + unpadded[1]!.length
        const block = text[marksEnd] === '{' ? readCellAttributeBlock(text, marksEnd) : undefined
        const runEnd = marksEnd + (block?.length ?? 0)
        if (text[runEnd] !== ' ') {
          push(
            i + 1,
            prefixWidth + indent + start + at + 1,
            unpadded[1]!.length,
            'table-alignment-run-padding',
            `The table alignment run "${unpadded[1]}" has no terminating space, so it is literal cell content. A cell's marker run - the kind marker, the alignment run and the attribute block - ends at a space (§5 T11). Add a space after the run${block ? ' and its attribute block' : ''} to make it alignment.`,
          )
        }
      }
      const block = readCellAttributeBlock(text)
      if (!block) continue
      const marker = text[block.length]
      if (marker === undefined || !TABLE_ALIGNMENT_MARKERS.has(marker)) continue
      const spelling = text.slice(0, block.length + 1)
      push(
        i + 1,
        prefixWidth + indent + start + 1,
        block.length + 1,
        'table-cell-attribute-before-marker',
        `"${spelling}" writes a cell's attribute block before its alignment marker, ` +
          `which Carve no longer reads as one. The block is part of the cell's marker run ` +
          `and the run ends at a space, so with the "${marker}" glued to it there is no run: ` +
          `the braces are content and the cell is neither attributed nor aligned. Write ` +
          `"${marker}${text.slice(0, block.length)} " to align it, or "${text.slice(0, block.length)} ` +
          `${marker}" to keep the "${marker}" as content deliberately.`,
      )
    }
  }

  for (const table of tables) {
    const kv = table.attrs?.keyValues ?? {}
    const widest = Math.max(0, ...table.rows.map((row) => row.cells.length))
    const lineNo = table.pos?.startLine ?? 1
    const tableStart = lineStart[lineNo - 1] ?? source.length
    const addTableWarning = (rule: string, key: string, message: string): void => {
      const found = source.lastIndexOf(key, tableStart)
      const start = found >= 0 ? found : (lineStart[lineNo - 1] ?? 0)
      const before = source.slice(0, start)
      const warningLine = before.split('\n').length
      const warningColumn = start - before.lastIndexOf('\n')
      out.push({ line: warningLine, column: warningColumn, rule, message, start, end: start + key.length })
    }
    for (const key of ['aligns', 'valigns', 'widths'] as const) {
      if (kv[key] === undefined) continue
      const values = kv[key]!.split(',')
      if (values.length < widest) {
        addTableWarning(
          'table-column-arity',
          key,
          `${key} supplies ${values.length} column entries for a ${widest}-column table; the unset tail is valid but may be accidental.`,
        )
      }
    }
    const widths = kv.widths?.split(',').map((raw) => Number(raw.trim())).filter(Number.isFinite) ?? []
    if (widths.reduce((sum, width) => sum + width, 0) > 100) {
      addTableWarning('table-width-total', 'widths', 'The specified table column widths total more than 100%.')
    }
    const aligns = kv.aligns?.split(',') ?? []
    const valigns = kv.valigns?.split(',') ?? []
    const headerRows = table.rows.filter((row) => row.cells.some((cell) => cell.header))
    for (let column = 0; column < widest; column++) {
      const markerAlign = headerRows.some((row) => row.cells[column]?.align !== undefined)
      const markerValign = headerRows.some((row) => row.cells[column]?.valign !== undefined)
      if ((markerAlign && aligns[column]?.trim()) || (markerValign && valigns[column]?.trim())) {
        addTableWarning(
          'table-column-overlap',
          markerAlign && aligns[column]?.trim() ? 'aligns' : 'valigns',
          `Column ${column + 1} supplies the same alignment axis both in the table and in a table attribute; the in-table marker wins.`,
        )
      }
    }
  }
}

function collectFootnoteDefinitionWarnings(
  source: string,
  doc: Document,
  verbatimLines: Set<number>,
  referenced: Set<string>,
  out: LintWarning[],
): void {
  const lines = source.split('\n')
  const lineStart: number[] = []
  for (let off = 0, i = 0; i < lines.length; i++) {
    lineStart[i] = off
    off += lines[i]!.length + 1
  }

  const firstSites = new Map<string, { line: number; col: number; start: number; end: number }>()
  // First label seen for each whitespace-insensitive key, so a later label that
  // collides with it can name its twin.
  const firstByWhitespaceKey = new Map<string, string>()

  const defs = doc.footnoteDefs ?? {}

  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    const line = lines[i]!
    // A definition inside a block quote or list item is a definition: the
    // parser strips the container prefix before collecting it, and the
    // document renders it. Scanning the raw line made every rule below blind
    // to those, so `> [^a]: one` twice reported no duplicate (carve-js#1019).
    // The parser's own stripper is used rather than a second spelling of it.
    // Indentation is KEPT: it is what separates a definition inside a quote
    // from a line merely indented under something else. Dropping it made an
    // over-indented literal `    [^a]: x` match, and a real definition for the
    // same label elsewhere then made it look like a duplicate.
    const afterTerm = RE_AFTER_TERM.test(stripContainerPrefixesKeepIndent(lines[i - 1] ?? ''))
    const m = FOOTNOTE_DEF.exec(stripContainerPrefixesKeepIndent(line, afterTerm))
    if (!m) continue
    // Raw, like the parser: a footnote label is matched exactly (PART 9 §16),
    // so `[^ a ]` and `[^a]` are two different definitions and neither is a
    // duplicate of the other.
    const label = m[1]!
    // The parser is the authority on what a definition IS. Stripping prefixes
    // line-by-line has no block context, so on its own it would read a marker
    // on a hard-wrapped prose line as a container (the limitation
    // `stripContainerPrefixes` documents). Reporting only labels the parser
    // actually collected keeps these rules from inventing a definition the
    // document does not have.
    if (!hasOwnKey(defs, label)) continue
    const col = line.indexOf('[^') + 1
    const start = (lineStart[i] ?? 0) + (col - 1)
    const site = { line: i + 1, col, start, end: start + m[0].length }
    if (firstSites.has(label)) {
      out.push({
        line: site.line,
        column: site.col,
        rule: 'duplicate-footnote-definition',
        message: `Duplicate footnote definition [^${label}] is ignored; the first definition for a label wins.`,
        start: site.start,
        end: site.end,
      })
    } else {
      // Two definitions that differ only in whitespace are LEGAL and distinct -
      // that is the exact-matching rule working. They are also, almost always,
      // one definition the author typed twice: the difference does not survive
      // into rendered output and is invisible in most editors, so a reader
      // comparing the two sees no reason they are separate footnotes.
      //
      // Djot's answer is to merge them, which silently drops one definition's
      // content and emits duplicate ids. Carve keeps both and says so here
      // instead, which is the same information without the data loss.
      const key = whitespaceKey(label)
      const twin = firstByWhitespaceKey.get(key)
      if (twin !== undefined && twin !== label) {
        out.push({
          line: site.line,
          column: site.col,
          rule: 'footnote-labels-differ-only-in-whitespace',
          message: `Footnote definitions [^${twin}] and [^${label}] differ only in whitespace, so they are two separate footnotes; labels are matched exactly.`,
          start: site.start,
          end: site.end,
        })
      } else if (twin === undefined) {
        firstByWhitespaceKey.set(key, label)
      }
      firstSites.set(label, site)
    }
  }

  for (const label of Object.keys(doc.footnoteDefs ?? {})) {
    if (referenced.has(label)) continue
    const site = firstSites.get(label)
    out.push({
      line: site?.line ?? 1,
      column: site?.col ?? 1,
      rule: 'unused-footnote-definition',
      message: `Footnote definition [^${label}] is never referenced, so it is omitted from the rendered document.`,
      start: site?.start ?? 0,
      end: site?.end ?? 0,
    })
  }
}

/** Format lint warnings as `file:line:col rule — message`. */
export function formatLintWarnings(
  warnings: LintWarning[],
  file = '<stdin>',
): string {
  return warnings
    .map((w) => `${file}:${w.line}:${w.column} ${w.rule} — ${w.message}`)
    .join('\n')
}

// ============================================================================
// Platform-autolink rules (opt-in, platform-scoped, DEFAULT OFF)
// ============================================================================

/**
 * Hosts whose rendering of published Carve output re-linkifies bare tokens.
 *
 * A union rather than a single flag, so a second host can be added with its own
 * token table later - the shape markup-carve/carve#297 ruled: "off by default,
 * enabled per platform". An unknown name is ignored rather than rejected: a
 * caller naming a host this build does not know about gets no rules from it,
 * which is the same outcome as not asking.
 */
export type LintPlatform = 'github'

/**
 * The two platform-autolink rules (markup-carve/carve#297,
 * markup-carve/carve-js#848).
 *
 * THE SOURCE IS THE ONLY PLACE THE AUTHOR'S INTENT STILL EXISTS. No
 * render-time construct prevents a host from re-linkifying published output,
 * so a bare hash-number becomes a link to an unrelated issue and a bare at-word
 * becomes a mention that notifies an uninvolved person.
 *
 * TWO IDS RATHER THAN ONE, because the two token shapes have different
 * false-positive profiles and an author will want to silence one without the
 * other - and a rule people disable wholesale is the failure the ruling names.
 *
 * DEFAULT OFF, and that is the ruled behavior rather than a convenience: every
 * other rule in this file reports a silent failure IN CARVE, while these two
 * are target-specific. An over-eager rule people turn off entirely would be
 * worse than none.
 *
 * WHERE THEY LOOK: prose and INLINE CODE SPANS, which are not reliably safe -
 * some host surfaces (a pull-request list, a commit log view) still linkify
 * inside them. Not fenced code blocks, which are reliably safe, and not raw
 * blocks or comments.
 */
const PLATFORM_RULES: Record<LintPlatform, { mention: RegExp; issue: RegExp }> = {
  github: {
    // An at-prefixed word. NOT preceded by a word character, a dot or a dash,
    // so an email address (`user@example.com`) is not one - the same boundary
    // Carve's own mention production uses (PART 9R §7). The name runs over
    // letters, digits, `_`, `-` and INTERIOR dots, so a scope prefix
    // (`@types/node`) flags its scope and `@release-1.0` flags whole.
    mention: /(?<![\w@.\-/])@([A-Za-z0-9_][\w-]*(?:\.[A-Za-z0-9_][\w-]*)*)/g,
    // A hash-number. NOT preceded by a word character, another `#`, or a `/`,
    // so a heading marker (`## 2`), an id-shaped `#a1` and a URL FRAGMENT
    // (`https://e.com/#99`) are out; the run is DIGITS ONLY, so `#release-1.0`
    // is a tag rather than an issue reference. A fragment is part of a URL the
    // host linkifies AS a URL, not a separate issue reference - raised by
    // codex review, and the `/` in the mention class above is the same case.
    issue: /(?<![\w#/])#(\d+)(?![\w-])/g,
  },
}

const PLATFORM_LABEL: Record<LintPlatform, string> = { github: 'GitHub' }

/**
 * The platform names this build knows, for a caller with no type checker.
 *
 * Derived from the rule table rather than written twice, so a host added there
 * is accepted by the CLI in the same commit - a list kept by hand is how
 * "documented but not emittable" starts.
 */
export const KNOWN_LINT_PLATFORMS = Object.keys(PLATFORM_RULES) as readonly LintPlatform[]

/**
 * Collect the platform-autolink findings for the requested hosts.
 *
 * Scanned over SOURCE LINES rather than over the tree, because the tokens are
 * not nodes: a docblock tag inside a code span is part of that span's text, and
 * a host linkifies the published characters whatever node produced them. The
 * exclusion is therefore also by line - the verbatim and comment ranges the
 * document already reports - which is exactly the "fenced code blocks, raw
 * blocks and comments" carve-out, and leaves inline code spans in.
 */
function collectPlatformAutolinks(
  source: string,
  platforms: readonly LintPlatform[],
  skipLines: Set<number>,
  out: LintWarning[],
): void {
  // An OWN-property test, not `in`. `'toString' in PLATFORM_RULES` is true, so
  // an untyped caller threading a config value through crashed on the lookup
  // instead of being ignored the way the type comment promises. Raised by codex
  // review.
  const active = platforms.filter(
    (p, i) => platforms.indexOf(p) === i && Object.hasOwn(PLATFORM_RULES, p),
  )
  if (active.length === 0) return
  const lines = source.split('\n')
  const lineStart: number[] = []
  for (let off = 0, i = 0; i < lines.length; i++) {
    lineStart.push(off)
    off += lines[i]!.length + 1
  }
  const FIX_MENTION =
    'move the example into a fenced code block, or strip the sigil and rephrase'
  const FIX_ISSUE =
    'move the example into a fenced code block, or rewrite it as "item 1" / "point 1"'
  for (const platform of active) {
    const host = PLATFORM_LABEL[platform]
    const { mention, issue } = PLATFORM_RULES[platform]
    const checks: readonly (readonly [RegExp, string, string, string])[] = [
      [mention, 'platform-mention-token', 'an at-prefixed word', FIX_MENTION],
      [issue, 'platform-issue-reference', 'a hash-number', FIX_ISSUE],
    ]
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1
      if (skipLines.has(lineNo)) continue
      const text = maskInlineDestinations(lines[i]!)
      for (const [re, rule, what, fix] of checks) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          // ALREADY UTF-16. `source.split` and `m.index` count the string the
          // caller passed, which is the unit LintWarning documents, so these do
          // NOT go through the codepoint map the tree-derived findings use -
          // mapping them again shifted every span after an astral character.
          // Raised by codex review.
          const start = lineStart[i]! + m.index
          out.push({
            line: lineNo,
            column: m.index + 1,
            rule,
            message:
              host +
              ' re-linkifies ' +
              what +
              ' in published output, so "' +
              m[0] +
              '" becomes a link that notifies or references something unrelated; ' +
              fix +
              '.',
            start,
            end: start + m[0].length,
          })
        }
      }
    }
  }
}

/** Whether `ch` occurs unescaped in `line` before `end`. */
function hasUnescapedBefore(line: string, ch: string, end: number): boolean {
  for (let i = 0; i < end; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] === ch) return true
  }

  return false
}

/**
 * The caption lines of a figure wrapping a code or raw block.
 *
 * Read off the CAPTION'S OWN INLINE SPANS, not guessed from the figure range.
 * A captioned listing reports only the figure's range, so `collectVerbatimLines`
 * marks the caption verbatim along with the body - but the caption's inline
 * nodes each carry a position, and their union is exactly the published text.
 *
 * Guessing it as "the figure's first or last line carrying the caret" was close
 * enough for a one-line caption and wrong for a CONTINUED one, whose second
 * line has no marker and stayed skipped. Raised by codex review. Deriving it
 * from the spans also leaves a caret line in the fence BODY protected without
 * having to reason about which lines the delimiters occupy.
 */
function collectListingCaptionLines(doc: Document): Set<number> {
  const captions = new Set<number>()
  walkDocument(doc, (node) => {
    if (node.type !== 'figure') return
    const target = (node.target as { type?: string } | undefined)?.type
    if (target !== 'code_block' && target !== 'raw_block') return
    const caption = (node as { caption?: unknown }).caption
    if (!Array.isArray(caption)) return
    for (const part of caption as Positioned[]) {
      const pos = part.pos
      if (!pos) continue
      const end = pos.endLine ?? pos.startLine
      for (let ln = pos.startLine; ln <= end; ln++) captions.add(ln)
    }
  })
  return captions
}

/**
 * Blank out an inline link's or image's DESTINATION before matching.
 *
 * A destination renders as an `href`/`src`, never as visible text, so a host
 * cannot re-linkify it: `[x](#123)` is an internal link, not an issue
 * reference. Masking keeps the LINE LENGTH, so every offset and column the scan
 * reports still indexes the real source.
 *
 * Only the `](...)` shape is masked, which is the destination and nothing else
 * - a parenthesis in PROSE is untouched, so `(#123)` in a sentence still flags.
 *
 * WALKED, NOT MATCHED, because a destination may hold BALANCED parentheses:
 * `[x](a(b)#123)` has the whole `a(b)#123` as its href, and a `[^)]*` pattern
 * stopped at the first `)` and scanned the rest of the real destination as
 * prose. A backslash escapes the next character, so it cannot close the run
 * either. An UNBALANCED run is not a destination, so it is left alone. Raised
 * by codex review, twice.
 */
function maskInlineDestinations(line: string): string {
  // A BARE URL is linkified AS A URL, so a token in its query or path is part
  // of it and not a separate mention or issue reference. Masked first, and
  // length-preserving like the destination walk below, so a token after the URL
  // still indexes the real source. Raised by codex review.
  line = line.replace(/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, (m) => ' '.repeat(m.length))
  let out: string[] | null = null
  for (let i = 0; i + 1 < line.length; i++) {
    if (line[i] !== ']' || line[i + 1] !== '(') continue
    // A LABEL HAS TO OPEN SOMEWHERE. A bare `](#123)` in prose is visible text,
    // not a destination, and masking it lost the finding. An escaped `\]` does
    // not close a label either. Raised by codex review.
    if (line[i - 1] === '\\' || !hasUnescapedBefore(line, '[', i)) continue
    let depth = 1
    let j = i + 2
    for (; j < line.length; j++) {
      const c = line[j]!
      if (c === '\\') {
        j++
        continue
      }
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) break
    }
    if (depth !== 0 || j >= line.length) continue
    out ??= [...line]
    for (let k = i + 2; k < j; k++) out[k] = ' '
    i = j
  }

  return out ? out.join('') : line
}

/**
 * Line numbers whose content never reaches published text.
 *
 * FRONTMATTER is metadata: the renderer omits it from the body, so an at-word
 * in an `author:` field is not something a host can linkify. A LINK REFERENCE
 * DEFINITION renders as the empty string; only the links that resolve it are
 * published, and their visible text is their label, not the destination.
 *
 * Both were spurious `--platform` failures on valid documents, which is the
 * failure mode the ruling warns about most: a rule people turn off wholesale.
 * Raised by codex review.
 */
function collectUnpublishedLines(
  source: string,
  doc: Document,
  referencedFootnotes: Set<string>,
): Set<number> {
  const lines = new Set<number>()
  const addRange = (pos: Positioned['pos']): void => {
    if (!pos) return
    const end = pos.endLine ?? pos.startLine
    for (let ln = pos.startLine; ln <= end; ln++) lines.add(ln)
  }
  walkDocument(doc, (node) => {
    // A link reference definition and an ABBREVIATION definition both render as
    // the empty string. An abbreviation's expansion reaches the page only as a
    // `title` attribute, which a host does not linkify either.
    if (node.type === 'link_reference_definition' || node.type === 'abbreviation_def') {
      addRange((node as Positioned).pos)
    }
  })
  // A footnote definition's body IS published - in the endnotes - so a
  // REFERENCED one stays scanned. An UNREFERENCED one is dropped from the
  // output entirely, and `unused-footnote-definition` already reports it, so a
  // platform warning there is a second finding about text nobody sees.
  //
  // Located by the same source-line pattern the footnote checks use, because a
  // definition lives in `doc.footnoteDefs` rather than in `children` and so
  // carries no node to walk. That covers the definition's OWN line; a
  // continuation line of an unreferenced body is still scanned.
  const defs = doc.footnoteDefs ?? {}
  source.split('\n').forEach((line, i) => {
    const m = FOOTNOTE_DEF.exec(line)
    if (!m) return
    // Raw: `doc.footnoteDefs` is keyed by the label as written, so trimming
    // here would miss a padded definition and report it as referenced.
    const label = m[1]!
    if (hasOwnKey(defs, label) && !referencedFootnotes.has(label)) lines.add(i + 1)
  })
  // Frontmatter carries no node in `children`, but it DOES report a span - so
  // the span is used rather than re-derived from the source. Re-deriving it
  // meant matching the opener by hand, and a TYPED opener (`--- yaml`) did not
  // match, leaving every typed block scanned. Raised by codex review.
  const fmPos = doc.frontmatter?.pos
  if (fmPos) {
    const end = fmPos.endLine ?? fmPos.startLine
    for (let ln = fmPos.startLine; ln <= end; ln++) lines.add(ln)
  }

  return lines
}

/** Line numbers covered by a comment node, which a host never sees. */
function collectCommentLines(doc: Document): Set<number> {
  const comments = new Set<number>()
  walkDocument(doc, (node) => {
    if (node.type !== 'comment') return
    const pos = (node as Positioned).pos
    if (!pos) return
    const end = (pos as { endLine?: number }).endLine ?? pos.startLine
    for (let ln = pos.startLine; ln <= end; ln++) comments.add(ln)
  })
  return comments
}
