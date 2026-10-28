/**
 * Recognition of processor-level `{{ ... }}` include directives (spec I1).
 *
 * Kept separate from {@link ./includes.js} so consumers that only need to
 * RECOGNIZE a directive -- notably the Carve serializer, which must emit one
 * verbatim rather than escape it -- do not pull in the expander's file-system
 * imports.
 */

import { unescapeAttrValue } from './extension/attribute-parser.js'
import type { Attrs } from './ast.js'

export interface Directive {
  raw: string
  path: string
  section?: string
  lines?: { start: number; end: number }
  invalidLines?: true
  rows?: { start: number; end: number }
  invalidRows?: true
  cols?: string[] | { start: number; end: number }
  invalidCols?: true
  repeatedTableOption?: true
  tableAttrs?: Attrs
  region?: string
  code?: { lang?: string }
  /** Literal signed offset, or "auto" to derive it from the include site. */
  shift: number | 'auto'
}

/**
 * A quoted run: its opening quote through the first unescaped matching one.
 * PART 4's `quoted_value` has both spellings, and each excludes only its own
 * quote, the backslash and the newline -- so a `}}` between the quotes belongs
 * to the run rather than closing the directive (spec I1, carve#2000).
 */
const DQUOTED_RUN = String.raw`"(?:\\.|[^"\\\n])*?"`
const SQUOTED_RUN = String.raw`'(?:\\.|[^'\\\n])*?'`

/**
 * The option slot up to the closer, stepping OVER whole quoted runs.
 *
 * The two lookaheads are the exact negation of the runs beside them, so at any
 * position either a run starts -- and only a run alternative is viable -- or
 * none does, and only the single-character one is. No position is reachable
 * two ways, so the lazy scan never backtracks across the alternation. Matching
 * a run to its closing quote and only then hunting for the closer is the shape
 * that does (carve-grammars#413); this one measures flat per byte.
 */
const QUOTE_AWARE_OPTIONS = String.raw`(?:${DQUOTED_RUN}|${SQUOTED_RUN}|(?!${DQUOTED_RUN})(?!${SQUOTED_RUN})[^\n])*?`

const OPEN = String.raw`\{\{ +`
const PATH = String.raw`(?:"((?:\\.|[^"\\])*)"|\u201c([^\u201d]*)\u201d|([^#@} "\u201c\n]+))`
// `explicit_identifier`: an id may open on a digit (`#2024-plan`). The path
// stops at `#`, so the name needs no whitespace in front of it (carve#2773).
const SECTION = String.raw`((?: *#\w[\w-]*)?)`
const CLOSE = String.raw` +\}\}`
const body = (options: string): string => `${OPEN}${PATH}${SECTION}(${options})${CLOSE}`

const QUOTE_AWARE_BODY = body(QUOTE_AWARE_OPTIONS)
/**
 * The fallback reading, tried only where the quote-aware one finds no closer
 * at all: an UNTERMINATED quote opens no run, so it must not pair with a quote
 * that lies PAST the closer and leave the whole token unrecognized. Section 19
 * forbids exactly one outcome -- literal text with no diagnostic -- and that
 * is what dropping this branch would produce for `{{ a @k:"x }} said "hi"`.
 */
const FIRST_PAIR_BODY = body(String.raw`.*?`)

export const DIRECTIVE_SCAN_RE = new RegExp(`(?:${QUOTE_AWARE_BODY})|(?:${FIRST_PAIR_BODY})`, 'g')
const DIRECTIVE_FULL_RE = new RegExp(`^(?:${QUOTE_AWARE_BODY})$`)
const OPTION_RE = /^@([A-Za-z_][\w-]*):([^@}\s]+)$/
const SECTION_TOKEN_RE = /^#\w[\w-]*$/
/** Loose directive shape: one whole-paragraph token, valid options or not. */
export const DIRECTIVE_SHAPE_RE = /^\{\{[^{}]*\}\}$/

// A quoted path decodes the escape set a quoted attribute value takes (carve#2778).
function unescapeQuotedPath(path: string): string {
  return unescapeAttrValue(path)
}

function trimSpaces(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === ' ') start++
  while (end > start && value[end - 1] === ' ') end--
  return value.slice(start, end)
}

function optionParts(rest: string): string[] {
  const parts: string[] = []
  let start = 0
  let quote = ''
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]!
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === ' ' || (char === '@' && i > start)) {
      if (i > start) parts.push(rest.slice(start, i))
      start = char === ' ' ? i + 1 : i
    }
  }
  if (start < rest.length) parts.push(rest.slice(start))
  return parts
}

function range(value: string): { start: number; end: number } | undefined {
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(value)
  if (!match) return undefined
  const start = Number(match[1]); const end = Number(match[2])
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end ? { start, end } : undefined
}

function columnNames(value: string): string[] | undefined {
  const quote = value[0]
  if (quote !== '"' || value.at(-1) !== quote) return undefined
  const names: string[] = []
  let current = ''
  for (let i = 1; i < value.length - 1; i++) {
    const char = value[i]!
    if (char === '\\') {
      if (i + 1 >= value.length - 1) return undefined
      current += value[++i]
    } else if (char === quote) return undefined
    else if (char === ',') { names.push(current); current = '' }
    else current += char
  }
  names.push(current)
  return names.every(name => name !== '') ? names : undefined
}

/**
 * Parse one candidate directive token. Returns null when the token is not a
 * well-formed directive per spec I1 -- a bad shape, or an unrecognized or
 * malformed option -- in which case it stays ordinary text.
 */
export function parseDirective(
  raw: string,
  onInvalidOption?: (part: string) => void,
  onSecondSection?: (part: string) => void,
  onRepeatedOption?: (part: string) => void,
): Directive | null {
  const m = DIRECTIVE_FULL_RE.exec(raw)
  if (!m) return null
  const path = m[1] !== undefined ? unescapeQuotedPath(m[1]) : m[2] ?? m[3]!
  if (path === '') return null
  const sectionPart = trimSpaces(m[4] ?? '')
  const section = sectionPart ? sectionPart.slice(1) : undefined
  let lines: Directive['lines']
  let invalidLines = false
  let rows: Directive['rows']
  let invalidRows = false
  let cols: Directive['cols']
  let invalidCols = false
  let repeatedTableOption = false
  let region: string | undefined
  let code: Directive['code']
  let shift: number | 'auto' = 0
  const seen = new Set<string>()
  // Spec I1: a key given twice is an error, never "last one wins".
  const first = (key: string, part: string): boolean => {
    if (!seen.has(key)) {
      seen.add(key)
      return true
    }
    onRepeatedOption?.(part)
    return false
  }
  const rest = trimSpaces(m[5] ?? '')
  if (rest) {
    // An option needs no whitespace before its `@` either (carve#2773).
    for (const part of optionParts(rest)) {
      // `include_section` is one slot: a second name is malformed, not ignored.
      if (section !== undefined && SECTION_TOKEN_RE.test(part)) {
        onSecondSection?.(part)
        return null
      }
      if (part === '@code') {
        if (!first('code', part)) return null
        code = {}
        continue
      }
      const opt = OPTION_RE.exec(part) ?? (/^@cols:(["'])(.*)\1$/.test(part) ? ['','cols',part.slice(6)] : null)
      const invalid = (): null => {
        // Spec I1: an unrecognized (or malformed) option makes the directive
        // unresolvable - Warning + literal, never silent.
        if (part.startsWith('@')) onInvalidOption?.(part)
        return null
      }
      if (part === '@lines:') {
        if (!first('lines', part)) return null
        invalidLines = true
        continue
      }
      if (part === '@rows:' || part === '@cols:' || part === '@rows' || part === '@cols') {
        const key = part.startsWith('@rows') ? 'rows' : 'cols'
        if (!first(key, part)) { repeatedTableOption = true; continue }
        if (key === 'rows') invalidRows = true
        else invalidCols = true
        continue
      }
      if (!opt) return invalid()
      const [, key, value] = opt
      if (key === 'lines') {
        if (!first(key, part)) return null
        lines = range(value!)
        if (!lines) invalidLines = true
      } else if (key === 'rows') {
        if (!first(key, part)) { repeatedTableOption = true; continue }
        rows = range(value!)
        if (!rows) invalidRows = true
      } else if (key === 'cols') {
        if (!first(key, part)) { repeatedTableOption = true; continue }
        cols = range(value!) ?? columnNames(value!)
        if (!cols) invalidCols = true
      } else if (key === 'region') {
        if (!/^[A-Za-z_][\w-]*$/.test(value!)) return invalid()
        if (!first(key, part)) return null
        region = value
      } else if (key === 'code') {
        if (!/^[A-Za-z0-9_+#./-]+$/.test(value!)) return invalid()
        if (!first(key, part)) return null
        code = { lang: value! }
      } else if (key === 'shift') {
        // Spec I8: a signed integer or the literal "auto", never both forms.
        if (value !== 'auto' && !/^[+-]?\d+$/.test(value!)) return invalid()
        if (!first(key, part)) return null
        shift = value === 'auto' ? 'auto' : Number(value)
      } else {
        return invalid()
      }
    }
  }
  const directive: Directive = { raw, path, shift }
  if (section !== undefined) directive.section = section
  if (lines !== undefined) directive.lines = lines
  if (invalidLines) directive.invalidLines = true
  if (rows) directive.rows = rows
  if (invalidRows) directive.invalidRows = true
  if (cols) directive.cols = cols
  if (invalidCols) directive.invalidCols = true
  if (repeatedTableOption) directive.repeatedTableOption = true
  if (region !== undefined) directive.region = region
  if (code !== undefined) directive.code = code
  return directive
}

/**
 * True when a candidate token has the SHAPE of a directive: it opens with
 * "{{", closes with "}}", and carries a non-empty path token. Section and
 * option validity are deliberately NOT considered -- those are expansion-time
 * diagnostics, not recognition criteria.
 */
export function isDirectiveShape(raw: string): boolean {
  const m = DIRECTIVE_FULL_RE.exec(raw)
  if (!m) return false
  const path = m[1] !== undefined ? unescapeQuotedPath(m[1]) : m[2] ?? m[3]!
  return path !== ''
}

/**
 * Which piece of a reassembled run holds a given character. Built once per
 * run so a lookup is a binary search, not a walk from the run's start: a run
 * with many `{{` candidates asks once per candidate.
 */
export class RunOffsets {
  private readonly ends: number[] = []

  constructor(texts: readonly string[]) {
    let end = 0
    for (const text of texts) {
      end += text.length
      this.ends.push(end)
    }
  }

  /** The first piece ending after `index`; the piece count when none does. */
  pieceAt(index: number): number {
    let lo = 0
    let hi = this.ends.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ends[mid]! <= index) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  startOf(piece: number): number {
    return piece === 0 ? 0 : this.ends[piece - 1]!
  }
}

/**
 * Locate the SHAPE-well-formed directive spans inside a reassembled inline
 * run, in source order.
 *
 * The bar is deliberately lower than {@link parseDirective}: the serializer
 * uses this to decide what to emit verbatim, and escaping a directive that is
 * merely mis-OPTIONED ("{{ a.crv @bogus:1 }}") would turn a fixable typo into
 * permanent literal text -- destroying the very warning that explains it. A
 * run that is not shape-well-formed ("{{ oops", "{{ }}") is not reported and
 * keeps being treated as ordinary text.
 */
export function findDirectives(
  text: string,
  escapedAt: (index: number) => boolean = () => false,
): { start: number; end: number; raw: string }[] {
  const re = new RegExp(DIRECTIVE_SCAN_RE.source, 'g')
  const spans: { start: number; end: number; raw: string }[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0]
    // An escaped brace is literal, so a match opening or closing on one is
    // no directive; rescan from the next character for one that follows.
    if (escapedAt(m.index) || escapedAt(m.index + raw.length - 1)) {
      re.lastIndex = m.index + 1
      continue
    }
    if (!isDirectiveShape(raw)) continue
    spans.push({ start: m.index, end: m.index + raw.length, raw })
  }
  return spans
}
