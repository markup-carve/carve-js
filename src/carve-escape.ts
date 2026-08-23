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
const BRACED_DELIMITER_CHARS = '^,=+-~/#*_'

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
 * quadratic in the NUMBER of escapes rather than in the input length: a line of
 * 32000 braced pairs - 192KB, well inside the BBCode converter's own input
 * bound - took 5.5 seconds that way and 8 milliseconds this way.
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
export const HANDLED_DJOT: HandledDelimiters = { braced: '=+-*_^~', bare: '~*_' }

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
  let out = line.replace(/(^|[ \t])%%(?!%)/g, '$1\\%%')

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
  // That reasoning holds only when the brace WAS escaped, which is why `=` and
  // `~` carry the same `(?<!(?<!\\)\{)` guard as `*` and `_` below. A brace
  // left bare here is one the caller declared handled: `{=x=}` is a highlight
  // in Djot as well as in Carve, so a Djot converter passes `=` as braced and
  // the run has to survive untouched. Escaping the inner `=` there lands on
  // markup that was meant to live, and `{=x=}` came back as literal text
  // instead of a mark.
  //
  // The `/` in the slash rule's lookbehind is load-bearing, not symmetry:
  // without it the SECOND slash of `ftp://x/` matched, and escaping it freed the
  // first one to open emphasis — `ftp:/\/x/` rendering as `ftp:<em>/x</em>`.
  // Only http and https URLs are protected above, so every other scheme reaches
  // this rule.
  if (!bareHandled.includes('/')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9/])\/(?!\s)([^/]+?)(?<!\s)\/(?![A-Za-z0-9])/g, out)
  }
  if (!bareHandled.includes('=')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9=])(?<!(?<!\\)\{)=(?![=\s])([^=]+?)(?<!\s)=(?![A-Za-z0-9=])/g, out)
  }
  if (!bareHandled.includes('~')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9~])(?<!(?<!\\)\{)~(?![~\s])([^~]+?)(?<!\s)~(?![A-Za-z0-9~])/g, out)
  }

  // `*` is a strong and `_` an underline, and both are word-bounded: the
  // lookarounds are the ones the parser opens on, so `a*b*c`,
  // `feature_flag_company`, `can_*` and `5 * 4 * 3` stay bare - escaping those
  // would put a backslash in front of a character the author typed as itself.
  // Doubling is excluded because `**x**` and `__x__` are already literal to the
  // parser. Ported from carve-php#1141, which fixed the same gap there.
  if (!bareHandled.includes('*')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9*])(?<!(?<!\\)\{)\*(?![*\s])([^*\n]+?)(?<!\s)\*(?![A-Za-z0-9*])/g, out)
  }
  if (!bareHandled.includes('_')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9_])(?<!(?<!\\)\{)_(?![_\s])([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/g, out)
  }

  // A TAG is the one construct here that is not a pair: `#x` opens on its own
  // and needs no closer, so nothing downstream neutralizes it and the brace
  // escaping above cannot either - `\{#y#}` still rendered a tag span inside
  // literal braces (carve-php#1191).
  //
  // Source languages do not share it. Djot and Markdown both mean literal text
  // by `#y`, so every `#word` in their prose became a Carve tag, of which the
  // braced case was only the rarest instance.
  //
  // Mirrors the parser's opener rather than approximating it: a tag opens on a
  // `#` NOT preceded by an alphanumeric and followed by an alphanumeric or `-`.
  // That leaves a heading alone, since `# ` is followed by a space, and leaves
  // `a#y` alone, which is not a tag either.
  //
  // `&` joins the exclusion for a reason the tag rule does not care about but
  // this converter does: `&#8212;` is a NUMERIC CHARACTER REFERENCE, and
  // escaping its `#` stops it decoding, so `a &#8212; b` kept the entity
  // instead of becoming an em dash.
  if (!bareHandled.includes('#')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9&])(?<!(?<!\\)\{)#(?=[A-Za-z0-9-])/g, out)
  }

  // A MENTION is the tag's sibling and needs the same rule for the same
  // reason: it opens on its own, so nothing downstream neutralizes it. Ported
  // from carve-php#1381, which fixed the same gap there. None of the source
  // languages here means a mention by that character, so prose that quoted a
  // framework directive came back as a span.
  //
  // Mirrors the parser's opener (`RE_MENTION` and its preceding-character
  // guard) rather than approximating it: a mention opens on an `@` NOT
  // preceded by an alphanumeric or `_` and followed by one of those or `-`.
  // The lookbehind is what leaves an email address alone, since `foo@bar` has
  // a letter before the `@`.
  //
  // No brace guard, unlike the tag: `{@x@}` is not an attribute block and not
  // a braced pair, so there is nothing above for this rule to duplicate.
  //
  // Goes through `escapeUnlessAlreadyEscaped`, like every bare rule above, so
  // an at-sign the source already escaped is left alone.
  if (!bareHandled.includes('@')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9_])@(?=[A-Za-z0-9_-])/g, out)
  }

  // A SYMBOL SHORTCODE is the third member of that family and the one that was
  // missing. `a :rocket: b` came back bare and re-parses as a `symbol` node, so
  // under a configured symbol map the prose stopped being the prose the source
  // held. PART 11 section 2 already asks for the escape - omitting it changes
  // the re-parsed AST - and `:` is already in section 5's candidate set, which
  // is why the tag and mention sigils beside it are hardened and this one was
  // not. Ported from carve-php#1610, which fixed the same gap there.
  //
  // ONLY THE OPENING COLON is escaped, because only the opening colon opens
  // anything: the closing one is preceded by a name character, so the lookbehind
  // declines it and `a \:rocket: b` is the whole escape.
  //
  // Mirrors `RE_SYMBOL` and its preceding-character guard in parse.ts rather
  // than approximating it: a symbol opens on a `:` NOT preceded by `_` or an
  // alphanumeric and followed by a name that closes on another `:`, where the
  // first name character is a letter, a digit, `+` or `-` and the rest adds `_`.
  // Requiring the CLOSER too is what leaves `a : b : c` alone - a colon that
  // closes no shortcode opens no symbol - and the lookbehind is what leaves a
  // URL alone, since `http://x` has a letter before its colon.
  if (!bareHandled.includes(':')) {
    out = escapeUnlessAlreadyEscaped(/(?<![A-Za-z0-9_]):(?=[A-Za-z0-9+-][\w+-]*:)/g, out)
  }

  return out
}

/**
 * Escape the opening brace of every braced pair that is not escaped already.
 *
 * Scans with an explicit offset instead of one sweeping replace, for two
 * reasons a plain replace gets wrong:
 *
 *  - a nested `{^a{,b,}c^}` has its inner pair swallowed by the outer match, so
 *    resuming AFTER each match never reaches it, and the inner pair would then
 *    render as a subscript inside literal text. Resuming just inside the match
 *    does reach it.
 *  - whether a brace is escaped is a question about the PARITY of the backslash
 *    run before it, which a fixed-width lookbehind cannot ask.
 *
 * The scan runs over the ORIGINAL line and collects offsets, which the one
 * forward pass at the end turns into escapes. Splicing each backslash in as it
 * was found made the pass quadratic, and the parity answers are the same either
 * way: an insertion only changes the character in front of the brace it
 * escapes, and the character after that brace is the pair's delimiter, so no
 * later match can start where an inserted backslash would be read.
 *
 * Terminates because the offset strictly increases on every iteration.
 *
 * @param delimiters A regex character class body.
 */
function escapeBracedPairs(line: string, delimiters: string): string {
  const pattern = new RegExp(`\\{([${delimiters}])(?!\\s)[^\\n]+?(?<!\\s)\\1\\}`, 'g')
  const offsets: number[] = []
  let offset = 0

  while (offset < line.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(line)
    if (match === null) {
      break
    }

    const at = match.index
    if (!isEscapedAt(line, at)) {
      offsets.push(at)
    }

    // Resumed just past the brace rather than past the whole match, so a pair
    // NESTED inside this one is the next thing considered.
    offset = at + 1
  }

  return insertEscapes(line, offsets)
}
