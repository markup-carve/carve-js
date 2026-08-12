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

/** Delimiters whose constructs the CALLER's source language owns and rewrites. */
export interface HandledDelimiters {
  /** Braced forms, e.g. `*_` when the caller rewrites `{*x*}` and `{_x_}`. */
  braced?: string
  /** Bare forms, e.g. `*_` when the caller rewrites `*x*` and `_x_`. */
  bare?: string
}

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
  const escapeFirst = (m: string): string => `\\${m}`
  const bareHandled = handled.bare ?? ''

  let out = line.replace(/(^|[ \t])%%(?!%)/g, '$1\\%%')

  // Braced forms first, so the bare rules below see an escaped `{` and leave
  // the delimiter inside it alone instead of escaping it twice.
  //
  // Repeated until stable, because one pass escapes only the outermost brace of
  // a nested `{^a{,b,}c^}` — the match consumes the inner pair, which would then
  // render as a subscript inside literal text. The `(?<!\\)` guard is what makes
  // this terminate: an escaped brace is never re-matched.
  const bracedDelimiters = bracedClass(handled.braced ?? '')
  if (bracedDelimiters !== '') {
    const braced = new RegExp(
      `(?<!\\\\)\\{([${bracedDelimiters}])(?!\\s)[^\\n]+?(?<!\\s)\\1\\}`,
      'g',
    )
    let previous: string
    do {
      previous = out
      out = out.replace(braced, escapeFirst)
    } while (out !== previous)
  }

  // These run INSIDE an already-escaped brace too, unlike the php port: `=`, `~`
  // and `/` are bare constructs in their own right here, so `\{=x=}` still
  // renders `{<mark>x</mark>}` — the literal brace does not suppress the run.
  // Escaping the inner delimiter as well is what makes the whole thing literal.
  //
  // The `/` in the slash rule's lookbehind is load-bearing, not symmetry:
  // without it the SECOND slash of `ftp://x/` matched, and escaping it freed the
  // first one to open emphasis — `ftp:/\/x/` rendering as `ftp:<em>/x</em>`.
  // Only http and https URLs are protected above, so every other scheme reaches
  // this rule.
  if (!bareHandled.includes('/')) {
    out = out.replace(/(?<![A-Za-z0-9/])\/(?!\s)([^/]+?)(?<!\s)\/(?![A-Za-z0-9])/g, escapeFirst)
  }
  if (!bareHandled.includes('=')) {
    out = out.replace(/(?<![A-Za-z0-9=])=(?![=\s])([^=]+?)(?<!\s)=(?![A-Za-z0-9=])/g, escapeFirst)
  }
  if (!bareHandled.includes('~')) {
    out = out.replace(/(?<![A-Za-z0-9~])~(?![~\s])([^~]+?)(?<!\s)~(?![A-Za-z0-9~])/g, escapeFirst)
  }

  // `*` is a strong and `_` an underline, and both are word-bounded: the
  // lookarounds are the ones the parser opens on, so `a*b*c`,
  // `feature_flag_company`, `can_*` and `5 * 4 * 3` stay bare - escaping those
  // would put a backslash in front of a character the author typed as itself.
  // Doubling is excluded because `**x**` and `__x__` are already literal to the
  // parser. Ported from carve-php#1141, which fixed the same gap there.
  if (!bareHandled.includes('*')) {
    out = out.replace(/(?<![A-Za-z0-9*])(?<!(?<!\\)\{)\*(?![*\s])([^*\n]+?)(?<!\s)\*(?![A-Za-z0-9*])/g, escapeFirst)
  }
  if (!bareHandled.includes('_')) {
    out = out.replace(/(?<![A-Za-z0-9_])(?<!(?<!\\)\{)_(?![_\s])([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/g, escapeFirst)
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
    out = out.replace(/(?<![A-Za-z0-9&])(?<!(?<!\\)\{)#(?=[A-Za-z0-9-])/g, escapeFirst)
  }

  return out
}
