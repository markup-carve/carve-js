/*
 * Markdown -> Carve converter.
 */

import {
  escapeAttributeBlockOpener,
  escapePlainCarveInlineSyntax,
  escapeVerbatimDelimiter,
  HANDLED_MARKDOWN,
} from './carve-escape.js'
import {
  extractReferenceDefinitions,
  referenceDestinationLabel,
  unwrapEmptyDestinations,
  useEmptyDestinationReferences,
} from './markdown-empty-destination.js'
import { isTableRow, parse } from './parse.js'
import { escapeSpanMarkerPayload, padCell, renderCarve } from './render-carve.js'

/**
 * A code-fence opener or closer, read the way CommonMark reads one.
 */
const RE_MD_FENCE_LINE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/
/**
 * Whether a matched fence run and its info string open or close a fence at all.
 *
 * Split out so a caller that has already matched the line with its own indent
 * rule can ask the info-string question without re-matching.
 */
const fenceRunIsAFence = (run: string, info: string): boolean =>
  run[0] !== '`' || !info.includes('`')
/** Whether LINE is a Markdown code-fence opener or closer. */
const isMarkdownFenceLine = (line: string): boolean => {
  const m = RE_MD_FENCE_LINE.exec(line)
  return m !== null && columnWidth(m[1]!) <= 3 && fenceRunIsAFence(m[2]!, m[3]!)
}

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

/**
 * The fence `carve fmt` writes around a code body: backticks, one longer than
 * the longest backtick run anywhere in the body, three at least.
 */
function canonicalFence(body: readonly string[]): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(body.join('\n')) + 1))
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
 * Escape every hyphen of a `--` or `---` run, which Carve's smart typography
 * renders as an en or em dash and Markdown keeps as typed. The form is the one
 * the Carve writer uses for literal hyphens. A line that is only a thematic
 * break or a setext underline, alone or under its containers' markers, is
 * structure rather than text and keeps its hyphens.
 */
function escapeTypographicDashes(input: string): string {
  if (!input.includes('--')) return input
  return input
    .split('\n')
    .map((line, idx) => {
      let rest = line.replace(/^[ \t]*(?:>[ \t]?)*/, '')
      // An underline needs a paragraph line above it, so never on the first line.
      if (RE_MD_THEMATIC.test(rest) || (idx > 0 && /^ {0,3}-+[ \t]*$/.test(rest))) return line
      for (let m = RE_LIST_MARKER.exec(rest); m; m = RE_LIST_MARKER.exec(rest)) {
        rest = rest.slice(m[0].length)
        if (RE_MD_THEMATIC.test(rest)) return line
      }
      return line.replace(/(?<!\\)-{2,}/g, (run) => run.replace(/-/g, '\\-'))
    })
    .join('\n')
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

/**
 * @param holdsFenceBody The caller handed a run whose first line opens a code
 *   fence, so its backticks are that fence rather than literal prose text. See
 *   `restorePrefixedInlineRun`, the only caller that passes it.
 */
function convertInline(
  input: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
  holdsFenceBody = false,
  taskBox = false,
): string {
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
  line = escapeCarveOnlyMarker(line)
  // A definition cannot interrupt a Markdown paragraph, but it does interrupt a
  // Carve one, so a continuation line shaped like one is escaped (carve-js#1812).
  line = line.replace(/\n([ \t]*)\[(?=[^^\]\n][^\]\n]*\]:)/g, '\n$1\\[')

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

  line = unwrapEmptyDestinations(line, protectedSpans, protect, decodeHtmlEntitiesRaw)

  // Normalize a `(dest "title")` part: Carve's link parser closes the
  // destination at the first `)`, so balanced parens in the URL are
  // percent-encoded (Titan_(moon) -> Titan_%28moon%29).
  const encodeDest = (paren: string): string => {
    // Spaces and tabs around a destination are not part of it (CommonMark 6.3).
    const inner = paren.slice(1, -1).replace(/^[ \t]+|[ \t]+$/g, '')
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
  // path is literal, so protect it before the emphasis passes. Carve does not
  // link a bare URL, so it is text, and a hyphen run in it is escaped like
  // any other.
  line = line.replace(/\bhttps?:\/\/[^\s<>`]+/g, (url) =>
    protect(url.replace(/(?<!\\)-{2,}/g, (run) => run.replace(/-/g, '\\-'))),
  )

  line = line.replace(/(?<![!\\\]])\[([^[\]\n]+)\](?![\[(])/g, (match, label: string, offset: number, source: string) => {
    const before = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset)
    if (source[offset + match.length] === ':' && /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t]*$/.test(before)) return match
    if (/^[ xX]$/.test(label) && ((taskBox && offset === 0) ||
      /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+$/.test(before))) return match
    const destinationLabel = referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans)
    if (destinationLabel === undefined) return match
    return `${match}${protect(label === destinationLabel && /^[\w\s-]+$/u.test(label) ? '[]' : `[${destinationLabel}]`)}`
  })

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
  // A backtick and an attribute-block brace are ordinary text in CommonMark and
  // GFM, and both are markup in Carve. They are escaped by the two shared
  // helpers the BBCode converter already calls, in the same composition order it
  // uses - the helpers FIRST, then the delimiter escaper - because that order is
  // what also escapes the `#`: the tag rule below declines a `#` that an
  // UNESCAPED `{` precedes, on the premise that the braced-pair rule handled it.
  // Escaping the brace first is what takes that premise away, so the reverse
  // order left `\{` in front of a LIVE tag span (the same trap
  // `escapeAttributeListsThatAttach` documents).
  //
  // A backtick reaching here is, by construction, one CommonMark reads as
  // literal text. `protectCodeSpans` above turned every MATCHED run into a
  // placeholder and emitted only the unterminated ones as text, so a genuine
  // code span is out of reach and cannot be frozen. That construction is what
  // makes the premise these helpers carried - that a backtick in Markdown
  // already means a code span the converter carries over - true of a matched
  // backtick and false of an unmatched one. An unmatched one is not literal text
  // in Carve: it opens a verbatim span that runs to the END of the block, so a
  // single stray backtick in migrated prose swallowed the rest of the line.
  if (!holdsFenceBody) line = escapeVerbatimDelimiter(line)
  // `{#id}` is ordinary text in CommonMark, where in Djot it is a deliberate
  // attribute block - which is why `djotToCarve` is right to leave it and this
  // path is not, and why the escape belongs at the CALL SITE rather than in the
  // shared escaper. Gated on the same flag as `escapeAttributeListsThatAttach`
  // below: with `attributes` on, `{#id}` is the Pandoc/kramdown syntax the
  // caller opted into and freezing it would lose the id. That rule escapes a
  // brace that ATTACHES to the construct before it, and one alone on a line;
  // mid-prose, attaching to nothing, was the position neither reached.
  if (!dialect.attributes) line = escapeAttributeBlockOpener(line)
  line = escapePlainCarveInlineSyntax(line, HANDLED_MARKDOWN)
  // Numeric references are decoded below. Keep their hash available to that
  // pass even though the standalone escaper freezes it.
  line = line.replace(/&\\#(?=(?:[0-9]+|[xX][0-9A-Fa-f]+);)/g, '&#')
  line = escapeCarveConstructsSpelledLikeText(line, dialect, protectedSpans)
  if (!holdsFenceBody) line = escapeTypographicDashes(line)

  // Converted strong / bold-italic are stashed behind placeholders so their
  // single `*` / `/` are not re-matched by the emphasis passes below.
  const stash: string[] = []
  const hold = (s: string) => {
    stash.push(s)
    return `\x00S${stash.length - 1}\x00`
  }

  // Whether a run at `offset` has an alphanumeric neighbor, so it opens or
  // closes INTRAWORD. Carve's bare markers do not open there and its braced
  // forms do, so that is the spelling Markdown's intraword emphasis takes
  // (carve-js#2031). `*` can open intraword in Markdown and `_` cannot, which
  // is why only the star passes below drop their boundary guard.
  const intraword = (full: string, offset: number, length: number): boolean =>
    /[A-Za-z0-9]/.test(full[offset - 1] ?? '') || /[A-Za-z0-9]/.test(full[offset + length] ?? '')
  const wrap = (open: string, body: string, close: string, braced: boolean): string =>
    braced ? `{${open}${body}${close}}` : `${open}${body}${close}`

  // Recursively convert *em* / _em_ nested inside a strong/bold-italic span to
  // /em/ (so a nested `_x_` becomes `/x/`, not Carve underline).
  const convertNestedEm = (inner: string): string =>
    inner
      .replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, (match, body: string, at: number, full: string) =>
        wrap('/', body, '/', intraword(full, at, match.length)))
      .replace(/(?<![A-Za-z0-9_])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9_])/g, '/$1/')

  // ***bold italic*** / ___bold italic___ -> /*x*/ (Carve's canonical
  // bold-italic). The underscore form needs word boundaries: CommonMark `_`
  // cannot open/close emphasis intraword (foo___bar___baz stays literal).
  line = line.replace(/\*{3}(?!\s)([\s\S]+?)(?<!\s)\*{3}/g, (match, inner: string, at: number, full: string) =>
    hold(wrap('/*', convertNestedEm(inner), '*/', intraword(full, at, match.length))),
  )
  line = line.replace(
    /(?<![A-Za-z0-9])___(?!\s)([\s\S]+?)(?<!\s)___(?![A-Za-z0-9])/g,
    (_m, inner: string) => hold(`/*${convertNestedEm(inner)}*/`),
  )

  // **strong** -> *strong*, braced where it opens intraword. Written bare there
  // it was no strong at all AND the run came out one star shorter, so a reader
  // saw `a*b*c` where the source said `a**b**c` (carve-js#2031).
  line = line.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, (match, inner: string, at: number, full: string) =>
    hold(wrap('*', convertNestedEm(inner), '*', intraword(full, at, match.length))),
  )

  // __strong__ -> *strong* (word-boundary: intraword `_` is literal)
  line = line.replace(
    /(?<![A-Za-z0-9])__(?!\s)([\s\S]+?)(?<!\s)__(?![A-Za-z0-9])/g,
    (_m, inner: string) => hold(`*${convertNestedEm(inner)}*`),
  )

  // *emphasis* -> /emphasis/, and `{/emphasis/}` where it opens intraword, which
  // `/` cannot do bare. `2 * 3` stays literal on the whitespace guards alone.
  line = line.replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, (match, body: string, at: number, full: string) =>
    wrap('/', body, '/', intraword(full, at, match.length)))

  // _emphasis_ -> /emphasis/ (word-boundary, so snake_case is left alone)
  line = line.replace(
    /(?<![A-Za-z0-9_])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9_])/g,
    '/$1/',
  )

  // ~~strikethrough~~ -> ~strikethrough~, braced intraword: bare there it was no
  // strikethrough and the run lost a tilde as well.
  line = line.replace(/~~([^~]+)~~/g, (match, body: string, at: number, full: string) =>
    wrap('~', body, '~', intraword(full, at, match.length)))

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

/** Escape list markers accepted by Carve but read as text by Markdown. */
function escapeCarveOnlyMarker(input: string): string {
  return input.replace(
    /^((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)*)(?:(\d{10,}|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)([.)])|(\.))(?=[ \t]|$|\{)/gm,
    (_match, prefix: string, label: string | undefined, delimiter: string | undefined, bareDot: string | undefined) =>
      `${prefix}${label ?? ''}\\${delimiter ?? bareDot}`,
  )
}

/** Catch text lines carried through a block collector without inline conversion. */
function escapeCarveOnlyMarkersOutsideFences(input: string): string {
  const protectedSpans: string[] = []
  const protectedInput = protectCodeSpans(input, (span) => {
    protectedSpans.push(span)
    return `\x00P${protectedSpans.length - 1}\x00`
  })
  let fence: { marker: string; length: number } | null = null
  return protectedInput.split('\n').map((line) => {
    const body = line.replace(/^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t]*/, '')
    const run = /^(`{3,}|~{3,})/.exec(body)?.[1]
    if (fence !== null) {
      if (run && run[0] === fence.marker && run.length >= fence.length && body.slice(run.length).trim() === '') fence = null
      return line
    }
    if (run) {
      fence = { marker: run[0]!, length: run.length }
      return line
    }
    return escapeCarveOnlyMarker(line)
  }).join('\n').replace(/\x00P(\d+)\x00/g, (match, index: string) => protectedSpans[Number(index)] ?? match)
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

/**
 * One table row in the spelling `carve fmt` writes, each cell through the
 * formatter's own cell writer: padding collapsed, and a lone `<` or `^` escaped
 * so it stays text rather than becoming a span marker.
 *
 * `width` is the header's column count. GFM drops a body row's cells past it
 * and pads a short row with empty cells, while a Carve row keeps the cells it
 * spells, so the row is fitted here.
 */
function writeTableRow(
  cells: readonly string[],
  prefixes: readonly string[],
  dialect: MarkdownDialect,
  width: number = cells.length,
): string {
  let row = ''
  for (let c = 0; c < width; c++) {
    const cell = convertInline(unescapePipesInCodeSpans(cells[c] ?? ''), dialect)
    row += '|' + padCell(prefixes[c] ?? '', escapeSpanMarkerPayload(cell))
  }
  return row + '|'
}

/**
 * What the importer could not represent, in the shared migration report's
 * vocabulary (docs/migration-results.md). `migrateMarkdown` carries these out
 * as diagnostics; `markdownToCarve` returns the source alone.
 */
export interface MarkdownImportLoss {
  code: 'structure-unspellable'
  message: string
}

let importLosses: MarkdownImportLoss[] = []

/**
 * Whether `row` is a row the parser reads back as a table row - the same
 * predicate `parseTable` gates on, so the importer cannot drop a row Carve
 * would have accepted or keep one it refuses.
 *
 * A row whose every cell is blank is not a table row (markup-carve/carve#1954).
 * GFM reads one as an empty row, and written out as `| | |` Carve reads a
 * paragraph, which splits the table in two (carve-js#1919). The row is dropped
 * and reported rather than filled with a cell the author never wrote: an
 * invented value round-trips back out as if it were theirs, and an honest
 * omission with a report beats a wrong value.
 *
 * The row is reported WITHOUT a position. A document-order table index would
 * be wrong wherever the converter leaves a table alone - a table two container
 * levels down reaches `restorePrefixedInlineRun`'s unmodellable return, stays
 * a table in the output, and is never counted - and a source line cannot be
 * had either, since the container runs are folded and re-spelled before a row
 * is written. Only the drop itself is exact, so only the drop is reported.
 */
function keepTableRow(row: string): boolean {
  if (isTableRow(row)) return true
  // No cell of a blank row can hold an escaped pipe, so splitting counts them.
  const cells = row.split('|').length - 2
  importLosses.push({
    code: 'structure-unspellable',
    message: `Dropped a table row of ${cells} blank cells; Carve spells no row whose every cell is blank`,
  })
  return false
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

/**
 * The ATX marker for the setext heading whose paragraph ends on `lines[index]`
 * in the container holding its content at `contentCol`, or null when the line
 * under it is no underline there. `held` says the line is already known to be
 * paragraph text.
 */
function setextParagraphEnd(lines: readonly string[], index: number, contentCol: number, held = false): string | null {
  const line = stripColumns(lines[index]!, contentCol)
  const below = lines[index + 1]!
  const underline = below.trim()
  if (!/^(?:=+|-+)$/.test(underline) || indentColumns(below) < contentCol) return null
  if (indentColumns(stripColumns(below, contentCol)) >= 4) return null
  if (held) return underline[0] === '=' ? '#' : '##'
  // No link-reference test here, though the line is the one being taken INTO the
  // heading: this is only ever asked about a line under an open paragraph, and a
  // link reference definition cannot interrupt a paragraph at any indent, so
  // there it is continuation text. Refusing it lost the heading and made a
  // second one out of the definition line (carve-js#2016). A construct that CAN
  // interrupt is still refused, by the two tests that remain.
  if (RE_MD_THEMATIC.test(line) || !isParagraphRunLine([line.trim()], 0, 'text')) return null
  return underline[0] === '=' ? '#' : '##'
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
  if (isMarkdownFenceLine(trimmed)) return false
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

/** `text` with each pipe row in it kept as paragraph text, inside quote markers too. */
function keepPipeRowsLiteral(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const body = peelQuoteMarkers(line.trimStart()).body.replace(/^(?:(?:[-*+]|\d{1,9}[.)]) +)*/, '')
      return isStandardTableRow(body) ? line.slice(0, line.length - body.length) + keepPipeRowLiteral(body) : line
    })
    .join('\n')
}

function isParagraphRunLine(
  lines: readonly string[],
  index: number,
  prevType: 'blank' | 'heading' | 'list' | 'block_quote' | 'code_fence' | 'code' | 'text',
): boolean {
  const line = lines[index]!
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (isMarkdownFenceLine(line)) return false
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
  // Continues the paragraph above lazily or from four columns past its
  // container, so it cannot be the delimiter row of a table.
  continued?: boolean | undefined
  // The paragraph body the collector escaped, without that escape, for a setext
  // fold to write instead: the escape guards a marker at the start of a line,
  // and a folded heading is one line with the marker in its middle, where it
  // opens nothing (carve#2244).
  bareBody?: string | undefined
}

const RE_LIST_MARKER = /^([ \t]*)(?:[-*+]|\d+[.)]) +/

/** A line opening with a list marker, padded with spaces or tabs. */
const RE_ITEM_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/

/**
 * The item markers and task checkbox a line opens with, as CARVE reads them:
 * any nesting of item markers, the innermost a `-` or `*` bullet, then a box.
 * Mirrors `RE_TASK` in the parser, which takes `[ xX-_>?]` and neither `+` nor
 * an ordered marker.
 *
 * Markdown's own reading stops at the bullet: the box is the first paragraph's
 * text there, so what follows it opened no block. Carve's reading does not, so
 * what follows the box stands at a content position, and a marker there opens
 * exactly what the source said was text.
 */
const RE_CARVE_TASK_LEAD = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*?[-*][ \t]+)\[[ xX\-_>?]\][ \t]+/

/**
 * `content` is the item's content column in the source and `shift` how far the
 * import moves it: the sum of every enclosing item's change of marker width.
 */
type OpenList = {
  col: number
  content: number
  shift: number
  outer: number
  kind: string
  bullet: string
  next: number
  restart?: boolean
}

/**
 * Writes list item markers the way `carve fmt` does, one container at a time.
 *
 * Ordered items are numbered on from the list's first number. A bullet or
 * delimiter change starts a new list in GFM as in Carve, so `separate` asks
 * for the blank line fmt puts between the two; and since `+` is written as `-`,
 * a new list whose bullet would come out the same as the list above flips to
 * `*`, or the two would merge.
 *
 * A number of another width moves the item's content column. The caller moves
 * the lines the item holds with it, by what `shiftAt` answers for them.
 */
class ListMarkers {
  private open: OpenList[] = []

  /** A block at `col` ends every list whose items sit at or past it. */
  end(col: number): void {
    while (this.open.length > 0 && this.open.at(-1)!.col >= col) this.open.pop()
  }

  /**
   * A line at `col` outside the open items ends the lists holding them. They
   * stay open for spacing, but an item after them numbers from its own marker.
   */
  leave(col: number): void {
    for (const list of this.open) if (list.content > col) list.restart = true
  }

  /** The innermost open item holding a line indented `col` columns in the source. */
  itemAt(col: number): OpenList | undefined {
    for (let at = this.open.length - 1; at >= 0; at--) if (this.open[at]!.content <= col) return this.open[at]
    return undefined
  }

  /** Whether a list of `kind` (bullet or delimiter) is open with its markers at `col`. */
  continues(col: number, kind: string): boolean {
    return this.open.some((list) => list.col === col && list.kind === kind)
  }

  /** Whether a marker at `col` would belong to an open list's level. */
  hasListAt(col: number): boolean {
    return this.levelAt(col) !== undefined
  }

  /**
   * The open list a marker at `col` belongs to the level of: the list open
   * directly in the item holding the marker, when the marker is within three
   * columns of that item's content.
   */
  private levelAt(col: number): OpenList | undefined {
    let parent = this.open.length - 1
    while (parent >= 0 && this.open[parent]!.content > col) parent--
    const level = this.open[parent + 1]
    return level !== undefined && col - (this.open[parent]?.content ?? 0) <= 3 ? level : undefined
  }

  /**
   * Whether a line indented `col` columns, left of an open item's content in
   * the source, reaches it once the item's content column has moved left.
   */
  reachedByMove(col: number): boolean {
    return this.open.some((list) => col < list.content && col >= list.content + list.shift)
  }

  /** How far a line indented `col` columns in the source moves. */
  shiftAt(col: number): number {
    return this.itemAt(col)?.shift ?? 0
  }

  /**
   * `outer` is how far the marker line itself moves, `shift` how far the lines
   * the item holds do.
   */
  write(line: string, onePad = false): { line: string; separate: boolean; outer: number; shift: number } {
    const m = /^([ \t]*)(?:([-*+])|(\d+)([.)]))(?=[ \t])/.exec(line)
    if (!m) return { line, separate: false, outer: 0, shift: 0 }
    const col = columnWidth(m[1]!)
    // The item holding the marker, and the list open directly in it. A marker
    // up to three columns past that item's content belongs to that list's
    // level, wherever the list's own markers sit (CommonMark 5.2): with the
    // same bullet or delimiter it is the next item, otherwise it starts a list
    // apart from it.
    let parent = this.open.length - 1
    while (parent >= 0 && this.open[parent]!.content > col) parent--
    const level = this.open[parent + 1]
    this.open.length = parent + 1
    const slack = col - (this.open[parent]?.content ?? 0)
    const prev = level !== undefined && slack <= 3 ? level : undefined
    const kind = m[2] ?? m[4]!
    const same = prev !== undefined && prev.kind === kind
    // A sibling goes where its list's markers were written, and a new list to
    // its container's content column, without the slack.
    const outer = same ? prev.col + prev.outer - col : this.shiftAt(col) - (slack <= 3 ? slack : 0)
    let marker: string
    let bullet = ''
    let next = 0
    if (m[2] !== undefined) {
      bullet = same ? prev.bullet : m[2] === '+' ? '-' : m[2]
      if (!same && prev?.bullet === bullet) bullet = bullet === '-' ? '*' : '-'
      marker = bullet
    } else {
      const number = same && !prev.restart ? prev.next : Number(m[3])
      marker = String(number) + m[4]!
      next = number + 1
    }
    // Two to four spaces of padding are written as one when asked, as fmt
    // writes them.
    const pad = onePad ? (/^ {2,4}(?=\S)/.exec(line.slice(m[0].length))?.[0].length ?? 1) : 1
    const shift = outer + marker.length - (m[0].length - m[1]!.length) - (pad - 1)
    const content = columnWidth(RE_LIST_MARKER.exec(line)?.[0] ?? m[0])
    this.open.push({ col, content, shift, outer, kind, bullet, next })
    // Items the first line nests (`- - a`) are written as they are, and move
    // with this one.
    const own = RE_LIST_MARKER.exec(line)?.[0].length ?? m[0].length
    for (const inner of nestedItemsOnLine(line, own)) {
      this.open.push({
        col: inner.col,
        content: inner.content,
        shift,
        outer: shift,
        kind: inner.kind,
        bullet: inner.bullet === '+' ? '-' : (inner.bullet ?? ''),
        next: inner.number === undefined ? 0 : Number(inner.number) + 1,
      })
    }
    return {
      line: m[1]! + marker + line.slice(m[0].length + pad - 1),
      separate: prev !== undefined && !same,
      outer,
      shift,
    }
  }
}

/**
 * The items a list line nests past the character `from` on its first line
 * (`- - a`), with their marker and content columns and where each ends.
 */
function nestedItemsOnLine(
  line: string,
  from: number,
): Array<{ col: number; content: number; kind: string; bullet?: string; number?: string; end: number }> {
  const items: Array<{ col: number; content: number; kind: string; bullet?: string; number?: string; end: number }> = []
  // Past four columns of padding a marker's content is indented code, which
  // nests nothing (CommonMark 5.2).
  const padded = (start: number, end: number): boolean =>
    columnWidth(line.slice(0, end)) - columnWidth(line.slice(0, start)) > 4
  const own = /^[ \t]*(?:[-*+]|\d{1,9}[.)])/.exec(line)
  if (own && padded(own[0].length, from)) return items
  let at = from
  for (;;) {
    // A thematic break wins over a list item (`- * * *`).
    if (RE_MD_THEMATIC.test(line.slice(at))) return items
    const m = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(?=\S)/.exec(line.slice(at))
    if (!m) return items
    const markerEnd = at + m[0].length - m[5]!.length
    if (padded(markerEnd, at + m[0].length)) return items
    items.push({
      col: columnWidth(line.slice(0, at + m[1]!.length)),
      content: columnWidth(line.slice(0, at + m[0].length)),
      kind: m[2] ?? m[4]!,
      bullet: m[2],
      number: m[3],
      end: at + m[0].length,
    })
    at += m[0].length
  }
}

/**
 * `line` with its indent and the padding after each marker it opens with
 * written as the spaces they span. CommonMark counts a tab there to the next
 * tab stop, and Carve reads no tab after a marker.
 */
function spaceMarkerPadding(line: string): string {
  const indent = /^[ \t]*/.exec(line)![0]
  let out = ' '.repeat(columnWidth(indent)) + line.slice(indent.length)
  let at = 0
  for (;;) {
    const m = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/.exec(out.slice(at))
    if (!m) return out
    const padAt = at + m[0].length - m[2]!.length
    const width = columnWidth(out.slice(0, at + m[0].length)) - columnWidth(out.slice(0, padAt))
    out = out.slice(0, padAt) + ' '.repeat(width) + out.slice(at + m[0].length)
    // Past four columns the rest is indented code, which nests no marker.
    if (width > 4) return out
    at = padAt + width
  }
}

/**
 * The content column of the item a marker match (`- `, `1.  `) opens. Five or
 * more columns of padding put it one column past the marker, the rest being
 * indented code (CommonMark 5.2).
 */
function itemContentColumn(prefix: string): number {
  const marker = columnWidth(prefix.replace(/[ \t]+$/, ''))
  const content = columnWidth(prefix)
  return content - marker > 4 ? marker + 1 : content
}

/**
 * An item whose first line is indented code, written as a fence in the item:
 * the code on the marker line and the lines four columns past the item's
 * content under it, blank lines between them included.
 */
function collectItemIndentedCode(
  lines: readonly string[],
  start: number,
  markerEnd: number,
): { lines: string[]; end: number; verbatimFrom: number } {
  const first = lines[start]!
  const prefix = first.slice(0, markerEnd) + ' '
  const contentCol = columnWidth(prefix)
  const code = [first.slice(markerEnd + 5)]
  let end = start + 1
  let blanks = 0
  for (let at = end; at < lines.length; at++) {
    const line = lines[at]!
    if (line.trim() === '') {
      blanks++
      continue
    }
    if (indentColumns(line) < contentCol + 4) break
    code.push(...new Array<string>(blanks).fill(''), stripColumns(line, contentCol + 4))
    blanks = 0
    end = at + 1
  }
  const pad = ' '.repeat(contentCol)
  const fence = canonicalFence(code)
  return {
    lines: [prefix + fence, ...code.map((text) => (text === '' ? '' : pad + text)), pad + fence],
    end,
    verbatimFrom: 1,
  }
}

/**
 * `line` with its first `from` columns of indent written as `to` spaces, so a
 * line an item holds follows the item's moved content column. What sits past
 * `from` is kept byte for byte; a blank line stays as it is.
 */
function moveIndent(line: string, from: number, to: number): string {
  if (from === to || line.trim() === '' || indentColumns(line) < from) return line
  return ' '.repeat(Math.max(0, to)) + stripColumns(line, from)
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
  const opensFence = isMarkdownFenceLine(run[0]?.text ?? '')
  const converted = convertInline(
    run.map((part) => part.text).join('\n'),
    dialect,
    opensFence,
    /^\s*(?:[-*+]|\d{1,9}[.)])\s+$/.test(run[0]?.prefix ?? ''),
  ).split('\n')
  const held = heldByItem(run)
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

  const container = run.map(
    (part, idx) => `${part.prefix.length}:${quoteDepth(held[idx]!.marker)}:${held[idx]!.marker.length}`,
  )
  const inTable = new Array<boolean>(run.length).fill(false)
  for (let start = 0; start < run.length; ) {
    let end = start + 1
    while (end < run.length && container[end] === container[start] && !run[end]!.continued) end++
    const flags = gfmTableRowLines(held.slice(start, end).map((part) => part.body))
    for (let offset = 0; offset < flags.length; offset++) inTable[start + offset] = flags[offset]!
    start = end
  }

  const out: string[] = []
  let tableWidth = 0
  for (let idx = 0; idx < run.length; idx++) {
    const part = run[idx]!
    const line = converted[idx] ?? ''
    if (inTable[idx]) {
      // The same rows the document-level table branch writes: a native `|=`
      // header in place of the header and delimiter rows, then each body row
      // rebuilt, so a table a container holds is canonical too.
      const { marker, body } = held[idx]!
      if (idx === 0 || !inTable[idx - 1] || container[idx - 1] !== container[idx]) {
        const headers = splitTableRow(held[idx + 1]!.body.trim()).map((cell) => `=${alignMarker(cell)}`)
        tableWidth = headers.length
        const header = writeTableRow(splitTableRow(body.trim()), headers, dialect)
        if (keepTableRow(header)) out.push(part.prefix + marker + header)
        idx++ // consume the delimiter row
        continue
      }
      const row = writeTableRow(splitTableRow(body.trim()), [], dialect, tableWidth)
      if (keepTableRow(row)) out.push(part.prefix + marker + row)
      continue
    }
    // The same containers `held` peeled, so a row a quoted item holds is
    // escaped at the item's column as well.
    const { marker } = held[idx]!
    const body = line.startsWith(marker) ? line.slice(marker.length) : peelQuoteMarkers(line).body
    const kept = line.slice(0, line.length - body.length)

    out.push(part.prefix + (isStandardTableRow(body) ? kept + keepPipeRowLiteral(body) : line))
  }
  return out
}

/**
 * `peelQuoteMarkers` for each line of a run, with one level of list item a
 * quote holds peeled too: the item's marker, and the same columns under it, go
 * to `marker`, so a table inside a quoted item is found at the item's column.
 */
function heldByItem(run: readonly PrefixedInlineLine[]): Array<{ marker: string; body: string }> {
  let itemCol = 0
  let itemKey = ''
  return run.map((part) => {
    const held = peelQuoteMarkers(part.text)
    const key = `${part.prefix.length}:${held.marker}`
    if (key !== itemKey) {
      itemCol = 0
      itemKey = key
    }
    const item = /^(?:[-*+]|\d+[.)]) {1,4}(?=\S)/.exec(held.body)
    if (item) {
      itemCol = item[0].length
      return { marker: held.marker + item[0], body: held.body.slice(itemCol) }
    }
    if (itemCol > 0 && indentColumns(held.body) >= itemCol) {
      return { marker: held.marker + ' '.repeat(itemCol), body: stripColumns(held.body, itemCol) }
    }
    itemCol = 0
    return held
  })
}

/**
 * An entry of a container run as the container holds it: `key` names the
 * container (what the collector consumed, the item columns still on the text,
 * and the quote markers inside them), `text` is what is left inside it, `lead`
 * the item markers or columns peeled off in front of the quote and `quote` the
 * quote markers themselves.
 *
 * The item collector consumes only the OUTERMOST marker into `prefix`, so one
 * item of depth leaves `> foo` on the text and two leave `- > foo` over
 * `  > bar`. Read without peeling, the deeper quote was not a quote at all: the
 * key said "no container", every line of the quote's paragraph disagreed with
 * every other, and no paragraph was registered inside it - so the fold below
 * could not see one (carve-js#2022). Peeling makes the reading depth-
 * independent, and the peeled WIDTH joins the key so two different items stay
 * two containers.
 *
 * Only where peeling reveals a quote. A lead peeled unconditionally would take
 * the item markers `paragraphLine` reads for the paragraph's column and
 * `RE_ITEM_LINE` reads for the item stack, which are the same markers.
 *
 * And not on a CONTINUED line, where a quote marker four columns in is text of
 * the paragraph above rather than a marker - the same reading that keeps a
 * fence opener out of the fold's closer test. Peeled there, `>     > bar` under
 * `> foo` read as a quote inside the quote and took its own paragraph out of
 * the fold.
 */
function heldInContainer(part: PrefixedInlineLine): { key: string; text: string; lead: string; quote: string } {
  const quoted = blockquotePrefix(part.text)
  if (quoted !== null) return { key: `${part.prefix.length}:0:${quoted.prefix}`, text: quoted.text, lead: '', quote: quoted.prefix }
  if (part.continued === true) return { key: `${part.prefix.length}:0:`, text: part.text, lead: '', quote: '' }
  const lead = RE_ITEM_LEAD.exec(part.text)![0]
  const inner = lead === '' ? null : blockquotePrefix(part.text.slice(lead.length))
  if (inner !== null) {
    return { key: `${part.prefix.length}:${columnWidth(lead)}:${inner.prefix}`, text: inner.text, lead, quote: inner.prefix }
  }
  return { key: `${part.prefix.length}:0:`, text: part.text, lead: '', quote: '' }
}

/**
 * The paragraph text an entry holds: the item markers it opens with, if any,
 * and the text past them. Null when the entry is not paragraph text - a
 * heading, a link reference definition, or anything else that opens a block.
 */
function paragraphLine(part: PrefixedInlineLine, text: string): { lead: string; body: string } | null {
  // A continued line opens nothing, so it is paragraph text whatever it is
  // shaped like, and the markers on it are text rather than markers. Asking the
  // tests below anyway refused a heading marker and a link reference outright,
  // and peeled an item marker off the text (carve-js#2008).
  if (part.continued) return text.trim() === '' ? null : { lead: '', body: text.trim() }
  const marker = RE_ITEM_LEAD.exec(text)![0]
  const opens = RE_ITEM_LINE.test(text)
  const body = (opens ? text.slice(marker.length) : text).trim()
  if (body === '' || /^#{1,6}([ \t]|$)/.test(body)) return null
  // No link-reference test, though a definition opening a paragraph must not
  // become a heading: the definition prepass lifts every definition out of a
  // container before this runs, so by here one can only be continuation text,
  // and a definition cannot interrupt a paragraph at any indent anyway. Gating
  // the test on an open paragraph instead left a branch no input reaches
  // (carve-js#2016).
  // `blank`, not `text`: after a blank an ordered marker of any number opens a
  // list, which is the reading that rejects the fold.
  if (!isParagraphRunLine([body], 0, 'blank')) return null
  return { lead: opens ? marker : '', body }
}

/**
 * A line of a setext heading's paragraph as a piece of the one-line heading:
 * trimmed, and without the hard break it may end in.
 */
function headingLine(line: string): string {
  return line.trim().replace(/(?<!\\)((?:\\\\)*)\\$/, '$1').trimEnd()
}

/** The indent and item markers a line opens with (`- - `, `  1. `). */
const RE_ITEM_LEAD = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/

/**
 * Rewrite every setext heading a collected container run holds into the ATX
 * line Carve spells it with.
 *
 * The run is already the container's content with its marker held separately,
 * so a setext heading is the paragraph's entries and the underline under them.
 * Every line of the paragraph has to sit in the underline's container, and the
 * container shows up in two places. The collector has already put what it
 * consumed in `prefix`, and two lines it consumed the same width of are two
 * lines it holds - `- ` and the `  ` under it are one item, while the quote
 * collector's `> > ` and `> ` are two different quotes, so `> > T` over `> ===`
 * is not a heading (the underline is a lazy continuation of the inner
 * paragraph there). What the collector did NOT consume is peeled here: quote
 * markers still on the text have to match, and item markers on the
 * paragraph's first line (`- - T`, or `- T` in a quote) put the paragraph in
 * that item, so the underline has to reach the item's content column. Left of
 * it the underline is outside the item and a thematic break.
 *
 * A Carve heading is one line, so a paragraph of several lines becomes one
 * heading with its lines joined by a space, the text CommonMark's multi-line
 * heading renders. Four columns past the paragraph's column is code rather
 * than an underline, and a lazy line or a line in a fence body is none either.
 * Folding needs no blank line after it: a heading interrupts a paragraph
 * inside a quote and inside a list item alike.
 */
function foldContainerSetext(run: readonly PrefixedInlineLine[]): PrefixedInlineLine[] {
  const out: PrefixedInlineLine[] = []
  // Where the paragraph each entry of `out` is a line of starts, or -1.
  const starts: number[] = []
  // Per container, the content columns of the items opened in it, innermost
  // last; an item hides every earlier one at or right of its column.
  const items = new Map<string, number[]>()
  let closer: { prefix: string; test: RegExp } | null = null
  for (const part of run) {
    const { key, text } = heldInContainer(part)
    const inner = text.replace(RE_ITEM_LEAD, '')
    if (closer !== null) {
      if (part.prefix !== closer.prefix || closer.test.test(inner)) closer = null
      out.push(part)
      starts.push(-1)
      continue
    }
    // `inner` has the line's indent stripped, so a continued line four columns
    // in read as a fence opener and took the paragraph out of the fold. It
    // opens nothing there, fence included (carve-js#2008).
    const open = part.continued === true ? null : RE_MD_FENCE_LINE.exec(inner)
    if (open && fenceRunIsAFence(open[2]!, open[3]!)) {
      closer = { prefix: part.prefix, test: new RegExp(`^ {0,3}${open[2]![0]}{${open[2]!.length},}[ \t]*$`) }
      out.push(part)
      starts.push(-1)
      continue
    }
    const rule = /^[ \t]*(=+|-+)[ \t]*$/.exec(text)
    const start = starts.at(-1) ?? -1
    if (rule && !part.continued && start >= 0 && heldInContainer(out.at(-1)!).key === key) {
      const held = heldInContainer(out[start]!)
      const first = held.text
      const lead = paragraphLine(out[start]!, first)!.lead
      // The paragraph's column: past its own item markers, or the content
      // column of the innermost item holding its first line. Markers peeled in
      // FRONT of a quote stand outside it and add no column inside it, which is
      // why they are `held.lead` here rather than part of `lead`.
      let col = columnWidth(lead)
      if (lead === '') for (const content of items.get(key) ?? []) if (content <= indentColumns(first)) col = content
      const at = indentColumns(text)
      if ((lead !== '' || indentColumns(first) - col < 4) && at >= col && at - col < 4) {
        const quote = heldInContainer(part).quote
        const indent = lead !== '' ? lead : /^[ \t]*/.exec(first)![0]
        const body = out
          .slice(start)
          // The collector's escape guarded a marker standing at the start of a
          // line; in the heading that marker sits in the middle of one line and
          // opens nothing, so the bare body is what gets written.
          .map((entry) => headingLine(entry.bareBody ?? paragraphLine(entry, heldInContainer(entry).text)!.body))
          .join(' ')
        const heading = `${held.lead}${quote}${indent}${rule[1]![0] === '=' ? '#' : '##'} ${body}`
        out.splice(start, out.length - start, { prefix: out[start]!.prefix, text: heading })
        starts.splice(start, starts.length - start, -1)
        continue
      }
    }
    const line = paragraphLine(part, text)
    const continues = line !== null && line.lead === '' && start >= 0 && heldInContainer(out.at(-1)!).key === key
    if (RE_ITEM_LINE.test(text)) {
      const content = columnWidth(RE_ITEM_LEAD.exec(text)![0])
      const open = (items.get(key) ?? []).filter((c) => c < content)
      items.set(key, [...open, content])
    }
    out.push(part)
    starts.push(line === null ? -1 : continues ? start : out.length - 1)
  }
  return out
}

/** What `line` holds inside its first `levels` quote markers. */
function peelQuoteLevels(line: string, levels: number): string {
  let rest = line
  for (let level = 0; level < levels && rest.startsWith('>'); level++) {
    rest = rest.slice(1)
    if (rest.startsWith(' ') || rest.startsWith('\t')) rest = rest.slice(1)
  }
  return rest
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
 * A quote line as the quote holds it, for a quote whose container holds its
 * content at `contentCol`: the quote markers peeled into `prefix`, and the
 * whitespace before and between the item markers `text` opens with written as
 * the spaces it spans where it stands in the line. Measured from the start of
 * `text` instead, a tab after a quoted item's marker lost the columns the
 * quote marker stood in, and five columns of padding read as three.
 */
function quotedLine(line: string, contentCol: number): { prefix: string; text: string } | null {
  let rest = stripColumns(line, contentCol)
  const slack = /^[ \t]{1,3}(?=>)/.exec(rest)?.[0] ?? ''
  let col = advanceColumns(contentCol, slack)
  rest = rest.slice(slack.length)
  let prefix = ''
  for (let marker = /^>[ \t]?/.exec(rest); marker; marker = /^>[ \t]?/.exec(rest)) {
    col = advanceColumns(col, marker[0])
    rest = rest.slice(marker[0].length)
    prefix += '> '
  }
  if (prefix === '') return null
  return { prefix, text: rest.includes('\t') ? expandItemLead(rest, col) : rest }
}

/** `col` advanced over `text`, a tab reaching the next four-column stop. */
function advanceColumns(col: number, text: string): number {
  for (const ch of text) col += ch === '\t' ? 4 - (col % 4) : 1
  return col
}

/**
 * `text`, starting at column `col`, with its indent and the padding after each
 * item marker it opens with written as spaces.
 */
function expandItemLead(text: string, col: number): string {
  const spaces = (ws: string): string => {
    const from = col
    col = advanceColumns(col, ws)
    return ' '.repeat(col - from)
  }
  const indent = /^[ \t]*/.exec(text)![0]
  let out = spaces(indent)
  let at = indent.length
  for (;;) {
    const m = /^(?:[-*+]|\d{1,9}[.)])([ \t]+)(?=\S)/.exec(text.slice(at))
    if (!m || RE_MD_THEMATIC.test(text.slice(at))) break
    const marker = m[0].length - m[1]!.length
    col += marker
    const padding = spaces(m[1]!)
    out += text.slice(at, at + marker) + padding
    at += m[0].length
    // Past four columns the rest is indented code, which nests no marker.
    if (padding.length > 4) break
  }
  return out + text.slice(at)
}

/**
 * The item markers a quote line opens with (`- `, `1. - `), as held by the
 * collector with its padding in spaces, and whether the innermost item holds
 * indented code: past four columns of padding its content column is one past
 * the marker (CommonMark 5.2), and `lead` ends there.
 */
function quotedItemLead(text: string): { lead: string; code: boolean } | null {
  let at = 0
  for (;;) {
    const rest = text.slice(at)
    if (RE_MD_THEMATIC.test(rest)) break
    const m = /^( *)(?:[-*+]|\d{1,9}[.)])( +)(?=\S)/.exec(rest)
    if (!m) break
    if (m[2]!.length > 4) return { lead: text.slice(0, at + m[0].length - m[2]!.length + 1), code: true }
    at += m[0].length
  }
  return at === 0 ? null : { lead: text.slice(0, at), code: false }
}

/**
 * The quote prefix a lazy line takes: that of the paragraph it continues, or
 * none when the paragraph's lines sit at different quote depths, because one of
 * them is itself lazy and the depth the paragraph opened at is not known here.
 */
function lazyQuotePrefix(run: readonly PrefixedInlineLine[]): string {
  const prefix = run.at(-1)!.prefix
  for (let at = run.length - 1; at >= 0 && quoteParagraphIsOpen(run[at]!.text); at--) {
    if (run[at]!.prefix !== prefix) return ''
  }
  return prefix
}

/** Whether a quote line leaves a paragraph open for a lazy line to continue. */
function quoteParagraphIsOpen(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '' || isMarkdownFenceLine(text)) return false
  return !/^#{1,6}(?:\s|$)/.test(trimmed) && !RE_MD_THEMATIC.test(text) && !isStandardTableRow(text)
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
  markers = new Map<string, ListMarkers>(),
): {
  lines: string[]
  end: number
  // The line is an empty quote line of the source.
  blank?: boolean
} {
  const pad = ' '.repeat(contentCol)
  const strip = (line: string): string =>
    stripColumns(line, contentCol).replace(/^[ \t]{1,3}(?=>)/, '')
  const run: PrefixedInlineLine[] = []
  let end = start
  // The open fence's quote prefix, closer, and the content column of the item
  // holding it inside the quote (0 for none). An empty quote line inside it is
  // a blank line of the code, not the end of the run.
  let fence: { prefix: string; closer: RegExp; col: number } | null = null
  // Indented code a quoted item opened, and that item's content column.
  let code: { prefix: string; col: number } | null = null
  // Whether the last line leaves a paragraph open for a lazy line. Not after a
  // fence or indented code, on an item's own line or not.
  let paragraph = false
  // The content column of the last item line at each quote prefix.
  const lastItem = new Map<string, number>()
  // The quote prefixes a table is open at.
  const table = new Set<string>()
  // The prefix the lazy lines of the current paragraph take, once found.
  let lazyPrefix: string | null = null
  // The answer for the run of blank lines being walked, so a run of `k` of them
  // is scanned once rather than once per line. It names the code block it
  // answers for, since a later one measures from a different column.
  let blankRun: { through: number; prefix: string; col: number; resumes: boolean } | null = null
  // Whether the run was carried past a blank line for the code block open now.
  let resumedCode = false
  while (end < lines.length) {
    const line = lines[end]!
    let parsed: { prefix: string; text: string } | null = quotedLine(line, contentCol)
    // A line with no marker lazily continues the quote's open paragraph
    // (CommonMark 5.1), unless it would start a block of its own. fmt writes it
    // with the quote's marker. Four columns past the quote's container it
    // starts none, since indented code cannot interrupt a paragraph.
    // A list marker there opens a list outside the quote, whatever its number.
    const plain = !RE_LIST_MARKER.test(line) && isParagraphRunLine(lines, end, 'text')
    const over = indentColumns(line) >= contentCol + 4
    if (!parsed && paragraph && line.trim() !== '' && (plain || over)) {
      const text = over && !plain ? escapeBlockOpener(strip(line).trimStart()) : strip(line)
      lazyPrefix ??= lazyQuotePrefix(run)
      run.push({ prefix: lazyPrefix, text, continued: true })
      end++
      continue
    }
    lazyPrefix = null
    if (!parsed) break
    // A quote line left of the container's content column is not in it.
    if (end > start && contentCol > 0 && indentColumns(line) < contentCol) break
    // Inside a fence, markers past its quote's depth are code.
    if (fence !== null && parsed.prefix.length > fence.prefix.length && parsed.prefix.startsWith(fence.prefix)) {
      parsed = { prefix: fence.prefix, text: peelQuoteLevels(strip(line), quoteDepth(fence.prefix)) }
    }
    const prefix: string = parsed.prefix
    const text: string = parsed.text
    const blank = text.trim() === ''
    // A blank line does not end an indented code block, only a non-blank line
    // left of its four columns does (CommonMark 4.4), so a blank the code comes
    // back from neither closes the code nor ends the run. Trailing blanks are
    // not the code's, and there the run still ends at the first of them
    // (markup-carve/carve-js#1947).
    const codeRuns =
      code !== null &&
      blank &&
      // A DEEPER quote line is blank once its own marker is stripped, and it is
      // no blank line of the code: it ends the code the way any line outside
      // the quote does.
      prefix === code.prefix &&
      (() => {
        if (blankRun !== null && end <= blankRun.through && blankRun.prefix === code!.prefix && blankRun.col === code!.col) {
          return blankRun.resumes
        }
        let at = end + 1
        for (; at < lines.length; at++) {
          const ahead = quotedLine(lines[at]!, contentCol)
          if (ahead === null || ahead.prefix !== code!.prefix) break
          if (ahead.text.trim() === '') continue
          break
        }
        const ahead = at < lines.length ? quotedLine(lines[at]!, contentCol) : null
        blankRun = {
          through: at - 1,
          prefix: code!.prefix,
          col: code!.col,
          resumes: ahead !== null && ahead.prefix === code!.prefix && indentColumns(ahead.text) >= code!.col + 4,
        }
        return blankRun.resumes
      })()
    // Only the code's own quote is carried past the blank. At another depth the
    // run ends here, where it used to end at the blank, so the caller re-enters
    // and reads what that quote holds - indented code of its own included,
    // which this run has no way to fence.
    //
    // Where that quote is DEEPER, the two are blocks of one quote and fmt puts
    // an empty quote line between them, which neither run writes: those
    // documents read the way cmark-gfm reads them now, where before they were
    // fixed points of the wrong reading, but they are not fixed points.
    if (resumedCode && code !== null && prefix !== code.prefix) break
    if (codeRuns) resumedCode = true
    // A line left of the item holding a fence or code ends the item, and them.
    if (fence !== null && (prefix !== fence.prefix || (!blank && indentColumns(text) < fence.col))) fence = null
    if (code !== null && (prefix !== code.prefix || (blank ? !codeRuns : indentColumns(text) < code.col + 4))) code = null
    if (blank && fence === null && !codeRuns) break
    const lazy = paragraph
    paragraph = false
    // Four columns past the column its paragraph stands at, a marked quote line
    // opens nothing, so it continues the paragraph above. Without the flag the
    // fold read a line shaped like a block opener as a block of its own, and a
    // quoted setext heading holding one stayed a paragraph (carve-js#2008).
    let continues = false
    if (fence !== null) {
      if (fence.closer.test(stripColumns(text, fence.col))) fence = null
    } else if (code === null) {
      const item = quotedItemLead(text)
      const inner = item === null ? text : text.slice(item.lead.length)
      const held = lastItem.get(prefix)
      if (item !== null) lastItem.set(prefix, columnWidth(item.lead))
      // Left of the item, only a lazy paragraph line keeps it open.
      else if (held !== undefined && indentColumns(text) < held && !(lazy && quoteParagraphIsOpen(text))) lastItem.delete(prefix)
      const open = RE_MD_FENCE_LINE.exec(inner)
      if (item?.code) {
        code = { prefix, col: columnWidth(item.lead) }
        resumedCode = false
      }
      else if (open && fenceRunIsAFence(open[2]!, open[3]!)) {
        const under = item === null ? lastItem.get(prefix) : undefined
        const col: number = item !== null ? columnWidth(item.lead) : under !== undefined && indentColumns(text) >= under ? under : 0
        fence = { prefix, closer: new RegExp(`^ {0,3}${open[2]![0]}{${open[2]!.length},}[ \t]*$`), col }
      } else if (end > start && interruptingHtmlBlock(text)) {
        // What the quote holds is measured with the marker stripped, so an
        // HTML block opening mid-quote ends the inline run and the caller
        // re-enters on that line as a block.
        break
      } else {
        // A pipe row is paragraph text until a delimiter row under it makes
        // the two a table, whose rows take no lazy line.
        continues = lazy && inner.trim() !== '' && indentColumns(text) >= (held ?? 0) + 4
        const row = isStandardTableRow(inner)
        const delimiter = RE_TABLE_DELIMITER.test(inner.trim()) && inner.includes('-')
        if (delimiter && !table.has(prefix) && run.at(-1)?.prefix === prefix && !run.at(-1)!.continued) table.add(prefix)
        else if (!row) table.delete(prefix)
        paragraph = inner.trim() !== '' && (quoteParagraphIsOpen(inner) || (row && !table.has(prefix)))
      }
    }
    run.push(continues ? { ...parsed, continued: true } : parsed)
    end++
  }
  if (run.length === 0) return { lines: [pad + strip(lines[start]!)], end: start + 1, blank: true }
  const quoteEnds = end === lines.length || quotedLine(lines[end]!, contentCol) === null
  return {
    lines: restorePrefixedInlineRun(respellQuotedBlocks(foldContainerSetext(canonicalQuotedFences(run)), markers, quoteEnds), dialect)
      .map((l) => pad + (/^(?:> )+$/.test(l) ? l.trimEnd() : l)),
    end,
  }
}

/**
 * Respell each fence a quote run holds as the backtick fence `carve fmt`
 * writes, and close one the quote ended. Indented code on a quoted item's own
 * line becomes such a fence too.
 *
 * Besides the spelling, a backtick fence is what keeps the body verbatim here:
 * the run goes through `convertInline`, which protects a backtick fence as a
 * code span but read a tilde fence's `~~` as strikethrough.
 */
function canonicalQuotedFences(run: readonly PrefixedInlineLine[]): PrefixedInlineLine[] {
  const out: PrefixedInlineLine[] = []
  let opener = -1
  let closer: RegExp | null = null
  let info = ''
  // What the opener line holds before its fence: the item markers of a fence
  // on an item's own line, or the indent of one under a quoted item.
  let lead = ''
  // The content column of the item the fence is in, 0 for none, and the
  // fence's own indent past it, which CommonMark strips from each body line.
  let col = 0
  let indent = 0
  // The content column of the last item line at each quote prefix, outside
  // fences, whose lines are code rather than items.
  const lastItem = new Map<string, number>()
  const close = (): PrefixedInlineLine => {
    const bodies = out.slice(opener + 1)
    for (const [offset, part] of bodies.entries()) {
      const text = part.text.trim() === '' ? part.text : ' '.repeat(col) + stripColumns(stripColumns(part.text, col), indent)
      out[opener + 1 + offset] = { prefix: part.prefix, text }
    }
    const fence = canonicalFence(out.slice(opener + 1).map((part) => part.text))
    out[opener] = { prefix: out[opener]!.prefix, text: lead + fence + info }
    const pad = /^[ \t]*$/.test(lead) ? lead : ' '.repeat(col)
    const written = { prefix: out[opener]!.prefix, text: pad + fence }
    opener = -1
    return written
  }
  for (let idx = 0; idx < run.length; idx++) {
    const part = run[idx]!
    if (opener >= 0) {
      // A shallower quote line ends the quote the fence is in, and the fence;
      // a line left of the item a fence is in ends the item and the fence.
      if (part.prefix !== out[opener]!.prefix || (col > 0 && part.text.trim() !== '' && indentColumns(part.text) < col)) {
        out.push(close())
      } else if (closer!.test(stripColumns(part.text, col))) {
        out.push(close())
        continue
      } else {
        out.push(part)
        continue
      }
    }
    const item = part.continued ? null : quotedItemLead(part.text)
    if (item?.code) {
      // Indented code on the item's line, and the lines four columns past the
      // item's content under it.
      col = columnWidth(item.lead)
      const bodies = [stripColumns(part.text.slice(item.lead.length), 4)]
      // A blank line the code comes back from is the code's; trailing ones are
      // not, so they are only kept once more code follows them.
      let blanks: string[] = []
      for (let ahead = idx + 1; ahead < run.length; ahead++) {
        const next = run[ahead]!
        if (next.prefix !== part.prefix || next.continued) break
        if (next.text.trim() === '') {
          blanks.push('')
          continue
        }
        if (indentColumns(next.text) < col + 4) break
        bodies.push(...blanks, stripColumns(next.text, col + 4))
        blanks = []
        idx = ahead
      }
      const fence = canonicalFence(bodies)
      out.push(
        { prefix: part.prefix, text: item.lead + fence },
        // A blank line of the code carries the quote marker alone, the way fmt
        // writes one: padded to the item it would keep trailing whitespace.
        ...bodies.map((body) => ({ prefix: part.prefix, text: body === '' ? '' : ' '.repeat(col) + body })),
        { prefix: part.prefix, text: ' '.repeat(col) + fence },
      )
      lastItem.set(part.prefix, col)
      continue
    }
    const inner = item === null ? part.text : part.text.slice(item.lead.length)
    const open = RE_MD_FENCE_LINE.exec(inner)
    if (!open || !fenceRunIsAFence(open[2]!, open[3]!)) {
      const held = lastItem.get(part.prefix)
      if (item !== null) lastItem.set(part.prefix, columnWidth(item.lead))
      else if (held !== undefined && indentColumns(part.text) < held) {
        // Left of the item, only a lazy paragraph line keeps it open.
        const above = out.at(-1)
        const lazy = above?.prefix === part.prefix && quoteParagraphIsOpen(above.text) && quoteParagraphIsOpen(part.text)
        if (!lazy) lastItem.delete(part.prefix)
      }
      out.push(part)
      continue
    }
    opener = out.length
    out.push(part)
    info = fenceInfo(open[3]!)
    if (item !== null) {
      lead = item.lead
      col = columnWidth(item.lead)
      indent = columnWidth(open[1]!)
      lastItem.set(part.prefix, col)
    } else {
      // An indented fence under a quoted list item is the item's: it keeps the
      // item's column, and its body keeps its indent.
      const held = lastItem.get(part.prefix)
      const underItem = held !== undefined && columnWidth(open[1]!) >= held
      lead = underItem ? open[1]! : ''
      col = underItem ? held : 0
      indent = underItem ? 0 : columnWidth(open[1]!)
    }
    closer = new RegExp(`^ {0,3}${open[2]![0] === '`' ? '`' : '~'}{${open[2]!.length},}[ \t]*$`)
  }
  if (opener >= 0) out.push(close())
  return out
}

/**
 * What the top-level loop does for list markers and block spacing, for the
 * blocks a quote run holds: list markers through `ListMarkers`, one per quote
 * depth, and an empty quote line wherever fmt separates two blocks the source
 * wrote adjacent - two lists, or a nested quote under the paragraph above it.
 */
function respellQuotedBlocks(
  run: readonly PrefixedInlineLine[],
  markers: Map<string, ListMarkers>,
  quoteEnds: boolean,
): PrefixedInlineLine[] {
  const out: PrefixedInlineLine[] = []
  // The open fence's closer, or null outside one, and the content column of
  // the item whose own line opened it (0 for none).
  let closer: RegExp | null = null
  let closerCol = 0
  let afterFence = false
  // The content column of the item the open or last fence sat under, or -1. A
  // quote run holds no blank line, so that item is tight, and only a line
  // leaving it is set apart from the fence.
  let fenceItem = -1
  const separate = (prefix: string): void => {
    const prev = out.at(-1)
    if (prev !== undefined && prev.prefix === prefix && prev.text.trim() !== '') out.push({ prefix, text: '' })
  }
  // A line the quote's open item holds moves with the item.
  const moved = (part: PrefixedInlineLine): PrefixedInlineLine => {
    const item = markers.get(part.prefix)?.itemAt(indentColumns(part.text))
    return item ? { ...part, text: moveIndent(part.text, item.content, item.content + item.shift) } : part
  }
  // The rows of the tables each stretch of one quote depth holds. Any other
  // pipe row is paragraph text.
  const tableRow = new Array<boolean>(run.length).fill(false)
  const bodies = heldByItem(run).map((held) => held.body)
  for (let start = 0; start < run.length; ) {
    let end = start + 1
    while (end < run.length && run[end]!.prefix === run[start]!.prefix && !run[end]!.continued) end++
    gfmTableRowLines(bodies.slice(start, end)).forEach((row, offset) => (tableRow[start + offset] = row))
    start = end
  }
  let prevTable = false
  // Whether the line being written leaves the quote's open list, which fmt
  // sets apart from it with an empty quote line.
  let leavesList = false
  for (const [idx, part] of run.entries()) {
    const prev = out.at(-1)
    const inTable = prevTable
    prevTable = tableRow[idx]!
    if (part.prefix === '') {
      out.push(part)
      afterFence = false
      continue
    }
    if (closer !== null) {
      out.push(moved(part))
      if (closer.test(stripColumns(part.text, closerCol))) {
        closer = null
        afterFence = true
      }
      continue
    }
    // A line with fewer quote markers than the paragraph above it continues
    // that paragraph when it opens no block of its own (CommonMark 5.1), and
    // is written inside the deeper quote.
    if (prev !== undefined && prev.prefix.length > part.prefix.length && prev.prefix.startsWith(part.prefix)) {
      let held = prev.text
      for (let marker = RE_LIST_MARKER.exec(held); marker; marker = RE_LIST_MARKER.exec(held)) {
        held = ' '.repeat(columnWidth(marker[0])) + held.slice(marker[0].length)
      }
      const over = indentColumns(part.text) >= 4
      const trimmed = part.text.trimStart()
      const paragraph = opensParagraph(held) || (!inTable && isStandardTableRow(held))
      const lazy =
        paragraph &&
        (over ||
          (!trimmed.startsWith('>') &&
            !RE_LIST_MARKER.test(trimmed) &&
            (isParagraphRunLine([trimmed], 0, 'text') || isStandardTableRow(trimmed))))
      if (lazy) {
        out.push({ prefix: prev.prefix, text: ' '.repeat(indentColumns(held)) + (over ? escapeBlockOpener(trimmed) : trimmed), continued: true })
        prevTable = false
        continue
      }
      // Any other line leaves the deeper quote, and fmt sets it apart; after a
      // paragraph Carve would otherwise read it as lazy continuation.
      if (prev.text.trim() !== '') out.push({ prefix: part.prefix, text: '' })
    }
    const open = RE_MD_FENCE_LINE.exec(part.text)
    if (open && fenceRunIsAFence(open[2]!, open[3]!)) {
      fenceItem = markers.get(part.prefix)?.itemAt(indentColumns(part.text))?.content ?? -1
      markers.get(part.prefix)?.end(indentColumns(part.text))
      closer = new RegExp(`^ {0,3}${open[2]![0]}{${open[2]!.length},}[ \t]*$`)
      closerCol = 0
      if (fenceItem < 0) separate(part.prefix)
      out.push(moved(part))
      continue
    }
    if (afterFence && (fenceItem < 0 || (!RE_LIST_MARKER.test(part.text) && indentColumns(part.text) < fenceItem))) {
      separate(part.prefix)
    }
    afterFence = false
    // A quote opened at the column of an outer one ends the lists it holds.
    for (const [prefix, outer] of markers) {
      if (part.prefix.length > prefix.length && part.prefix.startsWith(prefix)) outer.end(0)
    }
    let list = markers.get(part.prefix)
    if (list === undefined) markers.set(part.prefix, (list = new ListMarkers()))
    const markerCol = indentColumns(part.text)
    // An ordered marker other than 1 cannot interrupt a paragraph, so under
    // one it is paragraph text, unless it continues a list open at its column
    // or sits left of the item holding the paragraph, where it opens a list.
    const ordered = /^[ \t]*(\d+)([.)])[ \t]/.exec(part.text)
    const holder = list.itemAt(Infinity)
    // What the line above holds past its marker, when it is in this quote.
    const above = prev?.prefix === part.prefix ? prev.text.replace(RE_LIST_MARKER, '') : null
    // Four columns past its item's content, a line under paragraph text
    // continues the paragraph, whatever it looks like.
    const item = list.itemAt(markerCol)
    const overIndented = above !== null && markerCol >= (item?.content ?? 0) + 4 && opensParagraph(above)
    const asText =
      overIndented ||
      (ordered !== null &&
      (holder === undefined || markerCol >= holder.content) &&
      Number(ordered[1]) !== 1 &&
      prev?.prefix === part.prefix &&
      opensParagraph(prev.text.replace(RE_LIST_MARKER, '')) &&
      !list.continues(markerCol, ordered[2]!))
    // Marker padding collapses as fmt writes it when nothing the item could
    // take in follows the lines it holds, which move with it: the quote ends,
    // or the next line is another item of this list or an outer one.
    let onePad = false
    if (!asText && /^[ \t]*(?:[-*+]|\d+[.)]) {2}/.test(part.text)) {
      const content = columnWidth(RE_LIST_MARKER.exec(part.text)![0])
      let at = idx + 1
      const holds = (entry: PrefixedInlineLine): boolean =>
        entry.prefix === part.prefix && (entry.continued === true || entry.text.trim() === '' || indentColumns(entry.text) >= content)
      while (at < run.length && holds(run[at]!)) at++
      const next = run[at]
      onePad =
        next === undefined
          ? quoteEnds
          : next.prefix !== part.prefix || (RE_ITEM_LINE.test(next.text) && indentColumns(next.text) <= markerCol + 3)
    }
    const written = asText ? { line: part.text, separate: false, outer: 0 } : list.write(part.text, onePad)
    let text = moveIndent(written.line, markerCol, markerCol + written.outer)
    if (asText || !RE_LIST_MARKER.test(part.text)) {
      // A quote run holds no blank line, so an unmarked paragraph line under an
      // item is its lazy continuation, written at the item's content column;
      // only a line opening another block ends the item.
      const open = list.itemAt(Infinity)
      const lazy =
        open !== undefined &&
        markerCol < open.content &&
        prev?.prefix === part.prefix &&
        opensParagraph(prev.text.replace(RE_LIST_MARKER, '')) &&
        (asText || opensParagraph(part.text))
      // As text, the marker is escaped wherever the line lands.
      const trimmed = asText ? escapeBlockOpener(part.text.trimStart()) : part.text.trimStart()
      // A quote the open item holds takes the line as a lazy one, with its marker.
      const quote = above === null ? null : openQuoteParagraph(above)
      const quoteLazy =
        quote !== null &&
        open !== undefined &&
        !trimmed.startsWith('>') &&
        (markerCol >= open.content + 4 || isParagraphRunLine([trimmed], 0, 'text'))
      if (overIndented) text = ' '.repeat(item === undefined ? 0 : item.content + item.shift) + escapeBlockOpener(trimmed)
      else if (quoteLazy) {
        const escaped = markerCol >= open.content + 4 ? escapeBlockOpener(trimmed) : trimmed
        text = ' '.repeat(open.content + open.shift) + quote + escaped
      } else if (lazy) text = ' '.repeat(open.content + open.shift) + trimmed
      else {
        // A block left of every open item's content leaves the list, and fmt
        // writes an empty quote line between the two
        // (markup-carve/carve-js#1946). One still inside an item - the outer
        // of a nested pair included - stays there, where fmt sets nothing
        // apart, and a pipe row no table takes is paragraph text.
        leavesList =
          open !== undefined &&
          list.itemAt(markerCol) === undefined &&
          !quoteParagraphIsOpen(part.text) &&
          (tableRow[idx]! || !isStandardTableRow(part.text))
        if (!quoteParagraphIsOpen(part.text)) list.end(markerCol)
        const kept = list.itemAt(markerCol)
        // One to three columns past the item's content read as none.
        if (kept !== undefined && markerCol > kept.content && markerCol < kept.content + 4) {
          text = ' '.repeat(kept.content + kept.shift) + trimmed
        } else if (
          // The same slack where the quote holds no item at all. Markdown's one
          // to three columns there are the QUOTE's, and the block still opens;
          // Carve reads an opener only AT its container's content column, so
          // the slack turned the line back into text of the paragraph above
          // (carve-js#2030, carve-js#2031).
          kept === undefined &&
          markerCol > 0 &&
          markerCol < 4 &&
          part.continued !== true &&
          opensAtTheContentColumn(trimmed)
        ) {
          text = trimmed
        } else text = moved(asText ? { ...part, text: ' '.repeat(markerCol) + trimmed } : part).text
      }
    }
    // Not after a lazy line: an empty line there would be a blank one, and
    // would end the quote the lazy line continues.
    const deeper =
      prev !== undefined &&
      prev.prefix !== '' &&
      part.prefix.length > prev.prefix.length &&
      part.prefix.startsWith(prev.prefix)
    // After an empty quote line the run starts fresh, and that line already
    // separates the lists.
    if (((written.separate && prev !== undefined) || (deeper && prev.text.trim() !== '')) && out.at(-1)!.text !== '') {
      out.push({ prefix: deeper ? prev.prefix : part.prefix, text: '' })
    }
    // A quote a line of this run holds, whatever wrote it: as text the marker is
    // escaped above, so a `>` still standing here is structural and Carve reads
    // it only in its spaced form. A quote an ITEM of this run holds reaches no
    // other respelling at all (carve-js#2035).
    if (!asText) text = respellHeldQuoteMarkers(text)
    if (leavesList) separate(part.prefix)
    leavesList = false
    // `fmt` sets a block in a quote apart from the paragraph above it with an
    // empty quote line. Carve reads the block either way, so this changes no
    // render; written without it the import was not a fixed point of this
    // engine's own formatter (carve-js#2031).
    if (
      part.continued !== true &&
      indentColumns(text) === 0 &&
      prev !== undefined &&
      prev.prefix === part.prefix &&
      prev.text.trim() !== '' &&
      opensParagraph(prev.text.replace(RE_LIST_MARKER, '')) &&
      opensAtTheContentColumn(text)
    ) separate(part.prefix)
    out.push({ prefix: part.prefix, text, continued: part.continued })
    // A fence on the item's own line holds the lines up to its closer.
    const lead = asText ? null : quotedItemLead(part.text)
    const opener = lead === null ? null : RE_MD_FENCE_LINE.exec(part.text.slice(lead.lead.length))
    if (lead !== null && opener !== null && fenceRunIsAFence(opener[2]!, opener[3]!)) {
      closer = new RegExp(`^ {0,3}${opener[2]![0]}{${opener[2]!.length},}[ \t]*$`)
      closerCol = columnWidth(lead.lead)
      fenceItem = closerCol
    }
  }
  return out
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
    if (indentColumns(stripColumns(line, contentCol)) < 4) break
    run.push(line)
    end = i + 1
  }

  const body = run
    .slice(0, end - start)
    .map((line) =>
      line.trim() === '' ? '' : stripColumns(line, contentCol + 4),
    )
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body.join('\n')) + 1))
  const pad = ' '.repeat(contentCol)
  const out = [fence, ...body, fence].map((emitted) => (emitted === '' ? '' : pad + emitted))
  // Carve needs a blank line after a block; the caller resumes at `end`, which
  // is the first line the run did not take.
  if (end < lines.length && lines[end]!.trim() !== '') out.push('')

  return { lines: out, end }
}

/**
 * Rewrite the opener at `openerAt` to the canonical backtick fence for the body
 * written after it, and return the matching closer at `pad`.
 */
function closeFence(out: string[], openerAt: number, pad: string, info: string): string {
  const fence = canonicalFence(out.slice(openerAt + 1).map((line) => stripColumns(line, pad.length)))
  out[openerAt] = pad + fence + info
  return pad + fence
}

/**
 * A Markdown info string reduced to the one token a Carve fence takes, or
 * nothing when a backtick in its first word stops it being an info string.
 */
function fenceInfo(rest: string): string {
  const firstInfoWord = rest.trim().split(/[ \t]/, 1)[0] ?? ''
  return firstInfoWord.includes('`') ? '' : (rest.match(/[A-Za-z0-9_+#/.-]+/)?.[0] ?? '')
}

/**
 * A fence on a list item's own first line, with its body and its closer.
 *
 * The body is code, so it is written byte for byte at the item's content
 * column. The fence ends at its closer, or at the first non-blank line left of
 * that column, which ends the item; there it is closed after the blank lines it
 * ran through, and those are handed back to the caller too, so the item keeps
 * the looseness they gave it.
 */
function collectItemFence(
  lines: readonly string[],
  start: number,
  prefix: string,
  run: string,
  info: string,
): { lines: string[]; end: number; verbatimFrom: number } {
  const contentCol = columnWidth(prefix)
  const pad = ' '.repeat(contentCol)
  const out = [prefix + run + info]
  const closer = new RegExp(`^ {0,3}${run[0] === '`' ? '`' : '~'}{${run.length},}[ \t]*$`)
  let end = start + 1
  let blanks: string[] = []
  let trailing = 0
  while (end < lines.length) {
    const line = lines[end]!
    if (line.trim() === '') {
      blanks.push('')
      end++
      continue
    }
    if (indentColumns(line) < contentCol) {
      trailing = blanks.length
      end -= blanks.length
      blanks = []
      break
    }
    out.push(...blanks)
    blanks = []
    const body = stripColumns(line, contentCol)
    out.push(pad + body)
    end++
    if (closer.test(body)) break
  }
  // The line the document's final newline leaves is not a blank of the code.
  if (blanks.length > 0) trailing = blanks.length - (end === lines.length && lines.at(-1) === '' ? 1 : 0)
  end -= blanks.length
  const closed = out.length > 1 && closer.test(stripColumns(out.at(-1)!, contentCol))
  if (!closed) out.push(...new Array<string>(trailing).fill(''))
  const fence = canonicalFence(out.slice(1, closed ? -1 : undefined).map((line) => stripColumns(line, contentCol)))
  out[0] = prefix + fence + info
  if (closed) out[out.length - 1] = pad + fence
  else out.push(pad + fence)

  return { lines: out, end, verbatimFrom: 1 }
}

function collectListInlineRun(
  lines: readonly string[],
  start: number,
  dialect: MarkdownDialect,
): {
  lines: string[]
  end: number
  verbatimFrom?: number
} {
  const first = lines[start]!
  const marker = first.match(RE_LIST_MARKER)
  if (!marker) return { lines: [convertInline(first, dialect)], end: start + 1 }
  if (itemContentColumn(marker[0]) < columnWidth(marker[0]) && first.trim() !== marker[0].trim()) {
    return collectItemIndentedCode(lines, start, marker[0].trimEnd().length)
  }
  // Continuation lines are measured in columns, a tab advancing to the next
  // stop; the first line is sliced by characters.
  const contentCol = columnWidth(marker[0])
  // The content columns of the items the first line nests (`- - a`), and the
  // text past their markers.
  const nestedItems = nestedItemsOnLine(first, marker[0].length)
  const nestedEnd = nestedItems.at(-1)?.end ?? marker[0].length
  // The innermost of them may hold indented code.
  const codeItem = /^(?:[-*+]|\d{1,9}[.)])(?= {5,}\S)/.exec(first.slice(nestedEnd))
  if (codeItem) return collectItemIndentedCode(lines, start, nestedEnd + codeItem[0].length)
  const fence = RE_MD_FENCE_LINE.exec(first.slice(nestedEnd))
  if (fence && fenceRunIsAFence(fence[2]!, fence[3]!)) {
    return collectItemFence(lines, start, first.slice(0, nestedEnd), fence[2]!, fenceInfo(fence[3]!))
  }

  // A block marker behind a task checkbox is the item paragraph's text in
  // Markdown and a block opener in Carve, so the first line carried it across
  // bare and the quote, heading or list it spelled was not in the source. The
  // continuation lines of that same paragraph already escape it, which is what
  // made the two halves of one paragraph disagree (carve-js#2023).
  const taskLead = RE_CARVE_TASK_LEAD.exec(first)
  const firstLineText =
    taskLead === null
      ? respellHeldQuoteMarkers(first.slice(marker[0].length))
      : first.slice(marker[0].length, taskLead[0].length) + escapeBlockOpener(first.slice(taskLead[0].length))
  const run: PrefixedInlineLine[] = [{ prefix: marker[0], text: firstLineText }]
  const itemCols = [contentCol, ...nestedItems.map((item) => item.content)]
  const firstText = first.slice(nestedEnd)
  let end = start + 1
  // Whether any line of the run so far opens a list inside a quote it holds.
  const quotesAnItem = (line: string): boolean => {
    const body = blockquotePrefix(line.trimStart())
    return body !== null && RE_LIST_MARKER.test(body.text)
  }
  let quoteHoldsItem = quotesAnItem(firstText)
  // The closer of a fence the quote on the item's OWN line opened, while it is
  // still open: the lines up to it are the fence's content, and no block
  // reading is taken on them.
  let quotedFence = quotedFenceCloser(firstText)

  while (end < lines.length) {
    const line = lines[end]!
    if (line.trim() === '') break

    const indent = indentColumns(line)
    // The indent past the content column is written as the spaces it covers.
    const text = ' '.repeat(Math.max(0, indent - contentCol)) + line.replace(/^[ \t]+/, '')
    const above = run.length === 1 ? firstText : run.at(-1)!.text
    // An ordered marker other than 1 cannot interrupt the paragraph of the
    // innermost item holding it (CommonMark 5.2), unless it continues an
    // ordered list the first line nests at its column.
    const ordered = /^(\d{1,9})([.)])[ \t]/.exec(text.trimStart())
    const orderedText =
      ordered !== null &&
      Number(ordered[1]) !== 1 &&
      opensParagraph(above) &&
      indent >= itemCols.at(-1)! &&
      !nestedItems.some((item) => item.col === indent && item.number !== undefined && item.kind === ordered[2])
    // A block left of an item the first line nests ends that item; a lazy
    // paragraph line does not.
    const lazyText =
      orderedText ||
      ((opensParagraph(above) || openQuoteParagraph(above) !== null) &&
        !text.trimStart().startsWith('>') &&
        isParagraphRunLine([text.trimStart()], 0, 'text'))
    // The innermost item on the first line that holds this line.
    let base = contentCol
    for (const col of itemCols) if (col <= indent) base = col
    // Four columns past the content column a line under paragraph text only
    // continues it: indented code cannot interrupt a paragraph.
    const quote = openQuoteParagraph(above)
    const continues = indent >= base + 4 && (opensParagraph(above) || quote !== null)
    // A continuation line keeps the paragraph, and so the items, it continues.
    if (!lazyText && !continues) while (itemCols.length > 1 && itemCols.at(-1)! > indent) itemCols.pop()

    if (!continues && !orderedText && RE_ITEM_LINE.test(line)) break
    if (indent < contentCol) break

    // Leave fenced code blocks inside list items to the main fence handler.
    //
    // Measured from the innermost item that holds the line, not from the
    // outermost marker the run's prefix took: a fence opens on up to three
    // columns of slack, and past two items of depth every such line stood more
    // than three columns from the OUTER column and read as paragraph text, so
    // the fence and what it was meant to hold went out escaped (carve-js#2028).
    if (isMarkdownFenceLine(' '.repeat(Math.max(0, indent - base)) + line.replace(/^[ \t]+/, ''))) break
    // The same for a fence the quote this item holds opens: writing it, and
    // closing it where the source leaves it open, is the quote collector's job.
    // Carried into the run instead, the opener reached the inline converter,
    // which escaped an unmatched backtick run and read a tilde run as a
    // strikethrough, so the fence and its content went out as prose
    // (carve-js#2028).
    const openFence = blockquotePrefix(text.trimStart())
    if (quotedFence !== null) {
      if (openFence !== null && quotedFence.test(openFence.text)) quotedFence = null
    } else if (
      quote !== null &&
      openFence !== null &&
      openFence.prefix === quote &&
      indentColumns(openFence.text) < 4 &&
      isMarkdownFenceLine(openFence.text.trimStart())
    ) break
    // Same for an HTML block opening at the item's content column.
    if (interruptingHtmlBlock(text)) break
    // And for a quote opening with indented code, which the quote collector
    // would read as paragraph text.
    //
    // Only where the quote has no paragraph open: indented code cannot
    // interrupt one, so under `- > alpha` the line `  >     code` continues
    // `alpha`. `quotedIndentedCodeAt` cannot see that quote, because the line
    // above it is the item's MARKER line and carries no `>` of its own once
    // the item's columns come off, so it answers that the code opens the
    // quote. Read that way, a paragraph became a code block
    // (markup-carve/carve-js#1941).
    if (!continues && quote === null && quotedIndentedCodeAt(lines, end, base) !== null) break

    const prefix = ' '.repeat(contentCol)
    const pad = ' '.repeat(Math.max(0, base - contentCol))
    const over = indent - base
    // Indented code the item holds, four columns past the content column of
    // the item that holds it, under a block leaving no paragraph for it to
    // continue. Carve has no indented code block, so it is written as the
    // item's fence; carried through, the code and its own delimiters read as
    // prose (markup-carve/carve-js#1947, markup-carve/carve-js#1952).
    if (end > start && over >= 4 && !continues && quote === null && !lazyText && !opensParagraph(above)) {
      const code = collectIndentedCode(lines, end, base)
      const written = restorePrefixedInlineRun(foldContainerSetext(run), dialect)
      return { lines: [...written, ...code.lines], end: code.end, verbatimFrom: written.length }
    }
    const trimmed = orderedText ? escapeBlockOpener(text.trimStart()) : text.trimStart()
    // The same text with no block-opener escape, carried alongside so a setext
    // fold can write the unescaped spelling (carve#2244).
    const plain = text.trimStart()
    // A line of the quote the item holds sits at the QUOTE's content column
    // too, and Markdown's slack above it is the quote's, not the sample's. The
    // document-level collector already drops those columns; only the item-held
    // quote carried them through byte for byte, and `fmt` took them off
    // (markup-carve/carve-js#1946). Four columns in the line opens nothing at
    // all, so it is the branch below, with its escape, that takes it.
    //
    // Not once the quote holds a list of its own: the columns are then the
    // item's content column, measured from somewhere this loop does not track,
    // and taking them off moved the line out of the item.
    const inner = quote === null || over >= 4 || quoteHoldsItem ? null : blockquotePrefix(trimmed)
    // A link reference definition cannot interrupt a paragraph (CommonMark
    // 4.7), so on a line of the open quoted paragraph above it is that
    // paragraph's text. Carve reads one at the quote's content column, where it
    // opens no element at all and takes its line with it (carve-js#2029).
    const definition =
      inner !== null && inner.prefix === quote && RE_MD_LINK_REFERENCE.test(inner.text.trimStart())
    if (inner !== null && inner.prefix === quote && inner.text.trim() !== '' && (definition || /^[ \t]/.test(inner.text))) {
      const body = inner.text.trimStart()
      const asText = definition || indentColumns(inner.text) >= 4
      run.push({ prefix, text: pad + quote + (asText ? escapeBlockOpener(body) : body), bareBody: body })
    } else if (continues && quote === null) run.push({ prefix, text: pad + escapeBlockOpener(trimmed), continued: true, bareBody: plain })
    else if (quote !== null && (over >= 4 || (!trimmed.startsWith('>') && isParagraphRunLine([trimmed], 0, 'text')))) {
      // A lazy line of the quote the item holds, written with its marker.
      run.push({ prefix, text: pad + quote + (over >= 4 ? escapeBlockOpener(trimmed) : trimmed), continued: true, bareBody: plain })
    } else if (lazyText && opensParagraph(above) && indent < itemCols.at(-1)!) {
      // A lazy line of the innermost item's paragraph, at that item's column.
      run.push({ prefix, text: ' '.repeat(itemCols.at(-1)! - contentCol) + trimmed, continued: true })
    } else if (over > 0 && over < 4) run.push({ prefix, text: pad + respellHeldQuoteMarkers(trimmed) })
    // A later line the item holds, at the column the quote opens at. As text
    // the marker is escaped above, so a `>` arriving here is structural.
    else run.push({ prefix, text: orderedText ? pad + trimmed : respellHeldQuoteMarkers(text) })
    quoteHoldsItem ||= quotesAnItem(run.at(-1)!.text)
    end++
  }

  return { lines: restorePrefixedInlineRun(foldContainerSetext(run), dialect), end }
}

/**
 * The quote markers of `text` when it is a quote line whose paragraph is still
 * open for a lazy line, else null.
 */
function openQuoteParagraph(text: string): string | null {
  const quote = blockquotePrefix(text.trimStart())
  return quote !== null && quote.text.trim() !== '' && quoteParagraphIsOpen(quote.text) ? quote.prefix : null
}

/**
 * `text` with the quote markers it holds respelled in Carve's spaced form,
 * reached past the indentation and the item markers that hold them.
 *
 * The document-level path peels a quote into a prefix and writes it back
 * spaced, so `>> a` goes out `> > a` there. A quote a list item holds is
 * written from the item's own branch, which left the two characters as the
 * source spelled them; Carve reads `>>` as text, so both quotes went missing
 * from the import (carve-js#2035).
 */
function respellHeldQuoteMarkers(text: string): string {
  const held = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*)(>[\s\S]*)$/.exec(text)
  const quote = held === null ? null : blockquotePrefix(held[2]!)
  if (quote === null) return text
  const respelled = held![1]! + quote.prefix + quote.text
  // An empty quote line keeps no trailing space, the way the document-level
  // collector writes one.
  return quote.text.trim() === '' ? respelled.trimEnd() : respelled
}

/**
 * Whether `text` opens a block Carve reads at its container's content column
 * and Markdown lets interrupt a paragraph from one to three columns in.
 *
 * Enumerated one spelling at a time rather than widened to "whatever opens a
 * block at column 0": a fence belongs to the fence path, a list marker is
 * written by the list that holds it, and a link reference definition interrupts
 * no paragraph in Markdown, so dedenting one would spell a definition the source
 * does not hold.
 */
function opensAtTheContentColumn(text: string): boolean {
  return RE_MD_THEMATIC.test(text) || /^#{1,6}(?:[ \t]|$)/.test(text) || text.startsWith('>')
}

/**
 * The closer of the fence a quote in `text` opens, or null when it opens none.
 */
function quotedFenceCloser(text: string): RegExp | null {
  const quoted = blockquotePrefix(text.trimStart())
  const open = quoted === null ? null : RE_MD_FENCE_LINE.exec(quoted.text)
  if (open === null || columnWidth(open[1]!) > 3 || !fenceRunIsAFence(open[2]!, open[3]!)) return null
  return new RegExp(`^ {0,3}${open[2]![0]}{${open[2]!.length},}[ \t]*$`)
}

/**
 * Paragraph text that would open a block once it sits at its container's
 * column, with a Markdown escape on what opens it. `convertInline` carries the
 * escape over to Carve.
 */
function escapeBlockOpener(text: string): string {
  const ordered = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(text)
  if (ordered) return `${ordered[1]}\\${text.slice(ordered[1]!.length)}`
  const fence = /^(`{3,}|~{3,})/.exec(text)
  if (fence) return fence[1]!.replace(/./g, '\\$&') + text.slice(fence[1]!.length)
  if (RE_MD_THEMATIC.test(text)) return text.replace(/[^ \t]/g, '\\$&')
  // A setext underline, which a container's paragraph line above would fold.
  if (/^(?:=+|-+)[ \t]*$/.test(text)) return `\\${text}`
  if (/^(?:>|[-*+](?=[ \t]|$)|#{1,6}(?=[ \t]|$)|\|)/.test(text) || RE_MD_LINK_REFERENCE.test(text)) return `\\${text}`
  return text
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
      // `split('\n')` leaves one empty sentinel after a final newline. It is
      // not an additional blank line inside an unclosed HTML block.
      if (i === lines.length - 1 && line === '') break
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

  // A line left of that item's content is not the item's, whatever the item
  // was: it ends the item, and what it opens is measured from the quote again.
  const item = quotedItemColumn(held, lines, start, head.prefix)
  const base = indentColumns(head.text) < item ? 0 : item
  const isCode = (text: string): boolean =>
    base === 0 ? RE_MD_INDENTED_CODE.test(text) : indentColumns(text) >= base + 4
  const peel = (text: string): string =>
    base === 0 ? text.replace(/^(?: {4}|\t)/, '') : stripColumns(text, base + 4)
  if (!isCode(head.text)) return null

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
    if (!isCode(parsed.text)) break
    body.push(peel(parsed.text))
    end++
  }
  // A blank line does not end an indented code block, but trailing blanks
  // belong to the quote rather than to the code.
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop()
    end--
  }
  if (body.length === 0) return null
  return { prefix: ' '.repeat(contentCol) + head.prefix + ' '.repeat(base), lines: body, end }
}

/**
 * The content column of the list item a quote at `prefix` still holds above
 * `start`, or 0 when it holds none.
 *
 * A blank quote line leaves an item open; any other line left of the item's
 * content closes it, and that is measured against the marker once it is found,
 * not against column 0. Column 0 alone, `>  # h` under `> - alpha` kept an item
 * it had closed and the code below it was written into a list that had ended.
 *
 * A line that closes an INNER item while staying inside an outer one answers 0
 * rather than the outer item's column. That is what the quote answered before
 * this function existed, so it moves nothing; reaching the outer item is an
 * improvement this does not claim.
 */
function quotedItemColumn(
  held: (line: string) => string,
  lines: readonly string[],
  start: number,
  prefix: string,
): number {
  // The leftmost column an intervening line of the quote reached.
  let left = Infinity
  for (let at = start - 1; at >= 0; at--) {
    const parsed = blockquotePrefix(held(lines[at]!))
    if (!parsed || parsed.prefix !== prefix) return 0
    if (parsed.text.trim() === '') continue
    // A thematic break wins over a list item on a line both could open
    // (`> - ---`), so it opens no item to measure from; and an ordered marker
    // other than 1 cannot interrupt the paragraph above it (CommonMark 5.2),
    // so there it is paragraph text and opens none either.
    const marker = RE_MD_THEMATIC.test(parsed.text) ? null : RE_LIST_MARKER.exec(parsed.text)
    const ordered = marker === null ? null : /^[ \t]*(\d{1,9})[.)][ \t]/.exec(parsed.text)
    const above = ordered === null || at === 0 ? null : blockquotePrefix(held(lines[at - 1]!))
    const text =
      ordered !== null &&
      Number(ordered[1]) !== 1 &&
      above !== null &&
      above.prefix === prefix &&
      opensParagraph(above.text)
    if (marker && !text) {
      const content = itemContentColumn(marker[0])
      return left >= content ? content : 0
    }
    left = Math.min(left, indentColumns(parsed.text))
    if (left === 0) return 0
  }
  return 0
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
 */
export function markdownToCarve(
  markdown: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
): string {
  return markdownToCarveWithLosses(markdown, dialect).value
}

/**
 * {@link markdownToCarve} with what the conversion could not represent.
 */
export function markdownToCarveWithLosses(
  markdown: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
): { value: string; losses: MarkdownImportLoss[] } {
  const losses: MarkdownImportLoss[] = []
  importLosses = losses
  try {
    return { value: convertMarkdown(markdown, dialect), losses }
  } finally {
    useEmptyDestinationReferences(null)
    importLosses = []
  }
}

/**
 * A list item's collected lines with the marker `carve fmt` writes, the marker
 * line moved with the items around it and the lines under it with the item.
 */
function writeItemRun(
  run: { lines: string[] },
  markers: ListMarkers,
  onePad = false,
): { lines: string[]; separate: boolean } {
  const first = run.lines[0]!
  const written = markers.write(first, onePad)
  const markerCol = indentColumns(first)
  const content = columnWidth(RE_LIST_MARKER.exec(first)?.[0] ?? '')
  return {
    lines: [
      moveIndent(written.line, markerCol, markerCol + written.outer),
      ...run.lines.slice(1).map((line) => moveIndent(line, content, content + written.shift)),
    ],
    separate: written.separate,
  }
}

/**
 * Whether the item opening at `start`, collected up to `end`, can drop the
 * slack in its marker padding: only when nothing but the next item of this
 * list or an outer one follows it. A line the item holds past what it
 * collected, or one left of its content, could land in the wrong item once
 * the content column moves.
 */
function paddingIsFree(lines: readonly string[], start: number, end: number): boolean {
  const markerCol = indentColumns(lines[start]!)
  const content = columnWidth(RE_LIST_MARKER.exec(lines[start]!)?.[0] ?? '')
  for (let at = end; at < lines.length; at++) {
    const line = lines[at]!
    if (line.trim() === '') continue
    if (RE_ITEM_LINE.test(line)) return indentColumns(line) <= markerCol + 3
    // A line AT the item's content column is the item's own next block, and
    // `ListMarkers` moves it with the item, so the padding is free there too
    // (markup-carve/carve-js#1952).
    return content > 0 && indentColumns(line) === content
  }
  return true
}

/** Whether a line of item content leaves a paragraph a lazy line can continue. */
function opensParagraph(text: string): boolean {
  const trimmed = text.trimStart()
  return quoteParagraphIsOpen(trimmed) && !trimmed.startsWith('>') && !RE_LIST_MARKER.test(trimmed)
}

/**
 * Whether a collected list item ends in a table. The run writes every pipe row
 * that is text with its pipe escaped, so a line opening with one is a row.
 */
function endsInTable(run: { lines: string[] }): boolean {
  const last = run.lines.at(-1)!.replace(RE_LIST_MARKER, '')
  return last.trimStart().startsWith('|')
}

/** Whether a collected list item ends in paragraph text. */
function leavesItemParagraph(run: { lines: string[]; verbatimFrom?: number }): boolean {
  if (run.verbatimFrom !== undefined || endsInTable(run)) return false
  let last = run.lines.at(-1)!
  const own = RE_LIST_MARKER.exec(last)
  if (run.lines.length === 1 && own) last = last.slice(nestedItemsOnLine(last, own[0].length).at(-1)?.end ?? own[0].length)
  return opensParagraph(last)
}

/**
 * The quote markers of the quote paragraph a collected list item ends in, and
 * the column the quote sits at.
 */
function leavesItemQuote(run: { lines: string[]; verbatimFrom?: number }): { prefix: string; col: number } | null {
  if (run.verbatimFrom !== undefined) return null
  let last = run.lines.at(-1)!
  let col = indentColumns(last)
  const own = RE_LIST_MARKER.exec(last)
  if (run.lines.length === 1 && own) {
    const end = nestedItemsOnLine(last, own[0].length).at(-1)?.end ?? own[0].length
    col = columnWidth(last.slice(0, end))
    last = last.slice(end)
  }
  const prefix = openQuoteParagraph(last)
  return prefix === null ? null : { prefix, col }
}

/**
 * A blank line between every two items of each list the written source reads
 * loose, and between the blocks of each of its items, which is how `carve fmt`
 * spells a loose list. Those blank lines only confirm what the list already
 * is, so the reading stays the same.
 *
 * A blank line between two blocks of an item makes the list loose in
 * CommonMark, but in Carve only before a second paragraph (§17 L1). A list
 * Carve reads tight despite one is made loose the way fmt spells it: blank
 * lines between its items, or `{loose}` above a list of one item.
 */
function separateLooseItems(source: string, sourceBlanks: ReadonlySet<number>): string {
  if (!/\n[ \t>]*\n/.test(source)) return source
  const lines = source.split('\n')
  const isBlank = (at: number): boolean => /^[ \t>]*$/.test(lines[at] ?? '')
  const before: number[] = []
  const looseKeys = new Map<number, string>()
  const moved = new Map<number, string>()
  type Located = { pos?: { startLine: number; endLine: number; startColumn: number } }
  type Item = Located & { children?: Located[] }
  // Whether a blank line of the source parts two blocks of one of the items.
  // Not one the conversion put in, which parts nothing in the source.
  const parted = (items: readonly Item[]): boolean =>
    items.some((item) =>
      (item.children ?? []).some((child, idx) => {
        const prev = item.children![idx - 1]
        if (idx === 0 || !prev?.pos || !child.pos) return false
        for (let at = prev.pos.endLine; at < child.pos.startLine - 1; at++) if (sourceBlanks.has(at)) return true
        return false
      }),
    )
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const block = node as Located & { type?: string; tight?: boolean; items?: Item[]; children?: unknown[] }
    if (block.type === 'paragraph' || block.type === 'heading') return
    if (block.type === 'list') {
      let loose = block.tight === false
      if (block.tight === true && block.pos && parted(block.items!)) {
        const at = block.pos.startLine - 1
        const lead = lines[at]!.slice(0, block.pos.startColumn - 1)
        // A list opening on an outer item's line (`- - a`) moves to the next
        // line under its key, as fmt writes it.
        const outer = /^([ \t>]*)((?:(?:[-*+]|\d{1,9}[.)]) +)*)$/.exec(lead)
        if (block.items!.length > 1) loose = true
        else if (outer) {
          looseKeys.set(at, `${lead}{loose}`)
          if (outer[2] !== '') moved.set(at, outer[1] + ' '.repeat(outer[2]!.length) + lines[at]!.slice(lead.length))
          loose = true
        }
      }
      if (loose) {
        for (const [idx, item] of block.items!.entries()) {
          const starts = [...(idx > 0 ? [item] : []), ...(item.children ?? []).slice(1)]
          for (const start of starts) if (start.pos) before.push(start.pos.startLine - 1)
        }
      }
    }
    for (const child of [...(block.items ?? []), ...(block.children ?? [])]) visit(child)
  }
  visit(parse(source))
  if (before.length === 0) return source
  const starts = new Set(before)
  const written: string[] = []
  for (const [at, line] of lines.entries()) {
    const key = looseKeys.get(at)
    if (key !== undefined) written.push(key)
    if (starts.has(at) && at > 0 && !isBlank(at - 1)) {
      written.push(/^[ \t]*(?:>[ \t]?)*/.exec(line)![0].trimEnd().replace(/^[ \t]+$/, ''))
    }
    written.push(moved.get(at) ?? line)
  }
  return written.join('\n')
}

/**
 * The written lines joined, with 3+ consecutive newlines collapsed to 2, and
 * which lines of the result are blank lines of the source.
 */
function joinOutput(out: readonly string[], fromSource: readonly boolean[]): { text: string; sourceBlanks: Set<number> } {
  const lines: string[] = []
  const flags: boolean[] = []
  // Whether the line sits inside a fence, where an empty line is CONTENT rather
  // than block separation. The distinction used to be drawn at `=html` only, so
  // a raw block kept its blank lines while an ordinary code block one line away
  // still lost them.
  const fenced: boolean[] = []
  let fence: { marker: string; length: number } | null = null
  for (const [idx, entry] of out.entries()) {
    for (const line of entry.split('\n')) {
      const body = line.replace(/^(?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+))*[ \t]*/, '')
      const run = /^(`{3,}|~{3,})(.*)$/.exec(body)
      const closer = fence !== null && run !== null && run[1]![0] === fence.marker &&
        run[1]!.length >= fence.length && run[2]!.trim() === ''
      lines.push(line)
      flags.push(fromSource[idx]! && /^[ \t>]*$/.test(line))
      fenced.push(fence !== null && !closer)
      if (closer) fence = null
      else if (fence === null && run !== null && (run[1]![0] === '~' || !run[2]!.includes('`'))) {
        fence = { marker: run[1]![0]!, length: run[1]!.length }
      }
    }
  }
  const text: string[] = []
  const sourceBlanks = new Set<number>()
  for (let at = 0; at < lines.length; ) {
    if (lines[at] !== '') {
      if (flags[at]) sourceBlanks.add(text.length)
      text.push(lines[at++]!)
      continue
    }
    let end = at
    let flagged = false
    for (; end < lines.length && lines[end] === ''; end++) if (flags[end]) flagged = true
    // A run of empty lines is that many newlines, one more between two lines,
    // and a run of 3+ newlines keeps 2.
    const newlines = end - at + (at > 0 && end < lines.length ? 1 : 0)
    const keep = fenced.slice(at, end).some(Boolean)
      ? end - at
      : newlines < 3 ? end - at : at > 0 && end < lines.length ? 1 : 2
    for (let k = 0; k < keep; k++) {
      if (flagged) sourceBlanks.add(text.length)
      text.push('')
    }
    at = end
  }
  return { text: text.join('\n'), sourceBlanks }
}

/**
 * Write the blank line `carve fmt` puts inside an empty code block.
 *
 * A fence the import closed on the very next line renders the same empty
 * block either way, so this is bytes; without it the document failed
 * `fmt --check` (markup-carve/carve-js#1952). The blank carries the closer's
 * own container prefix, and the reading is checked before it is kept, the way
 * `separateLooseItems` answers from the parse.
 */
function blankInsideEmptyFences(source: string): string {
  const openers: number[] = []
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    type Block = {
      type?: string
      content?: string
      pos?: { startLine: number; endLine: number }
      items?: unknown[]
      children?: unknown[]
      footnoteDefs?: Record<string, unknown[]>
    }
    const block = node as Block
    if (
      block.type === 'code_block' &&
      block.content === '' &&
      block.pos !== undefined &&
      block.pos.endLine === block.pos.startLine + 1
    ) {
      openers.push(block.pos.startLine)
    }
    // A footnote definition's body hangs off the document rather than off its
    // children, so it needs naming to be reached.
    const held = Object.values(block.footnoteDefs ?? {}).flat()
    for (const child of [...(block.items ?? []), ...(block.children ?? []), ...held]) visit(child)
  }
  visit(parse(source))
  if (openers.length === 0) return source
  const lines = source.split('\n')
  const after = new Set(openers.map((line) => line - 1))
  const out: string[] = []
  for (const [at, line] of lines.entries()) {
    out.push(line)
    if (after.has(at)) out.push(/^[ \t>]*/.exec(lines[at + 1] ?? '')![0].trimEnd())
  }
  const written = out.join('\n')
  return reading(written) === reading(source) ? written : source
}

/** What a source reads as, with everything positional left out. */
function reading(text: string): string {
  return JSON.stringify(parse(text), (key, value) => (key === 'pos' || key === 'srcByteLength' ? undefined : value))
}

/** Matches a quote line carrying nothing but its own markers. */
const RE_BARE_QUOTE_LINE = /^ *>(?:[ \t]*>)*[ \t]*$/

/**
 * Drop an empty quote line the quote ENDS at, which `carve fmt` does not write.
 *
 * A blank line inside a quote separates two of its blocks, and fmt keeps it;
 * one the quote never comes back from carries nothing, and fmt drops it the way
 * it drops a trailing blank in any container. The import wrote it wherever the
 * source had one - `> alpha` over `>` at the document level as much as under
 * `- > alpha` - so an imported document holding one failed `fmt --check`
 * (markup-carve/carve-js#1947 case 2).
 *
 * A candidate is a quote line with a line of its own quote above it - dropping
 * the only line a quote has would delete the quote - that the next line does not
 * continue the quote of, or whose next line is itself a candidate: a run of them
 * is scanned from the end, since dropping the last leaves the one above it
 * trailing in turn.
 *
 * The reading decides whether the candidates go, because dropping one reopens
 * the paragraph above it for a lazy line. All of them at once answers it in two
 * parses, and one at a time from the end answers the rest - under a budget,
 * since that costs a parse per candidate and the alternative is quadratic in a
 * document built of them. Past the budget the lines stay, which is what the
 * import wrote before any of this.
 */
const TRAILING_QUOTE_LINE_PARSE_BUDGET = 32

function dropTrailingEmptyQuoteLines(source: string): string {
  const lines = source.split('\n')
  const candidates: number[] = []
  const trailing = new Set<number>()
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at]!
    if (!RE_BARE_QUOTE_LINE.test(line)) continue
    // A run of them is scanned from the end, but only a line spelled the same
    // way is part of the run: a DEEPER quote under this one is the block fmt
    // writes this very line to separate (markup-carve/carve-js#1921), and the
    // reading alone cannot tell, since both spellings read alike.
    const next = lines[at + 1] ?? ''
    if (next.startsWith(line.trimEnd()) && !(trailing.has(at + 1) && next.trimEnd() === line.trimEnd())) continue
    // The line above has to be a line of this quote, which it is when it holds
    // a marker no further right than this one's - `- > alpha` over `  >` as
    // much as `> alpha` over `>`.
    const above = lines[at - 1] ?? ''
    const marker = above.indexOf('>')
    if (marker < 0 || marker > line.indexOf('>')) continue
    trailing.add(at)
    candidates.unshift(at)
  }
  if (candidates.length === 0) return source
  const was = reading(source)
  const without = (drop: ReadonlySet<number>): string => lines.filter((_, at) => !drop.has(at)).join('\n')
  const all = without(new Set(candidates))
  if (reading(all) === was) return all
  if (candidates.length > TRAILING_QUOTE_LINE_PARSE_BUDGET) return source
  const drop = new Set<number>()
  for (const at of [...candidates].reverse()) {
    drop.add(at)
    if (reading(without(drop)) !== was) drop.delete(at)
  }
  return without(drop)
}

function convertMarkdown(markdown: string, dialect: MarkdownDialect): string {
  const allLines = markdown
    .replace(/\0/g, '\ufffd')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const { frontmatter, bodyStart } = splitFrontmatter(allLines)
  const removed = extractReferenceDefinitions(allLines.slice(bodyStart), decodeHtmlEntitiesRaw)
  useEmptyDestinationReferences(removed.references)
  const lines = removed.lines
  const out: string[] = []
  let terminalHtmlBlock = false
  // Where `out` holds a blank line of the source, as opposed to one the
  // conversion put in to separate two blocks.
  const sourceBlanks = new Set<number>()
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0
  // How many leading spaces to strip from the open fence's opener/body/closer,
  // so the migrated fence sits at its container's content column. See the
  // opener handler for how it is derived.
  let fenceStrip = 0
  // The content column of the list item holding the open fence, 0 outside one.
  let fenceCol = 0
  // Where the open fence's opener sits in `out`, and its info string. The
  // opener is rewritten at the closer, once the body says how long the
  // backtick fence `carve fmt` writes has to be.
  let fenceOut = -1
  let fenceInfoText = ''
  // How far the open fence's item moved (see `ListMarkers`), and whether a
  // blank line put the fence apart from the item content above it.
  let fenceShift = 0
  let fenceAfterBlank = false
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
  // A table starts only where its delimiter row sits in the container whose
  // paragraph the header line ends, lazily continued or not: a lazy delimiter,
  // or one four columns in, continues the paragraph instead.
  const headsTable = (at: number, col: number): boolean => {
    if (!startsTableHeader(lines, at)) return false
    const over = indentColumns(lines[at + 1]!) - col
    return over >= 0 && over < 4
  }
  // A pipe line no table takes is paragraph text, so an item paragraph takes it
  // as a lazy line.
  const lazyPipeLine = (at: number, col: number): boolean => {
    const text = lines[at]!.trim()
    if (/^(?:>|#{1,6}(?:[ \t]|$))/.test(text) || RE_LIST_MARKER.test(lines[at]!) || isMarkdownFenceLine(text)) return false
    return (isStandardTableRow(lines[at]!) || startsTableHeader(lines, at)) && !headsTable(at, col)
  }
  // Whether the line at `at` continues the paragraph of an item whose content
  // starts at `col`. What a line opens is measured from the innermost item
  // that holds it, and a setext underline cannot be lazy, so only one in the
  // item makes a heading.
  const continuesItemParagraph = (at: number, col: number): boolean => {
    const line = lines[at]!
    const held = (text: string): string => {
      let holder = 0
      for (const open of listCols) if (open <= Math.min(col, indentColumns(text))) holder = open
      return stripColumns(text, holder)
    }
    const next = lines[at + 1]
    const pair = next !== undefined && indentColumns(next) >= col ? [held(line), held(next)] : [held(line)]
    // Four columns past its holder a line opens nothing, so it continues.
    if (line.trim() !== '' && indentColumns(pair[0]!) >= 4) return true
    return isParagraphRunLine(pair, 0, 'text') || lazyPipeLine(at, col)
  }
  let inTableBody = false
  let tableWidth = 0
  const listMarkers = new ListMarkers()
  // The same for the lists a quote holds, kept across the empty quote lines
  // that split a quote into several runs, and dropped when the quote ends.
  const quoteMarkers = new Map<string, ListMarkers>()
  // was the previous line blank? A dedented line only leaves a list item when a
  // blank precedes it; without a blank it is lazy paragraph continuation and
  // the item stays open (CommonMark).
  let prevBlank = true
  // Whether the last line left a paragraph open inside a list item, which a
  // lazy line can continue.
  let itemParagraph = false
  // The quote markers of a quote paragraph the last item line left open, or
  // null. A lazy line continues that paragraph.
  let itemQuote: { prefix: string; col: number } | null = null
  // The content column of the item the last line lazily continued, or -1.
  let lazyCol = -1
  // Whether the last line ended a fence opened on an item's own line, or a
  // table the item holds: neither takes a lazy line.
  let fenceItem = false
  // The container column of the last quote written.
  let quoteCol = 0
  // The lines the current iteration wrote move with the items holding them:
  // those at or past `shiftCol` by `shiftBy` columns. Branches that place their
  // lines themselves set `shiftBy` to 0.
  let shiftFrom = 0
  let shiftCol = 0
  let shiftBy = 0
  const applyShift = (): void => {
    if (shiftBy !== 0) {
      for (let at = shiftFrom; at < out.length; at++) {
        out[at] = out[at]!
          .split('\n')
          .map((text) => moveIndent(text, shiftCol, shiftCol + shiftBy))
          .join('\n')
      }
    }
    shiftFrom = out.length
    shiftBy = 0
  }
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
    applyShift()
    // A tab after the marker of an item this line opens pads it to the next
    // tab stop. Not on a line four columns past the item holding it, which is
    // code or text, nor on an ordered marker other than 1 under a paragraph.
    if (!inCode && /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(lines[i]!) && lines[i]!.includes('\t')) {
      const at = indentColumns(lines[i]!)
      let holder = 0
      for (const col of listCols) if (col <= at) holder = col
      const ordered = /^[ \t]*(\d+)[.)]/.exec(lines[i]!)
      const prose = prevType === 'text' && ordered !== null && Number(ordered[1]) !== 1 && !listMarkers.hasListAt(at)
      if (at - holder < 4 && !prose) lines[i] = spaceMarkerPadding(lines[i]!)
    }
    const line = lines[i]!
    const trimmed = line.trim()
    const wasPrevBlank = prevBlank
    const lazyAllowed = itemParagraph
    itemParagraph = false
    const lazyQuote: { prefix: string; col: number } | null = itemQuote
    itemQuote = null
    const afterLazy = lazyCol
    lazyCol = -1
    const orderedInItemParagraph = (source: string): boolean => {
      const candidate = /^[ \t]*(\d+)[.)](?=[ \t])/.exec(source)
      return candidate !== null && Number(candidate[1]) !== 1 &&
        !listMarkers.hasListAt(indentColumns(source))
    }
    const orderedContinuesItem = !wasPrevBlank && lazyAllowed && listCols.length > 0 &&
      orderedInItemParagraph(line)
    const closedItem = fenceItem
    const afterTable = inTableBody
    // Whether this line left items no paragraph was open in.
    let leftItems = false
    const afterFence = prevType === 'code_fence' || fenceItem
    fenceItem = false
    prevBlank = trimmed === ''
    if (!trimmed.startsWith('>')) quoteMarkers.clear()
    const reachesMovedItem = trimmed !== '' && listMarkers.reachedByMove(indentColumns(line))

    // Maintain the list-item content-column stack. A marker opens an item whose
    // content starts after the marker (the task checkbox is content, so its
    // width is NOT part of the column); a blank line is transparent (a loose
    // item continues); a non-blank line pops items whose content starts to its
    // right. Code content never changes list tracking.
    let marker: RegExpMatchArray | null = null
    let overMarker = false
    if (!inCode) {
      // A thematic break wins over a list item on a line that could be read as
      // either (CommonMark: `* * *` is a rule, not a bullet holding `* *`).
      // Counted as a marker its columns became a content column, and the rule
      // itself - and every block after it - was padded out to them.
      const openCol = listCols.length ? listCols[listCols.length - 1]! : 0
      marker = RE_MD_THEMATIC.test(stripColumns(line, openCol))
        ? null
        : line.match(/^([ \t]*)(?:[-*+]|\d+[.)]) +/)
      if (orderedContinuesItem) marker = null
      // Four columns past the item holding it, a marker under an open
      // paragraph is text of that paragraph (indented code cannot interrupt).
      const anyMarker = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/.exec(line)
      if (anyMarker && (lazyAllowed || lazyQuote !== null)) {
        const markerIndent = columnWidth(anyMarker[1]!)
        let parentContent = 0
        for (const col of listCols) if (col <= markerIndent) parentContent = col
        if (markerIndent >= parentContent + 4) {
          marker = null
          overMarker = true
        }
      }
      // Anywhere else, four columns past the item holding it a marker line is
      // indented code, never an item.
      if (anyMarker && !overMarker) {
        const markerIndent = columnWidth(anyMarker[1]!)
        let parentContent = 0
        for (const col of listCols) if (col <= markerIndent) parentContent = col
        if (markerIndent >= parentContent + 4) marker = null
      }
      // Columns, not characters: the stack is compared against a line's indent
      // and a tab is worth four of them.
      const indent = indentColumns(line)
      // A dedented line leaves a list item when a blank precedes it OR the line
      // itself starts a block (heading, block quote, fence, thematic break) --
      // those interrupt lazy paragraph continuation, so the item ends (§10).
      // Four columns past the item holding it, an opener starts nothing.
      let holder = 0
      for (const col of listCols) if (col <= indent) holder = col
      const startsBlock =
        indent - holder < 4 &&
        (/^#{1,6}([ \t]|$)/.test(trimmed) ||
        trimmed.startsWith('>') ||
        isMarkdownFenceLine(trimmed) ||
        htmlBlockAt(lines, i) !== null ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed))
      // A block a fence or table ended every item for is set apart from the
      // list, as fmt writes it.
      if (closedItem && trimmed !== '' && !marker && listCols.length && listCols[0]! > indent && out.at(-1)?.trim() !== '') {
        out.push('')
      }
      // Only a paragraph takes a lazy line, so after any other block a line
      // left of the item's content leaves it.
      const noLazy = !lazyAllowed && lazyQuote === null && (prevType === 'list' || prevType === 'heading')
      if (marker && /\S/.test(line.slice(marker[0].length))) {
        const markerIndent = columnWidth(marker[1]!)
        while (listCols.length && listCols[listCols.length - 1]! > markerIndent) listCols.pop()
        listCols.push(itemContentColumn(marker[0]!))
        // And the items the line nests (`- - a`), the innermost perhaps holding
        // indented code.
        const nested = nestedItemsOnLine(line, marker[0].length)
        for (const inner of nested) listCols.push(inner.content)
        const nestedEnd = nested.at(-1)?.end ?? marker[0].length
        const codeItem = /^(?:[-*+]|\d{1,9}[.)])(?= {5,}\S)/.exec(line.slice(nestedEnd))
        if (codeItem && itemContentColumn(marker[0]!) === columnWidth(marker[0]!)) {
          listCols.push(columnWidth(line.slice(0, nestedEnd + codeItem[0].length)) + 1)
        }
      } else if (trimmed !== '' && (wasPrevBlank || startsBlock || afterFence || noLazy)) {
        while (listCols.length && listCols[listCols.length - 1]! > indent) {
          listCols.pop()
          leftItems = noLazy
        }
      }
      if (trimmed !== '' && !marker) listMarkers.end(listCols.length ? listCols[listCols.length - 1]! : 0)
      // A line left of an item whose last block was a fence ends the item's
      // list, a fence taking no lazy line; an item after it numbers from its
      // own marker.
      if (trimmed !== '' && !marker && afterFence && listCols.length && indent < listCols[listCols.length - 1]!) {
        listMarkers.leave(indent)
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
    shiftCol = inCode ? fenceCol : contentCol
    shiftBy = inCode ? fenceShift : listMarkers.shiftAt(contentCol)

    if (overMarker) {
      const text = escapeBlockOpener(line.trimStart())
      if (lazyQuote !== null) {
        shiftCol = lazyQuote.col
        shiftBy = listMarkers.shiftAt(lazyQuote.col)
        out.push(convertInline(' '.repeat(lazyQuote.col) + lazyQuote.prefix + text, dialect))
        itemQuote = lazyQuote
      } else {
        out.push(convertInline(containerPad + text, dialect))
        itemParagraph = true
      }
      prevType = 'list'
      continue
    }

    // A lazy line continues the paragraph of the item above it (CommonMark
    // 5.2), and is written at that item's content column, as fmt writes it.
    if (
      (lazyAllowed || lazyQuote !== null) &&
      !inCode &&
      !marker &&
      listCols.length > 0 &&
      indentColumns(line) < contentCol &&
      continuesItemParagraph(i, contentCol)
    ) {
      const run: string[] = []
      let end = i
      // Under a quote the item holds, every line continues the quote, at the
      // quote's column.
      if (lazyQuote !== null) {
        shiftCol = lazyQuote.col
        shiftBy = listMarkers.shiftAt(lazyQuote.col)
      }
      while (
        end < lines.length &&
        (!RE_LIST_MARKER.test(lines[end]!) || orderedInItemParagraph(lines[end]!)) &&
        continuesItemParagraph(end, contentCol)
      ) {
        const next = lines[end]!
        let holder = 0
        for (const col of listCols) if (col <= indentColumns(next)) holder = col
        const lazyText = indentColumns(next) - holder >= 4 || orderedInItemParagraph(next)
          ? escapeBlockOpener(next.trimStart()) : next.trimStart()
        if (lazyQuote !== null) run.push(' '.repeat(lazyQuote.col) + lazyQuote.prefix + lazyText)
        else run.push(indentColumns(next) < contentCol ? containerPad + lazyText
          : orderedInItemParagraph(next) || indentColumns(next) - holder >= 4
            ? ' '.repeat(indentColumns(next)) + lazyText : next)
        end++
      }
      out.push(keepPipeRowsLiteral(convertInline(run.join('\n'), dialect)))
      i = end - 1
      itemParagraph = true
      itemQuote = lazyQuote
      lazyCol = contentCol
      prevType = 'list'
      continue
    }
    // Past a lazy line, what the item holds reads as after the item line. A
    // block left of the item follows a paragraph instead, except an item of a
    // list open at its column; any other marker there starts a list of its
    // own, whatever its number, since it is outside the paragraph's item.
    let startsOwnList = false
    if (afterLazy >= 0 && trimmed !== '' && indentColumns(line) < afterLazy) {
      const isMarker = RE_LIST_MARKER.test(line)
      if (!isMarker || !listMarkers.hasListAt(indentColumns(line))) {
        prevType = 'text'
        startsOwnList = isMarker
      }
    }

    // Opening fence — a >=3 run of ` or ~, indented at most 3 spaces (the
    // Markdown rule). Carve accepts a single language token over a real-world
    // charset (c++, c#, asp.net, text/html are valid), so the Markdown info
    // string is normalized to its first such token — keeping `c++`/`text/html`
    // intact and reducing an extended info (```js title="x") to ```js (still a
    // code block). The charset matches RE_FENCE in parse.ts, including `/`.
    // Four columns past the container, a tab counted where it stands, the line
    // is indented code.
    const open = !inCode && indentColumns(line) - contentCol < 4 ? RE_MD_FENCE_LINE.exec(held) : null
    if (open && fenceRunIsAFence(open[2]!, open[3]!)) {
      // A fence interrupts the paragraph of the item holding it.
      if (prevType !== 'blank' && !(prevType === 'list' && contentCol > 0) && out.length > 0) out.push('')
      inCode = true
      fenceChar = open[2]![0]!
      fenceLen = open[2]!.length
      const info = fenceInfo(open[3]!)
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
      // A tab there is as wide as the stop it reaches from where it stands.
      fenceStrip = Math.max(0, indentColumns(line) - contentCol)
      fenceCol = contentCol
      fenceShift = shiftBy
      fenceAfterBlank = wasPrevBlank && contentCol > 0
      // Whatever the opener's own indent was, what survives the strip is
      // exactly the content column, so the fence goes back there.
      fenceOut = out.length
      fenceInfoText = info
      out.push(containerPad + open[2]! + info)
      prevType = 'code_fence'
      continue
    }

    // Inside a fence — a closer is a run of the same char at least as long as
    // the opener (indented by at most 3 spaces); a shorter inner run is code.
    if (inCode) {
      // A fence cannot continue lazily, so a line left of its item's content
      // ends the item and the fence with it (CommonMark 5.2).
      if (trimmed !== '' && indentColumns(line) < fenceCol) {
        shiftBy = 0
        out.push(closeFence(out, fenceOut, ' '.repeat(fenceCol + fenceShift), fenceInfoText))
        inCode = false
        fenceChar = ''
        fenceLen = 0
        fenceStrip = 0
        fenceCol = 0
        prevType = 'code_fence'
        i--
        continue
      }
      // The strip comes off past the content column, which the body keeps.
      const dedented =
        line.trim() === ''
          ? stripColumns(line, fenceStrip)
          : ' '.repeat(fenceCol) + stripColumns(line, Math.min(indentColumns(line), fenceCol + fenceStrip))
      if (new RegExp(`^\\s{0,3}(${fenceChar}{${fenceLen},})\\s*$`).test(stripColumns(line, fenceCol))) {
        inCode = false
        fenceChar = ''
        fenceLen = 0
        fenceStrip = 0
        shiftBy = 0
        out.push(closeFence(out, fenceOut, ' '.repeat(fenceCol + fenceShift), fenceInfoText))
        // A blank line before a line that returns to an enclosing item would
        // make that item loose.
        const next = lines[i + 1]
        const nextIndent = next === undefined ? 0 : indentColumns(next)
        if (next !== undefined && next.trim() !== '' && !(nextIndent > 0 && nextIndent < fenceCol)) out.push('')
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
      if (markdown.endsWith('\n') && i >= lines.length - 2) terminalHtmlBlock = true
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
      // A quote interrupts the paragraph of the item holding it.
      const inItem = prevType === 'list' && contentCol > 0
      if (prevType !== 'blank' && prevType !== 'block_quote' && !inItem && out.length > 0) out.push('')
      for (const emitted of [fence, ...quotedCode.lines, fence]) {
        out.push(emitted === '' ? quotedCode.prefix.trimEnd() : quotedCode.prefix + emitted)
      }
      // A block after the code in the same quote, or in one nested or around
      // it, is set apart from it by an empty line of the outer quote.
      const after = quotedCode.end < lines.length ? blockquotePrefix(stripColumns(lines[quotedCode.end]!, contentCol).replace(/^[ \t]{1,3}(?=>)/, '')) : null
      if (after !== null && after.text.trim() !== '') {
        const outer = ' '.repeat(contentCol) + (after.prefix.length < quotedCode.prefix.length - contentCol ? after.prefix : quotedCode.prefix.slice(contentCol))
        out.push(outer.trimEnd())
      }
      i = quotedCode.end - 1
      quoteCol = contentCol
      prevType = 'block_quote'
      continue
    }

    // A Markdown INDENTED code block becomes a Carve FENCE. Carve has no
    // indented code block, so carrying the run through byte-for-byte did not
    // preserve it - it made the code a PARAGRAPH, and the code's own `*` and
    // `_` were then read as emphasis: `    let x = *not bold*` rendered as
    // `<p>let x = <strong>not bold</strong></p>`.
    //
    // The previous line must be blank or a block that takes no continuation
    // line, like a heading, so an indented line under a list item - which is
    // item continuation, not code - never reaches here. The four
    // columns are counted from the container's content column, not from column
    // 0: a paragraph sitting AT a nested item's content column is the item's
    // own content, and reading it as code both lost the paragraph and moved it
    // out of the item.
    if (
      // After a quote too: a line its paragraph would take is already in it.
      (wasPrevBlank || prevType === 'blank' || prevType === 'code' || prevType === 'heading' || prevType === 'block_quote' || afterFence || afterTable || leftItems) &&
      trimmed !== '' &&
      // Measured on the line, as `relIndent` below is.
      indentColumns(line) - contentCol >= 4
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
      if (markdown.endsWith('\n') && i >= lines.length - 2) terminalHtmlBlock = true
      if (i + 1 === lines.length - 1 && lines[i + 1] === '') {
        out.push('')
        i++
      } else if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
      prevType = 'raw_block'
      continue
    }

    // An ordered marker other than `1` cannot interrupt a paragraph
    // (CommonMark), so after a paragraph it stays prose; bullets and `1.`
    // always start/continue a list. Mid-list, any number continues.
    const ordered = trimmed.match(/^(\d+)[.)]\s/)
    const isList =
      (/^[-*+]\s/.test(trimmed) || ordered !== null) &&
      !orderedContinuesItem &&
      !(
        prevType === 'text' &&
        !startsOwnList &&
        ordered !== null &&
        Number(ordered[1]) !== 1 &&
        // The next item of an open list is one, whatever its number.
        !listMarkers.hasListAt(indentColumns(line))
      )
    // A header GFM would not take here leaves its rows as text.
    if (inGfmTable[i] && startsTableHeader(lines, i) && !headsTable(i, contentCol)) {
      for (let at = i; at < lines.length && inGfmTable[at]; at++) inGfmTable[at] = false
    }
    // GFM table header: a `| ... |` row immediately followed by a delimiter
    // row (`| --- | :--: |`). Carve marks header cells with `|=` (alignment
    // glued as `<`/`>`/`~`) and needs no delimiter row, so rewrite the header
    // and drop the delimiter. Body rows are already valid Carve and fall
    // through as plain text below, so only the header is special-cased here.
    // An item or quote line is left to its collector, which finds a table the
    // item or quote holds.
    if (!isList && !trimmed.startsWith('>') && !/^#{1,6}([ \t]|$)/.test(trimmed) && headsTable(i, contentCol)) {
      const next = lines[i + 1]!.trim()
      if (next.includes('-') && RE_TABLE_DELIMITER.test(next)) {
        const headerCells = splitTableRow(trimmed)
        const aligns = splitTableRow(next).map(alignMarker)
        // GFM requires the delimiter row to have the same column count as the
        // header; a mismatch (e.g. `a | b` over `---`) is not a table, so leave
        // it for the setext/thematic-break handling below.
        if (aligns.length === headerCells.length) {
          const header = writeTableRow(
            headerCells,
            aligns.map((align) => `=${align}`),
            dialect,
          )
          if (prevType !== 'blank' && out.length > 0) out.push('')
          // At the container's content column, so the converted header keeps
          // the item that holds it. Written at column 0 it left the item while
          // the body rows stayed behind, splitting one table into two blocks.
          if (keepTableRow(header)) out.push(containerPad + header)
          i++ // consume the delimiter row
          prevType = 'text'
          inTableBody = true
          tableWidth = headerCells.length
          continue
        }
      }
    }

    // A body row of the table above. Rebuilt rather than passed through, so its
    // padding matches the formatter's and a pipeless row stays in the table.
    if (inTableBody && inGfmTable[i] && trimmed !== '') {
      const row = writeTableRow(splitTableRow(trimmed), [], dialect, tableWidth)
      if (keepTableRow(row)) out.push(containerPad + row)
      continue
    }
    inTableBody = false

    const isBlank = trimmed === ''
    const isHeading = /^#{1,6}\s/.test(trimmed)
    const indent = line.length - line.replace(/^\s+/, '').length
    // How far the line sits PAST its container's content column - the measure
    // Markdown's 0-3 space slack and its four-column code rule are both stated
    // in. `indent` is the absolute one, which is the same number only at the
    // document level.
    // Measured on the line: a tab `held` starts with is narrower than four
    // columns when the content column is not on a tab stop.
    const relIndent = Math.max(0, indentColumns(line) - contentCol)
    const isBlockquote = trimmed.startsWith('>')

    if (isBlank) {
      sourceBlanks.add(out.length)
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
    if (prevType === 'list' && indent >= 1 && listCols.length > (isList ? 1 : 0)) {
      if (isList) {
        const run = collectListInlineRun(lines, i, dialect)
        if (lazyQuote !== null && indentColumns(line) >= lazyQuote.col) out.push('')
        out.push(...writeItemRun(run, listMarkers, paddingIsFree(lines, i, run.end)).lines)
        shiftBy = 0
        itemParagraph = leavesItemParagraph(run)
        itemQuote = leavesItemQuote(run)
        fenceItem = run.verbatimFrom !== undefined || endsInTable(run)
        i = run.end - 1
        prevType = 'list'
        continue
      }
      // One to three columns past the item's content read as none.
      const slack = relIndent
      // A fence a quote opens here is the quote collector's to write and close.
      const quoted = blockquotePrefix(held.trimStart())
      const prevInItem = i > 0 && lines[i - 1]!.trim() !== '' && indentColumns(lines[i - 1]!) >= contentCol
      if (
        // `lazyQuote` is the quote the item run above left open, which is where
        // this fence stands when the item's own marker line opened that quote:
        // `prevInItem` cannot see that line, since a marker line sits LEFT of
        // the content column it establishes (carve-js#2028).
        (afterLazy >= 0 || prevInItem || lazyQuote !== null) &&
        indentColumns(line) >= contentCol &&
        slack < 4 &&
        quoted !== null &&
        isMarkdownFenceLine(quoted.text)
      ) {
        const run = collectBlockquoteInlineRun(lines, i, dialect, contentCol, quoteMarkers)
        quoteCol = contentCol
        if (run.blank) sourceBlanks.add(out.length)
        // The paragraph this fence interrupts is on the item's own marker line,
        // so it is not in this run and the collector cannot set the two apart
        // the way `fmt` does.
        if (lazyQuote !== null) out.push(' '.repeat(contentCol) + quoted.prefix.trimEnd())
        out.push(...run.lines)
        i = run.end - 1
        prevType = 'block_quote'
        continue
      }
      const content = slack >= 1 && slack <= 3 ? containerPad + held.trimStart() : line
      const written = convertInline(orderedContinuesItem
        ? content.replace(/^(\s*)(\S.*)$/, (_match, indent: string, body: string) => indent + escapeBlockOpener(body))
        : content, dialect)
      // No table starts here, so a pipe row is paragraph text, in a quote too
      // unless a delimiter row makes it a quoted table.
      const pipeText = isStandardTableRow(written)
      const quotedBody = (text: string | undefined): string =>
        peelQuoteMarkers(stripColumns(text ?? '', contentCol).trimStart()).body.trim()
      const quotedTable = [quotedBody(line), quotedBody(lines[i + 1])].some((body) => RE_TABLE_DELIMITER.test(body) && body.includes('-'))
      out.push(pipeText ? keepPipeRowLiteral(written) : quotedTable ? written : keepPipeRowsLiteral(written))
      itemParagraph = indentColumns(line) >= contentCol && (pipeText || opensParagraph(held))
      const quote = indentColumns(line) >= contentCol ? openQuoteParagraph(held) : null
      if (quote !== null) itemQuote = { prefix: quote, col: contentCol }
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
      (/^=+$/.test(underline) || /^-+$/.test(underline)) &&
      // Four columns past its container an underline is paragraph text.
      indentColumns(stripColumns(lines[i + 1]!, contentCol)) < 4
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
    // A quote at another container column than the one above is another quote.
    if (isBlockquote && prevType !== 'blank' && (prevType !== 'block_quote' || quoteCol !== contentCol)) out.push('')
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
    // So does a paragraph an item above it would take in once that item's
    // content column moved left.
    // Lists are dedented by `ListMarkers`, which moves their siblings along.
    const dedent = relIndent >= 1 && relIndent <= 3 && (isHeading || isBlockquote || ((reachesMovedItem || listCols.length > 0) && !isList))
    let body = dedent ? containerPad + line.slice(indent) : line
    // Strip an ATX heading's optional closing `#` run (Carve keeps it as text).
    if (isHeading) body = body.replace(/[ \t]+#+[ \t]*$/, '')
    // Carve has no `+` bullet (it is the list-continuation marker); normalize a
    // Markdown `+` bullet to `-` so the converted list survives.
    if (isList) body = body.replace(/^(\s*)\+(\s)/, '$1-$2')
    if (isBlockquote) {
      const run = collectBlockquoteInlineRun(lines, i, dialect, contentCol, quoteMarkers)
      quoteCol = contentCol
      if (run.blank) sourceBlanks.add(out.length)
      out.push(...run.lines)
      i = run.end - 1
      prevType = 'block_quote'
      continue
    }
    if (isList) {
      const run = collectListInlineRun(lines, i, dialect)
      const written = writeItemRun(run, listMarkers, paddingIsFree(lines, i, run.end))
      // A list under a quote an item holds is set apart from it, or Carve reads
      // the marker line as the quote's lazy continuation.
      if ((written.separate && prevType === 'list') || (lazyQuote !== null && indentColumns(line) >= lazyQuote.col)) out.push('')
      out.push(...written.lines)
      shiftBy = 0
      itemParagraph = leavesItemParagraph(run)
      itemQuote = leavesItemQuote(run)
      fenceItem = run.verbatimFrom !== undefined || endsInTable(run)
      i = run.end - 1
      prevType = 'list'
      continue
    }
    if (!isHeading && !isList && !isBlockquote && (!isStandardTableRow(body) || !inGfmTable[i])) {
      const run = [body]
      // The same lines with no block-opener escape, for the fold below. An
      // escape has to earn its place by protecting against something, and a
      // marker in the middle of a one-line heading could not have opened a
      // block, so escaping it there spells a construct that is not present
      // (carve#2244). The paragraph branch keeps `run`, where each line does
      // start one and the escape is load-bearing.
      const bare = [body]
      let end = i + 1
      while (end < lines.length) {
        const next = lines[end]!
        // Four columns past its container a line opens nothing, so it continues.
        const inside = (text: string): string => (indentColumns(text) >= contentCol ? stripColumns(text, contentCol) : text)
        const after = lines[end + 1]
        const opens = !isParagraphRunLine(after === undefined ? [inside(next)] : [inside(next), inside(after)], 0, 'text')
        if (opens && (next.trim() === '' || indentColumns(stripColumns(next, contentCol)) < 4)) break
        // A line of only `=` is a setext underline and nothing else, so the run
        // ends at it and the fold below reads it. A `-` underline reaches this
        // as a thematic break and stops the run already; an `=` one matched no
        // opener, so the run swallowed it and every paragraph whose middle line
        // sat four columns in stayed a paragraph.
        if (/^=+$/.test(next.trim()) && indentColumns(next) >= contentCol && indentColumns(inside(next)) < 4) break
        // The next item of an open list, whatever its number, ends the paragraph.
        if (listCols.length > 0 && RE_LIST_MARKER.test(next) && indentColumns(next) < contentCol && listMarkers.hasListAt(indentColumns(next))) break
        const trimmedNext = next.trimStart()
        // carve#2256 rules the escape by whether the marker would be structural
        // AT COLUMN 0, and `fmt` dedents this line to column 0. `opens` is
        // measured where the line stands, which is the right reading for ending
        // the run and the wrong one for the escape: `RE_MD_THEMATIC` is anchored
        // at three columns of slack, so a thematic run four columns in was not
        // read as one and went out bare. `fmt` then wrote the escape itself, so
        // the import was not a fixed point of this engine's own formatter.
        //
        // The thematic run and nothing else. A tilde fence interrupts no
        // paragraph in Carve, a lone pipe is no table without its delimiter row
        // and an equals line opens nothing at all, so an escape on any of those
        // would guard nothing (carve#2244). Measured one spelling at a time
        // rather than widened to "whatever opens a block at column 0", which
        // reads the fence at any indent and would have taken `~~~` with it.
        const structural = opens || RE_MD_THEMATIC.test(trimmedNext)
        run.push(structural ? next.slice(0, next.length - trimmedNext.length) + escapeBlockOpener(trimmedNext) : next)
        bare.push(next)
        end++
      }
      // A setext underline under the paragraph, after the run or after the
      // line the run stopped at, makes the whole paragraph the heading.
      let heading = run.length > 1 && end < lines.length ? setextParagraphEnd(lines, end - 1, contentCol, true) : null
      if (heading === null && end + 1 < lines.length) {
        heading = setextParagraphEnd(lines, end, contentCol)
        if (heading !== null) {
          run.push(lines[end]!)
          bare.push(lines[end]!)
          end++
        }
      }
      if (heading !== null) {
        if (prevType !== 'blank' && prevType !== 'heading') out.push('')
        out.push(containerPad + convertInline(`${heading} ${bare.map(headingLine).join(' ')}`, dialect))
        i = end
        if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
        prevType = 'heading'
        continue
      }
      if (run.length > 1) {
        // A line of the run left of the item's content column is lazy.
        const inItem = listCols.length > 0 && indentColumns(line) >= contentCol
        out.push(
          keepPipeRowsLiteral(
            convertInline(
              run
                .map((text) =>
                  inItem && indentColumns(text) < contentCol && !RE_LIST_MARKER.test(text) ? containerPad + text.trimStart() : text,
                )
                .join('\n'),
              dialect,
            ),
          ),
        )
        itemParagraph = inItem
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
    itemParagraph = listCols.length > 0 && indentColumns(line) >= contentCol && !isHeading && opensParagraph(held)

    if (isHeading && i + 1 < lines.length) {
      const next = lines[i + 1]!.trim()
      if (next !== '' && !/^#{1,6}\s/.test(next)) out.push('')
    }

    if (isHeading) prevType = 'heading'
    else if (isList) prevType = 'list'
    else if (isBlockquote) prevType = 'block_quote'
    else prevType = 'text'
  }

  applyShift()
  // A fence the document never closed runs to its end, blank lines included,
  // and is closed there; the line the final newline leaves stays last.
  //
  // Not one set apart from its item's content by a blank line with a blank
  // line of its own before more code: GFM reads that item loose, and so does
  // Carve while the fence is open, but closed it reads tight (a fence attaches
  // to the content above it), and only `{loose}` could say otherwise.
  let lastCode = out.length - 1
  while (lastCode > fenceOut && out[lastCode]!.trim() === '') lastCode--
  const blankInside = out.slice(fenceOut + 1, lastCode).some((text) => text.trim() === '')
  if (inCode) {
    const finalNewline = lines.at(-1) === '' && out.at(-1) === ''
    if (finalNewline) out.pop()
    const closer = closeFence(out, fenceOut, ' '.repeat(fenceCol + fenceShift), fenceInfoText)
    if (!(fenceAfterBlank && blankInside)) out.push(closer)
    if (finalNewline) out.push('')
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
  const fromSource = out.map((_, idx) => sourceBlanks.has(idx))
  if (
    frontmatter.length === 0 &&
    out[0] === '---' &&
    out.slice(1).some((l) => /^---\s*$/.test(l))
  ) {
    out.unshift('')
    fromSource.unshift(false)
  }

  if (removed.definitions.length > 0) {
    while (out.length > 0 && out.at(-1)!.trim() === '') out.pop()
    for (const definition of removed.definitions) {
      if (out.length > 0) out.push('')
      out.push(convertInline(definition, dialect))
    }
    if (markdown.endsWith('\n')) out.push('')
  }
  const written = joinOutput(out, fromSource)
  let body = dropTrailingEmptyQuoteLines(
    blankInsideEmptyFences(separateLooseItems(escapeCarveOnlyMarkersOutsideFences(written.text), written.sourceBlanks)),
  ).replace(/\x00REFITEM\x00/g, '%%')
  if (terminalHtmlBlock && !body.endsWith('\n')) body += '\n'
  const output = frontmatter.length === 0
    ? body
    : body === '' ? frontmatter.join('\n') : `${frontmatter.join('\n')}\n${body}`
  // The writer collects footnote definitions at document end. Apply that
  // ordering only when the parsed import actually defines a footnote.
  if (/(?:^|\n)[ \t]{0,3}\[\^[^\]\n]+\]:/.test(output)) {
    const doc = parse(output)
    if (Object.keys(doc.footnoteDefs ?? {}).length > 0) {
      const ordered = renderCarve(doc)
      return markdown.endsWith('\n') ? ordered : ordered.replace(/\n$/, '')
    }
  }
  return output
}
