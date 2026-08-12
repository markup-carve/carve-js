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

import { escapePlainCarveInlineSyntax } from './carve-escape.js'

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
 * `marked`, a GFM implementation, renders all three as plain text: `a ==b== c`,
 * `a ^b^ c` and `a $x+y$ c` all come back unchanged.
 */
export interface MarkdownDialect {
  /** `==x==` is a highlight (Obsidian, Quarto, pandoc's `mark` extension). */
  highlight?: boolean
  /** `^x^` is a superscript (Pandoc). */
  superscript?: boolean
  /** `$x$` is inline math (Pandoc, and GitHub's own renderer). */
  math?: boolean
}

const COMMONMARK_GFM: MarkdownDialect = {}

function convertInline(input: string, dialect: MarkdownDialect = COMMONMARK_GFM): string {
  // Protect inline code spans so their delimiters are never rewritten.
  // Placeholders are wrapped in NUL bytes — which cannot occur in the source
  // text — so ordinary text like "P0" is never mistaken for a placeholder.
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
  line = escapePlainCarveInlineSyntax(line, { braced: '*_', bare: '*_~' })

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

  line = decodeHtmlEntities(line)

  // Restore stashes and protected spans until stable: a protected/stashed
  // span may itself contain placeholders (e.g. a reference-definition line
  // that wrapped an already-protected URL), so a single pass is not enough.
  let prev: string
  do {
    prev = line
    line = line
      // A stash/protect index that has no stored value means the NUL-wrapped
      // sentinel came from the input itself (not one we emitted), so keep the
      // matched text verbatim rather than splicing the literal string
      // "undefined" into the output.
      .replace(/\x00S(\d+)\x00/g, (m, i) => stash[Number(i)] ?? m)
      .replace(/\x00P(\d+)\x00/g, (m, i) => protectedSpans[Number(i)] ?? m)
  } while (line !== prev)
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

function restorePrefixedInlineRun(
  run: readonly PrefixedInlineLine[],
  dialect: MarkdownDialect,
): string[] {
  const converted = convertInline(run.map((part) => part.text).join('\n'), dialect).split('\n')
  return run.map((part, idx) => part.prefix + (converted[idx] ?? ''))
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

function collectBlockquoteInlineRun(
  lines: readonly string[],
  start: number,
  dialect: MarkdownDialect,
): {
  lines: string[]
  end: number
} {
  const run: PrefixedInlineLine[] = []
  let end = start
  while (end < lines.length) {
    const line = lines[end]!.replace(/^[ \t]{1,3}(?=>)/, '')
    const parsed = blockquotePrefix(line)
    if (!parsed || parsed.text.trim() === '') break
    run.push(parsed)
    end++
  }
  if (run.length === 0) return { lines: [lines[start]!.replace(/^[ \t]{1,3}(?=>)/, '')], end: start + 1 }
  return { lines: restorePrefixedInlineRun(run, dialect), end }
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
 */
function collectIndentedCode(lines: readonly string[], start: number): {
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
    if (!RE_MD_INDENTED_CODE.test(line)) break
    run.push(line)
    end = i + 1
  }

  const body = run
    .slice(0, end - start)
    .map((line) => (line.trim() === '' ? '' : line.replace(/^(?: {4}|\t)/, '')))
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body.join('\n')) + 1))
  const out = [fence, ...body, fence]
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

    run.push({ prefix: line.slice(0, contentCol), text: line.slice(contentCol) })
    end++
  }

  return { lines: restorePrefixedInlineRun(run, dialect), end }
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

function htmlBlockAt(lines: readonly string[], start: number): { lines: string[]; end: number } | null {
  const first = lines[start]!
  if (/^(?: {4,}|\t)/.test(first)) return null
  const trimmed = first.replace(/^ {0,3}/, '')
  const collectUntil = (endRe: RegExp, fallbackBlank: boolean): { lines: string[]; end: number } => {
    const block: string[] = []
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]!
      if (i > start && fallbackBlank && line.trim() === '') return { lines: block, end: i - 1 }
      block.push(line)
      if (endRe.test(line)) return { lines: block, end: i }
    }
    return { lines: block, end: lines.length - 1 }
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
  if (HTML_BLOCK_TAGS.has(tag.name)) {
    if (tag.selfClosing || tag.closing || new RegExp(`</${tag.name}\\s*>`, 'i').test(trimmed.slice(tag.end))) {
      return { lines: [first], end: start }
    }
    return collectUntil(new RegExp(`</${tag.name}\\s*>`, 'i'), true)
  }
  if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\s*\/?>\s*$/.test(trimmed)) {
    return { lines: [first], end: start }
  }
  return null
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
 */
export function markdownToCarve(
  markdown: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
): string {
  const allLines = markdown.replace(/\r\n?/g, '\n').split('\n')
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
      const marker = line.match(/^([ \t]*)(?:[-*+]|\d+[.)]) +/)
      const indent = line.length - line.replace(/^[ \t]+/, '').length
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
        while (listCols.length && listCols[listCols.length - 1]! > marker[1]!.length) listCols.pop()
        listCols.push(marker[0].length)
      } else if (trimmed !== '' && (wasPrevBlank || startsBlock)) {
        while (listCols.length && listCols[listCols.length - 1]! > indent) listCols.pop()
      }
    }

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
      const openerIndent = open[1]!.length
      const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
      fenceStrip = Math.max(0, openerIndent - contentCol)
      out.push(open[1]!.slice(fenceStrip) + open[2]! + info)
      prevType = 'code_fence'
      continue
    }

    // Inside a fence — a closer is a run of the same char at least as long as
    // the opener (indented by at most 3 spaces); a shorter inner run is code.
    if (inCode) {
      const dedented = fenceStrip > 0 ? line.replace(new RegExp(`^ {0,${fenceStrip}}`), '') : line
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

    // A Markdown INDENTED code block becomes a Carve FENCE. Carve has no
    // indented code block, so carrying the run through byte-for-byte did not
    // preserve it - it made the code a PARAGRAPH, and the code's own `*` and
    // `_` were then read as emphasis: `    let x = *not bold*` rendered as
    // `<p>let x = <strong>not bold</strong></p>`.
    //
    // The condition is unchanged, and it is what keeps this safe: the previous
    // line must be blank, so an indented line under a list item - which is item
    // continuation, not code - never reaches here.
    if (
      (wasPrevBlank || prevType === 'blank' || prevType === 'code') &&
      RE_MD_INDENTED_CODE.test(line)
    ) {
      const block = collectIndentedCode(lines, i)
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
          out.push(header)
          i++ // consume the delimiter row
          prevType = 'text'
          continue
        }
      }
    }

    const isBlank = trimmed === ''
    const isHeading = /^#{1,6}\s/.test(trimmed)
    const indent = line.length - line.replace(/^\s+/, '').length
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

    if (indent >= 4 && (prevType === 'blank' || prevType === 'code')) {
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
    // and consume the underline. Only at the top level (not list/quote/code).
    const underline = i + 1 < lines.length ? lines[i + 1]!.trim() : ''
    if (
      !isHeading &&
      !isBlockquote &&
      !isList &&
      // A line that is ITSELF a Markdown thematic break (`***`, `---`, …) is a
      // rule, not a setext heading text line. CommonMark: `***\n---` is two
      // thematic breaks, not an h2 titled `***`; guard so the rule falls
      // through to the thematic-break normalization below.
      !RE_MD_THEMATIC.test(line) &&
      (/^=+$/.test(underline) || /^-+$/.test(underline))
    ) {
      if (prevType !== 'blank' && prevType !== 'heading') out.push('')
      out.push(convertInline(`${underline[0] === '=' ? '#' : '##'} ${trimmed}`, dialect))
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
    if (RE_MD_THEMATIC.test(line)) {
      if (prevType !== 'blank' && out.length > 0) out.push('')
      out.push('---')
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
    const bqRule = line.match(/^ {0,3}((?:>[ \t]?){1,})(.*)$/)
    if (bqRule && RE_MD_THEMATIC.test(bqRule[2]!)) {
      const depth = (bqRule[1]!.match(/>/g) ?? []).length
      if (prevType !== 'blank' && prevType !== 'block_quote' && out.length > 0) out.push('')
      out.push('> '.repeat(depth) + '---')
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

    // Carve recognizes `#` headings and `>` blockquotes only at column 1, but
    // Markdown allows 1-3 spaces of indent — dedent so the block survives.
    // Lists are NOT dedented: Carve parses indented lists fine, and dedenting
    // only some items of an indented list would reparent its siblings.
    const dedent = indent >= 1 && indent <= 3 && (isHeading || isBlockquote)
    let body = dedent ? line.slice(indent) : line
    // Strip an ATX heading's optional closing `#` run (Carve keeps it as text).
    if (isHeading) body = body.replace(/[ \t]+#+[ \t]*$/, '')
    // Carve has no `+` bullet (it is the list-continuation marker); normalize a
    // Markdown `+` bullet to `-` so the converted list survives.
    if (isList) body = body.replace(/^(\s*)\+(\s)/, '$1-$2')
    if (isBlockquote) {
      const run = collectBlockquoteInlineRun(lines, i, dialect)
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
    out.push(convertInline(body, dialect))

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
