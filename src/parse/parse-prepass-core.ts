import { buildBracketMap } from './inline/parse-brackets.js'
import { type Attrs, type BlockNode, type CodeBlock, type DefinitionItem, type Position, type Table } from '../ast.js'
import { isEmptyAttrs, isValidAttrPayload, isValidInlineAttrPayload, parseAttrs } from '../extension/attribute-parser.js'
import { indentColumns, isBlankLine, layoutWork, Lexer, TRAILING_WS } from './parse-lexer.js'
import { isCarveWhitespace, trimEndSpaceTab, trimNonNbsp } from '../trim-non-nbsp.js'
import { linkDestinationValue } from '../link-destination.js'
import { utf8ByteLength } from '../extension/abbr-budget.js'
import { ownValue, setOwn } from '../own-property.js'
import { delimitedTable } from '../table/delimited-table.js'
import { tableColumnsFromAttrs, tableRowGroupsFromAttrs } from '../table/table-source-metadata.js'
import { entriesToWire } from '../ast/definition-list-wire.js'
import { RE_INLINE_ATTR } from './inline/parse-inline-opaque.js'

// Content must carry at least one non-ASCII-whitespace character, mirroring
// RE_CAPTION: `# ` / `#   ` (marker + whitespace only) and `#\t…` are NOT
// headings, exactly like the caption rule. Leading spaces are folded into the
// ` +` delimiter, so the content group starts at the first non-space; a NBSP
// (U+00A0) counts as content, as everywhere else in the parser.
export const RE_HEADING =
  /^(#{1,6}) +((?=[ \t]*[^ \t\n\r]).+?)(?:[ \t]+\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)\})?[ \t]*$/

// Thematic break: a COL-0 line of 3+ CONTIGUOUS identical `-`, `*`, or `_`
// (`---`, `***`, `___`, `----`), followed only by optional trailing
// whitespace and end of line (grammar §262 thematic_break). No leading
// indent and no internal spaces: a spaced/indented `* * *` / ` ***` is NOT a
// break and falls through to normal parsing (list / paragraph). The chars
// must all match, so a mixed `-*-` is not a break. Matches the executable-
// spec oracle `/^(-{3,}|\*{3,}|_{3,})[ \t]*$/`. Tested against the RAW line
// (NOT trimStructural), so leading whitespace correctly disqualifies it.
export const RE_HR = /^([-*_])\1{2,}[ \t]*$/

export const FENCE_TRAILING_WS = '[ \\t]*$'

/**
 * A line matcher whose `[label]` slot closes where the reader's own bracket scan
 * does, rather than at the first `]`.
 *
 * The `label` production takes a BALANCED run (markup-carve/carve#2576), and a
 * regex cannot spell one - which is why the slot was written flat as
 * `\[[^\]]*\]` in the colon opener and the fence info line, the two spellings of
 * the one production, and why both lost a label holding a nested bracket. So the
 * slot matches greedily here and each label group is checked against
 * `buildBracketMap`: the same scan the inline pass resolves a link label with, so
 * a nested bracket, an escaped `]` and a `]` inside a code span read the same way
 * in both, and an UNCLOSED backtick run swallows the closer and leaves the line as
 * prose - which is what a link text does with the same bytes.
 *
 * `test` and `exec` keep RegExp's own signatures, so every tracker that asks
 * whether a line opens the block gets this one answer instead of a second.
 *
 * THE SLOT IS `[^\n]*`, NOT `.*`. JavaScript's dot also excludes U+2028 and
 * U+2029, which the flat `[^\]]*` accepted, so a dot would have turned a label
 * holding one into prose. How those two characters read is a question of its own
 * and is not answered here.
 */
export function balancedLabelMatcher(
  re: RegExp,
  labelGroups: readonly number[],
): { test: (line: string) => boolean, exec: (line: string) => RegExpExecArray | null } {
  const exec = (line: string): RegExpExecArray | null => {
    const m = re.exec(line)
    if (m === null) return null
    for (const group of labelGroups) {
      const raw = m[group]
      // A greedy slot reaches the LAST `]` on the line, so an unbalanced run
      // arrives here rather than being silently cut short at the first one.
      if (raw !== undefined && buildBracketMap(raw)(0) !== raw.length - 1) return null
    }

    return m
  }

  return { test: (line) => exec(line) !== null, exec }
}

export const RE_FENCE = balancedLabelMatcher(
  new RegExp(
    '^()(`{3,}|~{3,}) ?(?:([a-zA-Z0-9_+#/.-]+)(?: +("[^"]*"))?(?: +(\\[[^\\n]*\\]))?' +
      '|("[^"]*")(?: +(\\[[^\\n]*\\]))?|(\\[[^\\n]*\\]))?' +
      FENCE_TRAILING_WS,
  ),
  [5, 7, 8],
)

export const RE_UNORDERED = /^(?=([ \t]*))\1[-*] +[ \t]*([^ \t\r\n][^\r\n]*)$/

// Ordered marker: decimal, a single letter (alpha), or a roman-numeral
// run, then `.` or `)`. The dialect is fixed by the FIRST item (see
// olKindOf); letter/roman markers are ambiguous w.r.t. paragraphs (§10).
//
// BARE-DOT MARKER (Carve addition; proposal for carve#315). The value may be
// EMPTY when the delimiter is `.`: a bare `. ` is a decimal ordered marker that
// counts from 1. The empty branch is the zero-width lookahead `(?=\.)`, so it
// fires only before a `.` and a bare `)` can never match -- `) text` collides
// with prose parentheticals far more often, and AsciiDoc (the source of the
// shorthand) uses `.` only. Capture groups are unchanged, so every call site
// keeps working: [1] indent, [2] value ('' when bare), [3] delimiter, [4] content.
export const RE_ORDERED =
  /^(?=([ \t]*))\1([0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))([.)]) +[ \t]*([^ \t\r\n][^\r\n]*)$/

// Task states: `x`/`X` are checked; ` `, `_`, `-`, `/`, `!`, `>`, and `?`
// render as unchecked checkboxes. `_` is an open-state alias.
export const RE_TASK = /^(?=([ \t]*))\1[-*] +\[([ xX\-_>/!?])\] +[ \t]*([^ \t\r\n][^\r\n]*)$/

// A list-item attribute block ABUTTING the marker: a bullet (`-`/`*`) or an
// ordered marker directly followed by `{...}` (no space), then the marker's
// required space and content. The brace attaches its attributes to the <li>
// (Carve addition, grammar `item_attributes`). The brace body uses the same
// quote-aware subpattern as the inline span tail (RE_SPAN_TAIL).
// The ordered branch carries the same bare-dot alternative as RE_ORDERED, so
// `.{#x} text` is an item like `1.{#x} text` and `-{#x} text` are: the shape is
// marker + [attrs] + space + content, and the block sits BEFORE the required
// space rather than competing with it. A block with nothing after it is not a
// marker in any form (`.{#x}text`, `1.{#x}text`, `-{#x}text` are all text).
export const RE_ITEM_ATTR =
  /^(?=([ \t]*))\1((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +[ \t]*[^ \t\r\n][^\r\n]*)$/

export const RE_ITEM_ATTR_HEAD =
  /^(?=([ \t]*))\1((?:[-*])|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])\{((?:[^}"'\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}( +[ \t]*)(?=[^ \t])/

// Strip a valid abutting `{...}` from a marker line so the bare marker regexes
// match, returning the stripped line plus the parsed attributes. Returns null
// when there is no abutting brace or the brace is not a valid attribute payload
// (then `-{...}` is not a marker and the line stays ordinary text, mirroring the
// inline-span disambiguation, grammar §14).
export interface ItemAttributeMarker {
  stripped: string
  attrs: Attrs | undefined
  markerLine?: string
  contentOffset?: number
  headWidth?: number
}

export const RE_TASK_CONTENT_HEAD = /^\[([ xX\-_>/!?])\] +[ \t]*(?=[^ \t])/

export function extractItemAttr(line: string, terminatorFree = false): ItemAttributeMarker | null {
  const m = (terminatorFree ? RE_ITEM_ATTR_HEAD : RE_ITEM_ATTR).exec(line)
  if (!m || !isValidInlineAttrPayload(m[3]!)) return null
  const parsed = parseAttrs(m[3]!)
  // Empty braces remove marker metadata without adding an empty AST attribute object.
  const attrs = isEmptyAttrs(parsed) ? undefined : parsed
  if (!terminatorFree) return { stripped: m[1]! + m[2]! + m[4]!, attrs }

  const contentOffset = m[0].length
  const content = line.slice(contentOffset)
  const head = m[1]! + m[2]! + m[4]!
  const taskWidth = RE_TASK_CONTENT_HEAD.exec(content)?.[0].length ?? 0
  // Classifiers need the marker, an optional checkbox, and one payload character.
  // The body stays a slice of the source instead of a slice of a flattened rope.
  return {
    attrs, contentOffset, headWidth: head.length,
    markerLine: head + content.slice(0, taskWidth + 1),
    get stripped() {
      if (layoutWork.on) layoutWork.seam += head.length + content.length
      return head + content
    },
  }
}

/**
 * ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT (markup-carve/carve#977, PART
 * 7). Carve's whitespace is four characters - U+0020, U+0009, U+000A and
 * U+000D - and EVERY OTHER CHARACTER IS CONTENT, with U+000B and U+000C named
 * there as the two an implementation is likeliest to admit by accident.
 *
 * This was `[ \t]`, the host language's `\s` minus U+00A0. A class with
 * one exception carved out of it is still the host language's class: a vertical
 * tab, a form feed, an OGHAM SPACE MARK and every Unicode space were whitespace
 * to the emptiness tests that call this and content everywhere else in the
 * parser. An inline footnote `^[<VT>]` came out literal text where
 * `^[<NBSP>]` came out a footnote, on the same reading of the same rule.
 *
 * The NBSP exception is gone because it is no longer an exception: U+00A0 is
 * simply not one of the four, so nothing has to remember it.
 */
export function trimStructural(text: string): string {
  return trimNonNbsp(text)
}

export const RE_CONTINUATION_MARKER = /^\+[ \t]*$/

export function isContinuationMarker(line: string): boolean {
  return RE_CONTINUATION_MARKER.test(line)
}

export const RE_BLOCKQUOTE = /^>(?: ([^\r\n]*)|[\t][ \t]*|)$/

export const RE_VALID_ADMONITION_OPEN = balancedLabelMatcher(
  /^(:{3,}) +([a-zA-Z0-9_][\w-]*)(?: +("[^"]*"))?(?: +(\[[^\n]*\]))?[ \t]*$/,
  [4],
)

// Invalid metadata does not erase a recognized container (carve#2693).
export const RE_CONTAINER_PREFIX = /^(:{3,}) +([a-zA-Z0-9_][\w-]*)(?=$|[\s\u0085"{\[“”])[^\r\n]*$/

export const RE_ADMONITION_OPEN = {
  exec(line: string): RegExpExecArray | null {
    return RE_VALID_ADMONITION_OPEN.exec(line) ?? RE_CONTAINER_PREFIX.exec(line)
  },
  test(line: string): boolean {
    return this.exec(line) !== null
  },
}

// The closer takes the OPENER's trailing run (`TRAILING_WS`), not `\s`. This is
// the pair carve-js#805 names: carve-js#794 / carve-js#798 narrowed
// `RE_ADMONITION_OPEN` above to `[ \t]*$` and left this one wide, so a mark that
// could not open a block could still close one.
export const RE_ADMONITION_CLOSE = new RegExp('^(:{3,})' + TRAILING_WS)

// Line block: the opener is `::: |` ONLY (a bare pipe type token). The old
// `::: line-block` keyword is no longer special -- it falls through to the
// admonition branch and renders as an ordinary `<div class="line-block">`
// with NO hard-break / stanza / leading-whitespace handling. Output of the
// pipe form is unchanged (`<div class="line-block">` with `<br>` breaks).
// Mirrors carve#119 / carve-php#124.
export const RE_LINE_BLOCK_OPEN = /^(:{3,}) +\|[ \t]*$/

// Hard-break block: `::: \` (colon fence + a single trailing backslash). Like
// the line block it emits a `<div>`, but with class `hardbreaks`: the body is
// parsed as ordinary blocks and soft breaks become hard breaks ONLY in the
// div's DIRECT paragraph children (nested blocks keep ordinary soft breaks),
// with no leading-whitespace preservation. carve spec #207 / 88-line-blocks;
// matches carve-rs / carve-php (carve-js was the lagging impl).
export const RE_HARDBREAKS_OPEN = /^(:{3,}) +\\[ \t]*$/

// Fenced block quote: a colon fence plus a bare '>' type token. A second
// SPELLING of the block quote, not a new block: the body is parsed as ordinary
// blocks and the node is the one a '> ' prefix produces, so the two forms are
// the same tree. Third member of the sigil-fence family beside the line block
// and the hard-break block, and it takes the same required space before the
// token (markup-carve/carve#1718).
export const RE_QUOTE_BLOCK_OPEN = /^(:{3,}) +>[ \t]*$/

// Generic fenced div: a bare `:::` opener with NO type word (djot's generic
// container). A typed `::: word` routes to parseAdmonition. An inline
// `::: {.class}` is NOT a div (strict djot) -- use a preceding attribute
// line. A bare opener MAY carry an inert `[label]` (a typeless tab member,
// `::: [First]`) which a group extension consumes. As the FIRST token after
// the fence the label may sit directly against it (`:::[First]`), exactly as a
// code fence allows ```[NPM]; a label after a TYPE word needs a space and is
// handled by RE_ADMONITION_OPEN. Shares the `:::` closer.
// Groups: 2 label (bracketed).
export const RE_DIV_OPEN = balancedLabelMatcher(/^(:{3,}) *(?:(\[[^\n]*\])[ \t]*|\t[ \t]*)?$/, [2])

export const RE_DEFLIST_TERM = /^::(?!:) [ \t]*(?=[^ \t])(.+)$/

/**
 * `*[ABBR]: expansion`, the only shape a definition line has.
 *
 * Exported because the HTML importer rebuilds these from PART 10 §13a's
 * `data-carve-abbreviations` carrier: a line this does not match is not a
 * definition, and emitting one as an `abbreviation_def` would put a visible
 * paragraph into the document instead.
 */
export const RE_ABBR_DEF = /^\*\[([A-Za-z0-9]+)\]: +(?![ \t]*$)([^]+)$/u

/**
 * `reference_definition`, whole: label, destination, optional title, optional
 * trailing attribute block, anchored at the line ending.
 *
 * The block is matched here rather than scanned off the line first (carve#604,
 * reverted by markup-carve/carve-js#1868). A scan that walks the line from its
 * start cannot tell a brace or a quote in the DESTINATION from one opening the
 * block, so `[a]: /u{x} {.c}` and `[a]: it's {.c}` both fell through to prose.
 * Matched as `\{.*\}` after exactly one space and validated below, they read
 * as the production has them. With no space the braces are destination
 * (`[a]: /u{.c}`).
 */
export const RE_LINK_DEF =
  /^[ \t]*\[(?!@)([^\]]+)\]: +(\P{White_Space}+)(?: (?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'))?(?: (\{.*\}))?[ \t]*$/u

export const RE_EMPTY_LINK_DEF = /^[ \t]*\[(?![@^])([^\]]+)\]:[ \t]*$/

/** A reference definition read off one line. */
export interface LinkDefMatch {
  label: string
  href: string
  title: string | undefined
  attrText: string | null
}

/**
 * The production's own test, and the only spelling of it. Every predicate here
 * that asks "is this line a definition" reads this, so narrowing the rule
 * changes all of them at once.
 */
export function matchLinkDef(line: string): LinkDefMatch | null {
  const empty = RE_EMPTY_LINK_DEF.exec(line)
  if (empty !== null) return { label: empty[1]!, href: '', title: undefined, attrText: null }
  const m = RE_LINK_DEF.exec(line)
  if (m === null) return null
  const href = linkDestinationValue(m[2]!)
  if (href === null) return null
  // An invalid block is not `attributes`, so it is leftover content and the
  // anchor disposes of the line (CARVE-P3-006).
  let attrText: string | null = null
  if (m[5] !== undefined) {
    attrText = m[5].slice(1, -1)
    if (!isValidInlineAttrPayload(attrText) || isEmptyAttrs(parseAttrs(attrText))) return null
  }

  return { label: m[1]!, href, title: m[3] ?? m[4], attrText }
}

export function isLinkDefLine(line: string): boolean {
  return matchLinkDef(line) !== null
}

/**
 * `[^label]: body`, the footnote definition line.
 *
 * Exported because the HTML importer rebuilds an authored label from PART 10
 * §13a's `data-carve-footnote-label` carrier and has to ask the question this
 * parser asks. A hand-spelled "no whitespace" rule was stricter than the
 * grammar and rejected `[^my note]`, which the parser reads and the exporter
 * writes.
 */
export const RE_FOOTNOTE_DEF = /^\[\^([^\]]+)\]:(?=[ \t]*[^ \t]) +([^]+)$/

export const RE_TABLE_ROW = /^\|/

// A complete standard table row opens AND closes with `|` (grammar
// standard_row). A stray leading `|` with no closing `|` (`| a`) is ordinary
// paragraph text, not a table -- so a table opener / interrupter must have the
// trailing pipe, not just a leading one. A row may carry an attribute block
// GLUED to its closing pipe (`| a |{.x}` -> <tr class="x">); rowAttrsFromLine
// validates and strips it, so the gate allows an optional trailing `{...}`.
/**
 * Exported so the linter gates on a COMPLETE row the same way the parser does.
 * A leading `|` alone is a paragraph, and a rule that reported cell syntax in
 * one would be reporting text that has no cells.
 */
export const isTableRow = (line: string): boolean => {
  if (!RE_TABLE_ROW.test(line)) return false
  if (!/\|[ \t]*$/.test(line) && rowAttrsFromLine(line).attrs === undefined) return false
  // A slot is counted, not weighed (CARVE-P9-082): `||` and `| |` are one empty
  // cell, and only a lone `|` has no slot.
  return splitTableRow(rowAttrsFromLine(line).body).length > 0
}

// A `+`-prefixed continuation row (multi-line cell). Like the grammar's
// continuation_row it ends with `|`; that trailing pipe distinguishes
// it from a `+ ` list item (which never ends with `|`). Only consumed
// inside parseTable, after a standard `|` row has opened the table.
// The tail after the closing `|` is line padding, so `[ \t]*$` and not `\s*$`
// (PART 7). With `\s` a continuation row whose line ended in a vertical tab was
// still consumed into the cell above, where the same row ending in any other
// control character became a paragraph between two tables.
export const RE_TABLE_CONT = /^\+.*\|[ \t]*$/

// Frontmatter close fence: bare `---` only.
export const RE_RAW_FENCE = new RegExp('^(`{3,}|~{3,}) ?=([a-zA-Z][\\w-]*)' + FENCE_TRAILING_WS)

export const RE_COMMENT_BLOCK = /^(%{3,})(.*)$/

export const RE_COMMENT_LINE = /^[ \t]*%%/

/**
 * A sub-lexer over a container's body.
 *
 * `lines` are the body lines the container already collected. They are handed
 * over AS LINES: every call site used to join them and the Lexer split them
 * straight back, which copied the whole body twice at every nesting level and
 * is the bulk of markup-carve/carve#752's cubic term. Nothing about the round
 * trip was load-bearing - a parent line never holds a newline, because the
 * parent split on the same normalization - except the trailing-blank drop,
 * which the Lexer now reproduces directly.
 */
/**
 * THE LAZY FRAME (PART 9 SS10 I2, markup-carve/carve-js#1609).
 *
 * Prepended to a line a block quote admitted as LAZY continuation text. Its
 * first character is not whitespace, so the line stands at column 0 AND
 * matches no block opener at all - which is the whole difference between a
 * frame and a dedent. A dedented line still re-classifies at the column it
 * was dedented to, and that is what opened a real code fence under
 * `> - :: t` for a line the quote had already folded into the term.
 *
 * Unforgeable rather than merely unlikely: `parse` replaces every U+0000 with
 * U+FFFD before the first line is read (PART 0 INPUT), so no document can
 * spell it.
 */
export const LAZY_FRAME = '\u0000L\u0000'

/**
 * A line with the LAZY frame removed.
 *
 * Every consumer that turns a line into TEXT calls this; the predicates
 * deliberately do not, because failing them is what the frame is for. The
 * def-list ENTRY matcher is the one predicate that unframes, which is PART 9
 * SS24 C3's lenient entry.
 */
export function stripLazyFrame(line: string): string {
  // Nested collectors may frame the same line more than once.
  while (line.startsWith(LAZY_FRAME)) line = line.slice(LAZY_FRAME.length)
  return line
}

/**
 * Normalize an explicit `[label]: url` reference label for matching:
 * whitespace-collapsed but case-SENSITIVE. Djot does "no case normalization
 * on reference definitions" (links_and_images spec), and Carve keeps a
 * case-mismatched reference unresolved -> literal (corpus 36). Implicit
 * heading references match heading TEXT exactly too, adding NFC (heading-ids.ts).
 */
/**
 * Strip leading block-container prefixes (blockquote `>`, bullet/task and
 * decimal list markers, indentation) so a definition nested inside a real
 * container (introduced after a blank line) is seen by the single
 * forward-reference pass.
 *
 * KNOWN LIMITATION (§10): this pass is line-based and has no block context,
 * so it strips a container marker even when, at the document top level, that
 * marker is really a hard-wrapped prose line (full-djot: a lone marker under
 * prose with no blank line is paragraph text, not a block). A definition
 * jammed directly onto such a line — `1. [r]: /u` or `> [r]: /u` immediately
 * under prose — is therefore still collected, so the prose line resolves the
 * reference even though it renders literally. This over-collection is limited
 * to that pathological no-blank input; real definitions sit after a blank
 * line, where this pass and the block parser agree. Alpha/roman markers are
 * deliberately NOT stripped (a def directly on an `a.`/`i.` line is the same
 * near-impossible input, and skipping the strip avoids the more common false
 * positive of fabricating a def from ordinary prose).
 */
// A definition list's DESCRIPTION marker, which opens entry content exactly as a
// bullet does - so a definition written on that line is collected from it (§801,
// carve-js#730). It is NOT unconditional: a `:` line with no term above it is
// not a description at all but paragraph text, and a definition in it defines
// nothing (corpus 216-a-description-line-needs-a-term-above-it). Hence the
// `afterTerm` gate, which the caller answers from the preceding line.
//
// `::` is the TERM marker and a `:::` fence opener is a fence; both need
// whitespace after a SINGLE colon and neither has it, so neither matches.
export const RE_DESCRIPTION_PREFIX = /^[ \t]*:[ \t]+/

/**
 * Exported for `lint.ts`, which scans source lines for footnote definitions and
 * has to strip the same prefixes the collector strips - otherwise a definition
 * inside a block quote or list item is invisible to the lint rules while the
 * parser has already collected it (carve-js#1019).
 *
 * The KEEP-INDENT variant is the one lint wants. Residual indentation is what
 * separates `> [^a]: x` (a definition in a quote) from a line merely indented
 * under something, and dropping it would make an over-indented literal line
 * look like a definition.
 */
export function stripContainerPrefixesKeepIndent(raw: string, afterTerm = false): string {
  let offset = 0
  for (;;) {
    const before = offset
    let quote = offset
    while (raw[quote] === ' ' || raw[quote] === '\t') quote++
    if (raw[quote] === '>' && (raw[quote + 1] === ' ' || quote + 1 === raw.length)) {
      offset = Math.min(quote + 2, raw.length)
    }
    RE_PREPASS_MARKER_STRIP_AT.lastIndex = offset
    const marker = RE_PREPASS_MARKER_STRIP_AT.exec(raw)
    if (marker && (marker[2] === undefined || isValidInlineAttrPayload(marker[2]))) {
      offset += marker[0].length
    }
    if (afterTerm) {
      RE_DESCRIPTION_PREFIX_AT.lastIndex = offset
      const description = RE_DESCRIPTION_PREFIX_AT.exec(raw)
      if (description) offset += description[0].length
    }
    if (offset === before) return raw.slice(offset)
  }
}

export function stripContainerPrefixes(raw: string, afterTerm = false): string {
  // Residual INDENTATION, which is `whitespace` - a space or a tab and nothing
  // else (markup-carve/carve#977, PART 7). This is the view the definition
  // collector matches against, so a character eaten here resolved a reference
  // on a line the renderer prints verbatim: the definition line rendered
  // literally AND registered (#790). NBSP and U+FEFF were carved out of the
  // host language's class one at a time for that bug; naming the two
  // indentation characters directly makes both carve-outs unnecessary, and
  // takes U+000B, U+000C and every Unicode space out with them.
  return stripContainerPrefixesKeepIndent(raw, afterTerm).replace(/^[ \t]+/, '')
}

/**
 * One top-level pass over the whole source collects every reference
 * definition, so resolution is order-independent (grammar §6).
 * Blockquote markers are stripped first, so a quoted def (`> [r]: /u`)
 * is found here too — and fence tracking runs on the *stripped* line so
 * a definition shown inside a quoted code block stays a literal sample.
 * Admonition bodies and indented list defs already match the
 * whitespace-tolerant RE_LINK_DEF. Because this single pass is complete,
 * sub-lexers must NOT re-collect (that would overwrite a later
 * document-wide definition with a stale nested one).
 *
 * Implicit heading references (`[Heading Text][]` resolves to a matching
 * top-level heading) are handled in resolveHeadingIds, NOT here. That
 * deferred pass walks the parsed AST and uses the real inlineText, so
 * the implicit-ref key always agrees with the heading slug — no regex
 * pre-pass can mirror the inline parser perfectly.
 *
 * A marker-shaped definition is collected only when that marker really opens
 * or continues a container. PART 9 §10 does not let a list interrupt an open
 * paragraph, so `Intro\n- [r]: /u` remains paragraph text and must not enter
 * the reference table. The paragraph state below also remembers which open
 * container owns it: a column-0 sibling marker after item prose does open a
 * new item, while the same marker below document or quoted prose folds in.
 */
export const RE_PREPASS_MARKER =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +/

// The same marker with a task box after it, for the `afterMarker` strip below.
export const RE_PREPASS_MARKER_STRIP =
  /^([ \t]*)(?:[-*]|(?:[0-9]+|[ivxlcdm]+|[IVXLCDM]+|[a-z]|[A-Z]|(?=\.))[.)])(?:\{([^}]*)\})? +(?:\[[ xX\-_>/!?]\] +)?/

export const RE_PREPASS_MARKER_STRIP_AT = new RegExp(RE_PREPASS_MARKER_STRIP.source.slice(1), 'y')

export const RE_DESCRIPTION_PREFIX_AT = new RegExp(RE_DESCRIPTION_PREFIX.source.slice(1), 'y')

/**
 * The prepass marker at the head of `text`, or null when there is none.
 *
 * ONE producer, for the reason `fenceCloseRe` is one: an abutting brace has to
 * be tested for validity at every site that reads this marker, or the two sites
 * disagree about whether a line opened an item.
 */
export function prepassMarker(text: string, re: RegExp = RE_PREPASS_MARKER): RegExpMatchArray | null {
  const m = re.exec(text)
  if (!m) return null
  if (m[2] !== undefined && !isValidInlineAttrPayload(m[2])) return null

  return m
}

// The prepass's own quote-prefix pattern, named once so the walk below and any
// future reader of it cannot drift apart on which lines carry a marker.
export const RE_QUOTE_RUN = /^(?:[^\S ]*>(?: |$))+/

/**
 * The block quote depth of `text` behind its WHOLE container prefix.
 */
export function containerQuoteDepth(text: string): number {
  let rest = text
  let depth = 0
  // Both arms consume at least one character - a quote run carries its own `>`,
  // and the marker pattern needs a marker character and a space after it - so
  // the walk terminates on every input.
  for (;;) {
    const run = RE_QUOTE_RUN.exec(rest)
    if (run !== null) {
      depth += (run[0].match(/>/g) ?? []).length
      rest = rest.slice(run[0].length)
      continue
    }
    const marker = prepassMarker(rest, RE_PREPASS_MARKER_STRIP)
    if (marker === null) return depth
    rest = rest.slice(marker[0].length)
  }
}

/**
 * WHERE A PREPASS TRACKER WAS OPENED, so a later line can be asked whether it
 * still reaches that container.
 *
 * The pass models containers per line and had no notion of one ENDING, so every
 * tracker it opens - a code fence, a `:::` depth entry, a verse region - stayed
 * open for the rest of the document once its container was gone. The block
 * parser leaves the container and reads the following lines afresh; this pass
 * kept reading them as the container's interior, and each tracker turned that
 * into its own silent failure (carve-js#1135 for the fence, carve-js#1139 for
 * the depth stack).
 *
 * ONE RECORD AND ONE TEST for all three, rather than three ad-hoc tests: the
 * question is the same each time, and it is the spelling-it-N-times that let the
 * fence acquire a container test while the other two never got one.
 */
export interface PrepassScope {
  quoteDepth: number
  contentCol: number
}

/**
 * Is `line` a colon fence the BLOCK PARSER really opens?
 *
 * The prepass's own depth tracker is deliberately looser - it takes any run of
 * three or more colons, so `:::note` pushes a level even though the parser
 * renders that line as a paragraph. That looseness predates this pass's
 * container scopes and is left alone; what it may NOT do is decide anything a
 * malformed line has no business deciding. Two such decisions are gated on this
 * instead:
 *
 *   - which width a fence takes as its ENCLOSING div's closer, where a phantom
 *     level let a `:::` inside a code sample end the fence and publish the
 *     sample's definitions;
 *   - whether a flush colon line ends an open list item, where a phantom
 *     opener popped a column the parser keeps, and the definition below it was
 *     rejected as top-level indentation.
 *
 * The four arms are the block dispatcher's own, in its order.
 */
export function isColonFenceOpener(line: string): boolean {
  return (
    RE_DIV_OPEN.test(line) ||
    (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
    RE_LINE_BLOCK_OPEN.test(line) ||
    RE_HARDBREAKS_OPEN.test(line) ||
    RE_QUOTE_BLOCK_OPEN.test(line)
  )
}

/**
 * Does `raw` still reach the container a tracker was opened in?
 *
 * `quoteDepth` and `indent` are the line measured the way the tracker's own
 * closer reads it - counted quote markers, and the indent INSIDE the quote,
 * because a content column inside a quote is measured inside it (carve#658).
 *
 * A BLANK LINE holds a column but not a quote depth, and both halves are the
 * block parser's: a blank line is transparent inside a list item, and it ends a
 * block quote.
 */
export function scopeHoldsLine(
  scope: PrepassScope,
  raw: string,
  quoteDepth: number,
  view: string,
): boolean {
  return (
    quoteDepth >= scope.quoteDepth &&
    (scope.contentCol === 0 ||
      isBlankLine(raw) ||
      // VISUAL COLUMNS, the way the parser measures reach: a tab is worth up to
      // four. Counting characters read a tab-indented body line as column one
      // against a column of three, ended the fence on it, and published the
      // definitions in the sample below. The cap keeps
      // it O(the column) rather than O(the indentation run).
      indentColumns(view, scope.contentCol) >= scope.contentCol)
  )
}

/**
 * Does the prepass's view of a line START A BLOCK, so that no paragraph is left
 * open below it?
 */
export function prepassOpensBlock(
  line: string,
  // A BARE `+` NAMES A BLOCK ONLY INSIDE SOMETHING. §17 L3 attaches it to the
  // container that holds it, and at document level nothing holds it: every reader
  // renders a lone `+` as prose there, whatever stands above it. Read as an
  // opener anyway, it declared the paragraph over, so the marker below it opened
  // a real item and that item's definition registered while the page printed the
  // whole run as text (carve-js#2310). Only the caller holding the container
  // stack passes this; everywhere else the line is all there is.
  plusOpens = true,
): boolean {
  return (
    line === '' ||
    lineOpensBlock(line) ||
    RE_COMMENT_LINE.test(line) ||
    isBlockAttributeLine(line) ||
    (plusOpens && isContinuationMarker(line)) ||
    RE_TABLE_CONT.test(line) ||
    RE_ABBR_DEF.test(line)
  )
}

/**
 * A container the definition prepass has open, by the ABSOLUTE column its
 * content starts at. `quote` separates the two ways a line reaches one: a block
 * quote is reached by writing its marker again, a list item by indentation
 * alone.
 */
export interface OpenContainer {
  col: number
  quote: boolean
  /** The column the container's own marker starts at. */
  base: number
}

/** One container peeled off a line's own prefix by `composeContainerPrefix`. */
export interface PeeledContainer {
  /** The column the container's content starts at. */
  content: number
  quote: boolean
  /** Whether it CONTINUES a container already open, rather than opening one. */
  matched: boolean
  /** The column this marker itself starts at. */
  marker: number
  /**
   * Whether this marker FOLDS into the open item's lead text instead of
   * opening one. PART 9 §24 C3: below an item's content column no opener
   * nests, and at the base column a marker starts a sibling - so the fold
   * window is the columns strictly BETWEEN the two, and nowhere else
   * (markup-carve/carve-js#1598).
   *
   * A marker that folds opens NOTHING, so the container stack does not move
   * under it either.
   */
  folds: boolean
  /**
   * Whether the walk was standing in a QUOTE this line did not re-mark. The
   * line never reached the list inside that quote, so its marker is the
   * quote's lazy paragraph text whatever column it sits at - a different
   * question from the item window above, and one the container stack answers
   * on its own.
   */
  behindQuote: boolean
}

/**
 * Peel a line's container prefix the way PART 9 §24 C5 hands a body down, and
 * report the column the line's own content starts at.
 */
export function composeContainerPrefix(
  raw: string,
  afterTerm: boolean,
  open: readonly OpenContainer[],
): { column: number; peeled: PeeledContainer[]; depth: number } {
  const peeled: PeeledContainer[] = []
  let pos = 0
  let depth = 0
  // The column the container behind the walk hands its body out at. The
  // document hands out column 0.
  let handed = 0
  // Set once a marker closes the open container it stands at: past that the
  // line is inside the new item, and no deeper open container is re-entered.
  let closed = false
  for (;;) {
    const rest = raw.slice(pos)
    const ind = leadingWhitespace(rest)
    const col = pos + ind
    while (!closed && depth < open.length && !open[depth]!.quote && open[depth]!.col <= col) {
      handed = open[depth]!.col
      depth++
    }
    const after = rest.slice(ind)
    if (after === '') return { column: col, peeled, depth }
    if (after[0] === '>' && (after.length === 1 || after[1] === ' ')) {
      if (col !== handed) return { column: col, peeled, depth }
      const content = col + (after.length === 1 ? 1 : 2)
      const matched = depth < open.length && open[depth]!.quote && open[depth]!.col === content
      if (matched) depth++
      peeled.push({ content, quote: true, matched, marker: col, folds: false, behindQuote: false })
      handed = content
      pos = content
      continue
    }
    // The DESCRIPTION body column is where the text really starts, not §16's
    // fixed three: the oracle registers a definition under a wider `:   ` too,
    // so the extra spaces are the marker's slot rather than indentation in the
    // body.
    const desc = afterTerm ? /^:[ \t]+/.exec(after) : null
    const marker = desc ?? prepassMarker(after)
    if (marker === null || !/\S/.test(after.slice(marker[0].length))) {
      return { column: col, peeled, depth }
    }
    const content = col + marker[0].length
    const matched = !closed && depth < open.length && !open[depth]!.quote && open[depth]!.col === content
    // THE CONTAINER THIS MARKER IS WRITTEN INSIDE, if the walk is still
    // standing in one. An ITEM folds the marker into its lead text over the
    // columns strictly between its base and its content column, and nowhere
    // else. A QUOTE the line did not re-mark is a different answer, kept apart
    // from the window: the marker is that quote's lazy text whatever its
    // column, but the container stack still moves under it. Past the last open
    // container there is no owner and the marker nests.
    const owner = !closed && depth < open.length ? open[depth]! : null
    const behindQuote = owner !== null && owner.quote
    const folds = owner !== null && !owner.quote && col > owner.base && col < owner.col
    if (matched) depth++
    else if (owner !== null && !owner.quote && !folds) closed = true
    peeled.push({ content, quote: false, matched, marker: col, folds, behindQuote })
    handed = content
    pos = content
  }
}

export interface LazyProbeFrame {
  levels: string[]
  endsInParagraph: boolean
}

export function lazyProbeFrame(blocks: BlockNode[]): LazyProbeFrame {
  const levels: string[] = []
  let current = blocks
  let endsInParagraph = false
  for (;;) {
    const last = current[current.length - 1]
    if (!last) return { levels, endsInParagraph }
    levels.push(`blocks:${last.type}:${current.length}`)
    endsInParagraph = last.type === 'paragraph'
    if (
      last.type === 'block_quote' || last.type === 'div' ||
      last.type === 'admonition' || last.type === 'directive' ||
      last.type === 'figure_group' || last.type === 'line_block'
    ) {
      current = last.children
      continue
    }
    if (last.type === 'list') {
      endsInParagraph = false
      const item = last.items[last.items.length - 1]
      if (!item) return { levels, endsInParagraph }
      levels.push(`items:${last.items.length}`)
      current = item.children
      continue
    }
    if (last.type === 'definition_list') {
      endsInParagraph = false
      const item = last.items[last.items.length - 1]
      if (!item) return { levels, endsInParagraph }
      levels.push(`definitions:${last.items.length}`)
      const definition = item.definitions[item.definitions.length - 1]
      if (!definition) return { levels, endsInParagraph }
      current = definition
      continue
    }
    return { levels, endsInParagraph }
  }
}

export function lazyProbeCost(lexer: Lexer, candidate: number): { start: number; cost: number } | null {
  let start = candidate - 1
  while (start >= 0 && !isBlankLine(lexer.lineAt(start)!)) start--
  start++
  if (start === candidate) return null
  let runBytes = 0
  for (let i = start; i < candidate; i++) runBytes += utf8ByteLength(lexer.lineAt(i)!) + 1
  return { start, cost: runBytes * 2 + utf8ByteLength(lexer.lineAt(candidate)!) }
}

export function spendLazyProbeBudget(lexer: Lexer, candidate: number, budget: number): number {
  const priced = lazyProbeCost(lexer, candidate)
  return priced && priced.cost <= budget ? budget - priced.cost : budget
}

/**
 * A block-attribute run handed BETWEEN two consecutive `parseBlocks` calls over
 * what the author wrote as one stream. `attrs` goes in as the starting `pending`
 * and comes back out as whatever was still pending when the stream ended.
 *
 * Only a caller that SPLIT one author-visible stream into two lexers passes one;
 * everywhere else a dangling run is still dropped (§15 A4). See the split at
 * `firstBlockIdx` in `parseList`, which is the whole reason this exists.
 */
export interface PendingAttrCarry {
  attrs: Attrs | null
  /** The stream ends with this half, so a run still pending at its end is dead. */
  last?: boolean
}

/**
 * PART 9 §17 L7: `{loose}` on the preceding block-attribute line is a
 * STRUCTURAL key, and it is CONSUMED - it never reaches the output as an HTML
 * attribute. The precedent is PART 12 §15's `header-rows`, which rides the same
 * line, carries a structural fact as a boolean, and is likewise consumed.
 *
 * It says the container's children render as BLOCKS rather than as inline runs,
 * which reaches the one shape a blank line cannot spell: a ONE-ITEM loose list,
 * and a definition description holding ONE block (a blank line between two
 * ENTRIES does not loosen a `<dl>` at all, so `<dd><p>x</p></dd>` is unspellable
 * at every entry count).
 *
 * THE AXIS EXISTS IN EXACTLY TWO PLACES, so the key applies in exactly two: a
 * LIST and a DEFINITION LIST. On a block quote, a div or anything else the name
 * has no meaning at all and renders `loose=""` like any other boolean - the
 * clause adds a meaning where there is one and reserves the name nowhere else.
 *
 * A BOOLEAN AND AN EMPTY VALUE ARE ONE KEY (PART 4), so `{loose}` and
 * `{loose=""}` both arrive here as `''` and both are consumed. `loose=x` names a
 * value this key does not take, so it stays an ordinary attribute and renders
 * `loose="x"`. There is no error state.
 *
 * REDUNDANT USE IS A NO-OP: on a list the blank lines already loosened, and on a
 * description that already holds two blocks, this changes nothing.
 */
export function consumeLooseKey(node: BlockNode): void {
  if (node.type !== 'list' && node.type !== 'definition_list') return
  const attrs = node.attrs
  if (!attrs?.keyValues || ownValue(attrs.keyValues, 'loose') !== '') return

  const keyValues = { ...attrs.keyValues }
  delete keyValues['loose']
  const order = attrs.order?.filter((slot) => slot !== 'loose')
  // An attribute run that held NOTHING but this key leaves no attributes at all,
  // rather than an empty record: `{loose}` is not an authored `{}` and a bare
  // `attrs: {}` would be published on the wire and re-rendered from there.
  const remaining: Attrs = {
    ...attrs,
    ...(Object.keys(keyValues).length ? { keyValues } : {}),
    ...(order?.length ? { order } : {}),
  }
  if (!Object.keys(keyValues).length) delete remaining.keyValues
  if (!order?.length) delete remaining.order
  if (remaining.id === undefined && !remaining.classes?.length && !remaining.keyValues) {
    delete node.attrs
  } else {
    node.attrs = remaining
  }

  if (node.type === 'list') {
    node.tight = false
    return
  }
  // THE DEFINITION-LIST HALF SETS ITS OWN FIELD, and PART 12 §8 publishes it
  // (markup-carve/carve#1624, spec `cfb8d7bf`). The list half above reuses
  // `tight`, which is required and already false-able; a `<dl>` has no such
  // field to reuse, because a blank line between two ENTRIES does not loosen it
  // at any entry count - so the SPELLED fact is the only thing that can say a
  // one-block description wraps, and it is set here and serialized as-is.
  //
  // Written only where the key was spelled: this function runs off the consumed
  // attribute, so a definition list that derived its own looseness never
  // reaches it and publishes nothing (markup-carve/carve-js#1409).
  node.loose = true
}

/** A `{table}`-marked csv/tsv code block outside the parser (a code include, I1c), converted as an authored fence is. */
export function markedDelimitedTable(code: CodeBlock): Table | null {
  if (code.attrs?.keyValues?.table !== '') return null
  const table = delimitedTable(code, code.attrs)
  if (table) deriveTableMetadata(table)
  return table
}

export function deriveTableMetadata(table: Table): void {
  const columns = tableColumnsFromAttrs(table.attrs, table.rows.reduce((width, row) => Math.max(width, row.cells.length), 0))
  if (columns) table.columns = columns
  const attrs = table.sourceFormat && table.attrs?.keyValues?.['header-rows'] === undefined &&
    ['footer-rows', 'body-rows', 'body-header-rows', 'body-header-cols'].some(key => table.attrs?.keyValues?.[key] !== undefined)
    ? { ...table.attrs, keyValues: { ...(table.attrs?.keyValues ?? {}), 'header-rows': String(table.rows.filter((row) => row.cells[0]?.header).length) } }
    : table.attrs
  const rowGroups = tableRowGroupsFromAttrs(attrs, table.rows.length)
  if (rowGroups) table.rowGroups = rowGroups
}

/**
 * If the lexer is positioned on a standalone block-attribute line
 * (`{...}`, possibly spanning multiple indented lines until the closing
 * `}`), consume it and return the parsed attributes. Otherwise consume
 * nothing and return null. A block whose content yields no recognized
 * attribute is not a block-attribute line — it falls through to normal
 * block parsing (literal text). Grammar PART 9 §15.
 */
/**
 * Non-consuming check: is the lexer positioned on a standalone block-attribute
 * line? Mirrors tryCollectBlockAttributes' recognition without consuming, so
 * startsInterruptingBlock can break an open paragraph on a trailing `{...}`
 * line (which then floats forward via parseBlocks).
 */
export function peekBlockAttributes(lexer: Lexer, firstLine?: string): boolean {
  return probeBlockAttributes(lexer, firstLine) !== null
}

export function tryCollectBlockAttributes(lexer: Lexer): Attrs | null {
  const result = probeBlockAttributes(lexer)
  if (!result) return null
  for (let k = 0; k < result.count; k++) lexer.consume()
  return result.attrs
}

export function probeBlockAttributes(lexer: Lexer, firstLine?: string): { attrs: Attrs; count: number } | null {
  // The override changes the opening-column test; continuation lines still
  // come from this lexer, as they did in the paragraph classifier.
  if (!/^[ \t]*\{/.test(firstLine ?? lexer.peek()!)) return null
  let collected = ''
  let count = 0
  for (;;) {
    const line = lexer.peek(count)
    if (line === undefined || (count > 0 && isBlankLine(line))) return null
    if (count > 0 && lexer.quoteLazyLines.has(lexer.lineNumber(lexer.pos + count))) return null
    const closed = line.includes('}')
    // A continuation is a complete attribute fragment: quoted values cannot
    // cross a newline. Reject a later opener before re-reading its whole tail.
    if (count > 0 && !closed && !isValidAttrPayload('\n' + line + '\n')) return null
    collected += (count === 0 ? '' : '\n') + line
    count++
    if (closed) {
      const attrs = parseBlockAttributeRun(collected)
      return attrs ? { attrs, count } : null
    }
  }
}

export function parseBlockAttributeRun(src: string): Attrs | null {
  let i = 0
  // The BELOW-column classifier passes a dedented first-line override while
  // collection still carries the original residual indent. Strip that one
  // leading run; separators between CLOSED brace blocks remain forbidden.
  while (i < src.length && isCarveWhitespace(src[i])) i++
  let count = 0
  // The first block's parsed Attrs is returned as-is for a single-block run so
  // that common path stays byte-identical to the pre-optimization fold (which
  // never called mergeAttrs for one block). For 2+ blocks the values below
  // accumulate into a single mutable builder in ONE pass, avoiding the
  // per-block `mergeAttrs` array recopy that was O(n^2) on runs like
  // `{.c}{.c}{.c}…`. The builder reproduces mergeAttrs' semantics exactly:
  // classes append (no dedup), id/keyValues last-wins, first-seen source order.
  let first: Attrs | null = null
  let id: string | undefined
  const classes: string[] = []
  let keyValues: Record<string, string> | undefined
  const order: string[] = []
  const orderSeen = new Set<string>()

  while (i < src.length) {
    // Multiple brace blocks are the adjacent extension pinned by corpus 114:
    // `{.c}{#i}`. A space between two CLOSED blocks is paragraph content, not
    // attr_separator (which separates attributes inside one `{...}` block).
    // Accepting it here consumed `{.c} {.d}` as a dangling attribute line and
    // made the minimal canonical form lose authored text (carve#1028).
    if (i >= src.length) break
    if (src[i] !== '{') return null

    const start = ++i
    let quote: '"' | "'" | null = null
    let closed = false
    for (; i < src.length; i++) {
      const ch = src[i]!
      if (quote) {
        if (ch === '\\') {
          i++
          continue
        }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '}') {
        closed = true
        break
      }
    }
    if (!closed) return null

    const inner = src.slice(start, i)
    // The ENTIRE payload must be valid attribute syntax (attributes +
    // whitespace, nothing else). A line like `{#todo#}` has leftover content
    // and stays literal. Empty `{}` is not a block-attribute line.
    if (!isValidAttrPayload(inner)) return null
    const attrs = parseAttrs(inner)
    if (isEmptyAttrs(attrs)) return null

    count++
    if (count === 1) first = attrs
    // Accumulate this block into the builder (mirrors mergeAttrs field rules).
    if (attrs.id !== undefined) id = attrs.id
    if (attrs.classes) for (const c of attrs.classes) classes.push(c)
    if (attrs.keyValues) {
      if (!keyValues) keyValues = {}
      for (const [k, v] of Object.entries(attrs.keyValues)) setOwn(keyValues, k, v)
    }
    if (attrs.order) {
      for (const slot of attrs.order) {
        if (!orderSeen.has(slot)) {
          orderSeen.add(slot)
          order.push(slot)
        }
      }
    }
    i++
    // Padding after the final block belongs to the line ending and is legal.
    // The same run before another `{...}` block is authored paragraph content,
    // so do not consume it as a separator between blocks.
    if (i < src.length && isCarveWhitespace(src[i])) {
      let end = i
      while (end < src.length && isCarveWhitespace(src[end])) end++
      if (end === src.length) {
        i = end
        break
      }
      return null
    }
  }

  if (count === 0) return null
  if (count === 1) return first
  // A glued run is one physical line: only a lone block may wrap (carve#4078).
  if (src.includes('\n')) return null
  const out: Attrs = {}
  if (id !== undefined) out.id = id
  if (classes.length) out.classes = classes
  if (keyValues) out.keyValues = keyValues
  if (order.length) out.order = order
  return out
}

/*
 * A CONTAINER ENDS AT ITS LAST PLACED CHILD (PART 12 §4, markup-carve/carve#1522
 * and markup-carve/carve#1524).
 */
// Parser-only ownership: a closed fenced quote keeps its closer even when
// its children are empty or hoisted (CARVE-P12-014, carve-js#2345).
export const explicitlyClosedQuotes = new WeakSet<object>()

export const ENDS_AT_LAST_PLACED_CHILD = new Set([
  'block_quote',
  'definition_list',
  'heading',
  'list',
  'list_item',
])

/*
 * The block types whose span may begin PART WAY INTO the leading indentation,
 * mirroring `INDENT_LATITUDE` in the spec's `scripts/spec/ast-positions.mjs`.
 *
 * The indent is what places a nested item's marker, so a CONTAINER's span
 * legitimately starts inside it - at its parent's content column. A LEAF has no
 * child to place, so PART 12 §4 reads literally there and its span begins at
 * its own markup (markup-carve/carve#1928, ruled for this engine as
 * markup-carve/carve-js#1631).
 *
 * A TYPE SET rather than "has children", for the reason the spec gives: an
 * EMPTY container is still a container, and a leaf that happens to hold inline
 * children is still reached by its own markup.
 */
export const INDENT_LATITUDE = new Set([
  'admonition',
  'block_quote',
  'definition_list',
  'directive',
  'div',
  'line_block',
  'list',
  'list_item',
  'table',
])

/*
 * What an EMPTIED container of each kind spans instead: the markup that opened
 * it, and the whitespace separating that markup from the content it never got.
 *
 * "Ends at its last placed child" is silent when there is none, and a container
 * can be emptied - a definition written as an item's only content is collected
 * out of it and the item keeps no trace. Zero width was rejected (a shape every
 * consumer special-cases, and it discards the marker the author typed) and so
 * was the extent the author typed, which is what the ruling above rejects for a
 * container that does have children.
 */
export const EMPTIED_CONTAINER_MARKUP: Record<string, RegExp> = {
  block_quote: /^[ \t]*>[ \t]*/,
  list: /^[ \t]*(?:[-+*]|[0-9]+[.)]|[A-Za-z]+[.)]|\.)[ \t]*/,
  list_item: /^[ \t]*(?:[-+*]|[0-9]+[.)]|[A-Za-z]+[.)]|\.)[ \t]*/,
}

export function attachBlockPos(
  lexer: Lexer,
  node: { pos?: Position },
  startLineIndex: number,
  endLineIndexExclusive: number,
): void {
  if (lexer.suppressPositions || lexer.parseOptions.positions === false) return
  const endLineIndex = Math.max(startLineIndex, endLineIndexExclusive - 1)
  // A LAZY-FRAMED end line carries three codepoints the source never held (the
  // #1630 frame that keeps a container-folded closer from closing an
  // unterminated fence). `lineOffset`/`lineStartColumn` already anchor to the
  // UNFRAMED content (attachDocumentOffsets discounts the frame from the line's
  // prefix), so the end must be measured from the unframed length too - counting
  // the frame here leaked its width into every span whose end fell on a framed
  // line, running a fence's end three columns past its last character and its
  // end offset past document length (carve-js#1963, mirroring carve-rs#1559).
  const rawEndLine = lexer.lineAt(endLineIndex) ?? ''
  const endLine = stripLazyFrame(rawEndLine)
  const opening = lexer.sourceBoundary(startLineIndex, 0)
  const ending = lexer.sourceBoundary(
    endLineIndex,
    rawEndLine !== endLine && (lexer.sourceBoundaries?.[endLineIndex] || lexer.contiguousOrigin)
      ? rawEndLine.length : endLine.length,
  )
  node.pos = {
    startLine: lexer.lineNumber(startLineIndex),
    endLine: lexer.lineNumber(endLineIndex),
    startColumn: opening.column,
    endColumn: ending.column,
    startOffset: opening.offset,
    endOffset: ending.offset,
  }
  const type = (node as { type?: string }).type
  if (type === 'code_block' || type === 'raw_block') {
    if (layoutWork.on) layoutWork.literalSpanDecisions++
    const content = (node as { content?: string }).content ?? ''
    const sourceLineNumber = lexer.lineNumber(endLineIndex)
    const root = lexer.documentRoot ?? lexer
    const sourceLine = (lexer.rootLines ?? root.lines)[sourceLineNumber - 1] ?? ''
    const nextLineOffset = sourceLineNumber < lexer.documentLineCount
      ? root.lineOffset(sourceLineNumber) : undefined
    if (
      isBlankLine(endLine) &&
      !/[ \t]$/.test(sourceLine) &&
      content.charCodeAt(content.length - 1) === 10 &&
      nextLineOffset !== undefined &&
      nextLineOffset > ending.offset
    ) {
      node.pos.endLine = sourceLineNumber + 1
      node.pos.endColumn = 1
      node.pos.endOffset = nextLineOffset
    }
  }
  // A LEAF BEGINS AT ITS MARKUP. The line offset above is the start of the
  // LINE, which for an indented leaf is the first space of a run that places
  // nothing - a `comment` at a description body's column started on the fourth
  // space rather than on its `%`. Containers keep the latitude and are excluded;
  // `paragraph` is in neither camp and is overwritten by its first inline below.
  // A definition list keeps the latitude in the spec checker, but its lead can
  // only be an indent a list-hosted entry match trimmed, so it opens on `::`.
  if (type !== undefined && (!INDENT_LATITUDE.has(type) || type === 'definition_list')) {
    const startLine = lexer.lineAt(startLineIndex) ?? ''
    const lead = leadingWhitespace(startLine)
    if (lead > 0) {
      const marker = lexer.sourceBoundary(startLineIndex, lead)
      node.pos.startOffset = marker.offset
      node.pos.startColumn = marker.column
    }
  }
  if (type === 'list' || type === 'list_item') {
    const startLine = lexer.lineAt(startLineIndex) ?? ''
    const lead = leadingWhitespace(startLine)
    const documentLine = (lexer.rootLines ?? lexer.lines)[node.pos.startLine - 1]
    const behindMarkup = documentLine !== undefined && /\S/.test(documentLine.slice(0, Math.max(0, opening.column - 1)))
    if (lead > 0 && (lexer.sublistsCarryAuthoredBase || behindMarkup || (lexer.sourceBoundaries?.[startLineIndex]?.synthetic ?? 0) > 0)) {
      const marker = lexer.sourceBoundary(startLineIndex, lead)
      node.pos.startColumn = marker.column
      node.pos.startOffset = marker.offset
    }
  }
  // A paragraph has no opening marker: its extent begins at its first owned
  // inline, not at indentation or a surrounding container's content column.
  if ((node as { type?: string }).type === 'paragraph') {
    const children = (node as { children?: Array<{ pos?: Position }> }).children
    const allPlaced = children?.every((child) => child.pos !== undefined) ?? false
    const first = allPlaced ? children?.[0]?.pos : undefined
    const last = allPlaced ? children?.[children.length - 1]?.pos : undefined
    if (first) {
      node.pos.startLine = first.startLine
      if (first.startColumn !== undefined) node.pos.startColumn = first.startColumn
      if (first.startOffset !== undefined) node.pos.startOffset = first.startOffset
    }
    if (last) {
      node.pos.endLine = last.endLine
      if (last.endColumn !== undefined) node.pos.endColumn = last.endColumn
      if (last.endOffset !== undefined) node.pos.endOffset = last.endOffset
    }
  }
  if (type !== undefined && ENDS_AT_LAST_PLACED_CHILD.has(type) && !explicitlyClosedQuotes.has(node)) {
    const kids =
      type === 'definition_list'
        ? entriesToWire((node as { items?: DefinitionItem[] }).items ?? [])
        : [
            ...((node as { children?: Array<{ pos?: Position }> }).children ?? []),
            ...((node as { items?: Array<{ pos?: Position }> }).items ?? []),
          ]
    const lastOwned = [...kids].reverse().find((child) => child.pos !== undefined)?.pos
    if (lastOwned) {
      node.pos.endLine = lastOwned.endLine
      if (lastOwned.endColumn !== undefined) node.pos.endColumn = lastOwned.endColumn
      if (lastOwned.endOffset !== undefined) node.pos.endOffset = lastOwned.endOffset
    } else if (EMPTIED_CONTAINER_MARKUP[type]) {
      const startLine = lexer.lineAt(startLineIndex) ?? ''
      const lead = leadingWhitespace(startLine)
      const marker = EMPTIED_CONTAINER_MARKUP[type]!.exec(startLine.slice(lead))?.[0]?.length ?? 0
      node.pos.endLine = node.pos.startLine
      const end = lexer.sourceBoundary(startLineIndex, lead + marker)
      node.pos.endColumn = end.column
      node.pos.endOffset = end.offset
    }
  }
  // A continuation marker below this admonition's authored column belongs to
  // its enclosing item. The colon-body scanner may consume that line while
  // looking for a closer, but it is not part of this node's source extent.
  if (type === 'admonition' && endLineIndexExclusive > startLineIndex + 1) {
    const lastIndex = endLineIndexExclusive - 1
    const lastLine = lexer.rootLines?.[lexer.lineNumber(lastIndex) - 1] ?? lexer.lineAt(lastIndex) ?? ''
    const plusColumn = lastLine.indexOf('+') + 1
    if (/^(?:[ \t]*>[ \t]*)*[ \t]*\+[ \t]*$/.test(lastLine) && plusColumn > 0 && plusColumn < node.pos.startColumn!) {
      const children = (node as { children?: Array<{ pos?: Position }> }).children ?? []
      const lastChild = [...children].reverse().find((child) => child.pos !== undefined)?.pos
      if (lastChild) {
        node.pos.endLine = lastChild.endLine
        if (lastChild.endColumn !== undefined) node.pos.endColumn = lastChild.endColumn
        if (lastChild.endOffset !== undefined) node.pos.endOffset = lastChild.endOffset
      } else {
        const end = lexer.sourceBoundary(startLineIndex, (lexer.lineAt(startLineIndex) ?? '').length)
        node.pos.endLine = node.pos.startLine
        node.pos.endColumn = end.column
        node.pos.endOffset = end.offset
      }
    }
  }
}

// Recognition is separate from interruption: a list marker recognized here
// can still fold into a paragraph under PART 9 §10 I2.
export function lineOpensBlock(line: string): boolean {
  const first = line.charCodeAt(0)
  switch (first) {
    case 96: case 126:
      return RE_RAW_FENCE.test(line) || RE_FENCE.test(line)
    case 37:
      return RE_COMMENT_BLOCK.test(line)
    case 91:
      return RE_FOOTNOTE_DEF.test(line) || isLinkDefLine(line)
    case 35:
      return RE_HEADING.test(line)
    case 58:
      return RE_DEFLIST_TERM.test(line) ||
        (RE_ADMONITION_OPEN.test(line) && !RE_ADMONITION_CLOSE.test(line)) ||
        RE_DIV_OPEN.test(line) || RE_LINE_BLOCK_OPEN.test(line) ||
        RE_HARDBREAKS_OPEN.test(line) || RE_QUOTE_BLOCK_OPEN.test(line)
    case 62:
      return RE_BLOCKQUOTE.test(line)
    case 124:
      return isTableRow(line)
    case 95:
      return RE_HR.test(line)
    case 45: case 42:
      return RE_HR.test(line) || isListMarkerLine(line)
    default:
      // List markers alone allow indentation and decimal/letter prefixes.
      if (first === 32 || first === 9 || first === 46 ||
          (first >= 48 && first <= 57) || (first >= 65 && first <= 90) ||
          (first >= 97 && first <= 122)) {
        return isListMarkerLine(line)
      }
      return false
  }
}

/**
 * A line whose only shape is a LIST MARKER - the four spellings an item opens
 * with. Kept apart from `lineOpensBlock`, which answers for every opener.
 */
export function isListMarkerLine(line: string): boolean {
  return (
    RE_TASK.test(line) ||
    RE_UNORDERED.test(line) ||
    RE_ORDERED.test(line) ||
    extractItemAttr(line) !== null
  )
}

/**
 * Track verbatim/paragraph state across a list item's collected inner lines so a
 * dedented non-blank line only lazily continues an OPEN paragraph (the
 * djot/CommonMark family-D rule, matching carve-php). Each line is passed in its
 * content-column-dedented form so the block-opener regexes key off column 0.
 *
 * Mirrors `trackBlockQuoteLazyState`, but a blockquote line (`>`) keeps the
 * fold open: the trailing quote paragraph absorbs the dedented line in the
 * quote's own lazy continuation. After a code fence or a table (no open
 * trailing paragraph) the dedented line must END the item instead.
 */

/**
 * A `{…}` line that is a block-attribute line rather than paragraph text.
 *
 * Recognition mirrors `tryCollectBlockAttributes` for the SINGLE-LINE form,
 * which is all this caller can see: it is handed one dedented item line at a
 * time, so a block whose `}` arrives on a later line (§15 A5) reads as ordinary
 * text here. That errs toward the old answer (the item stays open), never
 * toward closing an item the author kept open.
 */
export function isBlockAttributeLine(content: string): boolean {
  if (!content.startsWith('{') || !content.includes('}')) return false
  return parseBlockAttributeRun(content) !== null
}

// A row attribute block is a valid `{...}` attribute block GLUED to the row's
// closing `|` and running to end of line -- the row-level twin of a cell's
// opening-pipe attribute block. It sets the `<tr>` attributes. The whole
// payload must be valid attribute syntax (same gate as cell / inline / block
// attributes); otherwise the `{` is ordinary content and there is no row attr.
export function rowAttrsFromLine(line: string): { attrs?: Attrs; body: string } {
  const stripped = trimEndSpaceTab(line)
  const last = stripped.lastIndexOf('|{')
  if (last < 0 || stripped[stripped.length - 1] !== '}') return { body: line }
  // A quoted value may hold `|{`, so the block's own `|{` is the last one whose
  // tail reads as one block, not simply the last one in the line.
  const tailIsBlock = last === stripped.indexOf('|{') || !/['"]/.test(stripped.slice(last)) ? null : blockTailStarts(stripped)
  for (let pipe = last; pipe >= 0; pipe = pipe > 0 ? stripped.lastIndexOf('|{', pipe - 1) : -1) {
    if (tailIsBlock && !tailIsBlock[pipe + 2]) continue
    const payload = stripped.slice(pipe + 2, -1)
    if (payload === '' || (!tailIsBlock && RE_INLINE_ATTR.exec(stripped.slice(pipe + 1))?.[0].length !== stripped.length - pipe - 1)) break
    if (isValidInlineAttrPayload(payload)) {
      const attrs = parseAttrs(payload)
      if (!isEmptyAttrs(attrs)) return { attrs, body: stripped.slice(0, pipe + 1) }
      break
    }
    if (!tailIsBlock) break
  }
  return { body: line }
}

/**
 * For each index, whether an attribute payload read from there ends at the
 * line's final `}` with no bare `|`, which no attribute item holds. One
 * right-to-left pass, so a line of many `|{` stays linear.
 */
function blockTailStarts(line: string): Uint8Array {
  const n = line.length
  const reads = new Uint8Array(n + 1)
  // The closing quote for a string whose content is read from each index.
  const closes = { '"': new Int32Array(n + 2).fill(-1), "'": new Int32Array(n + 2).fill(-1) }
  for (let i = n - 1; i >= 0; i--) {
    const c = line[i]!
    for (const quote of ['"', "'"] as const) {
      const close = closes[quote]
      close[i] = c === quote ? i : c === '\\' ? close[i + 2]! : close[i + 1]!
    }
    if (c === '}') reads[i] = i === n - 1 ? 1 : 0
    else if (c === '|') reads[i] = 0
    else if (c === '"' || c === "'") {
      const close = closes[c][i + 1]!
      reads[i] = close < 0 ? 0 : reads[close + 1]!
    } else reads[i] = reads[i + 1]!
  }
  return reads
}

/**
 * Split a table row into cells, reporting where each one STARTS in the line.
 *
 * The start index is what lets a cell carry a real span (PART 12 section 4)
 * instead of none. Rows with escapes or verbatim spans need a character scan;
 * ordinary rows can slice cells directly from the source.
 */
export function splitTableRowSpans(
  line: string,
  carried?: readonly number[],
): Array<{ text: string; start: number }> {
  if (carried === undefined && !line.includes('\\') && !line.includes('`')) {
    const cells: Array<{ text: string; start: number }> = []
    const begin = line[0] === '|' || line[0] === '+' ? 1 : 0
    const bodyEnd = trimEndSpaceTab(line).length
    const scanEnd = bodyEnd > begin && line[bodyEnd - 1] === '|' ? bodyEnd - 1 : line.length
    let start = begin
    for (let pipe = line.indexOf('|', start); pipe !== -1 && pipe < scanEnd; pipe = line.indexOf('|', start)) {
      cells.push({ text: line.slice(start, pipe), start })
      start = pipe + 1
    }
    const last = line.slice(start, scanEnd)
    if (scanEnd < line.length || trimStructural(last) !== '') cells.push({ text: last, start })
    return cells
  }
  const cells: Array<{ text: string; start: number }> = []
  let buf = ''
  let cellIndex = 0
  let openRun = carried?.[0] ?? 0
  let i = 0
  // Skip the leading row marker: `|` (standard) or `+` (continuation)
  if (line[0] === '|' || line[0] === '+') i = 1
  let cellStart = i
  const bodyEnd = trimEndSpaceTab(line).length
  const scanEnd = bodyEnd > i && line[bodyEnd - 1] === '|' ? bodyEnd - 1 : line.length
  for (; i < scanEnd; i++) {
    const ch = line[i]!
    if (openRun === 0 && ch === '\\' && /[!-/:-@\[-`{-~]/.test(line[i + 1] ?? '')) {
      buf += line.slice(i, i + 2)
      i++
      continue
    }
    if (ch === '`') {
      // The MAXIMAL run, as the opener is: a run cannot cross `scanEnd`, whose
      // character is the row's closing `|`.
      let run = 1
      while (line[i + run] === '`') run++
      if (openRun === 0) openRun = run
      else if (run === openRun) openRun = 0
      // A run of any other length inside an open one is content, and so is the
      // opener and the closer themselves.
      buf += line.slice(i, i + run)
      i += run - 1
      continue
    }
    if (ch === '\\' && line[i + 1] === '|') {
      // Keep the escape. It stops the pipe SPLITTING the row - that is this
      // loop's job - but resolving it here too made a cell the one place in the
      // engine where an escape does not become an `escaped_text` node, and left
      // the cell's text shorter than its source so no position could be
      // anchored to it (#462).
      buf += '\\|'
      i++
      continue
    }
    if (ch === '|' && openRun === 0) {
      cells.push({ text: buf, start: cellStart })
      buf = ''
      cellStart = i + 1
      cellIndex++
      openRun = carried?.[cellIndex] ?? 0
      continue
    }
    buf += ch
  }
  // The last cell. When the closing `|` was removed above, this cell is real
  // however empty it looks - `|||` is two empty cells. Otherwise there was no
  // closing pipe to end it, so a padding-only tail is line padding, not a cell.
  if (scanEnd < line.length || trimStructural(buf) !== '')
    cells.push({ text: buf, start: cellStart })
  return cells
}

export function splitTableRow(line: string): string[] {
  return splitTableRowSpans(line).map((cell) => cell.text)
}

export function leadingWhitespace(line: string): number {
  let n = 0
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++
  return n
}
