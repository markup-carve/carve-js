/*
 * Markdown -> Carve converter.
 *
 * Source-to-source transformation (not parsing) that rewrites common
 * Markdown into equivalent Carve. Two things differ from Markdown and from
 * Djot, and both are handled here:
 *
 *   1. Block spacing. Carve requires blank lines around block elements
 *      (headings, fenced code, lists, blockquotes); Markdown does not.
 *   2. Inline delimiters. Carve diverged from Djot/Markdown:
 *        emphasis      asterisk/underscore pairs -> slash pairs  /x/
 *                      ( _x_ is UNDERLINE in Carve, not emphasis )
 *        strong        double-star / double-underscore -> single star *x*
 *        bold-italic   triple-star / triple-underscore -> star+slash
 *        strikethrough one OR two tildes -> single tilde ~x~
 *
 * The dialect is CommonMark + GFM. Constructs that exist only in a wider
 * flavour are OPT-IN via `MarkdownDialect`, because converting one that was
 * not in the source invents markup the author never saw:
 *
 *        highlight     ==x==  -> =x=     ( dialect.highlight  — Obsidian, Quarto )
 *        superscript   ^x^    -> {^x^}   ( dialect.superscript — Pandoc )
 *        inline math   $x$    -> $`x`    ( dialect.math — Pandoc, GitHub )
 *
 *      All three are LITERAL text in CommonMark and GFM; `marked` renders
 *      `a ==b== c`, `a ^b^ c` and `a $x+y$ c` unchanged. Carve's highlight
 *      marker is a single char (`=x=`), and superscript has no bare form in
 *      Carve, so `^x^` maps to the braced `{^x^}`, which renders anywhere.
 *
 * Four more flavour constructs need no rewrite at all, because Carve spells
 * them the way the source does - so leaving them alone WAS the conversion, and
 * a CommonMark document grew markup it never had. They are escaped unless the
 * flag is on:
 *
 *        inline note   ^[x]         ( dialect.inlineFootnotes — Pandoc )
 *        abbreviation  *[HTML]: …   ( dialect.abbreviations — Markdown Extra )
 *        fenced div    ::: note     ( dialect.fencedDivs — Pandoc, Quarto )
 *        attributes    [t]{.c}      ( dialect.attributes — Pandoc, kramdown )
 *
 * Carve constructs that no Markdown flavour spells at all are escaped
 * unconditionally - see `escapeCarveConstructsSpelledLikeText`.
 *
 * The `_x_` -> `/x/` rule is the critical one: a naive Markdown->Djot port
 * keeps `_x_`, which Carve renders as underline — a silent mis-render.
 *
 * Delimiters inside inline code and fenced code blocks are never rewritten.
 *
 * Carve has no indented code block (like Djot), so a Markdown 4-space one is
 * rewritten as a FENCE rather than carried across; and Carve gives trailing
 * spaces no meaning, so a Markdown hard break becomes a trailing backslash.
 * Both used to pass through unchanged, which lost them.
 *
 * Known limitations:
 *  - Markdown lazy continuation is not preserved — Carve has none. A non-`>`
 *    line after a blockquote, or an unindented line after a list item, stays
 *    a separate paragraph rather than folding into the quote/item. Put `>` on
 *    every quoted line, and indent list-item continuation lines, to keep them.
 *  - Intraword emphasis (`foo*bar*baz`) is not converted: Carve's `/` cannot
 *    open or close next to an alphanumeric, so it has no intraword form.
 *  - Reference definitions nested inside a blockquote or list container are
 *    not recognized as such — only top-level ones are. Their delimiters may be
 *    rewritten. Keep reference definitions at the top level for a faithful
 *    migration.
 *  - Image alt text is preserved verbatim, not flattened to plain text as
 *    CommonMark does, so `![*x*](u)` keeps `*x*` in the Carve alt attribute.
 *  - A document opening with `---`, at least one non-blank line, and a closing
 *    `---` is migrated as frontmatter, even where CommonMark alone would read a
 *    thematic break followed by a setext h2. Every Markdown toolchain that
 *    supports frontmatter resolves that ambiguity the same way, and so does
 *    Carve. An EMPTY fence pair carries no metadata and stays two rules.
 */

import { escapePlainCarveInlineSyntax, HANDLED_MARKDOWN } from './carve-escape.js'

type TagReplacer = string | ((match: string, body: string, offset: number, full: string) => string)

/**
 * Build a replacer for a single-char inline marker (`^` super, `,` sub, `=`
 * highlight). Carve's bare markers do not open/close intraword or next to
 * whitespace, so the bare form (`^x^`) is only used when the tag has a
 * non-alphanumeric neighbor on each side and its body is not whitespace-padded.
 * Otherwise the brace form (`{^x^}`) is required - it renders in every position
 * (e.g. `H<sub>2</sub>O`), at the cost of being noisier. Preferring the bare
 * form keeps the common, whitespace-separated case clean on a Markdown->Carve
 * round-trip (corpus 67-superscript-and-subscript).
 */
function markerForm(marker: string): (match: string, body: string, offset: number, full: string) => string {
  return (match, body, offset, full) => {
    // Superscript and subscript have NO bare form in Carve - always braced.
    if (marker === '^' || marker === ',') return `{${marker}${body}${marker}}`
    const before = full[offset - 1] ?? ''
    const after = full[offset + match.length] ?? ''
    const intraword = /[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)
    const padded = /^\s|\s$/.test(body)
    return intraword || padded ? `{${marker}${body}${marker}}` : `${marker}${body}${marker}`
  }
}

const HTML_TAG_RULES: Array<[RegExp, TagReplacer]> = [
  // Only plain, attribute-free tags have Carve-native equivalents here. If an
  // HTML tag carries attributes, migrating it to native Carve would drop data,
  // so convertInlineHtml protects it as raw HTML instead.
  [/<mark>([^<]+)<\/mark>/gi, markerForm('=')],
  [/<ins>([^<]+)<\/ins>/gi, '{+$1+}'],
  [/<del>([^<]+)<\/del>/gi, '~$1~'],
  [/<s>([^<]+)<\/s>/gi, '~$1~'],
  [/<sup>([^<]+)<\/sup>/gi, markerForm('^')],
  [/<sub>([^<]+)<\/sub>/gi, markerForm(',')],
  [/<strong>([^<]+)<\/strong>/gi, '*$1*'],
  [/<b>([^<]+)<\/b>/gi, '*$1*'],
  [/<em>([^<]+)<\/em>/gi, '/$1/'],
  [/<i>([^<]+)<\/i>/gi, '/$1/'],
]

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  Aacute: '\u00c1',
  aacute: '\u00e1',
  Abreve: '\u0102',
  abreve: '\u0103',
  Acirc: '\u00c2',
  acirc: '\u00e2',
  AElig: '\u00c6',
  aelig: '\u00e6',
  Agrave: '\u00c0',
  agrave: '\u00e0',
  Alpha: '\u0391',
  alpha: '\u03b1',
  Amacr: '\u0100',
  amacr: '\u0101',
  amp: '&',
  apos: "'",
  and: '\u2227',
  ang: '\u2220',
  angst: '\u00c5',
  Aogon: '\u0104',
  aogon: '\u0105',
  Aring: '\u00c5',
  aring: '\u00e5',
  ast: '*',
  asymp: '\u2248',
  Atilde: '\u00c3',
  atilde: '\u00e3',
  Auml: '\u00c4',
  auml: '\u00e4',
  bdquo: '\u201e',
  Beta: '\u0392',
  beta: '\u03b2',
  brvbar: '\u00a6',
  bull: '\u2022',
  Cacute: '\u0106',
  cacute: '\u0107',
  cap: '\u2229',
  Ccaron: '\u010c',
  ccaron: '\u010d',
  Ccedil: '\u00c7',
  ccedil: '\u00e7',
  Ccirc: '\u0108',
  ccirc: '\u0109',
  Cdot: '\u010a',
  cdot: '\u010b',
  cent: '\u00a2',
  clubs: '\u2663',
  copy: '\u00a9',
  crarr: '\u21b5',
  cup: '\u222a',
  curren: '\u00a4',
  Dagger: '\u2021',
  dagger: '\u2020',
  dArr: '\u21d3',
  darr: '\u2193',
  Dcaron: '\u010e',
  dcaron: '\u010f',
  deg: '\u00b0',
  Delta: '\u0394',
  delta: '\u03b4',
  diams: '\u2666',
  div: '\u00f7',
  divide: '\u00f7',
  Dstrok: '\u0110',
  dstrok: '\u0111',
  Eacute: '\u00c9',
  eacute: '\u00e9',
  Ecaron: '\u011a',
  ecaron: '\u011b',
  Ecirc: '\u00ca',
  ecirc: '\u00ea',
  Edot: '\u0116',
  edot: '\u0117',
  Egrave: '\u00c8',
  egrave: '\u00e8',
  Emacr: '\u0112',
  emacr: '\u0113',
  emdash: '\u2014',
  empty: '\u2205',
  emsp: '\u2003',
  endash: '\u2013',
  ENG: '\u014a',
  eng: '\u014b',
  ensp: '\u2002',
  Eogon: '\u0118',
  eogon: '\u0119',
  epsilon: '\u03b5',
  equiv: '\u2261',
  ETH: '\u00d0',
  eth: '\u00f0',
  Euml: '\u00cb',
  euml: '\u00eb',
  euro: '\u20ac',
  exist: '\u2203',
  fnof: '\u0192',
  forall: '\u2200',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  frasl: '\u2044',
  gacute: '\u01f5',
  Gamma: '\u0393',
  gamma: '\u03b3',
  Gbreve: '\u011e',
  gbreve: '\u011f',
  Gcedil: '\u0122',
  Gcirc: '\u011c',
  gcirc: '\u011d',
  Gdot: '\u0120',
  gdot: '\u0121',
  ge: '\u2265',
  gt: '>',
  hArr: '\u21d4',
  harr: '\u2194',
  Hcirc: '\u0124',
  hcirc: '\u0125',
  hearts: '\u2665',
  hellip: '\u2026',
  Hstrok: '\u0126',
  hstrok: '\u0127',
  Iacute: '\u00cd',
  iacute: '\u00ed',
  Icirc: '\u00ce',
  icirc: '\u00ee',
  Idot: '\u0130',
  iexcl: '\u00a1',
  Igrave: '\u00cc',
  igrave: '\u00ec',
  IJlig: '\u0132',
  ijlig: '\u0133',
  Imacr: '\u012a',
  imacr: '\u012b',
  imath: '\u0131',
  imped: '\u01b5',
  infin: '\u221e',
  inodot: '\u0131',
  int: '\u222b',
  Iogon: '\u012e',
  iogon: '\u012f',
  iquest: '\u00bf',
  isin: '\u2208',
  Itilde: '\u0128',
  itilde: '\u0129',
  Iuml: '\u00cf',
  iuml: '\u00ef',
  Jcirc: '\u0134',
  jcirc: '\u0135',
  jmath: '\u0237',
  Kcedil: '\u0136',
  kcedil: '\u0137',
  kgreen: '\u0138',
  Lacute: '\u0139',
  lacute: '\u013a',
  Lambda: '\u039b',
  lambda: '\u03bb',
  laquo: '\u00ab',
  lArr: '\u21d0',
  larr: '\u2190',
  Lcaron: '\u013d',
  lcaron: '\u013e',
  Lcedil: '\u013b',
  lcedil: '\u013c',
  ldquo: '\u201c',
  le: '\u2264',
  Lmidot: '\u013f',
  lmidot: '\u0140',
  lowast: '\u2217',
  loz: '\u25ca',
  lsaquo: '\u2039',
  lsquo: '\u2018',
  Lstrok: '\u0141',
  lstrok: '\u0142',
  lt: '<',
  mdash: '\u2014',
  micro: '\u00b5',
  middot: '\u00b7',
  minus: '\u2212',
  mu: '\u03bc',
  nabla: '\u2207',
  Nacute: '\u0143',
  nacute: '\u0144',
  napos: '\u0149',
  nbsp: '\u00a0',
  Ncaron: '\u0147',
  ncaron: '\u0148',
  Ncedil: '\u0145',
  ncedil: '\u0146',
  ndash: '\u2013',
  ne: '\u2260',
  ni: '\u220b',
  not: '\u00ac',
  notin: '\u2209',
  Ntilde: '\u00d1',
  ntilde: '\u00f1',
  Oacute: '\u00d3',
  oacute: '\u00f3',
  Ocirc: '\u00d4',
  ocirc: '\u00f4',
  Odblac: '\u0150',
  odblac: '\u0151',
  OElig: '\u0152',
  oelig: '\u0153',
  Ograve: '\u00d2',
  ograve: '\u00f2',
  oline: '\u203e',
  Omacr: '\u014c',
  omacr: '\u014d',
  Omega: '\u03a9',
  omega: '\u03c9',
  or: '\u2228',
  ordf: '\u00aa',
  ordm: '\u00ba',
  Oslash: '\u00d8',
  oslash: '\u00f8',
  Otilde: '\u00d5',
  otilde: '\u00f5',
  Ouml: '\u00d6',
  ouml: '\u00f6',
  para: '\u00b6',
  part: '\u2202',
  permil: '\u2030',
  perp: '\u22a5',
  Phi: '\u03a6',
  phi: '\u03c6',
  Pi: '\u03a0',
  pi: '\u03c0',
  plusmn: '\u00b1',
  pound: '\u00a3',
  Prime: '\u2033',
  prime: '\u2032',
  prod: '\u220f',
  prop: '\u221d',
  quot: '"',
  Racute: '\u0154',
  racute: '\u0155',
  radic: '\u221a',
  raquo: '\u00bb',
  rArr: '\u21d2',
  rarr: '\u2192',
  Rcaron: '\u0158',
  rcaron: '\u0159',
  Rcedil: '\u0156',
  rcedil: '\u0157',
  rdquo: '\u201d',
  reg: '\u00ae',
  rsaquo: '\u203a',
  rsquo: '\u2019',
  Sacute: '\u015a',
  sacute: '\u015b',
  sbquo: '\u201a',
  Scaron: '\u0160',
  scaron: '\u0161',
  Scedil: '\u015e',
  scedil: '\u015f',
  Scirc: '\u015c',
  scirc: '\u015d',
  sect: '\u00a7',
  shy: '\u00ad',
  Sigma: '\u03a3',
  sigma: '\u03c3',
  sim: '\u223c',
  spades: '\u2660',
  star: '\u2606',
  sub: '\u2282',
  sube: '\u2286',
  sum: '\u2211',
  sup: '\u2283',
  sup1: '\u00b9',
  sup2: '\u00b2',
  sup3: '\u00b3',
  supe: '\u2287',
  szlig: '\u00df',
  Tcaron: '\u0164',
  tcaron: '\u0165',
  Tcedil: '\u0162',
  tcedil: '\u0163',
  there4: '\u2234',
  Theta: '\u0398',
  theta: '\u03b8',
  thinsp: '\u2009',
  THORN: '\u00de',
  thorn: '\u00fe',
  times: '\u00d7',
  trade: '\u2122',
  Tstrok: '\u0166',
  tstrok: '\u0167',
  Uacute: '\u00da',
  uacute: '\u00fa',
  uArr: '\u21d1',
  uarr: '\u2191',
  Ubreve: '\u016c',
  ubreve: '\u016d',
  Ucirc: '\u00db',
  ucirc: '\u00fb',
  Udblac: '\u0170',
  udblac: '\u0171',
  Ugrave: '\u00d9',
  ugrave: '\u00f9',
  Umacr: '\u016a',
  umacr: '\u016b',
  Uogon: '\u0172',
  uogon: '\u0173',
  Uring: '\u016e',
  uring: '\u016f',
  Utilde: '\u0168',
  utilde: '\u0169',
  Uuml: '\u00dc',
  uuml: '\u00fc',
  Wcirc: '\u0174',
  wcirc: '\u0175',
  Yacute: '\u00dd',
  yacute: '\u00fd',
  Ycirc: '\u0176',
  ycirc: '\u0177',
  yen: '\u00a5',
  Yuml: '\u0178',
  yuml: '\u00ff',
  Zacute: '\u0179',
  zacute: '\u017a',
  Zcaron: '\u017d',
  zcaron: '\u017e',
  Zdot: '\u017b',
  zdot: '\u017c',
})

const RE_HTML_ENTITY = /&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]+));/g
const RE_DECODED_CARVE_PUNCTUATION = /[\\`*_{}\[\]()#+\-.!~^/<>@%|=,"'$:;?]/g

function decodeCodePoint(n: number): string {
  // U+0000 joins the out-of-range and surrogate cases: cmark replaces a NUL
  // with U+FFFD, and this module wraps its own placeholders in NUL, so a
  // decoded one would collide with the stash/protect sentinels.
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : '\ufffd'
}

function escapeDecodedForCarve(s: string): string {
  return s.replace(RE_DECODED_CARVE_PUNCTUATION, '\\$&')
}

function resolveEntity(
  match: string,
  dec: string | undefined,
  hex: string | undefined,
  named: string | undefined,
): string {
  const decoded =
    dec !== undefined
      ? decodeCodePoint(Number(dec))
      : hex !== undefined
        ? decodeCodePoint(Number.parseInt(hex, 16))
        : NAMED_HTML_ENTITIES[named ?? '']
  return decoded ?? match
}

/** Resolve every entity reference in `s`, with no Carve escaping applied. */
function decodeHtmlEntitiesRaw(s: string): string {
  return s.replace(
    RE_HTML_ENTITY,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) =>
      resolveEntity(match, dec, hex, named),
  )
}

/**
 * Decode entities in a link/image DESTINATION. Unlike inline text the result is
 * not Carve-escaped: a backslash would be part of the URL. Whitespace a decode
 * introduces (`&#32;`, `&nbsp;`) is percent-encoded through
 * `encodeURIComponent`, so a non-ASCII space becomes its UTF-8 bytes the way
 * cmark writes it (`%C2%A0`, not `%A0`); a raw space would end the destination
 * and turn the rest into a title. A destination holds no raw whitespace before
 * decoding -- it is matched against the White_Space property below -- so every
 * match here came from an entity.
 *
 * The test is that property and NOT `/\s/`, which also holds U+FEFF. A BOM is
 * not whitespace in CommonMark either, so cmark keeps it in the destination;
 * encoding it turned an invisible character the author wrote into the six
 * visible ones `%EF%BB%BF` (markup-carve/carve#806).
 */
function decodeEntitiesInDestination(url: string): string {
  return decodeHtmlEntitiesRaw(url).replace(/\p{White_Space}/gu, (c) => encodeURIComponent(c))
}

/** A quoted title and the whitespace around it: ` "a & b"` / ` 'a & b'`. */
const RE_QUOTED_TITLE = /^(\s*)(["'])([\s\S]*)\2(\s*)$/

/**
 * Decode entities in a link/image TITLE. The decoded text is ordinary prose but
 * it sits inside a delimiter: `&quot;` in a double-quoted title decodes to the
 * very character that closes it, and emitting that raw stops the link parsing
 * at all. Carve reads a backslash-escaped delimiter inside a title, so the
 * delimiter (and any backslash) is escaped on the way out. A title in a shape
 * this does not recognize is left exactly as it was rather than guessed at.
 */
function decodeEntitiesInTitle(rest: string): string {
  const m = RE_QUOTED_TITLE.exec(rest)
  if (!m) return rest
  const [, lead, quote, body, trail] = m
  const decoded = decodeHtmlEntitiesRaw(body!)
  if (decoded === body) return rest
  const escaped = decoded.replace(/\\/g, '\\\\').split(quote!).join('\\' + quote)
  return `${lead}${quote}${escaped}${quote}${trail}`
}

function decodeHtmlEntities(s: string): string {
  const decoded = s.replace(
    RE_HTML_ENTITY,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      const resolved = resolveEntity(match, dec, hex, named)
      if (resolved === match) return match
      // A decoded line ending would SPLIT this line. The migration works a line
      // at a time, so the tail would lose whatever prefix its block needs (a
      // list item's indent, a quote's `>`) and land outside it. cmark reads
      // `&#10;` as a soft break, and a soft break is whitespace once rendered,
      // so a space says the same thing without breaking the line.
      if (resolved === '\n' || resolved === '\r' || resolved === '\r\n') return ' '
      return escapeDecodedForCarve(resolved)
    },
  )
  // Whitespace that a decode put at the START of the line is indentation to
  // every block rule that runs after this: `&#32;- item` is a paragraph in
  // cmark and would become a LIST here. `\ ` keeps it inline. The cost is one
  // character - Carve reads the escape as U+00A0, where cmark keeps U+0020 -
  // and structure is worth more than the space's breaking behavior.
  return /^[ \t]/.test(decoded) && !/^[ \t]/.test(s) ? '\\ ' + decoded.slice(1) : decoded
}

const NATIVE_INLINE_HTML_TAGS = new Set([
  'mark',
  'ins',
  'del',
  's',
  'sup',
  'sub',
  'strong',
  'b',
  'em',
  'i',
])

const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
])

const RAWTEXT_HTML_BLOCK_TAGS = new Set(['script', 'pre', 'style', 'textarea'])

function longestBacktickRun(s: string): number {
  let longest = 0
  let current = 0
  for (const ch of s) {
    if (ch === '`') {
      current++
      if (current > longest) longest = current
    } else {
      current = 0
    }
  }
  return longest
}

function rawInlineHtml(content: string): string {
  const tickLen = Math.max(1, longestBacktickRun(content) + 1)
  return `${'`'.repeat(tickLen)}${content}${'`'.repeat(tickLen)}{=html}`
}

function rawBlockHtml(lines: readonly string[]): string[] {
  const content = lines.join('\n')
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1))
  return [`${fence}=html`, content, fence]
}

function scanHtmlTag(
  s: string,
  start: number,
): { end: number; name: string; closing: boolean; selfClosing: boolean; attrs: boolean } | null {
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/.exec(s.slice(start))
  if (!tag) return null
  let quote = ''
  for (let i = start + tag[0]!.length; i < s.length; i++) {
    const ch = s[i]!
    if (quote !== '') {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '<') return null
    if (ch === '>') {
      const beforeClose = s.slice(start, i).replace(/\s+$/, '').endsWith('/')
      return {
        end: i + 1,
        name: tag[1]!.toLowerCase(),
        closing: s[start + 1] === '/',
        selfClosing: beforeClose,
        attrs: /\s+\S/.test(s.slice(start + tag[0]!.length, i).replace(/\/\s*$/, '')),
      }
    }
  }
  return null
}

function convertInlineHtml(input: string, protect: (s: string) => string): string {
  let out = ''
  let i = 0
  while (i < input.length) {
    if (input[i] !== '<') {
      out += input[i]!
      i++
      continue
    }
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end !== -1) {
        const html = input.slice(i, end + 3)
        out += protect(rawInlineHtml(html))
        i = end + 3
        continue
      }
    }
    const tag = scanHtmlTag(input, i)
    if (!tag) {
      out += input[i]!
      i++
      continue
    }
    let end = tag.end
    let native = false
    if (!tag.closing && !tag.selfClosing) {
      const closeRe = new RegExp(`</${tag.name}\\s*>`, 'i')
      const close = closeRe.exec(input.slice(tag.end))
      if (close) {
        end = tag.end + close.index + close[0].length
        const body = input.slice(tag.end, tag.end + close.index)
        native = !tag.attrs && NATIVE_INLINE_HTML_TAGS.has(tag.name) && !body.includes('<')
      }
    }
    if (native) {
      out += input.slice(i, end)
      i = end
      continue
    }
    out += protect(rawInlineHtml(input.slice(i, end)))
    i = end
  }
  return out}

/**
 * Replace every inline code span in `s` via `repl`, leaving everything else
 * untouched. A run of N backticks closes at the next run of *exactly* N
 * backticks (so a span may embed shorter runs, e.g. `` `a `b` c` ``). An
 * unterminated run is literal and left alone.
 */
function protectCodeSpans(s: string, repl: (span: string) => string): string {
  const runLen = (idx: number): number => {
    let n = 0
    while (s[idx + n] === '`') n++
    return n
  }
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] !== '`') {
      out += s[i]
      i++
      continue
    }
    const len = runLen(i)
    let j = i + len
    let closed = -1
    while (j < s.length) {
      // Close only at the start of a run of *exactly* len backticks, so a
      // longer inner run (```) never closes a shorter span (``) on its suffix.
      if (s[j] === '`' && s[j - 1] !== '`' && runLen(j) === len) {
        closed = j
        break
      }
      j++
    }
    if (closed === -1) {
      out += s.slice(i, i + len) // unterminated run: literal
      i += len
      continue
    }
    out += repl(s.slice(i, closed + len))
    i = closed + len
  }
  return out
}

/** Convert inline Markdown formatting in non-code text to Carve. */
/**
 * Markdown constructs that exist only in a wider flavour than CommonMark+GFM.
 *
 * They default to OFF because converting one that was not in the source
 * INVENTS markup: a `<sup>` in a migrated GitHub README renders differently
 * from anything its author saw, while leaving Pandoc superscript flat loses a
 * raised character but keeps the text readable. Failing toward literal is the
 * recoverable direction, so each flavour extension is opt-in.
 *
 * `marked`, a GFM implementation, renders them all as plain text: `a ==b== c`,
 * `a ^b^ c`, `a $x+y$ c`, `a ^[note] b`, `*[HTML]: …`, `::: note` and
 * `a [t]{.c} b` all come back unchanged, and so does `commonmark`.
 *
 * A flavour construct reaches Carve two ways, and both are covered here. Some
 * this converter REWRITES (`^x^` to `{^x^}`); others need no rewrite because
 * Carve happens to spell them the same way, so leaving the source alone is
 * itself the conversion (`::: note` is a paragraph in CommonMark and a div in
 * Carve). The second kind is the quieter defect: nothing in the converter
 * mentions the construct, yet the migrated document grows markup the source
 * never had. Those are escaped unless the matching flag is on.
 */
export interface MarkdownDialect {
  /** `==x==` is a highlight (Obsidian, Quarto, pandoc's `mark` extension). */
  highlight?: boolean
  /** `^x^` is a superscript (Pandoc). */
  superscript?: boolean
  /** `$x$` is inline math (Pandoc, and GitHub's own renderer). */
  math?: boolean
  /** `^[body]` is an inline footnote (Pandoc). */
  inlineFootnotes?: boolean
  /** `*[HTML]: HyperText` defines an abbreviation (PHP Markdown Extra). */
  abbreviations?: boolean
  /** `::: note` opens a fenced div (Pandoc, Quarto). */
  fencedDivs?: boolean
  /** `{.cls}` and `[text]{.cls}` carry attributes (Pandoc, kramdown). */
  attributes?: boolean
}

const COMMONMARK_GFM: MarkdownDialect = {}

/**
 * Escape the Carve constructs that CommonMark and GFM read as ORDINARY TEXT.
 *
 * `escapePlainCarveInlineSyntax` covers the constructs whose spelling is a
 * delimiter run (`{^x^}`, `=x=`, `#tag`, `%%comment%%`). It cannot cover the
 * ones spelled as a bracket, a marker column or a sigil-plus-code-span, and
 * every one of those reached the migrated document live:
 *
 *   a $`x+y` c     a math span, where the source says `$` then a code span
 *   a !`x` c       a literal span - the `!` and the code formatting vanish
 *   a :term[x] b   an extension call, where the source says a colon then text
 *   ^ caption      a caption bound to the block above it
 *
 * None of those is a Markdown construct in ANY flavour, so they are escaped
 * unconditionally. Four more are real syntax somewhere, so each is escaped
 * unless its {@link MarkdownDialect} flag opts in:
 *
 *   a ^[note] b    an inline footnote (Pandoc)
 *   *[HTML]: …     an abbreviation definition (PHP Markdown Extra)
 *   ::: note       a fenced div (Pandoc, Quarto)
 *   a [t]{.c} b    an attributed span, and `{.c}` alone on a line, a block's
 *                  attributes (Pandoc, kramdown)
 *
 * `input` is one paragraph-ish run, so a rule anchored at the run start is
 * anchored at the paragraph start.
 */
function escapeCarveConstructsSpelledLikeText(
  input: string,
  dialect: MarkdownDialect,
  protectedSpans: readonly string[],
): string {
  let out = input

  // `$`x`` / `$$`x`` (math) and `!`x`` (literal). The code span is already a
  // placeholder by now, so the sigil is matched against the placeholder and the
  // stored span is checked to BE a code span rather than some other protected
  // construct. EVERY dollar of the run is escaped, not just the first: in
  // `\$$`x`` the second dollar still opens inline math.
  out = out.replace(/(?<!\\)(\$+|!)\x00P(\d+)\x00/g, (m, sigil: string, index: string) => {
    if (!protectedSpans[Number(index)]?.startsWith('`')) return m
    return [...sigil].map((c) => `\\${c}`).join('') + m.slice(sigil.length)
  })

  // `:name[…]` calls an extension. The opener needs no left boundary - Carve
  // reads `foo:term[x]` as an extension call the same as ` :term[x]` - so the
  // rule takes none either. `note:[see below]` and `at 10:30[x]` are untouched
  // because the name must start with a letter and reach the bracket without a
  // break, and `:name{…}` is not an extension call at all.
  out = out.replace(/(?<!\\):(?=[A-Za-z][A-Za-z0-9-]*\[)/g, '\\:')

  // `^ text` is a CAPTION, and it binds to the block above: after a quote,
  // table or fence it became a `<footer>`/`<caption>`/`<figcaption>` and left
  // the flow of the document. It binds only at a block start, and a run is one
  // block, so the run start is the whole exposure.
  out = out.replace(/^\^(?= )/, '\\^')

  if (!dialect.inlineFootnotes) {
    // `^[body]` is an inline footnote: the text moves to the foot of the
    // document. The superscript rule below already refuses to pair across a
    // `[`, so this is the only thing standing between the source and a note.
    // A brace before the caret changes nothing - Carve reads the note in
    // `a {^[body] b` too - so only an existing escape is excluded. A footnote
    // REFERENCE is untouched: the caret in `a[^1]` is followed by the label,
    // not by a bracket.
    out = out.replace(/(?<!\\)\^(?=\[)/g, '\\^')
  }

  if (!dialect.abbreviations) {
    // `*[HTML]: HyperText` defines an abbreviation: the definition line
    // disappears from the render and every later `HTML` becomes an `<abbr>`.
    // Carve wants the space after the colon, so `*[A]:x` is already literal.
    out = out.replace(/^(?=\*\[[^\]\n]+\]:[ \t])/gm, '\\')
  }

  if (!dialect.fencedDivs) {
    // `::: name` opens a div and `:::` closes it: both fence lines disappear
    // from the render and everything between them is wrapped. Carve wants a
    // space or a line end after the colons, so `:::note` is already literal.
    out = out.replace(/^(?=:{3,}([ \t]|$))/gm, '\\')
  }

  return out
}

/**
 * Escape a `{…}` attribute list that would ATTACH to the construct before it.
 *
 * Runs after the delimiter rewrites, not with the rest of the escaping, because
 * what an attribute list attaches to is decided by what precedes it and half of
 * those things do not exist yet earlier in the pass: `a *x*{.c} b` becomes
 * `a /x/{.c} b`, and a link, image, code span or autolink is a placeholder by
 * then. Anchoring on `]` alone caught the bare span form and left the other
 * eight - `[t](u){.c}`, `` `x`{.c} ``, `<https://e.com/>{.c}` and the emphasis
 * family - attaching live attributes to text CommonMark renders with the braces
 * showing.
 *
 * A list attaches to a Carve inline element and to nothing else, so `a x{.c} b`
 * and `a (foo){.c} b` are left alone: the character before the brace has to be
 * a closer. `\x00` covers every placeholder in one lookbehind, since each ends
 * with the sentinel byte.
 *
 * A braced DELIMITER pair is not an attribute list and must not be escaped as
 * one: Carve reads `{,x,}` as a subscript wherever it stands, including alone
 * on a line and directly after another construct, and this converter emits that
 * form itself for `<sub>x</sub>`.
 */
const RE_BRACED_DELIMITER_FORM = /^([\^,=+\-~/#*_])[^\n]*\1$/

function escapeAttributeListsThatAttach(input: string): string {
  const escapeUnlessDelimiterPair = (match: string, interior: string): string => {
    if (RE_BRACED_DELIMITER_FORM.test(interior)) return match
    // A TAG opener at the head of the payload needs escaping too. The general
    // tag rule skips a `#` that an unescaped `{` precedes, because inside a
    // brace it is the braced form's business - and escaping the brace here is
    // what takes that premise away, so `{#id}` came out as `\{` plus a live
    // `#id` tag. Only the head position is affected; `{.a #b}` is escaped by
    // the general rule already, and escaping it twice would print a backslash.
    return `\\{${interior.replace(/^#(?=[A-Za-z0-9-])/, '\\#')}}`
  }
  return input
    .replace(/(?<=\x00|[\]/*_~=,^}])\{([^}\n]*)\}/g, escapeUnlessDelimiterPair)
    .replace(/^\{([^}\n]*)\}(?=[ \t]*$)/gm, escapeUnlessDelimiterPair)
}

function convertInline(input: string, dialect: MarkdownDialect = COMMONMARK_GFM): string {
  // Protect inline code spans so their delimiters are never rewritten.
  // Placeholders are wrapped in NUL, so ordinary text like "P0" is never
  // mistaken for one. NUL cannot occur in the text this sees because
  // `markdownToCarve` replaced every authored one with U+FFFD on the way in
  // (CommonMark 2.3); the comment here used to claim the source could not
  // contain one, which is an assumption about a file rather than about the
  // string a host passes, and carve-js#1291 measured what an authored one did.
  const protectedSpans: string[] = []
  const protect = (s: string) => {
    protectedSpans.push(s)
    return `\x00P${protectedSpans.length - 1}\x00`
  }
  let line = protectCodeSpans(input, protect)

  // A backslash escape (`\*`, `\_`, `\\`, …) makes the next punctuation char
  // literal in both Markdown and Carve, so protect the pair verbatim.
  line = line.replace(/\\[^A-Za-z0-9\s]/g, protect)

  // <code>...</code> without attributes has a Carve-native equivalent. Protect
  // it before delimiter rewrites so its body stays verbatim. Attributed code
  // is handled by convertInlineHtml as raw HTML so attributes are not lost.
  line = line.replace(/<code>([^<]+)<\/code>/gi, (_m, inner) => protect(`\`${inner}\``))

  // A Markdown HARD BREAK is two or more spaces before a newline; Carve spells
  // it with a trailing backslash. Trailing spaces mean NOTHING in Carve, so
  // carrying them across dropped the break: `a  \nb` migrated to a `<p>a\nb</p>`
  // with no `<br>`. Runs are joined before this call, so a newline here means
  // another line of the same paragraph follows - which is exactly CommonMark's
  // condition, a hard break being impossible at a paragraph's end. Code spans
  // are already protected, so a multi-line span keeps its own spacing.
  line = line.replace(/ {2,}\n/g, '\\\n')

  // Normalize a `(dest "title")` part: Carve's link parser closes the
  // destination at the first `)`, so balanced parens in the URL are
  // percent-encoded (Titan_(moon) -> Titan_%28moon%29).
  const encodeDest = (paren: string): string => {
    const inner = paren.slice(1, -1)
    // Split on the White_Space property, not `\S`: `\S` treats a BOM as the
    // whitespace that separates destination from title, and it is an ordinary
    // destination character, so the halves were cut in the wrong place and each
    // ran through the wrong decoder (markup-carve/carve#806).
    const m = inner.match(/^(\P{White_Space}+)([\s\S]*)$/u)
    const url = m ? m[1]! : inner
    const rest = m ? m[2]! : ''
    // A destination and title are entity-decoded by cmark like any other text,
    // and this whole construct is protected from the later decode pass, so it
    // happens here or not at all. `&amp;` in a query string is the canonical
    // case: left literal, the migrated link points somewhere else.
    const enc = decodeEntitiesInDestination(url).replace(/[()]/g, (c) =>
      c === '(' ? '%28' : '%29',
    )
    return `(${enc}${decodeEntitiesInTitle(rest)})`
  }

  // Images `![alt](dest)`: Carve renders the alt as raw text, so protect the
  // whole construct (alt and dest alike). The alt may contain one level of
  // nested brackets (`![a [b]](url)`); the dest is paren-normalized.
  line = line.replace(
    /(!\[(?:[^[\]]|\[[^\]]*\])*\])(\((?:[^()\n]|\([^()\n]*\))*\))/g,
    (_m, alt: string, dest: string) => protect(alt + encodeDest(dest)),
  )

  // Link destinations `](dest "title")`. (Images already handled above.) The
  // delimiters in a URL (e.g. /_v1_/) are never markup, so protect it whole.
  line = line.replace(/(?<=\])(\((?:[^()\n]|\([^()\n]*\))*\))/g, (_m, dest: string) =>
    protect(encodeDest(dest)),
  )

  // Reference-link use site `[text][label]`: the trailing `[label]` is a
  // literal reference key, not inline markup, so protect it too.
  line = line.replace(/(?<=\])\[[^\]]*\]/g, protect)

  // Autolinks `<scheme:...>` and `<email>`: the URL/address is literal, so a
  // `_` or `*` inside it (e.g. /_v1_/) must not be rewritten as markup.
  line = line.replace(/<[A-Za-z][A-Za-z0-9+.-]*:[^>\s]+>/g, protect)
  line = line.replace(/<[^>\s@]+@[^>\s]+>/g, protect)

  // Markdown inline HTML is live markup. Protect tags that have no lossless
  // Carve-native equivalent as explicit raw HTML before delimiter rewrites.
  line = convertInlineHtml(line, protect)

  // Bare/GFM autolink URLs in prose (https://example.com/api/_v1_/x): the
  // path is literal, so protect it before the emphasis passes.
  line = line.replace(/\bhttps?:\/\/[^\s<>`]+/g, protect)

  // Reference-link definition `[label]: dest "title"` (optional space after
  // the colon). The whole line is consumed literally by Carve's ref-link
  // parser, so protect it. A footnote definition `[^id]: body` is excluded —
  // its body is normal inline content that must still be converted.
  // The destination and title are entity-decoded here for the same reason the
  // inline form is (encodeDest): protecting the line puts it out of reach of
  // the later decode pass, and a literal `&amp;` in the definition points the
  // link somewhere the Markdown source did not.
  // Destination split on the White_Space property, for the reason `encodeDest`
  // gives above: `\S` cuts a destination at a BOM.
  line = line.replace(/^(\s*\[[^^\]][^\]]*\]:\s*)(\P{White_Space}+)([\s\S]*)$/u, (_m, head, dest, rest) =>
    protect(head + decodeEntitiesInDestination(dest) + decodeEntitiesInTitle(rest)),
  )

  // Math, converted and protected before the emphasis passes so a formula
  // body containing * _ ~ (e.g. $*x*$) is not rewritten as markup. Opt-in:
  // CommonMark and GFM both read a dollar as literal text.
  if (dialect.math) {
    // $$display$$ -> $$`display`
    line = line.replace(/\$\$([^$]+)\$\$/g, (_m, inner) => protect(`$$\`${inner}\``))
    // $inline$ -> $`inline`; a bare-number body ($5, $3.50) is currency, kept.
    // The `(?!\d)` keeps a currency range like `$5-$10` literal (otherwise the
    // first..second `$` would be paired as math).
    line = line.replace(/\$([^$\s][^$]*[^$\s]|\S)\$(?!\d)/g, (m, inner: string) =>
      /^[\d.,]+$/.test(inner) ? m : protect(`$\`${inner}\``),
    )
  }

  // Carve-only inline syntax in what is, in Markdown, plain text. Runs after
  // the protection block (so code, destinations and URLs are placeholders) and
  // before the rewrites below (so the `/x/`, `=x=`, `~x~` and `{^x^}` forms
  // THEY generate are not escaped).
  // `*` and `_` are Markdown's own emphasis delimiters, bare and braced alike,
  // and the passes below rewrite them into Carve. Escaping them here would
  // freeze `*x*` as literal text before that rewrite ever sees it.
  // `~` joins them: GFM strikethrough is a matching pair of ONE or two tildes,
  // so `~b~` is struck, and Carve spells strikethrough the same way. Escaping
  // it here froze it as literal text, and the doubled form's rule below could
  // then never see it.
  line = escapePlainCarveInlineSyntax(line, HANDLED_MARKDOWN)
  line = escapeCarveConstructsSpelledLikeText(line, dialect, protectedSpans)

  // Converted strong / bold-italic are stashed behind placeholders so their
  // single `*` / `/` are not re-matched by the emphasis passes below.
  const stash: string[] = []
  const hold = (s: string) => {
    stash.push(s)
    return `\x00S${stash.length - 1}\x00`
  }

  // Recursively convert *em* / _em_ nested inside a strong/bold-italic span to
  // /em/ (so a nested `_x_` becomes `/x/`, not Carve underline).
  const convertNestedEm = (inner: string): string =>
    inner
      .replace(/(?<![A-Za-z0-9*])\*(?!\s)([^*]+?)(?<!\s)\*(?![A-Za-z0-9*])/g, '/$1/')
      .replace(/(?<![A-Za-z0-9_])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9_])/g, '/$1/')

  // ***bold italic*** / ___bold italic___ -> /*x*/ (Carve's canonical
  // bold-italic). The underscore form needs word boundaries: CommonMark `_`
  // cannot open/close emphasis intraword (foo___bar___baz stays literal).
  line = line.replace(/\*{3}(?!\s)([\s\S]+?)(?<!\s)\*{3}/g, (_m, inner: string) =>
    hold(`/*${convertNestedEm(inner)}*/`),
  )
  line = line.replace(
    /(?<![A-Za-z0-9])___(?!\s)([\s\S]+?)(?<!\s)___(?![A-Za-z0-9])/g,
    (_m, inner: string) => hold(`/*${convertNestedEm(inner)}*/`),
  )

  // **strong** -> *strong*
  line = line.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, (_m, inner: string) =>
    hold(`*${convertNestedEm(inner)}*`),
  )

  // __strong__ -> *strong* (word-boundary: intraword `_` is literal)
  line = line.replace(
    /(?<![A-Za-z0-9])__(?!\s)([\s\S]+?)(?<!\s)__(?![A-Za-z0-9])/g,
    (_m, inner: string) => hold(`*${convertNestedEm(inner)}*`),
  )

  // *emphasis* -> /emphasis/. Carve `/` cannot flank whitespace OR open/close
  // intraword, so `2 * 3` and `foo*bar*baz` are left literal (Markdown
  // intraword emphasis is not expressible in Carve — see module header).
  line = line.replace(/(?<![A-Za-z0-9*])\*(?!\s)([^*]+?)(?<!\s)\*(?![A-Za-z0-9*])/g, '/$1/')

  // _emphasis_ -> /emphasis/ (word-boundary, so snake_case is left alone)
  line = line.replace(
    /(?<![A-Za-z0-9_])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9_])/g,
    '/$1/',
  )

  // ~~strikethrough~~ -> ~strikethrough~
  line = line.replace(/~~([^~]+)~~/g, '~$1~')

  // ==highlight== -> =highlight=. Carve highlight is a single `=`; a literal
  // `==x==` renders as plain text in Carve (corpus 74-two-char-delimiter-runs),
  // so a Markdown highlight left unchanged would silently mis-render.
  // Opt-in: `==x==` is literal text in CommonMark and GFM alike, so converting
  // it unconditionally invented a highlight the source never had.
  if (dialect.highlight) {
    line = line.replace(/==(?!\s)([^=]+?)(?<!\s)==/g, '=$1=')
  }

  // Attribute-free HTML inline tags -> Carve. Run after the emphasis/strong
  // passes: the tag bodies contain no * _ ~ delimiters, so the markup they
  // produce (e.g. <strong>a</strong> -> *a*) is not re-matched and turned into
  // /a/.
  for (const [re, repl] of HTML_TAG_RULES) {
    line = typeof repl === 'string' ? line.replace(re, repl) : line.replace(re, repl)
  }

  // ^superscript^ (pandoc-style) -> {^x^}. Carve has no bare superscript, so
  // an unconverted `^x^` would render literal. (Highlight ==x== was converted
  // to =x= above; math was converted and protected before the emphasis passes.)
  // The brace guards skip an already-braced `{^x^}` so it is not wrapped
  // twice. The `[` guards skip carets that belong to footnote references
  // (`[^x] … [^y]` must not pair up as a superscript span across the line).
  // Opt-in: `^x^` is literal text in CommonMark and GFM alike.
  if (dialect.superscript) {
    line = line.replace(/(?<![{[])\^(?![\s[])([^^\n]+?)(?<![\s[])\^(?!\})/g, '{^$1^}')
  }

  if (!dialect.attributes) line = escapeAttributeListsThatAttach(line)

  line = decodeHtmlEntities(line)

  // Restore stashes and protected spans until stable: a protected/stashed
  // span may itself contain placeholders (e.g. a reference-definition line
  // that wrapped an already-protected URL), so a single pass is not enough.
  //
  // BOUNDED. A slot only ever holds placeholders that were allocated before it,
  // so the nesting a legitimate document produces is at most one level per slot
  // and this many passes always reaches the fixed point. The bound is what turns
  // the one shape that does not terminate into a return: a slot holding its OWN
  // key is a cycle, and the loop spun on it forever rather than finishing
  // (carve-js#1291, ``a `b<NUL>P0<NUL>c` d `code` e``). The NUL replacement in
  // `markdownToCarve` is what stops such a slot being built at all; this is the
  // second lock, so a future path into `convertInline` that skipped the
  // replacement would emit the text unrestored instead of hanging the host.
  const maxRestorePasses = protectedSpans.length + stash.length + 1
  for (let pass = 0; pass < maxRestorePasses; pass++) {
    const prev = line
    line = line
      // A stash/protect index that has no stored value means the NUL-wrapped
      // sentinel came from the input itself (not one we emitted), so keep the
      // matched text verbatim rather than splicing the literal string
      // "undefined" into the output. Unreachable from an input NUL since the
      // replacement above - kept because it is the post-condition of the whole
      // restore, and the cost of being wrong about that is a document with
      // "undefined" written into it.
      .replace(/\x00S(\d+)\x00/g, (m, i) => stash[Number(i)] ?? m)
      .replace(/\x00P(\d+)\x00/g, (m, i) => protectedSpans[Number(i)] ?? m)
    if (line === prev) break
  }
  return line
}

/** A GFM table delimiter row, e.g. `| --- | :--: |` (at least one column). */
const RE_TABLE_DELIMITER = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/

/**
 * A Markdown/CommonMark thematic break: up to 3 leading spaces, then 3+ of the
 * same `-`, `*`, or `_`, which may be separated by spaces/tabs (`***`, `- - -`,
 * `_ _ _`, ` ***`), and nothing else on the line. Carve's canonical thematic
 * break is a contiguous col-0 `---`, so every Markdown form is normalized to
 * `---` on migration; without this a loose/indented `* * *` would parse as a
 * list or paragraph in Carve and the horizontal rule would be lost.
 */
const RE_MD_THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

/** A Markdown indented code line: four spaces, or one tab. */
const RE_MD_INDENTED_CODE = /^(?: {4,}|\t)/

/**
 * A link reference definition carrying its destination on the same line -
 * `[label]: destination`.
 *
 * Not a full reader for the construct: a label may run over lines, a
 * destination may sit on the line below its colon, and a title may sit below
 * that. Reading all of it would be a parser, and this file has none. It is only
 * ever asked whether a line is paragraph TEXT, and the destination is what
 * decides that on the line itself - a bare `[label]:` with nothing after it is
 * not a definition at all but a paragraph, which a setext underline may turn
 * into a heading like any other.
 */
const RE_MD_LINK_REFERENCE = /^ {0,3}\[[^\]]*\]:[ \t]*\S/

/**
 * Split a pipe-delimited table row into trimmed cell texts, honoring `\|`
 * escapes and dropping the empty cells produced by a leading/trailing pipe.
 */
function splitTableRow(row: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!
    if (ch === '\\' && i + 1 < row.length) {
      cur += ch + row[++i]!
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  if (cells.length > 1 && cells[0]!.trim() === '') cells.shift()
  if (cells.length > 1 && cells[cells.length - 1]!.trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function unescapePipesInCodeSpans(row: string): string {
  return protectCodeSpans(row, (span) => span.replace(/\\\|/g, '|'))
}

function isStandardTableRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false
  const cells = splitTableRow(trimmed)
  return cells.some((cell) => cell !== '') || cells.length >= 2
}

function hasFollowingSetextUnderline(lines: readonly string[], index: number): boolean {
  const underline = index + 1 < lines.length ? lines[index + 1]!.trim() : ''
  return /^=+$/.test(underline) || /^-+$/.test(underline)
}

function startsTableHeader(lines: readonly string[], index: number): boolean {
  const trimmed = lines[index]!.trim()
  if (!trimmed.includes('|')) return false
  const next = index + 1 < lines.length ? lines[index + 1]!.trim() : ''
  if (!next.includes('-') || !RE_TABLE_DELIMITER.test(next)) return false
  return splitTableRow(trimmed).length === splitTableRow(next).length
}

/**
 * Does a GFM table already under way keep this line as a body row?
 *
 * GFM ends the table at a blank line or at a block construct, and NOT at a line
 * that merely stops looking like a row: measured against `marked` 18 with
 * `gfm: true`, a plain unpiped line after a table body is a one-cell row, while
 * a heading, a bullet, a quote or a fence closes the table and starts its own
 * block.
 *
 * Only ever asked about a line inside a run a header opened, so it does not
 * have to decide what STARTS a table - `startsTableHeader` does that.
 */
function continuesGfmTableBody(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^#{1,6}([ \t]|$)/.test(trimmed)) return false
  if (trimmed.startsWith('>')) return false
  if (/^(`{3,}|~{3,})/.test(trimmed)) return false
  if (RE_MD_THEMATIC.test(line)) return false
  // An HTML block that can interrupt a paragraph ends the table too, and the
  // same predicate answers both: `marked` 18 closes the table at `<div>` and
  // `<script>` and keeps `<span>` as a body row, which is exactly the type-1-to-6
  // split this tests. Without it a row after the block stayed marked as part of
  // the table and came through unescaped.
  if (interruptingHtmlBlock(line)) return false
  // Four columns in ends it too: `marked` closes the table at an indented line
  // and reads what follows as a fresh block. Measured on the line as its own
  // container holds it, so an indented table is not four columns in - only a
  // line indented past its neighbours is.
  if (RE_MD_INDENTED_CODE.test(line)) return false

  return !/^(?:[-*+]|\d+[.)])([ \t]|$)/.test(trimmed)
}

/**
 * Which of these lines GFM reads as part of a table: a header, the delimiter
 * row under it, and the body rows that follow until the table ends.
 *
 * The whole point of asking is the INVERSE. Carve reads `| a | b |` as a table
 * row on its own, with no delimiter row anywhere, so every line this returns
 * `false` for and Carve would still read as a row is a table the source did not
 * have (markup-carve/carve-js#1061). The caller escapes those.
 */
function gfmTableRowLines(lines: readonly string[]): boolean[] {
  const inTable = lines.map(() => false)
  let i = 0
  while (i < lines.length) {
    if (!startsTableHeader(lines, i)) {
      i++
      continue
    }
    inTable[i] = true
    inTable[i + 1] = true
    i += 2
    while (i < lines.length && continuesGfmTableBody(lines[i]!)) {
      inTable[i] = true
      i++
    }
  }

  return inTable
}

/**
 * Keep a line Carve would read as a table row as ordinary text, by escaping the
 * pipe that opens it.
 *
 * The OPENING pipe alone, because that is the whole of Carve's rule: a row has
 * to both begin and end with one, so `\| a | b |` renders the pipes it was
 * written with and needs no further escaping - which is what keeps the line
 * readable, and lets it stay in the paragraph it belongs to rather than
 * becoming a block of its own.
 */
function keepPipeRowLiteral(line: string): string {
  return line.replace(/^(\s*)\|/, '$1\\|')
}

function isParagraphRunLine(
  lines: readonly string[],
  index: number,
  prevType: 'blank' | 'heading' | 'list' | 'block_quote' | 'code_fence' | 'code' | 'text',
): boolean {
  const line = lines[index]!
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^(\s{0,3})(`{3,}|~{3,})(.*)$/.test(line)) return false
  if (/^#{1,6}\s/.test(trimmed) || trimmed.startsWith('>')) return false
  if (RE_MD_THEMATIC.test(line) || hasFollowingSetextUnderline(lines, index)) return false
  if (startsTableHeader(lines, index) || isStandardTableRow(line)) return false
  // An HTML block whose condition may interrupt a paragraph ends the run, the
  // way a heading or a fence does. Carried into the run instead, a `<div>` on
  // the line after prose stayed INSIDE the paragraph as an inline raw span.
  if (interruptingHtmlBlock(line)) return false

  const ordered = trimmed.match(/^(\d+)[.)]\s/)
  const isList =
    (/^[-*+]\s/.test(trimmed) || ordered !== null) &&
    !(prevType === 'text' && ordered !== null && Number(ordered[1]) !== 1)
  return !isList
}

type PrefixedInlineLine = {
  prefix: string
  text: string
}

const RE_LIST_MARKER = /^([ \t]*)(?:[-*+]|\d+[.)]) +/

function leadingIndentWidth(line: string): number {
  return line.length - line.replace(/^[ \t]+/, '').length
}

/**
 * The width in COLUMNS of a string, a tab advancing to the next four-column
 * stop.
 *
 * Not the same as the character count once a tab is involved, and columns are
 * what CommonMark measures a block's indent in: a single tab opens an indented
 * code block, four characters of it or not. Measured in characters, one tab
 * counted as one column, so a tab-indented continuation looked less indented
 * than the list item holding it and closed the item.
 */
function columnWidth(text: string): number {
  let col = 0
  for (const ch of text) col += ch === '\t' ? 4 - (col % 4) : 1
  return col
}

/** The width in columns of a line's leading whitespace. */
function indentColumns(line: string): number {
  return columnWidth(/^[ \t]*/.exec(line)![0]!)
}

/**
 * Drop `columns` columns of leading whitespace - what an enclosing container
 * consumes before its content begins.
 *
 * A tab that straddles the boundary comes back as the spaces it covered past
 * it, which is how CommonMark splits a tab a container has partially eaten. A
 * plain `slice` by character count cannot do that, and on a tab-indented line
 * it removes the tab and the first letters of the content with it.
 */
function stripColumns(line: string, columns: number): string {
  if (columns <= 0) return line
  let col = 0
  let i = 0
  while (col < columns && i < line.length) {
    const ch = line[i]!
    if (ch === ' ') col += 1
    else if (ch === '\t') col += 4 - (col % 4)
    else break
    i++
  }
  return ' '.repeat(Math.max(0, col - columns)) + line.slice(i)
}

/**
 * The block-quote markers a line still carries, split off byte-for-byte so
 * `marker + body` is the line again.
 *
 * The collectors do NOT leave every container in `prefix`. The quote collector
 * peels all the levels it found, and the list collector peels only the item's
 * columns, so a quoted line inside an item reaches here with its `>` still on
 * the text. Both have to be visible to group a run by the container it is
 * really in.
 */
function peelQuoteMarkers(line: string): { marker: string; body: string } {
  const marker = /^(?:>[ \t]?)*/.exec(line)![0]

  return { marker, body: line.slice(marker.length) }
}

/** How many quote levels a peeled marker names; `>` and `> ` are one level. */
function quoteDepth(marker: string): number {
  return marker.split('>').length - 1
}

function restorePrefixedInlineRun(
  run: readonly PrefixedInlineLine[],
  dialect: MarkdownDialect,
): string[] {
  const converted = convertInline(run.map((part) => part.text).join('\n'), dialect).split('\n')
  const held = run.map((part) => peelQuoteMarkers(part.text))
  // Only a run whose lines this function can place in a container gets the
  // escape at all. What `prefix` holds is up to the collector, and a run can
  // still carry a container it does not model: the OUTER item of `- - | a |` is
  // in `prefix` while the inner one is left on the text, so the header sits at
  // an inner item and the rows under it sit at that item's content column.
  // Grouped as one container those three lines are not a table, and escaping
  // them broke a nested table this converter got right. A marker or an indent
  // still on the body is that signal, and the run is left exactly as it was.
  const modellable = held.every(
    (part) => !RE_LIST_MARKER.test(part.body) && !/^[ \t]/.test(part.body),
  )
  if (!modellable) return run.map((part, idx) => part.prefix + (converted[idx] ?? ''))

  // A container holds tables too, and the source decides which of its lines are
  // rows exactly as it does at the top level - so the same question is asked of
  // what each container HOLDS (markup-carve/carve-js#1061).
  //
  // ONE CONTAINER AT A TIME. Asked of the whole run, lines from different
  // containers form a header/delimiter/body sequence that exists in none of
  // them: `> | a | b |` over `> > |---|---|` over `> | x | y |` is a quoted
  // paragraph, a deeper quote and another quoted paragraph, and reading it as
  // one table left all three unescaped. The item's own columns are already in
  // `prefix`, whose WIDTH is what separates two items - `- ` and the `  ` under
  // it are one item, the same rule `containerSetextHeading` states - and the
  // quote levels are counted off the text, since a list collector leaves them
  // there.
  const container = run.map((part, idx) => `${part.prefix.length}:${quoteDepth(held[idx]!.marker)}`)
  const inTable = new Array<boolean>(run.length).fill(false)
  for (let start = 0; start < run.length; ) {
    let end = start + 1
    while (end < run.length && container[end] === container[start]) end++
    const flags = gfmTableRowLines(held.slice(start, end).map((part) => part.body))
    for (let offset = 0; offset < flags.length; offset++) inTable[start + offset] = flags[offset]!
    start = end
  }

  return run.map((part, idx) => {
    const line = converted[idx] ?? ''
    if (inTable[idx]) return part.prefix + line
    const quoted = peelQuoteMarkers(line)

    return (
      part.prefix +
      (isStandardTableRow(quoted.body)
        ? quoted.marker + keepPipeRowLiteral(quoted.body)
        : line)
    )
  })
}

/**
 * Fold a setext heading a CONTAINER holds into the ATX line Carve spells it
 * with, given the paragraph line and the line under it as the container holds
 * them - marker stripped, indent measured from the container's own content.
 *
 * Returns the replacement text for the paragraph line, or null when the two
 * lines are not a setext heading.
 *
 * BOTH lines have to sit in the same container, and the container shows up in
 * two places. The collector has already put what it consumed in `prefix`, and
 * two lines it consumed the same width of are two lines it holds - `- ` and
 * the `  ` under it are one item, while the quote collector's `> > ` and `> `
 * are two different quotes, so `> > T` over `> ===` is not a heading (the
 * underline is a lazy continuation of the inner paragraph there). What the
 * collector did NOT consume is peeled here: the LIST collector holds
 * `- > T` / `  > ===` as the texts `> T` and `> ===`, still quote-marked, and
 * that marker has to match too. Peeling both is what lets one helper serve a
 * quote, a list item, and a quote inside a list item alike.
 *
 * Four columns past the container's content is code rather than an underline
 * (CommonMark), so `>     =====` under a quoted paragraph stays paragraph
 * continuation; one to three columns of slack is still an underline.
 *
 * The line above the underline has to be paragraph TEXT, which is what
 * `isParagraphRunLine` already decides for the top level. A container holds
 * blocks other than paragraphs and the collectors hand those over here too,
 * where a `=` or `-` line under one is not an underline at all: under a fence
 * opener it is the code's first line, under a list marker it is a lazy
 * continuation of the item's own paragraph that an underline cannot reach, and
 * under a link reference definition it is a paragraph of its own. Folding any
 * of those destroyed the block. The test runs on the text with the quote
 * marker already peeled, so a quoted paragraph a list item holds still counts
 * as one. It also covers the rule case - `***` over `---` is two thematic
 * breaks, not an h2 titled `***` - while the separate heading guard stops a
 * second underline from re-folding a heading this pass just wrote.
 */
function containerSetextHeading(
  paragraph: PrefixedInlineLine,
  underline: PrefixedInlineLine,
): string | null {
  if (paragraph.prefix.length !== underline.prefix.length) return null
  const above = blockquotePrefix(paragraph.text)
  const below = blockquotePrefix(underline.text)
  if ((above === null) !== (below === null)) return null
  if (above && below && above.prefix !== below.prefix) return null
  const quote = above?.prefix ?? ''
  const text = above ? above.text : paragraph.text
  const rule = below ? below.text : underline.text
  if (indentColumns(text) >= 4 || indentColumns(rule) >= 4) return null
  const run = /^[ \t]*(=+|-+)[ \t]*$/.exec(rule)
  if (!run) return null
  const body = text.trim()
  if (body === '') return null
  if (/^#{1,6}([ \t]|$)/.test(body)) return null
  // `blank`, not `text`: after a blank an ordered marker of any number opens a
  // list, which is the reading that rejects the fold, and rejecting is the
  // safe side of a line this helper cannot classify.
  if (!isParagraphRunLine([text], 0, 'blank')) return null
  if (RE_MD_LINK_REFERENCE.test(text)) return null
  return `${quote}${run[1]![0] === '=' ? '#' : '##'} ${body}`
}

/**
 * Rewrite every setext heading a collected container run holds.
 *
 * The run is already the container's content with its marker held separately,
 * so a setext heading is just two adjacent entries in it. Folding the pair
 * needs no blank line after it: a heading interrupts a paragraph inside a
 * quote and inside a list item alike, so `> One` / `> # Two` keeps the
 * paragraph and the heading apart on its own.
 *
 * Where the paragraph is more than one line, the line ABOVE the underline
 * becomes the heading and the earlier lines stay a paragraph. That is the
 * approximation the top-level branch already makes, and it is forced: a Carve
 * heading is one line, so the multi-line heading CommonMark reads here has
 * nothing to convert into.
 */
function foldContainerSetext(run: readonly PrefixedInlineLine[]): PrefixedInlineLine[] {
  const out: PrefixedInlineLine[] = []
  for (const part of run) {
    const above = out[out.length - 1]
    const folded = above ? containerSetextHeading(above, part) : null
    if (above && folded !== null) {
      out[out.length - 1] = { prefix: above.prefix, text: folded }
      continue
    }
    out.push(part)
  }
  return out
}

function blockquotePrefix(line: string): { prefix: string; text: string } | null {
  let rest = line
  let prefix = ''
  while (rest.startsWith('>')) {
    rest = rest.slice(1)
    if (rest.startsWith(' ') || rest.startsWith('\t')) rest = rest.slice(1)
    prefix += '> '
  }
  if (prefix === '') return null
  return { prefix, text: rest }
}

/**
 * Collect a run of block-quote lines and convert their inlines.
 *
 * The quote is re-emitted at `contentCol`, the column its container holds its
 * content at, and the Markdown 1-3 space slack is stripped from what is left
 * above that column. Stripping the slack from column 0 instead took the list
 * item's content column with it, and the quote left the item.
 */
function collectBlockquoteInlineRun(
  lines: readonly string[],
  start: number,
  dialect: MarkdownDialect,
  contentCol = 0,
): {
  lines: string[]
  end: number
} {
  const pad = ' '.repeat(contentCol)
  const strip = (line: string): string =>
    stripColumns(line, contentCol).replace(/^[ \t]{1,3}(?=>)/, '')
  const run: PrefixedInlineLine[] = []
  let end = start
  while (end < lines.length) {
    const parsed = blockquotePrefix(strip(lines[end]!))
    if (!parsed || parsed.text.trim() === '') break
    // What the quote holds is measured with the marker stripped, so an HTML
    // block opening mid-quote ends the inline run and the caller re-enters on
    // that line as a block.
    if (end > start && interruptingHtmlBlock(parsed.text)) break
    run.push(parsed)
    end++
  }
  if (run.length === 0) return { lines: [pad + strip(lines[start]!)], end: start + 1 }
  return {
    lines: restorePrefixedInlineRun(foldContainerSetext(run), dialect).map((l) => pad + l),
    end,
  }
}

/**
 * Collect a Markdown indented code block and re-emit it as a Carve fence.
 *
 * The run is the contiguous stretch of lines indented 4+ columns, plus any
 * blank lines BETWEEN them - a blank line does not end an indented code block
 * in CommonMark, only a less-indented non-blank one does. Trailing blanks
 * belong to the document rather than the code, so they are given back.
 *
 * Exactly four columns are removed, which is what CommonMark strips; deeper
 * indentation is the code's own and is kept.
 *
 * Both the four columns and the emitted fence are measured from `contentCol`,
 * the column at which the enclosing container holds its content. Measured from
 * column 0 instead, code inside a list item lost the item (the fence was
 * written at column 0) and kept the item's columns as leading whitespace of the
 * sample.
 */
function collectIndentedCode(lines: readonly string[], start: number, contentCol = 0): {
  lines: string[]
  end: number
} {
  const run: string[] = []
  let end = start
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') {
      run.push(line)
      continue
    }
    // The same test the caller's branch uses, deliberately: a different
    // measure here could take a line the caller would not have called code.
    if (!RE_MD_INDENTED_CODE.test(stripColumns(line, contentCol))) break
    run.push(line)
    end = i + 1
  }

  const body = run
    .slice(0, end - start)
    .map((line) =>
      line.trim() === '' ? '' : stripColumns(line, contentCol).replace(/^(?: {4}|\t)/, ''),
    )
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body.join('\n')) + 1))
  const pad = ' '.repeat(contentCol)
  const out = [fence, ...body, fence].map((emitted) => (emitted === '' ? '' : pad + emitted))
  // Carve needs a blank line after a block; the caller resumes at `end`, which
  // is the first line the run did not take.
  if (end < lines.length && lines[end]!.trim() !== '') out.push('')

  return { lines: out, end }
}

function collectListInlineRun(
  lines: readonly string[],
  start: number,
  dialect: MarkdownDialect,
): {
  lines: string[]
  end: number
} {
  const first = lines[start]!
  const marker = first.match(RE_LIST_MARKER)
  if (!marker) return { lines: [convertInline(first, dialect)], end: start + 1 }

  const contentCol = marker[0].length
  const run: PrefixedInlineLine[] = [{ prefix: marker[0], text: first.slice(marker[0].length) }]
  let end = start + 1

  while (end < lines.length) {
    const line = lines[end]!
    if (line.trim() === '') break

    const nestedOrSibling = line.match(RE_LIST_MARKER)
    if (nestedOrSibling) break

    const indent = leadingIndentWidth(line)
    if (indent < contentCol) break

    // Leave fenced code blocks inside list items to the main fence handler.
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line.slice(contentCol))) break
    // Same for an HTML block opening at the item's content column.
    if (interruptingHtmlBlock(line.slice(contentCol))) break

    run.push({ prefix: line.slice(0, contentCol), text: line.slice(contentCol) })
    end++
  }

  return { lines: restorePrefixedInlineRun(foldContainerSetext(run), dialect), end }
}

/** Map a GFM delimiter cell to Carve's column-alignment marker (glued to `|=`). */
function alignMarker(cell: string): '' | '<' | '>' | '~' {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return '~'
  if (right) return '>'
  if (left) return '<'
  return ''
}

/**
 * A document-leading frontmatter fence, mirroring the parser's
 * RE_FRONTMATTER_OPEN / RE_FRONTMATTER_CLOSE so a document Carve reads as
 * having frontmatter is migrated as having frontmatter.
 *
 * The mirror is the whole point of this pair, so it moves when the parser
 * moves: the format slot takes `space` (PART 7), and `---<TAB>yaml` is a
 * thematic break followed by ordinary lines. Left at `[ \t]` this would have
 * migrated body content AS frontmatter for a document the parser does not read
 * as having any.
 *
 * It moved again for the CARDINALITY half (carve#912): the slot is `[space]`,
 * exactly one, so ` *` here would have migrated `---<SP><SP>yaml` as
 * frontmatter for a document the parser now reads as a paragraph - the same
 * leak the tab paragraph above describes, one narrowing later. Nothing failed
 * when the parser moved: this pair is a SECOND SPELLING of the production, and
 * the mirror test that guards it carried a space case and a tab case and no
 * run case at all.
 */
const RE_MD_FRONTMATTER_OPEN = /^--- ?(\w*)\s*$/
const RE_MD_FRONTMATTER_CLOSE = /^---\s*$/

/**
 * A run of lines that CommonMark reads as an HTML block, plus whether the
 * condition that opened it may interrupt a paragraph.
 *
 * Only condition 7 (a complete open or close tag alone on the line) may not -
 * every other condition can start a block on the line right after prose. The
 * flag is what keeps a `<span>` on its own line from silently eating the
 * paragraph above it while a `<footer>` correctly ends that paragraph.
 */
type HtmlBlockRun = { lines: string[]; end: number; interrupts: boolean }

/** Matches nothing, so `collectUntil` runs to its blank-line fallback. */
const RE_NEVER = /(?!)/

function htmlBlockAt(lines: readonly string[], start: number): HtmlBlockRun | null {
  const first = lines[start]!
  if (/^(?: {4,}|\t)/.test(first)) return null
  const trimmed = first.replace(/^ {0,3}/, '')
  const collectUntil = (endRe: RegExp, fallbackBlank: boolean, interrupts = true): HtmlBlockRun => {
    const block: string[] = []
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]!
      if (i > start && fallbackBlank && line.trim() === '') {
        return { lines: block, end: i - 1, interrupts }
      }
      block.push(line)
      if (endRe.test(line)) return { lines: block, end: i, interrupts }
    }
    return { lines: block, end: lines.length - 1, interrupts }
  }

  if (trimmed.startsWith('<!--')) return collectUntil(/-->/, false)
  if (/^<\?/.test(trimmed)) return collectUntil(/\?>/, false)
  if (/^<![A-Z]/.test(trimmed)) return collectUntil(/>/, false)
  if (trimmed.startsWith('<![CDATA[')) return collectUntil(/\]\]>/, false)

  const tag = scanHtmlTag(trimmed, 0)
  if (!tag) return null
  if (RAWTEXT_HTML_BLOCK_TAGS.has(tag.name)) {
    return collectUntil(new RegExp(`</${tag.name}\\s*>`, 'i'), false)
  }
  // Condition 6: a known block tag name. The block ends at the next blank line,
  // NOT at the element's closing tag - `<div>x</div>` followed by prose is one
  // HTML block holding both, and ending at the tag migrated that prose as a
  // paragraph outside the block the source put it in.
  if (HTML_BLOCK_TAGS.has(tag.name)) return collectUntil(RE_NEVER, true)
  // Condition 7: a complete tag, alone on the line. The block runs to the next
  // blank line - taking only the opening line split `<span>`/`text`/`</span>`
  // into a fence, a paragraph and an inline span, which is three readings of
  // one block.
  if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\s*\/?>\s*$/.test(trimmed)) {
    return collectUntil(RE_NEVER, true, false)
  }
  return null
}

/**
 * The same HTML-block condition, applied to what a CONTAINER holds.
 *
 * CommonMark opens an HTML block inside a block quote or a list item exactly as
 * it does at the top level - the container's marker or content column is
 * stripped first, and the condition is tested against what is left. Testing the
 * raw line instead answered the question twice wrong: a `<footer>` in a quote
 * never matched (the line starts with `>`), so it fell through to the inline
 * converter and came back as a raw SPAN wrapped in a paragraph the source did
 * not have; a `<footer>` under a list item matched, but the fence was written
 * at column 0 and landed outside the item.
 *
 * The prefix comes back with the run so the caller can re-emit the fence where
 * the container holds it. Any 1-3 space indent the block carries INSIDE the
 * container joins that prefix: in `>   <footer>x</footer>` the two spaces are
 * the enclosing list item's content column, and dropping them would move the
 * block out of the item and into the quote.
 */
function containerHtmlBlockAt(
  lines: readonly string[],
  start: number,
  listCols: readonly number[],
): { prefix: string; lines: string[]; end: number } | null {
  const stripLeadingQuoteIndent = (line: string): string => line.replace(/^[ \t]{1,3}(?=>)/, '')
  const quoted = blockquotePrefix(stripLeadingQuoteIndent(lines[start]!))
  const collect = (
    prefix: string,
    inner: readonly string[],
  ): { prefix: string; lines: string[]; end: number } | null => {
    const block = htmlBlockAt(inner, 0)
    if (!block) return null
    const pad = /^ {0,3}/.exec(block.lines[0]!)![0]
    const dedent = new RegExp(`^ {0,${pad.length}}`)
    return {
      prefix: prefix + pad,
      lines: block.lines.map((line) => line.replace(dedent, '')),
      end: start + block.end,
    }
  }

  if (quoted) {
    const inner: string[] = []
    let end = start
    while (end < lines.length) {
      const parsed = blockquotePrefix(stripLeadingQuoteIndent(lines[end]!))
      // A change of quote depth is a different container, so the run ends.
      if (!parsed || parsed.prefix !== quoted.prefix) break
      inner.push(parsed.text)
      end++
    }
    return collect(quoted.prefix, inner)
  }

  const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
  if (contentCol === 0) return null
  // Columns, matching the unit the stack is kept in - a tab is four of them.
  if (indentColumns(lines[start]!) < contentCol) return null
  const inner: string[] = []
  let end = start
  while (end < lines.length) {
    const line = lines[end]!
    if (line.trim() !== '' && indentColumns(line) < contentCol) break
    inner.push(line.trim() === '' ? '' : stripColumns(line, contentCol))
    end++
  }
  return collect(' '.repeat(contentCol), inner)
}

/**
 * Collect indented code a BLOCK QUOTE holds and re-emit it as a Carve fence
 * carrying the quote's own marker.
 *
 * The four columns that make a line code are counted after the quote marker,
 * because that is where the quote's content starts. Tested against the raw
 * line the count never reached four - the line begins with `>` - so quoted
 * code migrated as a PARAGRAPH, and the sample's `*` and `_` were then read as
 * emphasis, the same way top-level indented code used to be lost.
 *
 * Code opens only after a blank line, so the quote line before this one must
 * hold nothing, or there must be no such quote line at all and the code opens
 * the quote. Without that test a quoted paragraph's own indented continuation -
 * lazy continuation, which is prose - would come back as code.
 */
function quotedIndentedCodeAt(
  lines: readonly string[],
  start: number,
  contentCol: number,
): { prefix: string; lines: string[]; end: number } | null {
  const held = (line: string): string =>
    stripColumns(line, contentCol).replace(/^[ \t]{1,3}(?=>)/, '')
  const head = blockquotePrefix(held(lines[start]!))
  if (!head || !RE_MD_INDENTED_CODE.test(head.text)) return null

  const previous = start > 0 ? blockquotePrefix(held(lines[start - 1]!)) : null
  const opensHere =
    previous === null || previous.prefix !== head.prefix || previous.text.trim() === ''
  if (!opensHere) return null

  const body: string[] = []
  let end = start
  while (end < lines.length) {
    const parsed = blockquotePrefix(held(lines[end]!))
    // A change of quote depth is a different container, so the run ends.
    if (!parsed || parsed.prefix !== head.prefix) break
    if (parsed.text.trim() === '') {
      body.push('')
      end++
      continue
    }
    if (!RE_MD_INDENTED_CODE.test(parsed.text)) break
    body.push(parsed.text.replace(/^(?: {4}|\t)/, ''))
    end++
  }
  // A blank line does not end an indented code block, but trailing blanks
  // belong to the quote rather than to the code.
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop()
    end--
  }
  if (body.length === 0) return null
  return { prefix: ' '.repeat(contentCol) + head.prefix, lines: body, end }
}

/** Does an HTML block open on this line, and may it interrupt a paragraph? */
function interruptingHtmlBlock(line: string): boolean {
  const block = htmlBlockAt([line], 0)
  return block !== null && block.interrupts
}

/**
 * Split leading frontmatter off a document, returning its lines (fences
 * included) and the index of the first body line.
 *
 * Frontmatter is opaque metadata in Markdown and in Carve alike - both strip it
 * before block parsing - so it has to survive the migration byte-for-byte. Left
 * to the normal line transform, the opening `---` reads as a thematic break and
 * the closing one as a setext underline, so `description: y` becomes an h2 and
 * the metadata is destroyed.
 *
 * The fence must enclose at least one non-blank line. An empty pair (`---\n---`
 * or `---\n\n---`) carries no metadata, so the CommonMark reading - two
 * thematic breaks - is the meaning-preserving one, and it stays on the
 * thematic-break path guarded at the end of markdownToCarve.
 */
function splitFrontmatter(lines: readonly string[]): { frontmatter: string[]; bodyStart: number } {
  const none = { frontmatter: [], bodyStart: 0 }
  if (lines.length < 2 || !RE_MD_FRONTMATTER_OPEN.test(lines[0]!)) return none
  for (let i = 1; i < lines.length; i++) {
    if (!RE_MD_FRONTMATTER_CLOSE.test(lines[i]!)) continue
    const content = lines.slice(1, i)
    if (!content.some((l) => l.trim() !== '')) return none
    return { frontmatter: lines.slice(0, i + 1), bodyStart: i + 1 }
  }
  return none
}

/**
 * Convert a Markdown document to Carve.
 *
 * The dialect is CommonMark + GFM. Pass a {@link MarkdownDialect} to opt into
 * constructs that exist only in a wider flavour.
 *
 * A U+0000 IN THE INPUT IS REPLACED BY U+FFFD, before anything reads the text.
 * That is CommonMark 2.3's own rule for the flavour this converter reads, and it
 * is what `parse` already does for Carve source (`parse.ts`, "decided cross-impl
 * behavior"), and what {@link decodeCodePoint} already did for a NUL spelled as
 * a numeric entity - a raw one was the only spelling that reached the output, so
 * the converter disagreed with both the spec it converts FROM and the engine it
 * converts FOR.
 *
 * It is also what makes this file's placeholders safe. `convertInline` protects
 * code spans, escapes and converted emphasis behind `\x00P<n>\x00` /
 * `\x00S<n>\x00` under a comment claiming NUL "cannot occur in the source
 * text" - an assumption about a SOURCE FILE, while the node API hands this
 * function whatever string a host has. An authored `\x00P0\x00` answered the
 * restore pass and came back as the code span stored in slot 0, so text from
 * elsewhere in the document landed where the author's characters were; an
 * authored placeholder INSIDE a code span made that span hold its own key, and
 * the restore loop - which repeats until the text stops changing - never
 * terminated (carve-js#1291).
 *
 * Normalizing here rather than picking a private-use run, the way the BBCode
 * importer's stash key is picked (carve-js#1290, carve-js#1292): the two are not
 * equivalent. A picked run is drawn from characters the input MAY legitimately
 * carry, so it needs a scan, a refusal when the private-use area is full, and an
 * exported error for it. NUL is not text this converter may emit at all - the
 * engine downstream replaces it, and this converter now does the same - so after
 * the replacement the wrapper's alphabet is provably absent from the text it
 * wraps, with no failure mode to expose.
 */
export function markdownToCarve(
  markdown: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
): string {
  const allLines = markdown
    .replace(/\0/g, '\ufffd')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const { frontmatter, bodyStart } = splitFrontmatter(allLines)
  const lines = allLines.slice(bodyStart)
  const out: string[] = []
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0
  // How many leading spaces to strip from the open fence's opener/body/closer,
  // so the migrated fence sits at its container's content column. See the
  // opener handler for how it is derived.
  let fenceStrip = 0
  // Stack of enclosing list items' content columns (outermost first), so a
  // fence is re-based to the DEEPEST item that still contains it. A Markdown
  // fence indented to a list item's content stays in the item (strip nothing);
  // a document-level 1-3 space fence dedents to column 0.
  const listCols: number[] = []
  // Which source lines GFM reads as part of a table. Answered once, from the
  // SOURCE, because that is where the delimiter row still is - by the time a
  // header has been rewritten to `|=` the row that made it a table is gone.
  // Lines a fence or a container holds get an answer here too and are never
  // asked for it: a fenced line never reaches the text branch below, and a
  // contained one is answered again by `restorePrefixedInlineRun` against what
  // its container holds, marker peeled.
  const inGfmTable = gfmTableRowLines(lines)
  // was the previous line blank? A dedented line only leaves a list item when a
  // blank precedes it; without a blank it is lazy paragraph continuation and
  // the item stays open (CommonMark).
  let prevBlank = true
  let prevType:
    | 'blank'
    | 'heading'
    | 'list'
    | 'block_quote'
    | 'code_fence'
    | 'code'
    | 'raw_block'
    | 'text' = 'blank'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    const wasPrevBlank = prevBlank
    prevBlank = trimmed === ''

    // Maintain the list-item content-column stack. A marker opens an item whose
    // content starts after the marker (the task checkbox is content, so its
    // width is NOT part of the column); a blank line is transparent (a loose
    // item continues); a non-blank line pops items whose content starts to its
    // right. Code content never changes list tracking.
    if (!inCode) {
      // A thematic break wins over a list item on a line that could be read as
      // either (CommonMark: `* * *` is a rule, not a bullet holding `* *`).
      // Counted as a marker its columns became a content column, and the rule
      // itself - and every block after it - was padded out to them.
      const openCol = listCols.length ? listCols[listCols.length - 1]! : 0
      const marker = RE_MD_THEMATIC.test(stripColumns(line, openCol))
        ? null
        : line.match(/^([ \t]*)(?:[-*+]|\d+[.)]) +/)
      // Columns, not characters: the stack is compared against a line's indent
      // and a tab is worth four of them.
      const indent = indentColumns(line)
      // A dedented line leaves a list item when a blank precedes it OR the line
      // itself starts a block (heading, block quote, fence, thematic break) --
      // those interrupt lazy paragraph continuation, so the item ends (§10).
      const startsBlock =
        /^#{1,6}([ \t]|$)/.test(trimmed) ||
        trimmed.startsWith('>') ||
        /^(`{3,}|~{3,})/.test(trimmed) ||
        htmlBlockAt(lines, i) !== null ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)
      if (marker && /\S/.test(line.slice(marker[0].length))) {
        const markerIndent = columnWidth(marker[1]!)
        while (listCols.length && listCols[listCols.length - 1]! > markerIndent) listCols.pop()
        listCols.push(columnWidth(marker[0]!))
      } else if (trimmed !== '' && (wasPrevBlank || startsBlock)) {
        while (listCols.length && listCols[listCols.length - 1]! > indent) listCols.pop()
      }
    }

    // The column at which the innermost open container holds its content, and
    // the padding that puts a block back there. Every block branch below both
    // MEASURES from here and WRITES BACK to here: a line is indented code only
    // four columns past it, Markdown's 0-3 space slack is counted from it, and
    // an emitted block that ignores it leaves the item that held it. Nothing on
    // the stack means column 0, the document itself.
    const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
    const containerPad = ' '.repeat(contentCol)
    // What that container holds on this line, its content column removed. The
    // block tests run against this rather than the raw line.
    const held = stripColumns(line, contentCol)

    // Opening fence — a >=3 run of ` or ~, indented at most 3 spaces (the
    // Markdown rule). Carve accepts a single language token over a real-world
    // charset (c++, c#, asp.net, text/html are valid), so the Markdown info
    // string is normalized to its first such token — keeping `c++`/`text/html`
    // intact and reducing an extended info (```js title="x") to ```js (still a
    // code block). The charset matches RE_FENCE in parse.ts, including `/`.
    const open = !inCode ? line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/) : null
    if (open) {
      if (prevType !== 'blank' && out.length > 0) out.push('')
      inCode = true
      fenceChar = open[2]![0]!
      fenceLen = open[2]!.length
      const info = open[3]!.match(/[A-Za-z0-9_+#/.-]+/)?.[0] ?? ''
      // Re-base the fence to its container's content column: strip only the
      // indentation ABOVE that column. At document level the column is 0, so a
      // 1-3 space Markdown fence dedents fully; inside a list item the fence's
      // own indent IS the content column, so nothing is stripped and it stays
      // in the item. The same strip comes off the body and closer, since
      // Markdown already treats that indent as the fence's, not the sample's.
      //
      // The slack is measured, and stripped, in COLUMNS. Measured in
      // characters a tab-indented fence inside a list item counted as one
      // column, less than the item's own two, so nothing was stripped and the
      // tab went through to Carve, which does not read a tab-indented fence
      // inside an item as a fence at all.
      const openerIndent = columnWidth(open[1]!)
      fenceStrip = Math.max(0, openerIndent - contentCol)
      // Whatever the opener's own indent was, what survives the strip is
      // exactly the content column, so the fence goes back there.
      out.push(containerPad + open[2]! + info)
      prevType = 'code_fence'
      continue
    }

    // Inside a fence — a closer is a run of the same char at least as long as
    // the opener (indented by at most 3 spaces); a shorter inner run is code.
    if (inCode) {
      const dedented = stripColumns(line, fenceStrip)
      if (new RegExp(`^\\s{0,3}(${fenceChar}{${fenceLen},})\\s*$`).test(line)) {
        inCode = false
        fenceChar = ''
        fenceLen = 0
        fenceStrip = 0
        out.push(dedented)
        if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
        prevType = 'code_fence'
      } else {
        out.push(dedented)
        prevType = 'code'
      }
      continue
    }

    // An HTML block held by a container: a raw fence carrying the container's
    // own prefix, so the block stays where the source put it. Placed BEFORE the
    // indented-code branch, because a line four columns in is code only when
    // those columns are four past its container's content column - inside a
    // nested item whose content starts at column 4 it is an ordinary block.
    const contained = containerHtmlBlockAt(lines, i, listCols)
    if (contained) {
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(contained.lines.join('\n')) + 1))
      for (const emitted of [`${fence}=html`, ...contained.lines, fence]) {
        out.push(emitted === '' ? contained.prefix.trimEnd() : contained.prefix + emitted)
      }
      i = contained.end
      prevType = contained.prefix.trimStart().startsWith('>') ? 'block_quote' : 'list'
      continue
    }

    // Indented code a block quote holds. Placed before the indented-code branch
    // below, which measures from column 0 and so never fires on a line that
    // begins with `>`, and after the HTML one, which reads the same content and
    // is the narrower match.
    const quotedCode = quotedIndentedCodeAt(lines, i, contentCol)
    if (quotedCode) {
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(quotedCode.lines.join('\n')) + 1))
      if (prevType !== 'blank' && prevType !== 'block_quote' && out.length > 0) out.push('')
      for (const emitted of [fence, ...quotedCode.lines, fence]) {
        out.push(emitted === '' ? quotedCode.prefix.trimEnd() : quotedCode.prefix + emitted)
      }
      i = quotedCode.end - 1
      prevType = 'block_quote'
      continue
    }

    // A Markdown INDENTED code block becomes a Carve FENCE. Carve has no
    // indented code block, so carrying the run through byte-for-byte did not
    // preserve it - it made the code a PARAGRAPH, and the code's own `*` and
    // `_` were then read as emphasis: `    let x = *not bold*` rendered as
    // `<p>let x = <strong>not bold</strong></p>`.
    //
    // The previous line must be blank, so an indented line under a list item -
    // which is item continuation, not code - never reaches here. The four
    // columns are counted from the container's content column, not from column
    // 0: a paragraph sitting AT a nested item's content column is the item's
    // own content, and reading it as code both lost the paragraph and moved it
    // out of the item.
    if (
      (wasPrevBlank || prevType === 'blank' || prevType === 'code') &&
      RE_MD_INDENTED_CODE.test(held)
    ) {
      const block = collectIndentedCode(lines, i, contentCol)
      if (prevType !== 'blank' && out.length > 0) out.push('')
      out.push(...block.lines)
      i = block.end - 1
      prevType = 'code_fence'
      continue
    }

    const htmlBlock = htmlBlockAt(lines, i)
    if (htmlBlock) {
      if (prevType !== 'blank' && out.length > 0) out.push('')
      out.push(...rawBlockHtml(htmlBlock.lines))
      i = htmlBlock.end
      if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
      prevType = 'raw_block'
      continue
    }

    // GFM table header: a `| ... |` row immediately followed by a delimiter
    // row (`| --- | :--: |`). Carve marks header cells with `|=` (alignment
    // glued as `<`/`>`/`~`) and needs no delimiter row, so rewrite the header
    // and drop the delimiter. Body rows are already valid Carve and fall
    // through as plain text below, so only the header is special-cased here.
    if (trimmed.includes('|')) {
      const next = i + 1 < lines.length ? lines[i + 1]!.trim() : ''
      if (next.includes('-') && RE_TABLE_DELIMITER.test(next)) {
        const headerCells = splitTableRow(trimmed)
        const aligns = splitTableRow(next).map(alignMarker)
        // GFM requires the delimiter row to have the same column count as the
        // header; a mismatch (e.g. `a | b` over `---`) is not a table, so leave
        // it for the setext/thematic-break handling below.
        if (aligns.length === headerCells.length) {
          let header = ''
          for (let c = 0; c < headerCells.length; c++) {
            const cell = convertInline(unescapePipesInCodeSpans(headerCells[c]!), dialect)
            header += `|=${aligns[c] ?? ''} ${cell} `
          }
          header += '|'
          if (prevType !== 'blank' && out.length > 0) out.push('')
          // At the container's content column, so the converted header keeps
          // the item that holds it. Written at column 0 it left the item while
          // the body rows stayed behind, splitting one table into two blocks.
          out.push(containerPad + header)
          i++ // consume the delimiter row
          prevType = 'text'
          continue
        }
      }
    }

    const isBlank = trimmed === ''
    const isHeading = /^#{1,6}\s/.test(trimmed)
    const indent = line.length - line.replace(/^\s+/, '').length
    // How far the line sits PAST its container's content column - the measure
    // Markdown's 0-3 space slack and its four-column code rule are both stated
    // in. `indent` is the absolute one, which is the same number only at the
    // document level.
    const relIndent = indentColumns(held)
    const isBlockquote = trimmed.startsWith('>')
    // An ordered marker other than `1` cannot interrupt a paragraph
    // (CommonMark), so after a paragraph it stays prose; bullets and `1.`
    // always start/continue a list. Mid-list, any number continues.
    const ordered = trimmed.match(/^(\d+)[.)]\s/)
    const isList =
      (/^[-*+]\s/.test(trimmed) || ordered !== null) &&
      !(prevType === 'text' && ordered !== null && Number(ordered[1]) !== 1)

    if (isBlank) {
      out.push(line)
      prevType = 'blank'
      continue
    }

    if (relIndent >= 4 && (prevType === 'blank' || prevType === 'code')) {
      out.push(line)
      prevType = 'code'
      continue
    }

    // Indented content directly under a list item (a nested sublist, an
    // indented blockquote/heading, or a lazy continuation) belongs to that
    // item. Carve keeps it there by indentation, so pass it through with
    // inline conversion only — no top-level block spacing or dedent.
    if (prevType === 'list' && indent >= 1) {
      if (isList) {
        const run = collectListInlineRun(lines, i, dialect)
        out.push(...run.lines.map((l) => l.replace(/^(\s*)\+(\s)/, '$1-$2')))
        i = run.end - 1
        prevType = 'list'
        continue
      }
      out.push(convertInline(line, dialect))
      prevType = 'list'
      continue
    }

    // Setext heading: a paragraph line immediately followed by a line of only
    // `=` (h1) or `-` (h2). Carve has no setext, so rewrite to an ATX heading
    // and consume the underline.
    //
    // This branch answers for the top level only. A quote line or a list line
    // never reaches it, because the collectors below take the whole run of
    // them in one step, so a container's own setext heading is folded there,
    // by `foldContainerSetext`, where the marker is already held apart from
    // the content. Letting the guards through instead would write the heading
    // at column 0 and take it out of the container that held it.
    const underline = i + 1 < lines.length ? lines[i + 1]!.trim() : ''
    if (
      !isHeading &&
      !isBlockquote &&
      !isList &&
      // A line that is ITSELF a Markdown thematic break (`***`, `---`, …) is a
      // rule, not a setext heading text line. CommonMark: `***\n---` is two
      // thematic breaks, not an h2 titled `***`; guard so the rule falls
      // through to the thematic-break normalization below.
      !RE_MD_THEMATIC.test(held) &&
      (/^=+$/.test(underline) || /^-+$/.test(underline))
    ) {
      if (prevType !== 'blank' && prevType !== 'heading') out.push('')
      out.push(
        containerPad + convertInline(`${underline[0] === '=' ? '#' : '##'} ${trimmed}`, dialect),
      )
      i++ // consume the underline line
      if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
      prevType = 'heading'
      continue
    }

    // Markdown thematic break (`***`, `- - -`, `_ _ _`, indented ` ***`, …) ->
    // Carve's canonical contiguous col-0 `---`. Placed AFTER the setext block: a
    // contiguous `---` UNDER a paragraph is consumed there as a setext h2
    // (CommonMark: setext wins over a thematic break under a paragraph), while a
    // rule line that is not a setext underline for a preceding paragraph falls
    // through to here (the setext guard above skips rule lines themselves).
    if (RE_MD_THEMATIC.test(held)) {
      if (prevType !== 'blank' && out.length > 0) out.push('')
      out.push(containerPad + '---')
      if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
      prevType = 'blank'
      continue
    }

    // A thematic break wrapped in blockquote markers (`> * * *`, `> > ___`).
    // Strip the `>`-marker prefix; if the remainder is a Markdown rule, re-emit
    // the same quote depth with Carve's canonical `---` so the rule survives
    // inside the quote (a stricter Carve parser would otherwise read the spaced
    // form as a nested list). Rules nested inside LIST items are a known
    // limitation — the line-based migrator does not restructure item indent.
    const bqRule = held.match(/^ {0,3}((?:>[ \t]?){1,})(.*)$/)
    if (bqRule && RE_MD_THEMATIC.test(bqRule[2]!)) {
      const depth = (bqRule[1]!.match(/>/g) ?? []).length
      if (prevType !== 'blank' && prevType !== 'block_quote' && out.length > 0) out.push('')
      out.push(containerPad + '> '.repeat(depth) + '---')
      prevType = 'block_quote'
      continue
    }

    if (isHeading && prevType !== 'blank' && prevType !== 'heading') out.push('')
    if (isBlockquote && prevType !== 'blank' && prevType !== 'block_quote') out.push('')
    // A blockquote ends at the first non-`>` line; Carve needs a blank line
    // between it and the following paragraph to keep them separate blocks.
    if (!isBlockquote && !isHeading && !isList && prevType === 'block_quote') out.push('')
    // A top-level list needs a blank line before it. A list line right after
    // another list item is a sibling/nested item — Carve already handles both
    // by indentation, so no blank there (it would wrongly make the list loose).
    const isTopLevelList = isList && prevType !== 'list'
    if (isTopLevelList && prevType !== 'blank') out.push('')

    // Carve recognizes `#` headings and `>` blockquotes at their container's
    // content column, but Markdown allows 1-3 further spaces of indent — dedent
    // that slack so the block survives. The slack is measured from the content
    // column, and the block goes back to it: measured from column 0, a heading
    // or a quote sitting AT a list item's content column looked like slack and
    // was dedented out of the item.
    // Lists are NOT dedented: Carve parses indented lists fine, and dedenting
    // only some items of an indented list would reparent its siblings.
    const dedent = relIndent >= 1 && relIndent <= 3 && (isHeading || isBlockquote)
    let body = dedent ? containerPad + line.slice(indent) : line
    // Strip an ATX heading's optional closing `#` run (Carve keeps it as text).
    if (isHeading) body = body.replace(/[ \t]+#+[ \t]*$/, '')
    // Carve has no `+` bullet (it is the list-continuation marker); normalize a
    // Markdown `+` bullet to `-` so the converted list survives.
    if (isList) body = body.replace(/^(\s*)\+(\s)/, '$1-$2')
    if (isBlockquote) {
      const run = collectBlockquoteInlineRun(lines, i, dialect, contentCol)
      out.push(...run.lines)
      i = run.end - 1
      prevType = 'block_quote'
      continue
    }
    if (isList) {
      const run = collectListInlineRun(lines, i, dialect)
      out.push(...run.lines.map((l) => l.replace(/^(\s*)\+(\s)/, '$1-$2')))
      i = run.end - 1
      prevType = 'list'
      continue
    }
    if (!isHeading && !isList && !isBlockquote && !isStandardTableRow(body)) {
      const run = [body]
      let end = i + 1
      while (end < lines.length && isParagraphRunLine(lines, end, 'text')) {
        run.push(lines[end]!)
        end++
      }
      if (run.length > 1) {
        out.push(convertInline(run.join('\n'), dialect))
        i = end - 1
        prevType = 'text'
        continue
      }
    }
    if (isStandardTableRow(body)) body = unescapePipesInCodeSpans(body)
    const converted = convertInline(body, dialect)
    // A pipe row GFM did NOT read as a table row stays text. Carve needs no
    // delimiter row, so passing the line through was itself the conversion and
    // the migrated document grew a table the author never saw
    // (markup-carve/carve-js#1061). Escaping only the opening pipe keeps the
    // line in the paragraph it belongs to.
    out.push(
      !inGfmTable[i] && isStandardTableRow(converted) ? keepPipeRowLiteral(converted) : converted,
    )

    if (isHeading && i + 1 < lines.length) {
      const next = lines[i + 1]!.trim()
      if (next !== '' && !/^#{1,6}\s/.test(next)) out.push('')
    }

    if (isHeading) prevType = 'heading'
    else if (isList) prevType = 'list'
    else if (isBlockquote) prevType = 'block_quote'
    else prevType = 'text'
  }

  // Frontmatter-collision guard: Carve reads a line-0 `---` as a frontmatter
  // OPEN fence (frontmatter is recognized only on the first line) and, with a
  // later closer, swallows everything between as opaque metadata — ignoring any
  // code fences in that span, since frontmatter is stripped before block
  // parsing. A document that OPENS with a thematic break (`***\n\n***` ->
  // `---\n\n---`), or one whose body holds a bare `---` line (e.g. inside a code
  // block), would otherwise vanish. A leading blank keeps line 0 off `---` so
  // frontmatter never triggers and every rule stays a rule. The closer test
  // mirrors Carve's `/^---\s*$/` (trailing whitespace allowed, so `---   ` in a
  // code fence counts too); the opener is always the exact `---` we emit.
  // Real frontmatter already occupies line 0, so the body cannot open a
  // phantom fence and the guard would only inject a stray blank after the
  // closing `---`.
  if (
    frontmatter.length === 0 &&
    out[0] === '---' &&
    out.slice(1).some((l) => /^---\s*$/.test(l))
  ) {
    out.unshift('')
  }

  // Collapse 3+ consecutive blank lines to 2.
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n')
  if (frontmatter.length === 0) return body
  return body === '' ? frontmatter.join('\n') : `${frontmatter.join('\n')}\n${body}`
}
