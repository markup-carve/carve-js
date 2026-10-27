/*
 * Escaping the Carve inline constructs that are LITERAL TEXT in a source
 * language being migrated from.
 *
 * Shared by the migration converters, mirroring carve-php's
 * `EscapesCarveConstructs` trait. It lives in one place because the rule is not
 * "escape Carve syntax" but "escape what is literal text in THIS language" -
 * and a delimiter the caller's own language owns must NOT be escaped here, or
 * it is frozen as text before that caller ever rewrites it.
 */

import { isCarveWhitespace } from './trim-non-nbsp.js'

/**
 * The braced-pair delimiters that may be literal text in a source language.
 *
 * `{X…X}` is a Carve construct for each of these: superscript, subscript,
 * highlight, insert, delete, strike, emphasis, strong, underline and an
 * editorial comment. The list is deliberately longer than the obvious cases -
 * a delimiter missing from it renders as markup.
 *
 * `@` and `"` are absent because `{@x@}` and `{"x"}` reinterpret through
 * mentions and smart typography, which apply to any Carve source rather than
 * being introduced here.
 */
const BRACED_DELIMITER_CHARS = '^,=+-~/#*_%'

/** The delimiters as a regex character class. Derived, so the list lives once. */
function bracedClass(handled: string): string {
  return [...BRACED_DELIMITER_CHARS]
    .filter((c) => !handled.includes(c))
    .map((c) => c.replace(/[\\^\-/\]]/, (m) => `\\${m}`))
    .join('')
}

/**
 * Is the character at that offset already escaped?
 *
 * An ODD run of backslashes before it escapes it; an even run is literal
 * backslashes and the character still counts.
 *
 * Counted rather than tested with a lookbehind, because "an odd number of
 * backslashes" is not something a fixed-width lookbehind can ask. That matters
 * once a source language without backslash escapes has had its backslashes
 * doubled by `escapeLiteralBackslashes`: in `\\{^x^}` the brace is real and the
 * two backslashes are one literal one, which a single-character lookbehind read
 * as an escaped brace.
 */
function isEscapedAt(subject: string, offset: number): boolean {
  let backslashes = 0
  for (let i = offset - 1; i >= 0 && subject[i] === '\\'; i--) {
    backslashes++
  }

  return backslashes % 2 === 1
}

/**
 * Insert a backslash at each of those offsets, which are measured against the
 * ORIGINAL string and must arrive in ascending order.
 *
 * Built in one forward pass rather than by splicing each insertion into a
 * growing string. Splicing copies the whole string per insertion, which is
 * quadratic in the number of escapes rather than in the input length.
 */
function insertEscapes(subject: string, offsets: readonly number[]): string {
  if (offsets.length === 0) {
    return subject
  }

  let out = ''
  let cursor = 0
  for (const offset of offsets) {
    out += `${subject.slice(cursor, offset)}\\`
    cursor = offset
  }

  return out + subject.slice(cursor)
}

/**
 * Escape each bare delimiter that could open a pair and has a closer after it.
 *
 * The parser skips a delimiter that can neither open nor close and pairs the
 * opener with a later closer, so a pair may hold its own delimiter: `/usr/local/`
 * is one emphasis and `=a=b=` one highlight, and a closer may sit before
 * another delimiter, as in `=a==`. A pattern whose body stops at the first
 * delimiter saw neither.
 *
 * One backward pass finds the nearest closer after each offset, so a line of
 * openers with no closer costs its length once.
 *
 * `_` before an opener is not treated as a word character the way the parser
 * treats it: a caller may still rewrite that `_` into another delimiter.
 *
 * @param behindBrace Whether an opener behind an unescaped `{` is escaped too.
 */
function escapeBareOpeners(subject: string, delimiter: string, behindBrace: boolean): string {
  if (!subject.includes(delimiter)) return subject
  const alnum = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9]/.test(c)
  const offsets: number[] = []
  let closer = -1
  let lineIsBlank = false
  for (let i = subject.length - 1; i >= 0; i--) {
    const c = subject[i]!
    if (c === '\n') {
      // A pair never spans a blank line.
      if (lineIsBlank) closer = -1
      lineIsBlank = true
      continue
    }
    if (c !== ' ' && c !== '\t' && c !== '\r') lineIsBlank = false
    if (c !== delimiter || isEscapedAt(subject, i)) continue
    const before = subject[i - 1], after = subject[i + 1]
    if (
      before !== delimiter && !alnum(before) && after !== delimiter && after !== undefined && !isCarveWhitespace(after)
      && closer > i + 1 && (behindBrace || before !== '{' || isEscapedAt(subject, i - 1))
    ) offsets.push(i)
    if (before !== undefined && !isCarveWhitespace(before) && !alnum(after)) closer = i
  }

  return insertEscapes(subject, offsets.reverse())
}

/**
 * Escape every match of the pattern that is not escaped ALREADY.
 *
 * Escaping an escaped delimiter a second time is worse than leaving it: the
 * doubled backslash renders as a literal backslash and frees the delimiter to
 * open the construct the first escape was suppressing, so the output gains a
 * character the author never wrote AND the markup they escaped away.
 *
 * Matched with offsets rather than replaced in place, so the parity question
 * `isEscapedAt` asks can be asked at all.
 *
 * The pattern must carry the `g` flag.
 */
function escapeUnlessAlreadyEscaped(pattern: RegExp, subject: string): string {
  const offsets: number[] = []

  for (const match of subject.matchAll(pattern)) {
    if (!isEscapedAt(subject, match.index)) {
      offsets.push(match.index)
    }
  }

  return insertEscapes(subject, offsets)
}

/**
 * Double every backslash, for a source language that has no backslash escape of
 * its own.
 *
 * HTML and BBCode do not: a backslash in their text is a character the author
 * typed, so it has to survive into Carve, where a backslash IS an escape. Left
 * alone it is read as one and eats the character after it - `a \ b` rendered as
 * `a &nbsp;b`, the backslash gone and a non-breaking space where it stood.
 *
 * Runs FIRST, before any delimiter escaping, which is also what keeps the
 * already-escaped guard honest: after doubling, every backslash run coming from
 * source text is EVEN, so a delimiter behind one is correctly seen as unescaped
 * and still gets its own escape.
 *
 * Djot and Markdown do not call this. A backslash there is an escape the author
 * wrote, and doubling it would render the backslash they meant to disappear.
 */
export function escapeLiteralBackslashes(text: string): string {
  return text.replace(/\\/g, '\\\\')
}

/**
 * Escape a brace that opens what Carve would read as an ATTRIBUTE BLOCK, for a
 * source language that has no such construct.
 *
 * `{#id}` is an attribute block in Carve and in Djot, so a Djot converter must
 * leave it alone - a pinned id is deliberate there. In HTML, BBCode and MARKDOWN
 * text the same characters are literal, and left bare the `#` rule below
 * declines to escape them (it defers to the brace rule, which only matches a
 * complete pair), so `a {#id} b` came back with a tag span inside literal
 * braces.
 *
 * Djot is the one source language here that means an attribute by it. The split
 * is per LANGUAGE, not per character, which is why the escape lives at the call
 * site: the Markdown converter calls this and `djotToCarve` does not.
 *
 * Call it BEFORE `escapePlainCarveInlineSyntax`, not after. That function's tag
 * rule declines a `#` behind an unescaped `{`, so the brace has to be escaped
 * first for the `#` to be escaped at all; the reverse order yields `\{` in front
 * of a live tag span, which is the defect this helper exists to prevent.
 */
export function escapeAttributeBlockOpener(text: string): string {
  return escapeUnlessAlreadyEscaped(/\{(?=#)/g, text)
}

/**
 * Escape the verbatim delimiter, for a source language that has no code span of
 * its own to convert.
 *
 * A backtick in HTML or BBCode text is a character. Carried across bare it
 * opens a Carve code span, so plain text turned into markup: `a ``b`` c` came
 * back as a code span. A lone backtick is worse - it has no pair at all and
 * still produced one.
 *
 * Only the TEXT path calls this. A code or pre element takes its own route and
 * emits its own fence, and BBCode's code tags are stashed before any escaping
 * runs, so neither is reached from here.
 *
 * MARKDOWN CALLS IT TOO, on a distinction the earlier premise here missed. That
 * premise - a backtick in Markdown already means a code span its converter
 * carries over as one - holds for a MATCHED backtick and fails for an unmatched
 * one, which CommonMark and GFM read as ordinary text. The two are told apart by
 * position rather than by character, so no per-character handled set can express
 * it; what expresses it is the Markdown converter's own code-span protection,
 * which turns every matched run into a placeholder before it calls this. A
 * backtick still standing in the text by then is one CommonMark read as literal,
 * and escaping it cannot reach a real code span.
 *
 * Leaving it bare was unbounded, not cosmetic: an opener with no equal-length
 * closer ahead does not fall back to text in Carve, it opens a verbatim span
 * that runs to the END of the block (see `resources/grammar.ebnf`, UNCLOSED RUN).
 *
 * `djotToCarve` does not call it because a backtick is Djot's own verbatim
 * delimiter; its masking pass protects matched spans and leaves unmatched
 * source text unchanged, as Djot does.
 */
export function escapeVerbatimDelimiter(text: string): string {
  return escapeUnlessAlreadyEscaped(/`/g, text)
}

/** Delimiters whose constructs the CALLER's source language owns and rewrites. */
export interface HandledDelimiters {
  /** Braced forms, e.g. `*_` when the caller rewrites `{*x*}` and `{_x_}`. */
  braced?: string
  /** Bare forms, e.g. `*_` when the caller rewrites `*x*` and `_x_`. */
  bare?: string
}

/**
 * A language that owns none of these delimiters, so every one of them in its
 * text is the author's own character: HTML and BBCode.
 *
 * Named rather than spelled as `{}` at the call site so the shared escaper
 * corpus can be held against the set a converter ACTUALLY passes. The corpus
 * measures the escaper under named profiles, and a profile whose set is only
 * restated in a test file proves nothing about the converter - the call site
 * could drift out from under it and every case would still pass.
 */
export const HANDLED_PLAIN: HandledDelimiters = {}

/**
 * Markdown: `*` and `_` are its emphasis delimiters bare and braced alike, and
 * `~` is GFM strikethrough. The Markdown converter rewrites all three into
 * Carve, so freezing them here would freeze the markup instead of the text.
 */
export const HANDLED_MARKDOWN: HandledDelimiters = { braced: '*_', bare: '*_~' }

/**
 * Djot. `djotToCarve` passes this set while escaping source text outside code
 * and destinations. Constructs owned by Djot remain available to its delimiter
 * conversion pass; Carve-only constructs are frozen as literal text.
 */
export const HANDLED_DJOT: HandledDelimiters = { braced: '=+-*_^~%', bare: '~*_' }

/**
 * Escape the Carve inline constructs that are literal text in the source.
 *
 * Escaping the first delimiter is enough to keep the run literal. Doing nothing
 * let `a {,y,} b` render as a subscript and `a %%c%% b` lose its text outright,
 * since `%%` opens a comment.
 */
export function escapePlainCarveInlineSyntax(
  line: string,
  handled: HandledDelimiters = {},
): string {
  const bareHandled = handled.bare ?? ''

  // The one bare rule that does NOT go through `escapeUnlessAlreadyEscaped`,
  // and the one that does not need to: it matches on the character BEFORE the
  // `%%`, which it requires to be a space, a tab or the start of the line. A
  // backslash there fails the match outright, so an escaped `\%%` is never
  // reached and cannot be escaped twice. The offset the helper would insert at
  // is the captured character's, not the delimiter's, so it does not fit here
  // either.
  //
  // A LONGER RUN IS STILL AN OPENER, on its first two signs: a third does not
  // close or cancel anything, so `a %%%c b` left bare loses the rest of the
  // line (carve-js#2690). One escape on the first sign is the whole of what the
  // run owes, because after `\%` the rest sits inside a word.
  //
  // THE START OF THE LINE, not of the string: callers hand this function a
  // whole paragraph, and a run opening the SECOND line of one was left bare
  // because an unanchored `^` never reached it. A lazy continuation and a
  // folded Djot heading both put a run there, and both lost the line.
  let out = line.replace(/(^|[ \t])%%/gm, '$1\\%%')

  // Braced forms first, so the bare rules below see an escaped `{` and leave
  // the delimiter inside it alone instead of escaping it twice.
  const bracedDelimiters = bracedClass(handled.braced ?? '')
  if (bracedDelimiters !== '') {
    out = escapeBracedPairs(out, bracedDelimiters)

    // A brace that LOOKS like a pair opener but never closes is escaped too.
    // The bare rules below decline to escape a delimiter sitting behind an
    // unescaped `{`, on the assumption that the rule above already handled the
    // pair - and when there is no pair, nothing did.
    //
    // Leaving it bare costs more than the missing pair, because the escaper is
    // LINE-oriented and a braced run is not: `a {^x` on one line and `y^} b` on
    // the next is one superscript spanning the soft break, so two lines of
    // literal text became markup. Escaping the opener costs nothing when
    // nothing closes the run, since `a \{^x b` and `a {^x b` render alike.
    //
    // `#` is excluded: `{#id}` is an ATTRIBUTE BLOCK, not a pair opener, and
    // escaping its brace destroys an id a Djot source pinned deliberately. A
    // source language that means literal text by it says so by calling
    // `escapeAttributeBlockOpener`.
    const unpairedOpeners = bracedDelimiters.replace(/#/g, '')
    if (unpairedOpeners !== '') {
      out = escapeUnlessAlreadyEscaped(new RegExp(`\\{(?=[${unpairedOpeners}])`, 'g'), out)
    }
  }

  // These run INSIDE an already-escaped brace, unlike the php port for `/`:
  // `=`, `~` and `/` are bare constructs in their own right here, so `\{=x=}`
  // still renders `{<mark>x</mark>}` — the literal brace does not suppress the
  // run. Escaping the inner delimiter as well is what makes the whole thing
  // literal.
  //
  // That reasoning holds only when the brace WAS escaped, which is why every
  // delimiter but `/` is left alone behind an unescaped `{`. A brace left bare
  // here is one the caller declared handled: `{=x=}` is a highlight in Djot as
  // well as in Carve, so a Djot converter passes `=` as braced and the run has
  // to survive untouched.
  //
  // The same-delimiter test is load-bearing for `/`: without it the SECOND
  // slash of `ftp://x/` was escaped, which freed the first one to open
  // emphasis - `ftp:/\/x/` rendering as `ftp:<em>/x</em>`.
  //
  // `a*b*c`, `feature_flag_company` and `5 * 4 * 3` open nothing in the parser,
  // so none of them gains a backslash.
  for (const delimiter of '/=~*_') {
    if (!bareHandled.includes(delimiter)) out = escapeBareOpeners(out, delimiter, delimiter === '/')
  }

  if (!bareHandled.includes('#')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9])(?<!(?<!\\)\{)#(?=[A-Za-z0-9-])/g, out)
  }

  if (!bareHandled.includes('@')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9_])@(?=[A-Za-z0-9_-])/g, out)
  }

  if (!bareHandled.includes(':')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9_]):(?=[A-Za-z0-9+-][\w+-]*:)/g, out)
  }

  return out
}

const PRIVATE_USE_FIRST = 0xe000
const PRIVATE_USE_LAST = 0xf8ff

/**
 * Escape plain text that surrounds opaque runs such as code spans and
 * destinations, one paragraph at a time.
 *
 * A pair rule needs its opener and its closer in the same call. Escaping the
 * text between opaque runs piece by piece hid one from the other, so a pair
 * across a space or a code span stayed bare and rendered as markup. Each
 * opaque character is swapped for a stand-in no rule matches, the paragraph
 * is escaped whole, and the original characters are put back in order.
 */
export function escapePlainCarveInlineSyntaxAround(
  source: string,
  opaque: (offset: number) => boolean,
  handled: HandledDelimiters = {},
): string {
  // Private-use characters are neither blank nor alphanumeric to any rule.
  const used = new Set<number>()
  for (let i = 0; i < source.length; i++) {
    const unit = source.charCodeAt(i)
    if (unit >= PRIVATE_USE_FIRST && unit <= PRIVATE_USE_LAST) used.add(unit)
  }
  let code = PRIVATE_USE_FIRST
  while (used.has(code)) code++
  const standIn = code <= PRIVATE_USE_LAST ? String.fromCharCode(code) : null
  const hidden: string[] = []
  let text = ''
  let pieces = ''
  let from = 0
  for (let i = 0; i < source.length; i++) {
    if (!opaque(i)) text += source[i]
    else if (standIn !== null) {
      hidden.push(source[i]!)
      text += standIn
    } else {
      // No stand-in is free, so each run between opaque characters stands alone.
      pieces += escapePlainCarveInlineSyntax(source.slice(from, i), handled) + source[i]
      from = i + 1
    }
  }
  if (standIn === null) return pieces + escapePlainCarveInlineSyntax(source.slice(from), handled)
  // A pair never spans a blank line, so no rule may pair across one either.
  const escaped = text.split(/(\n(?:[ \t]*\n)+)/)
    .map((part, index) => index % 2 === 1 ? part : escapePlainCarveInlineSyntax(part, handled))
    .join('')
  if (hidden.length === 0) return escaped
  let next = 0
  return escaped.replaceAll(standIn, () => hidden[next++]!)
}

/**
 * Escape the opening brace of every braced pair that is not escaped already.
 *
 * A pair is `{X`, content that starts with a non-blank, and `X}` behind a
 * non-blank, all on one line. Pairs nest and overlap, so every opener with a
 * closer after it is escaped, not only the outermost.
 *
 * One backward pass keeps the last closer of each delimiter on the current
 * line. Searching forward from each opener reread the line once per opener.
 *
 * @param delimiters The delimiter characters, as a regex character class body.
 */
function escapeBracedPairs(line: string, delimiters: string): string {
  if (!line.includes('}')) return line
  const isDelimiter = new RegExp(`[${delimiters}]`)
  const blank = (c: string | undefined): boolean => c === undefined || /\s/.test(c)
  const closers = new Map<string, number>()
  const offsets: number[] = []
  for (let i = line.length - 1; i >= 0; i--) {
    const c = line[i]!
    if (c === '\n') closers.clear()
    else if (c === '}' && i >= 2 && isDelimiter.test(line[i - 1]!) && !blank(line[i - 2])) {
      if (!closers.has(line[i - 1]!)) closers.set(line[i - 1]!, i - 1)
    } else if (c === '{' && (closers.get(line[i + 1] ?? '') ?? -1) >= i + 3 && !blank(line[i + 2]) && !isEscapedAt(line, i)) {
      offsets.push(i)
    }
  }

  return insertEscapes(line, offsets.reverse())
}

/** Find the first editorial opener whose non-overlapping closer is absent. */
export function unclosedImageEditorialOpener(text: string): number {
  let from = 0
  while (from < text.length) {
    const open = text.indexOf('{#', from)
    if (open < 0) return -1
    const close = text.indexOf('#}', open + 2)
    if (close < 0) return open
    from = close + 2
  }
  return -1
}

/** Keep an unclosed editorial opener in image alt from consuming a later title. */
export function escapeUnclosedImageEditorialOpeners(text: string): string {
  const open = unclosedImageEditorialOpener(text)
  if (open < 0) return text
  return text.slice(0, open) + text.slice(open).replace(/\{(?=#)/g, '\\{')
}
