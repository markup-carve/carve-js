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
import { parse, type UnclosedContainer } from './parse.js'
import {
  slugify,
  inlineText,
  headingIdSlugOpts,
  normalizeHeadingRefLabel,
  headingRefKeyFromLabel,
  isCollapsedRef,
  type AsciiHeadingIdMode,
} from './heading-ids.js'
import { readStamp, compareSpecVersions } from './stamp.js'
import { SPEC_VERSION } from './version.js'
import { hasOwnKey } from './own-property.js'
import { isBidiControl } from './bidi-controls.js'
import type { BlockNode, Document, Heading } from './ast.js'

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
  for (const { id, node } of footnoteRefs) {
    referencedFootnotes.add(id)
    if (hasOwnKey(footnoteDefs, id)) continue
    out.push({
      ...locate(node, toUtf16),
      rule: 'unresolved-footnote',
      message: `Footnote reference [^${id}] has no matching definition; it renders as literal text.`,
    })
  }

  // Verbatim (code/raw-block) line numbers are needed by both source-line
  // collectors below. Build the set once and share it: an O(1) membership test
  // per line replaces a per-line scan over a growing range list (was O(n^2),
  // and was computed twice).
  const verbatimLines = collectVerbatimLines(doc)
  collectSilentFailures(source, doc, verbatimLines, out, toUtf16)
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
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (node.type === 'heading') headings.push(node as Positioned)
    else if (node.type === 'paragraph') paragraphs.push(node as Positioned)
    for (const key of Object.keys(node)) {
      if (key !== 'pos' && key !== 'attrs') walk(node[key])
    }
  }
  walk(doc.children)

  // 0.2 paragraph extent: opener-shaped continuation lines are literal. That
  // is often intentional hard-wrapped prose, so this is advisory; when the
  // author meant a block, the repair is a blank line before the marker.
  const likelyBlockOpener = (raw: string): RegExpMatchArray | null => {
    const line = raw.replace(/^(?:[ \t]*> ?)+/, '').replace(/^[ \t]+/, '')
    return line.match(
      /^(#{1,6} |>(?: |$)|(?:---|\*\*\*|___)[ \t]*$|\|.*\|[ \t]*$|`{3,}|~{3,}|:{2,}(?: |$)|\[[^\]]+\]: +|\[\^[^\]]+\]: +|\*\[[A-Z][^\]]*\]: +|%%|\{[^{}]+\}[ \t]*$|(?:[-*]|[0-9A-Za-z]+[.)]) )/,
    )
  }
  for (const p of paragraphs) {
    const first = p.pos?.startLine
    const last = (p.pos as { endLine?: number } | undefined)?.endLine ?? first
    if (first === undefined || last === undefined) continue
    // A paragraph that already began with a malformed/block-looking marker has
    // a more specific diagnostic below; do not cascade on its later lines.
    if (likelyBlockOpener(lines[first - 1] ?? '')) continue
    for (let lineNo = first + 1; lineNo <= last; lineNo++) {
      if (verbatimLines.has(lineNo)) continue
      const raw = lines[lineNo - 1] ?? ''
      const marker = likelyBlockOpener(raw)
      if (!marker) continue
      const markerAt = raw.indexOf(marker[1]!)
      push(
        lineNo,
        markerAt + 1,
        marker[1]!.length,
        'missing-blank-before-block',
        'This block-looking line is part of the open paragraph in Carve 0.2. Add a blank line before it if a new block was intended.',
      )
    }
  }

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

}

/**
 * PORTABILITY (advisory) - source whose whitespace parses differently in Djot.
 *
 * Nothing here is a defect in the document: Carve renders it exactly as the
 * author intended. The rule marks a place where Carve accepts whitespace that
 * Djot does not, so a document that avoids it is valid Djot source as well.
 * The portable form is also the CommonMark-safe form, so the advice costs no
 * Markdown compatibility.
 */
function collectPortableWhitespace(
  source: string,
  doc: Document,
  verbatimLines: Set<number>,
  out: LintWarning[],
): void {
  const lines = source.split('\n')
  // A source-relative table of each line's UTF-16 start offset, so a
  // continuation line (which has no AST node of its own to read a position
  // from) can still report a `start`/`end` in the same units as every other
  // LintWarning.
  const lineStart: number[] = []
  for (let off = 0, i = 0; i < lines.length; i++) {
    lineStart[i] = off
    off += lines[i]!.length + 1
  }

  // A `>` blockquote marker with no space after it. Djot has no `>>` marker at
  // all, so a nested quote must be written `> > q`; anchoring on each
  // block_quote node's OWN startColumn (as the parser itself recorded it, not
  // a hardcoded column) reports each level separately, and is naturally
  // correct through arbitrary interposed containers - a list item, a div, an
  // admonition - since it never has to walk the raw text past their syntax to
  // reach a nested quote's real column.
  //
  // A block_quote node's own position spans its ENTIRE range (startLine to
  // endLine), including every continuation line at this nesting depth - not
  // just the line it opens on - so each of those lines needs its own marker
  // check: Djot does not strip an unspaced `>` on a continuation line either;
  // it falls through to lazy paragraph continuation and the `>` survives as
  // literal text, which is a silent divergence from Carve (which always
  // strips it) exactly like the opening-line case this rule already covers.
  //
  // A LAZY continuation line carries no marker of its own at all - not even
  // the outermost one - and is ordinary paragraph text that happens to be
  // laid out under the quote. Nothing on that line is a marker, so a `>`
  // that lands at a node's recorded column there is coincidence, not syntax
  // (e.g. "> > As the report says.\n  >90% of cases fail." - line 2 is a
  // lazy continuation, and its literal ">90%" happens to sit at the inner
  // quote's recorded column 3). Checking it anyway would both false-positive
  // AND, if the advice were taken, corrupt a document the two engines
  // already agree on: adding the suggested space turns "&gt;90%" (Carve and
  // Djot: identical today) into "&gt; 90%" in Carve but a dropped chevron
  // ("90%") in Djot, since Djot would then read it as a real, if oddly
  // placed, blockquote marker. So before trusting a node's own column on a
  // given physical line, EVERY enclosing block_quote's marker must also be
  // present at ITS OWN recorded column on that same line - if any ancestor's
  // marker is missing, the line is a lazy continuation at that outer level
  // and this node's column carries no marker either, so the line is skipped
  // entirely for this node. `ancestorCols` is collected once while walking
  // the tree, outermost first, rather than re-derived from the text.
  //
  // KNOWN LIMITATION: on a continuation line, this still checks each node at
  // its OWN recorded startColumn, which was computed from the node's OPENING
  // line. When an OUTER quote's marker is unspaced on a LATER line, every
  // INNER level's marker on that same physical line shifts one column to the
  // left of where the inner node's own recorded startColumn expects it, so
  // the inner check silently misses it on that line (e.g. `> > a\n>>bad\n`
  // reports only the outer, at [2,1] - not the inner, which sits at column 2
  // on that line, not its own recorded column 3). This is bounded, not open-
  // ended: fixing the reported outer marker and re-running the linter moves
  // the inner marker back to its recorded column, so it is then reported too
  // - a divergent document is never reported clean, just not fully explained
  // in one pass. A version of this rule that also gets nested mixed-spacing
  // right in one pass would need to walk each line's live text forward from
  // its enclosing container's column, consuming each level's marker as it is
  // actually spaced on THAT line rather than trusting a recorded column - but
  // that walk cannot generically tell a quote's own repeated `>` prefix apart
  // from another container's marker syntax (a list bullet, a div fence)
  // interposed between two quote levels on the same line, and misidentifying
  // that syntax as content would be a worse, non-convergent miss than this
  // one. Per-node anchoring stays correct through any such interposition,
  // which is why it is what this rule uses despite the narrower limitation
  // above.
  //
  // Exempt: whitespace of any kind (a tab and two spaces both parse identically
  // in the two engines) and end of line (a bare `>` separator line likewise),
  // a lazy continuation line that carries no marker at this column at all
  // (there is nothing to make portable), and any line inside a verbatim
  // (code/raw) region, where the character at this column is sample text, not
  // a marker.
  //
  // KNOWN LIMITATION: a `>` marker followed by a fence opener on the SAME line
  // (for example `>` immediately followed by three backticks) is skipped,
  // because collectVerbatimLines marks that line verbatim, so the unspaced
  // marker is never checked. This is a miss, not a false positive: the rule
  // simply says nothing about that line rather than reporting it wrongly.
  //
  // No sort is needed here: `lintCarve` already sorts `out` by `start` at the
  // end, and two quote warnings from this loop can never share a `start`.
  const quotes: Array<{ node: Positioned; ancestorCols: number[] }> = []
  const collectQuotes = (value: unknown, ancestorCols: number[]): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectQuotes(item, ancestorCols)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    let childAncestorCols = ancestorCols
    if (node.type === 'block_quote') {
      const q = node as Positioned
      quotes.push({ node: q, ancestorCols })
      const col = q.pos?.startColumn
      if (col) childAncestorCols = [...ancestorCols, col]
    }
    for (const key of Object.keys(node)) {
      if (key !== 'pos' && key !== 'attrs') collectQuotes(node[key], childAncestorCols)
    }
  }
  collectQuotes(doc.children, [])
  // A footnote definition body is a normal block sequence living outside
  // `doc.children` (see the Document.footnoteDefs docblock in ast.ts).
  if (doc.footnoteDefs) collectQuotes(Object.values(doc.footnoteDefs), [])

  for (const { node: q, ancestorCols } of quotes) {
    const startLine = q.pos?.startLine
    const endLine = q.pos?.endLine ?? startLine
    const col = q.pos?.startColumn
    if (!startLine || !endLine || !col) continue
    for (let line = startLine; line <= endLine; line++) {
      if (verbatimLines.has(line)) continue
      const text = lines[line - 1] ?? ''
      // Every enclosing quote's own marker must be present at ITS OWN
      // recorded column on this physical line before this node's column can
      // be trusted as a marker position at all - see the comment above.
      if (ancestorCols.some((aCol) => text[aCol - 1] !== '>')) continue
      // Guard against position drift, and skip a lazy continuation line: only
      // flag where this node's own marker really is.
      if (text[col - 1] !== '>') continue
      const after = text[col]
      if (after === undefined || after === ' ' || after === '\t' || after === '\r') continue
      const start = (lineStart[line - 1] ?? 0) + (col - 1)
      out.push({
        line,
        column: col,
        rule: 'portable-quote-marker-space',
        message:
          'This ">" blockquote marker has no space after it. Carve treats it as a real ' +
          'quote marker regardless; Djot only recognizes it when followed by a space, a ' +
          'tab, or the end of the line, and otherwise leaves the ">" as literal text. ' +
          'Write "> " with a space - and a nested quote as "> > ", since Djot has no ' +
          '">>" marker.',
        start,
        end: start + 1,
      })
    }
  }
}

// Deprecated compatibility path retained for the CLI option docs/history; the
// blockquote marker rule is now core syntax and is reported by default.
void collectPortableWhitespace

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

  for (let i = 0; i < lines.length; i++) {
    if (verbatimLines.has(i + 1)) continue
    const line = lines[i]!
    const m = FOOTNOTE_DEF.exec(line)
    if (!m) continue
    const label = m[1]!.trim()
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
    const label = m[1]!.trim()
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
