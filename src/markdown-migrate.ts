import { spellEmptyItemPlaceholders } from './import/empty-item-placeholder.js'
import { freeMarkerSerial } from './parse/list/marker-serial.js'
import { protectNativeMarkdownDestinationGlyphs } from './import/markdown/markdown-native-destination-glyphs.js'
import { encodeMarkdownDestinationCharacter, writeMarkdownDestinationValue } from './import/markdown/markdown-destination-encoding.js'
import type { BlockNode, Document, InlineNode, List } from './ast.js'
import { orderedMarker } from './render-carve.js'
import { isCarveWhitespace, trimMatchingEdges, trimEndSpaceTab } from './trim-non-nbsp.js'
import { escapeInactiveMarkdownLinkBrackets, markdownActiveLinkLabelRanges, protectMarkdownLinkLabels, markdownInlineDestinationEnd } from './import/markdown/markdown-link-scopes.js'
import { parseFragment } from 'parse5'
import { SourceUnspellableError } from './source/source-unspellable-error.js'
import { isValidAttrPayload, isValidInlineAttrPayload, unescapeAttrValue } from './extension/attribute-parser.js'
import { completeDestinationOpeners } from './link-destination.js'
import { markdownEmphasis, recordMarkdownProtectedDepth } from './import/markdown/markdown-emphasis.js'
import { markdownBareLinks, markdownRawBareLinks } from './import/markdown/markdown-gfm-autolinks.js'
import { backtickRunEnds } from './parse/inline/backtick-run-index.js'
import { opensCodeFence } from './parse/block/parse-quote-core.js'
import { linkMarkdownEmailText } from './import/markdown/markdown-email-links.js'
import { GITHUB_ALERT_LABEL, importGithubAlerts } from './import/markdown/markdown-github-alerts.js'
import { canonicalCarveWrite } from './ast/canonical-carve-write.js'
import { convertedIds, protectUnresolvedCrossrefs } from './import/html/imported-crossrefs.js'
import { rewriteSameFileHeadingLinks, type FragmentFixup } from './import/markdown/markdown-heading-fragments.js'
/*
 * Markdown -> Carve converter.
 */

import {
  escapeAttributeBlockOpener,
  escapeUnclosedImageEditorialOpeners,
  escapePlainCarveInlineSyntax,
  escapePlainCarveInlineSyntaxAround,
  escapeVerbatimDelimiter,
  HANDLED_MARKDOWN,
} from './carve-escape.js'
import {
  escapeLineInitialBlockSyntax,
  extractReferenceDefinitions,
  importedFootnoteLabel,
  plainAltText,
  referenceDestinationLabel,
  referenceInlineTarget,
  isEmptyDestinationReference,
  referenceSourceLabel,
  referenceSourceText,
  referenceLiteralText,
  unwrapEmptyDestinations,
  useEmptyDestinationReferences,
  useEmptyDestinationBoundaryKey,
} from './import/markdown/markdown-empty-destination.js'
import { CARRIER_MARKER_DROPPED, CARRIER_MARKER_PAIR_DROPPED, CARRIER_MARKERS_DAMAGED, EXTENDER_LEADING_SPAN_UNSPELLABLE, FRONTMATTER_SYNTHESIZED, HEADING_LEADING_WHITESPACE_UNSPELLABLE, LEADING_WHITESPACE_UNSPELLABLE, ORDERED_TASK_ITEM_UNSPELLABLE, RAW_SPAN_WHITESPACE_TRIMMED } from './import/markdown/import-report-messages.js'
import { extendsGrapheme } from './grapheme-extender.js'
import { opensFrontmatter, parse, rawImageBracketRunCloses } from './parse.js'
import { BLOCK_SEPARATOR, FRONTMATTER_CLOSER, canonicalFrontmatterOpener, canonicalQuoteBodyLines, dropTrailingWs, emphasisNeedsBraces, escapeQuoted, escapeSpanMarkerPayload, foldEmptyItemBody, listContinuationWidth, padCell, paragraphLineText, quoteAttrValue, renderCarve, spellCodeSpan, trimHeadingText } from './render-carve.js'
import { FRONTMATTER_SAFE_BREAK } from './parse/block/thematic-break-marker.js'

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

type TagReplacer = string | ((match: string, body: string, offset: number, full: string, spans?: readonly string[]) => string)

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
/** The body with a leading character reference decoded, as the later entity pass will leave it. */
function decodeLeadingReference(body: string): string {
  const reference = /^&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(body)
  return reference ? decodeHtmlEntitiesRaw(reference[0]) + body.slice(reference[0].length) : body
}

/** A span whose content starts with an extender has no Carve opener (CARVE-P3-025). */
function extenderLeadingBody(body: string): boolean {
  if (!extendsGrapheme(decodeLeadingReference(body), 0)) return false
  importLosses.push({ code: 'structure-unspellable', message: EXTENDER_LEADING_SPAN_UNSPELLABLE })
  return true
}

/** The text after a tag form starts with an extender, so a bare closer there would not close. */
function extenderFollows(full: string, end: number): boolean {
  return extendsGrapheme(decodeLeadingReference(full.slice(end, end + 40)), 0)
}

function wrapped(open: string, close: string, braced = open): (match: string, body: string, offset: number, full: string) => string {
  return (match, body, offset, full) => {
    if (extenderLeadingBody(body)) return body
    if (braced !== open && (isCarveWhitespace(body[0]!) || isCarveWhitespace(body.at(-1)!))) return `${braced}${body}${close}}`
    return extenderFollows(full, offset + match.length) ? `${braced}${body}${close}${braced === open ? '' : '}'}` : `${open}${body}${close}`
  }
}

function markerForm(marker: string): (match: string, body: string, offset: number, full: string, spans?: readonly string[]) => string {
  return (match, body, offset, full, spans = []) => {
    if (extenderLeadingBody(body)) return body
    if (marker === '*') {
      const nested = nestedHtmlStrongBody(body)
      if (nested !== undefined) return nested
    }
    // Superscript and subscript have NO bare form in Carve - always braced.
    if (marker === '^' || marker === ',') return `{${marker}${body}${marker}}`
    let before = full[offset - 1] ?? ''
    if (before === '\x00') {
      const start = full.lastIndexOf('\x00', offset - 2)
      const token = start < 0 ? null : /^\x00P(\d+)\x00$/.exec(full.slice(start, offset))
      if (token) {
        let index = Number(token[1])
        let value = spans[index] ?? ''
        for (;;) {
          const nested = /\x00P(\d+)\x00$/.exec(value)
          if (!nested || Number(nested[1]) >= index) break
          index = Number(nested[1])
          value = spans[index] ?? ''
        }
        before = value.at(-1) ?? before
      }
    }
    const after = full[offset + match.length] ?? ''
    return emphasisNeedsBraces(marker, body, before, after, extenderFollows(full, offset + match.length))
      ? `{${marker}${body}${marker}}` : `${marker}${body}${marker}`
  }
}

/** Render an HTML strong wrapper with its already-converted Markdown children. */
function nestedHtmlStrongBody(body: string): string | undefined {
  if (!body.includes('*') || body.includes('\x00')) return undefined
  try {
    const blocks = parse(body).children
    if (blocks.length !== 1 || blocks[0]?.type !== 'paragraph') return undefined
    const children = blocks[0].children
    if (!children.some(child => child.type === 'strong')) return undefined
    return renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'strong', children }] }] }).replace(/\n$/, '')
  } catch {
    return undefined
  }
}

const HTML_TAG_RULES: Array<[RegExp, TagReplacer]> = [
  // Only plain, attribute-free tags have Carve-native equivalents here. If an
  // HTML tag carries attributes, migrating it to native Carve would drop data,
  // so convertInlineHtml protects it as raw HTML instead. The exclusion is on
  // the data loss, not on the attributes: where the Carve construct CARRIES
  // every attribute the tag holds, nothing drops and the tag migrates through
  // `attributedNative` instead of this table (carve#2838).
  [/<mark>([^<]+)<\/mark>/gi, markerForm('=')],
  [/<u>([^<]+)<\/u>/gi, markerForm('_')],
  [/<ins>([^<]+)<\/ins>/gi, wrapped('{+', '+}')],
  [/<del>([^<]+)<\/del>/gi, wrapped('~', '~', '{~')],
  [/<s>([^<]+)<\/s>/gi, wrapped('~', '~', '{~')],
  [/<sup>([^<]+)<\/sup>/gi, markerForm('^')],
  [/<sub>([^<]+)<\/sub>/gi, markerForm(',')],
  [/<strong>([^<]+)<\/strong>/gi, markerForm('*')],
  [/<b>([^<]+)<\/b>/gi, markerForm('*')],
  [/<em>([^<]+)<\/em>/gi, markerForm('/')],
  [/<i>([^<]+)<\/i>/gi, markerForm('/')],
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

const RE_HTML_ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g
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
  if (decoded !== undefined) return decoded
  const first = parseFragment(`<span data-value="${match}"></span>`).childNodes[0]
  return first && 'attrs' in first ? first.attrs[0]?.value ?? match : match
}

/** Resolve every entity reference in `s`, with no Carve escaping applied. */
function decodeHtmlEntitiesRaw(s: string): string {
  return s.replace(
    RE_HTML_ENTITY,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) =>
      resolveEntity(match, dec, hex, named),
  )
}

/** Decode a Markdown URL and escape it for a Carve destination. */
function writeMarkdownDestination(url: string, protectedSpans: readonly string[] = [], inTable = false): string {
  let restored = url
  for (let pass = 0; pass <= protectedSpans.length; pass++) {
    const next = restored.replace(RE_PROTECTED_SPAN_TOKEN, (token, index: string) => protectedSpans[Number(index)] ?? token)
    if (next === restored) break
    restored = next
  }
  const decoded = restored.replace(RE_MARKDOWN_ESCAPE_OR_ENTITY, (match, escaped: string | undefined) => escaped ?? decodeHtmlEntitiesRaw(match))
  // carve#2865: a square bracket is NOT encoded. A Carve `(...)` destination
  // carries it literally, balanced or not, so encoding changed the address the
  // Markdown writer had emitted verbatim. Same ruling as the Djot side,
  // carve#2854.
  const encoded = writeMarkdownDestinationValue(decoded, inTable)
  recordAuthoredDestination(encoded, restored)
  return encoded
}

/**
 * CARVE-P2-031: the destination each converted link had in the Markdown source,
 * keyed by the destination the conversion wrote. `null` marks two spellings,
 * where the encoded form is reported because the link cannot be told apart.
 */
let authoredDestinations = new Map<string, string | null>()

function recordAuthoredDestination(encoded: string, authored: string): void {
  const known = authoredDestinations.get(encoded)
  authoredDestinations.set(encoded, known === undefined || known === authored ? authored : null)
}

/** The destinations a conversion changed, mapped back to the spelling the author wrote. */
export type AuthoredDestinations = ReadonlyMap<string, string>

/** A quoted title and the whitespace around it: ` "a & b"` / ` 'a & b'`. */
const RE_PROTECTED_SPAN_TOKEN = /\x00P(\d+)\x00/g
const RE_MARKDOWN_ESCAPABLE = /[!-/:-@\[-`{-~]/
const RE_MARKDOWN_ESCAPE_OR_ENTITY = new RegExp(String.raw`\\([!-/:-@\[-\x60{-~])|${RE_HTML_ENTITY.source}`, 'g')
const RE_QUOTED_TITLE = /^(\s*)(["'])([\s\S]*)\2(\s*)$/

/**
 * Decode entities in a link/image TITLE. The decoded text is ordinary prose but
 * it sits inside a delimiter: `&quot;` in a double-quoted title decodes to the
 * very character that closes it, and emitting that raw stops the link parsing
 * at all. Carve reads a backslash-escaped delimiter inside a title, so the
 * delimiter (and any backslash) is escaped on the way out. A title in a shape
 * this does not recognize is left exactly as it was rather than guessed at.
 */
function decodeEntitiesInTitle(rest: string, protectedSpans: readonly string[] = [], preserveSingleQuote = false): string {
  rest = rest.replace(RE_PROTECTED_SPAN_TOKEN, (token, index: string) => protectedSpans[Number(index)] ?? token)
  const decode = (value: string): string => value.replace(RE_MARKDOWN_ESCAPE_OR_ENTITY, (match, escaped: string | undefined) => escaped ?? decodeHtmlEntitiesRaw(match))
  const parenthesized = /^(\s*)\(([^()]*)\)(\s*)$/.exec(rest)
  if (parenthesized) {
    const decoded = decode(parenthesized[2]!)
    return `${parenthesized[1]}"${escapeQuoted(decoded)}"${parenthesized[3]}`
  }
  const m = RE_QUOTED_TITLE.exec(rest)
  if (!m) return rest
  const [, lead, quote, body, trail] = m
  const decoded = decode(body!)
  if (preserveSingleQuote && quote === "'" && decoded === body) return rest
  return `${lead}"${escapeQuoted(decoded)}"${trail}`
}

/** An ATX marker, its separator, and whitespace past it: `#` + ` ` + ` `. */
const RE_HEADING_HEAD_WHITESPACE = /^(#{1,6}[ \t])[ \t]+/

/**
 * The container prefixes a marker run can sit behind: indentation, quote
 * markers and list markers. `> #&#32;x` and `- #&#32;x` decode into the same
 * shape as a bare line, and carve-rs escapes the run in all three.
 */
const RE_CONTAINER_PREFIX = /^(?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+))*[ \t]*/

/** A Carve heading opener: a marker run of at most six, then ONE space. */
const RE_CARVE_HEADING_OPENER = /^#{1,6} /

/** A Markdown ATX opener: its separator may be a tab, and may end the line. */
const RE_MD_HEADING_OPENER = /^#{1,6}(?:[ \t]|$)/

/** A marker run with nothing but the separator behind it. */
const RE_MARKER_RUN_ALONE = /^(#{1,6})[ \t]+$/

/**
 * Escape a marker run that only a DECODED separator turns into a heading.
 *
 * CommonMark decides the block before any reference is decoded, and an ATX
 * heading needs a LITERAL space or tab after its marker run, so `#&#32;nosep`
 * is a paragraph whose text begins with `#`. Written bare, the line read back
 * as a level-1 heading: it gained an id, entered the outline and changed the
 * rendered structure, with no diagnostic (carve-js#2698). Escaping the run
 * keeps the block the source had, which is what carve-rs writes.
 *
 * Run on EVERY line of the body, not just the first: a paragraph's later line
 * opens a heading at column 0 just as its first one does, so `foo\n#&#32;x`
 * split one paragraph into a paragraph and a heading.
 *
 * Only a SPACE opens a Carve heading, so a decoded tab stays bare, as does a
 * run of seven. A marker that was itself decoded is already escaped as decoded
 * content and never reaches this.
 */
function escapeMarkerRunADecodedSeparatorPromotes(decoded: string, source: string): string {
  const sourceLines = source.split('\n')

  return decoded
    .split('\n')
    .map((line, index) => {
      const prefix = RE_CONTAINER_PREFIX.exec(line)![0]
      const rest = line.slice(prefix.length)
      const sourceLine = sourceLines[index] ?? ''
      // The SOURCE opens a heading here, so the line IS one and carve-js#2695
      // rules what its decoded whitespace does. That is the control.
      if (RE_MD_HEADING_OPENER.test(sourceLine.slice(RE_CONTAINER_PREFIX.exec(sourceLine)![0].length))) {
        return line
      }
      // The decode left NOTHING but the run and the separator it supplied. A
      // run alone on its line is already a paragraph, so the separator goes
      // and the run stays bare: `#&#32;` writes `#`.
      const alone = RE_MARKER_RUN_ALONE.exec(rest)
      if (alone && line !== sourceLine) return prefix + alone[1]
      if (!RE_CARVE_HEADING_OPENER.test(rest)) return line

      return prefix + rest.replace(/^#{1,6}/, (run) => run.replace(/#/g, '\\#'))
    })
    .join('\n')
}

function decodeHtmlEntities(s: string, headingHeadDrops = true): string {
  let decoded = s.replace(
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
  ).replace(/&#/g, '&\\#')
  // Whitespace that a decode put at the START of the line is indentation to
  // every block rule that runs after this, and Carve has no spelling for it at a
  // paragraph's start. It is DROPPED and reported, not substituted
  // (markup-carve/carve#2595): this used to emit `\ `, which Carve reads as
  // U+00A0, and a non-breaking space is not the tab or space the author wrote -
  // it changes line breaking and copies out of a browser as a different byte, so
  // the substitution travels further than the document. The precedent is the
  // HTML round-trip ruling that an empty half beats a wrong one.
  //
  // A marker the drop leaves at column 0 is escaped, so the line stays the
  // paragraph it was: `&#32;- item` reads as text, not as a list.
  // The same character at a HEADING's head. The marker separator is a run of
  // spaces and none of it is content, so widening the separator keeps bytes
  // rather than the character: `#  head` and `# head` render the same document
  // and `carve fmt` rewrites the first back to the second
  // (markup-carve/carve-rs#2449).
  // Whitespace a decode put at the line's HEAD belongs to the drop rule below,
  // which escapes whatever marker the drop uncovers at column 0. Taking that
  // whitespace for a container prefix here kept it instead.
  const decodedIndents = /^[ \t]/.test(decoded) && !/^[ \t]/.test(s)
  // Not in a table cell: a `#` run there is literal text, and the space after
  // it is content Carve holds.
  if (headingHeadDrops && !decodedIndents) {
    decoded = escapeMarkerRunADecodedSeparatorPromotes(decoded, s)
  }
  if (headingHeadDrops && RE_HEADING_HEAD_WHITESPACE.test(decoded) && !RE_HEADING_HEAD_WHITESPACE.test(s)) {
    importLosses.push({
      code: 'structure-unspellable',
      message: HEADING_LEADING_WHITESPACE_UNSPELLABLE,
    })
    // Nothing is left but the separator when the decode WAS the content, and a
    // separator with no content behind it is not canonical either.
    return decoded.replace(RE_HEADING_HEAD_WHITESPACE, '$1').replace(/^(#{1,6})[ \t]+$/, '$1')
  }
  if (!/^[ \t]/.test(decoded) || /^[ \t]/.test(s)) return decoded
  const dropped = decoded.replace(/^[ \t]+/, '')
  importLosses.push({
    code: 'structure-unspellable',
    message: LEADING_WHITESPACE_UNSPELLABLE,
  })

  return escapeLineInitialBlockSyntax(dropped).replace(RE_LINE_INITIAL_DEFINITION, '\\$&')
}

/**
 * A definition marker the drop can leave at column 0: a link reference, a
 * footnote, an abbreviation.
 *
 * `escapeLineInitialBlockSyntax` does not cover these, and a definition is not
 * merely a different block - it reaches no output at all, so
 * `&#32;[foo]: /url` lost the whole paragraph instead of its leading space.
 * Raised by codex review on this change.
 */
const RE_LINE_INITIAL_DEFINITION = /^\*?(?=\[[^\]\n]*\]:)/

const NATIVE_INLINE_HTML_TAGS = new Set([
  'mark',
  'u',
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

const RE_NATIVE_INLINE_TAG = new RegExp(`</?(?:${[...NATIVE_INLINE_HTML_TAGS].join('|')})>`, 'gi')

/** Offsets of the native tags that the tag rules turn into Carve markers. */
function nativeInlineTagOffsets(line: string): Set<number> {
  const offsets = new Set<number>()
  for (const tag of line.matchAll(RE_NATIVE_INLINE_TAG)) {
    for (let at = tag.index; at < tag.index + tag[0].length; at++) offsets.add(at)
  }
  return offsets
}

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
  reportRawSpanTrailingWhitespace(content)
  const tickLen = Math.max(1, longestBacktickRun(content) + 1)
  return `${'`'.repeat(tickLen)}${content}${'`'.repeat(tickLen)}{=html}`
}

function rawBlockHtml(lines: readonly string[]): string[] {
  const content = lines.join('\n').replaceAll(' \x00FNEMPTY\x00', '')
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1))
  return [`${fence}=html`, content, fence]
}

/** Import a Markdown HTML block that contains exactly one comment as Carve comment syntax. */
function markdownHtmlBlock(lines: readonly string[], sourceLine?: number): string[] {
  const source = lines.join('\n')
  const match = /^[ \t]*<!--([\s\S]*?)-->[ \t]*$/.exec(source)
  if (!match || match[1]!.includes('<!--') || match[1]!.includes('-->') || /^[ \t]*<!-- carve:/.test(source)) {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(source) + 1))
    return [`${fence}=html`, ...lines, fence]
  }
  const body = match[1]!.trim()
  importLosses.push({
    code: 'markdown-html-comment',
    message: 'Imported a Markdown HTML comment as a Carve comment.',
    fidelity: 'normalized',
    ...(sourceLine === undefined ? {} : { line: sourceLine }),
  })
  if (!match[1]!.includes('\n')) return [body === '' ? '%%' : `%% ${body}`]
  const width = Math.max(3, ...body.split('\n').map(line => /^%{3,}[ \t]*$/.test(line) ? line.trimEnd().length + 1 : 3))
  const fence = '%'.repeat(width)
  return [fence, ...body.split('\n'), fence]
}

function scanHtmlTag(
  s: string,
  start: number,
  placeholders: readonly string[] = [],
): { end: number; name: string; closing: boolean; selfClosing: boolean; attrs: boolean } | null {
  const head = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(s.slice(start))
  if (!head) return null
  let i = start + head[0].length
  const closing = head[1] === '/'
  let attrs = false
  while (i < s.length) {
    const beforeSpace = i
    while (/[ \t\n\r\f]/.test(s[i] ?? '') && i < s.length) i++
    if (s[i] === '>' || (!closing && s[i] === '/' && s[i + 1] === '>')) {
      return { end: i + (s[i] === '/' ? 2 : 1), name: head[2]!.toLowerCase(), closing, selfClosing: s[i] === '/', attrs }
    }
    if (closing || i === beforeSpace) return null
    const attribute = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(s.slice(i))
    if (!attribute) return null
    attrs = true
    i += attribute[0].length
    const afterName = i
    while (/[ \t\n\r\f]/.test(s[i] ?? '') && i < s.length) i++
    if (s[i] !== '=') { i = afterName; continue }
    i++
    while (/[ \t\n\r\f]/.test(s[i] ?? '') && i < s.length) i++
    if (s[i] === '"' || s[i] === "'") {
      const end = s.indexOf(s[i]!, i + 1)
      if (end < 0) return null
      for (const token of s.slice(i, end).matchAll(RE_PROTECTED_SPAN_TOKEN)) {
        const value = placeholders[Number(token[1])]
        if (value === undefined || value.startsWith('\\')) return null
      }
      i = end + 1
    } else {
      const value = /^[^ \t\n\r\f"'=<>`\x00]+/.exec(s.slice(i))
      if (!value) return null
      i += value[0].length
    }
  }
  return null
}

function opaqueHtmlScanner(s: string): (start: number) => number | undefined {
  const ends = new Map<string, number>()
  const forms: [string, string, number][] = [['<!--', '-->', 2], ['<?', '?>', 2], ['<![CDATA[', ']]>', 9]]
  const closingEnd = (close: string, from: number): number | undefined => {
    let end = ends.get(close)
    if (end === undefined || (end >= 0 && end < from)) {
      end = s.indexOf(close, from)
      ends.set(close, end)
    }
    return end < 0 ? undefined : end + close.length
  }
  return start => {
    for (const [open, close, skip] of forms) {
      if (s.startsWith(open, start)) return closingEnd(close, start + skip)
    }
    return /^<![A-Za-z]/.test(s.slice(start, start + 3)) ? closingEnd('>', start + 3) : undefined
  }
}

/**
 * PART 11 §8c writes two constructs with no Markdown delimiter spelling as an
 * ATTRIBUTE-BEARING inline tag: an abbreviation as `<abbr title="...">` and an
 * editorial comment as `<span class="critic-comment">`. HTML_TAG_RULES excludes
 * attribute-bearing tags because migrating one would drop its attributes - here
 * the Carve construct carries them, so nothing drops and the exclusion does not
 * apply (carve#2838).
 *
 * The match is on the shape §8c emits and refuses anything wider: one
 * double-quoted attribute and no other, and a body that cannot break out of the
 * construct. Anything else falls back to the raw span the importer wrote before.
 */
function attributedNative(tag: string, open: string, body: string, protect: (s: string) => string, sources: readonly string[] = []): string | undefined {
  if (body.includes('<')) return undefined
  if (tag === 'span') {
    // CARVE-P3-016 makes a comment's content literal, so the whole construct is
    // protected: no later inline pass may read markup inside it.
    if (!/^<span\s+class\s*=\s*"critic-comment"\s*>$/i.test(open)) return undefined
    const escapesAndEntities = new RegExp(String.raw`\x00P(\d+)\x00|\\([!-/:-@\[-\x60{-~])|${RE_HTML_ENTITY.source}`, 'g')
    let rawHtml = false
    const value = body.replace(escapesAndEntities, (match, index: string | undefined, escaped: string | undefined) => {
      if (index === undefined) return escaped ?? decodeHtmlEntitiesRaw(match)
      const source = referenceSourceText(match, sources)
      if (/^\\[!-/:-@\[-`{-~]$/.test(source)) return source.slice(1)
      if (source.includes('<')) rawHtml = true
      return source
    })
    return rawHtml || /[{}\\\n]/.test(value) ? undefined : protect(`{#${value}#}`)
  }
  if (tag !== 'abbr') return undefined
  const title = /^<abbr\s+title\s*=\s*"([^"]*)"\s*>$/i.exec(open)
  if (!title) return undefined
  const value = decodeHtmlEntitiesRaw(title[1]!)
  if (/["\\\n{}]/.test(value) || /[[\]\n]/.test(body)) return undefined
  // The label stays live so the inline passes still convert markup inside it;
  // only the attribute block is protected, from the quote escaping below.
  return `[${body}]${protect(`{abbr=${quoteAttrValue(value)}}`)}`
}

/**
 * A body that would close or re-open the braced critic construct it is about to
 * be written into, so the tag stays a raw span instead.
 */
function breaksOutOfACriticBody(body: string): boolean {
  return /[{}\\\n]|~>/.test(body)
}

/**
 * PART 11 section 8c spells a deletion `<del class="critic-delete">`, so it no
 * longer collides with the bare `<del>` a `strike` falls back to
 * (markup-carve/carve#2845). The substitution shape is read FIRST: its
 * `<del>`/`<ins>` pair is ONE construct, and the deletion rule alone would
 * leave a strike beside an unrelated insertion.
 *
 * Only the delimiters are protected - the body stays live markup, as it is in
 * the Carve construct the tag came from.
 */
function criticDeletion(
  tag: string,
  open: string,
  body: string,
  input: string,
  end: number,
  protect: (s: string) => string,
): { carve: string; end: number } | undefined {
  if (tag !== 'del' || body.includes('<')) return undefined
  if (!/^<del\s+class\s*=\s*"critic-delete"\s*>$/i.test(open)) return undefined
  if (breaksOutOfACriticBody(body)) return undefined
  const insertion = /^<ins\s*>([^<]*)<\/ins\s*>/i.exec(input.slice(end))
  if (insertion && !breaksOutOfACriticBody(insertion[1]!)) {
    return {
      carve: protect('{~') + body + protect('~>') + insertion[1]! + protect('~}'),
      end: end + insertion[0].length,
    }
  }
  return { carve: protect('{-') + body + protect('-}'), end }
}

function convertInlineHtml(input: string, protect: (s: string) => string, placeholders: readonly string[], sources: readonly string[] = placeholders): string {
  let out = ''
  let i = 0
  const opaqueEnd = opaqueHtmlScanner(input)
  while (i < input.length) {
    if (input[i] !== '<') {
      out += input[i]!
      i++
      continue
    }
    const opaque = opaqueEnd(i)
    if (opaque !== undefined) {
      out += protect(rawInlineHtml(input.slice(i, opaque)))
      i = opaque
      continue
    }
    const tag = scanHtmlTag(input, i, placeholders)
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
        native = input.slice(i, tag.end).toLowerCase() === `<${tag.name}>` && close[0].toLowerCase() === `</${tag.name}>` && NATIVE_INLINE_HTML_TAGS.has(tag.name) && !body.includes('<')
        if (!native && tag.attrs && close[0].toLowerCase() === `</${tag.name}>`) {
          const deletion = criticDeletion(tag.name, input.slice(i, tag.end), body, input, end, protect)
          if (deletion !== undefined) {
            out += deletion.carve
            i = deletion.end
            continue
          }
          const carve = attributedNative(tag.name, input.slice(i, tag.end), body, protect, sources)
          if (carve !== undefined) {
            out += carve
            i = end
            continue
          }
        }
      }
    }
    if (native) {
      out += input.slice(i, end)
      i = end
      continue
    }
    out += protect(rawInlineHtml(input.slice(i, tag.end)))
    i = tag.end
  }
  return out}

/**
 * Replace every inline code span in `s` via `repl`, leaving everything else
 * untouched. A run of N backticks closes at the next run of *exactly* N
 * backticks (so a span may embed shorter runs, e.g. `` `a `b` c` ``). An
 * unterminated run is literal and left alone.
 */
function protectCodeSpans(s: string, repl: (span: string, offset: number) => string): string {
  const runLen = (idx: number): number => {
    let n = 0
    while (s[idx + n] === '`') n++
    return n
  }
  const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y
  let out = ''
  let i = 0
  const opaqueEnd = opaqueHtmlScanner(s)
  while (i < s.length) {
    if (s[i] === '\\' && RE_MARKDOWN_ESCAPABLE.test(s[i + 1] ?? '')) {
      out += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (s[i] === '<') {
      const opaque = opaqueEnd(i)
      if (opaque !== undefined) {
        out += s.slice(i, opaque)
        i = opaque
        continue
      }

      autolink.lastIndex = i
      const match = autolink.exec(s)
      const tag = scanHtmlTag(s, i)
      if (tag) {
        out += s.slice(i, tag.end)
        i = tag.end
        continue
      }
      if (match) {
        out += match[0]
        i += match[0].length
        continue
      }
    }
    if (s[i] !== '`') {
      out += s[i]
      i++
      continue
    }
    const len = runLen(i)
    let j = i + len
    let closed = -1
    while (j < s.length) {
      if (len < 3 && s[j] === '\n') {
        const end = s.indexOf('\n', j + 1)
        const next = s.slice(j + 1, end < 0 ? s.length : end)
        if (next.trim() === '' || (indentColumns(next) < 4 && !isParagraphRunLine([next], 0, 'text'))) break
      }
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
    out += repl(s.slice(i, closed + len), i)
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
  /**
   * `*[HTML]: HyperText` defines an abbreviation (PHP Markdown Extra). On
   * unless `false`: the Markdown target writes the line (CARVE-P11-033 T1).
   */
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

  if (dialect.abbreviations === false) {
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
 * structure rather than text and keeps its hyphens. A table cell has no
 * block-structure role, so it does not take those exemptions.
 */
function escapeTypographicDashes(input: string, table = false): string {
  if (!input.includes('--')) return input
  return input
    .split('\n')
    .map((line, idx) => {
      let rest = line.replace(/^[ \t]*(?:>[ \t]?)*/, '')
      // An underline needs a paragraph line above it, so never on the first line.
      if (!table && (RE_MD_THEMATIC.test(rest) || (idx > 0 && /^ {0,3}-+[ \t]*$/.test(rest)))) return line
      for (let m = RE_LIST_MARKER.exec(rest); m; m = RE_LIST_MARKER.exec(rest)) {
        rest = rest.slice(m[0].length)
        if (!table && RE_MD_THEMATIC.test(rest)) return line
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
    if (RE_BRACED_DELIMITER_FORM.test(interior) || /^[/*_^,~=]/.test(interior) && interior.includes('{')) return match
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
function markdownDestinationOpaqueEnd(source: string, dialect: MarkdownDialect): (offset: number) => number | undefined {
  const opaque = opaqueHtmlScanner(source)
  const angle = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y
  const math = /(?:\$\$[^$]+\$\$|\$(?:[^$\s][^$]*[^$\s]|\S)\$(?!\d))/y
  return offset => {
    if (dialect.math && source[offset] === '$') {
      math.lastIndex = offset
      const match = math.exec(source)
      if (match) return offset + match[0].length
    }
    angle.lastIndex = offset
    const match = angle.exec(source)
    return match ? offset + match[0].length : opaque(offset) ?? scanHtmlTag(source, offset)?.end
  }
}

let inlineCarriersEnabled = false
let importedCrossrefIds: Set<string> | null = null
let inlineCarriersDamaged = false
let footChainMarker = ''

// Read adjacency after Markdown links, including references, have become AST nodes.
function restoreInlineCarriers(source: string): string {
  if (!inlineCarriersEnabled || !source.includes(CARRIER_PREFIX)) return source
  const tree = parse(spellEmptyItemPlaceholders(source))
  let changed = false
  const restore = (nodes: InlineNode[]): InlineNode[] => {
    const out: InlineNode[] = []
    const stack: InlineNode[][] = []
    let current = out
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      if (node.type === 'raw_inline' && node.format === 'html' && node.content.startsWith(CARRIER_PREFIX)) {
        const payload = carrierPayload(node.content)
        if (payload === '[') {
          stack.push(current)
          current = []
          changed = true
          continue
        }
        const closer = payload?.startsWith(']') ? payload.slice(1) : undefined
        const attrsSource = closer ?? payload
        const attrsValid = attrsSource !== undefined && /^\{.*\}$/.test(attrsSource) && isValidInlineAttrPayload(attrsSource.slice(1, -1))
        if (closer !== undefined && attrsValid) {
          const parent = stack.pop()
          if (!parent) { inlineCarriersDamaged = true; return nodes }
          const parsed = parse(`[x]${attrsSource}`).children[0]
          const span = parsed?.type === 'paragraph' ? parsed.children[0] : undefined
          if (span?.type === 'span') {
            const child = current.length === 1 ? current[0] : undefined
            const attrs = span.attrs
            const childAttrs = child?.attrs
            const sameAttrs = attrs?.id === childAttrs?.id
              && (attrs?.classes ?? []).length === (childAttrs?.classes ?? []).length
              && (attrs?.classes ?? []).every((value, index) => value === childAttrs?.classes?.[index])
              && Object.keys(attrs?.keyValues ?? {}).length === Object.keys(childAttrs?.keyValues ?? {}).length
              && Object.entries(attrs?.keyValues ?? {}).every(([key, value]) => value === childAttrs?.keyValues?.[key])
            // Markdown's abbr element omits the span's other attributes.
            const abbreviationOnly = childAttrs?.id === undefined
              && !(childAttrs?.classes?.length)
              && Object.keys(childAttrs?.keyValues ?? {}).length === 1
              && childAttrs?.keyValues?.abbr !== undefined
              && childAttrs.keyValues.abbr === attrs?.keyValues?.abbr
            if (child?.type === 'span' && (sameAttrs || abbreviationOnly)) {
              if (span.attrs) child.attrs = span.attrs
              else delete child.attrs
              parent.push(child)
            } else parent.push({ ...span, children: current })
          }
          current = parent
          changed = true
          continue
        }
        const previous = current.at(-1)
        if (closer === undefined && attrsValid && (previous?.type === 'link' || previous?.type === 'image' || previous?.type === 'autolink')) {
          const parsed = parse(`[x]${attrsSource}`).children[0]
          const span = parsed?.type === 'paragraph' ? parsed.children[0] : undefined
          if (span?.type === 'span') {
            if (span.attrs) previous.attrs = span.attrs
            else delete previous.attrs
          }
          if (previous.type === 'link' || previous.type === 'image') {
            delete previous.ref
            delete previous.rawRef
          }
          changed = true
          continue
        }
        if (payload?.startsWith('</#') && payload.endsWith('>') && (nodes[i + 1]?.type === 'link' || nodes[i + 1]?.type === 'autolink')) {
          const parsed = parse(payload).children[0]
          const ref = parsed?.type === 'paragraph' ? parsed.children[0] : undefined
          if (parsed?.type === 'paragraph' && parsed.children.length === 1 && ref?.type === 'heading_ref') {
            current.push(ref)
            i++
            changed = true
            continue
          }
        }
        // A container, term or caption payload is the block pass's to report.
        if (!/^(?::|\^|$)/.test(payload ?? '')) importLosses.push({
          code: 'carrier-markers-damaged',
          message: `${CARRIER_MARKER_DROPPED}: ${node.content}`,
          ...(node.pos === undefined ? {} : { line: node.pos.startLine }),
          fidelity: 'degraded',
          confidence: 'fallback',
        })
      }
      if ('children' in node && Array.isArray(node.children)) node.children = restore(node.children)
      current.push(node)
    }
    if (stack.length) inlineCarriersDamaged = true
    return out
  }
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as BlockNode
    if (node.type === 'table' || node.type === 'code_block' || node.type === 'raw_block' || node.type === 'image') return
    if (node.type === 'paragraph' || node.type === 'heading') node.children = restore(node.children)
    else Object.values(value).forEach(visit)
  }
  visit(tree)
  if (!changed || inlineCarriersDamaged) return source
  return renderCarve(tree)
}

function flattenHtmlAnchorsInLinkLabels(
  line: string,
  spans: readonly string[],
  sources: readonly string[],
  isReference: (label: string) => boolean,
): string {
  if (!line.includes('[') || !line.includes('\x00P')) return line
  const removed = new Set<number>()
  const ranges = markdownActiveLinkLabelRanges(line, spans, isReference)
  for (const range of ranges) {
    const openings: number[] = []
    for (const token of line.slice(range.start, range.end).matchAll(/\x00P(\d+)\x00/g)) {
      const at = range.start + token.index
      const source = sources[Number(token[1])] ?? ''
      const fence = /^`+/.exec(source)?.[0]
      if (!fence || !source.endsWith(`${fence}{=html}`)) continue
      const html = source.slice(fence.length, -fence.length - 7)
      const tag = scanHtmlTag(html, 0)
      if (tag?.name !== 'a' || tag.end !== html.length) continue
      if (!tag.closing && !tag.selfClosing) openings.push(at)
      else if (tag.closing && openings.length) {
        removed.add(openings.pop()!)
        removed.add(at)
        importLosses.push({ code: 'structure-unspellable', message: 'Flattened an HTML link inside a Markdown link label; its text was kept' })
      }
    }
  }
  return line.replace(/\x00P\d+\x00/g, (token, at: number) => removed.has(at) ? '' : token)
}

function convertInline(
  input: string,
  dialect: MarkdownDialect = COMMONMARK_GFM,
  holdsFenceBody = false,
  taskBox = false,
  joinedLines?: Set<number>,
  terminal = true,
  table = false,
  _reportEmptyLosses = true,
  sourceLineAtOffset?: (offset: number) => number | undefined | null,
  unwrapEmptyLinks = true,
  nativeCode = false,
  stripDestinationIndent: boolean | ((line: number) => boolean | string) = false,
  // The caller writes every returned line as it stands, so a code value may add one.
  breakableCode = false,
  preserveSingleQuoteTitle = false,
  codeBreakMarker?: string,
): string {
  if (input.includes('][') && !input.includes('<')) input = respellReferenceChainDestinations(input, table)
  const reportFlattenedEmphasis = (reason?: 'extender') => importLosses.push({
    code: 'structure-unspellable',
    message: reason === 'extender' ? EXTENDER_LEADING_SPAN_UNSPELLABLE : 'Flattened emphasis exceeding the native nesting budget; its text is preserved',
  })
  if (!input.includes('www.') && /^[A-Za-z0-9 *_.,;?!'"-]+$/.test(input)) {
    let line = escapeCarveOnlyMarker(input)
    if (!holdsFenceBody) line = escapeTypographicDashes(line, table)
    line = markdownEmphasis(line, reportFlattenedEmphasis)
    return holdsFenceBody ? line : line.replace(/["']/g, '\\$&')
  }
  // Protect inline code spans so their delimiters are never rewritten.
  // Placeholders are wrapped in NUL, so ordinary text like "P0" is never
  // mistaken for one. NUL cannot occur in the text this sees because
  // `markdownToCarve` replaced every authored one with U+FFFD on the way in
  // (CommonMark 2.3); the comment here used to claim the source could not
  // contain one, which is an assumption about a file rather than about the
  // string a host passes, and carve-js#1291 measured what an authored one did.
  const protectedSpans: string[] = []
  const protectedSources: string[] = []
  const protect = (s: string, source = s) => {
    protectedSpans.push(s)
    protectedSources.push(source)
    return `\x00P${protectedSpans.length - 1}\x00`
  }
  const codeTokens = new Map<string, string>()
  const protectCode = (value: string, source = value): string => {
    const token = protect(value, source)
    codeTokens.set(token, source)
    return token
  }
  let codeCursor = 0, codeLine = 0
  const codeSourceToken = /\x00P(\d+)\x00/y
  const writeCodeSpan = (span: string, offset: number, trackLines = true): string => {
    const fence = /^`+/.exec(span)?.[0] ?? ''
    if (fence.length > 2 && span.includes('\n')) return protectCode(span)
    if (!span.includes('\n')) {
      let value = span.slice(fence.length, -fence.length)
      if (value.startsWith(' ') && value.endsWith(' ') && value.replaceAll(' ', '') !== '') value = value.slice(1, -1)
      return protectCode(spellCodeSpan(value), span)
    }
    if (joinedLines && trackLines) {
      while (codeCursor < offset) {
        if (rawLine[codeCursor] === '\x00') {
          codeSourceToken.lastIndex = codeCursor
          const token = codeSourceToken.exec(rawLine)
          if (token) {
            codeLine += (referenceSourceText(token[0], protectedSpans).match(/\n/g) ?? []).length
            codeCursor += token[0].length
            continue
          }
        }
        if (rawLine[codeCursor++] === '\n') codeLine++
      }
      while (codeCursor < offset + span.length) if (rawLine[codeCursor++] === '\n') joinedLines.add(++codeLine)
    }
    let value = span.slice(fence.length, -fence.length).replace(/\n[ \t]*/g, ' ')
    if (value.startsWith(' ') && value.endsWith(' ') && value.replaceAll(' ', '') !== '') value = value.slice(1, -1)
    const rendered = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] })
    return protectCode(rendered.replace(/\n$/, ''), span)
  }
  let rawLine = input
  const rawDefinition = /^\s*\[([^^\]][^\]]*)\]:/.exec(input)
  const isReferenceDefinition = rawDefinition !== null && referenceDestinationLabel(rawDefinition[1]!, decodeHtmlEntitiesRaw, [], table) !== undefined
  if (!holdsFenceBody && !isReferenceDefinition && (input.includes(':') || input.includes('www.'))) {
    let cursor = 0
    let captured = ''
    const rawOpaqueEnd = markdownDestinationOpaqueEnd(input, dialect)
    for (const link of markdownRawBareLinks(input, rawOpaqueEnd)) {
      captured += input.slice(cursor, link.start) + protect(writeLiteralAutolink(input.slice(link.start, link.end), link.prefix, true), input.slice(link.start, link.end))
      cursor = link.end
    }
    rawLine = captured + input.slice(cursor)
  }
  if (rawLine.includes('](') && (rawLine.includes('`') || rawLine.includes('<') || dialect.math && rawLine.includes('$'))) {
    const rawSubject = rawLine
    rawLine = protectNativeMarkdownDestinationGlyphs(rawSubject, (value, source) => protect(value, source),
      label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined
        || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, protectedSpans),
      markdownDestinationOpaqueEnd(rawSubject, dialect), stripDestinationIndent)
  }
  let line = protectCodeSpans(rawLine, writeCodeSpan)
  // Bare HTML code uses CommonMark character-reference decoding, then written with a safe Carve fence.
  // Keep empty and multiline values in HTML where a source slot may fold them.
  let unchangedHtmlCode: Set<number> | undefined
  const htmlCodeSurvivesEmphasis = (offset: number): boolean => {
    if (unchangedHtmlCode === undefined) {
      const scratch = [...protectedSpans]
      const firstScratch = scratch.length
      let masked = ''
      const opaqueEnd = opaqueHtmlScanner(line)
      for (let at = 0; at < line.length;) {
        const autolink = line[at] === '<' ? /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(line.slice(at)) : null
        const end = autolink ? at + autolink[0].length : line[at] === '<' ? opaqueEnd(at) ?? scanHtmlTag(line, at)?.end : undefined
        if (end === undefined) { masked += line[at++]; continue }
        scratch.push(line.slice(at, end))
        masked += `\x00P${scratch.length - 1}\x00`
        at = end
      }
      const converted = markdownEmphasis(masked, undefined, undefined, scratch, true, true).replace(
        RE_PROTECTED_SPAN_TOKEN,
        (token, index: string) => Number(index) >= firstScratch ? scratch[Number(index)] ?? token : token,
      )
      const before = [...line.matchAll(/<code>((?:[^<\n]|<!---->)*)<\/code>/gi)]
      const after = [...converted.matchAll(/<code>((?:[^<\n]|<!---->)*)<\/code>/gi)]
      unchangedHtmlCode = new Set(before.filter((match, index) => after[index]?.[0] === match[0]).map(match => match.index!))
    }
    return unchangedHtmlCode.has(offset)
  }
  let codeSourceCursor = 0, codeSourceOffset = 0, codeSourceLines = 0
  let codeSourceMatchesInput: boolean | undefined
  const htmlCodeLineAt = (offset: number): number | undefined => {
    codeSourceMatchesInput ??= sourceLineAtOffset === undefined || referenceSourceText(line, protectedSources) === input
    while (codeSourceCursor < offset) {
      const token = line[codeSourceCursor] === '\x00' ? /^\x00P\d+\x00/.exec(line.slice(codeSourceCursor)) : null
      if (token) {
        const source = referenceSourceText(token[0], protectedSources)
        codeSourceOffset += source.length
        codeSourceLines += (source.match(/\n/g) ?? []).length
        codeSourceCursor += token[0].length
      } else {
        if (line[codeSourceCursor] === '\n') codeSourceLines++
        codeSourceOffset++
        codeSourceCursor++
      }
    }
    return sourceLineAtOffset === undefined
      ? inlineRunSourceLine === undefined ? undefined : inlineRunSourceLine + codeSourceLines
      : codeSourceMatchesInput ? sourceLineAtOffset(codeSourceOffset) ?? undefined : undefined
  }

  const activeHtmlCodeLinkBoundaries: number[] = []
  let nextHtmlCodeLinkBoundary = 0
  let activationOriginalSource: string | undefined
  let codeSourceMatchesActivation: boolean | undefined
  const standaloneHtmlCode = input.trim()
  const writeHtmlCode = (match: string, offset: number): string | undefined => {
    const codeSourceLine = htmlCodeLineAt(offset)
    const restoreLiteral = (part: string): string => part.replace(RE_PROTECTED_SPAN_TOKEN, (token, index: string) => {
      const span = protectedSpans[Number(index)]
      if (span && /^\\[!-\/:-@\[-`{-~]$/.test(span)) return span
      if (span && /^\[[^\]\n^]*\]$/.test(span) && referenceDestinationLabel(span.slice(1, -1), decodeHtmlEntitiesRaw, protectedSpans, table) === undefined) return span
      return token
    })
    const parts = match.slice(6, -7).split('<!---->').map(restoreLiteral)
    const body = parts.join('')
    if (body.includes('\x00')) return undefined
    if (activationOriginalSource !== undefined) {
      codeSourceMatchesActivation ??= referenceSourceText(line, protectedSources) === activationOriginalSource
      if (!codeSourceMatchesActivation) {
        if (/[\[\]]/.test(body)) return undefined
      } else {
        while (nextHtmlCodeLinkBoundary < activeHtmlCodeLinkBoundaries.length
          && activeHtmlCodeLinkBoundaries[nextHtmlCodeLinkBoundary]! < codeSourceOffset + 6) nextHtmlCodeLinkBoundary++
        if ((activeHtmlCodeLinkBoundaries[nextHtmlCodeLinkBoundary] ?? Infinity)
          < codeSourceOffset + referenceSourceText(match, protectedSources).length - 7) return undefined
      }
    }
    if (/[\\`*_~\[\]]/.test(body)) {
      if (/[*_~]/.test(body) && !htmlCodeSurvivesEmphasis(offset)) return undefined
      const savedLosses = importLosses
      importLosses = []
      let probe: ReturnType<typeof parse>
      try {
        probe = parse(`x ${convertInline(body, dialect)}\n`)
      } finally {
        importLosses = savedLosses
      }
      const paragraph = probe.children[0]
      const plain = (nodes: readonly InlineNode[]): boolean => nodes.every(node => {
        if (['text', 'escaped_text', 'smart_punctuation', 'non_breaking_space', 'soft_break'].includes(node.type)) return true
        return node.type === 'link' && node.href === '' && node.ref !== undefined
          && referenceDestinationLabel(node.rawRef ?? node.ref, decodeHtmlEntitiesRaw, protectedSpans, table) === undefined && plain(node.children)
      })
      if (probe.children.length !== 1 || paragraph?.type !== 'paragraph' || !plain(paragraph.children)) return undefined
    }
    const escapesAndEntities = new RegExp(String.raw`\\([!-/:-@\[-\x60{-~])|${RE_HTML_ENTITY.source}`, 'g')
    const value = parts.map(part => part.replace(
      escapesAndEntities,
      (entity, escaped: string | undefined) => escaped ?? decodeHtmlEntitiesRaw(entity),
    ).replace(/\r\n?/g, '\n')).join('')
    if (nativeCode && terminal && !table && standaloneHtmlCode === restoreLiteral(match)) {
      try {
        const source = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] })
        const document = parse(source)
        const paragraph = document.children[0]
        const code = paragraph?.type === 'paragraph' ? paragraph.children[0] : undefined
        if (document.children.length === 1 && paragraph?.type === 'paragraph' && paragraph.children.length === 1 && code?.type === 'code' && code.value === value.replace(/\r\n?/g, '\n')) return protect(source.replace(/\n$/, ''), referenceSourceText(match, protectedSources))
      } catch (error) {
        if (!(error instanceof SourceUnspellableError)) throw error
      }
    }
    // An empty code run is spellable only as an unclosed run ending its paragraph.
    if (value === '' && terminal && !table &&
        /(?:^|[\p{L}\p{N} \t\n.,;:?)'"-])$/u.test(line.slice(0, offset)) &&
        /^[ \t]*$/.test(line.slice(offset + match.length))) {
      return protect('``', referenceSourceText(match, protectedSources))
    }
    // A line break in the value continues the paragraph when the caller keeps added lines.
    if (breakableCode && value.includes('\n') && !value.includes('\r') && !table &&
        !/^[ \t]*#{1,6}(?:[ \t]|$)/.test(input) && !/[!$\\`\x00{}\]]$/.test(line.slice(0, offset))) {
      try {
        const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] }).replace(/\n$/, '')
        const probe = parse(`x ${written} y\n`)
        const paragraph = probe.children[0]
        const code = paragraph?.type === 'paragraph' ? paragraph.children[1] : undefined
        if (probe.children.length === 1 && paragraph?.type === 'paragraph' && paragraph.children.length === 3 && code?.type === 'code' && code.value === value) {
          return protect(codeBreakMarker === undefined ? written : written.replace(/\n/g, codeBreakMarker), referenceSourceText(match, protectedSources))
        }
      } catch (error) {
        if (!(error instanceof SourceUnspellableError)) throw error
      }
    }
    if (value === '' || value.includes('\n') || value.includes('\r')) {
      importLosses.push({
        code: 'raw-code-fallback',
        message: 'Preserved an HTML code payload as raw HTML; targets and profiles that escape or omit raw HTML change its code structure and content',
        fidelity: 'degraded',
        ...(codeSourceLine === undefined ? {} : { line: codeSourceLine }),
      })
      const html = value.replace(/\r\n?/g, '\n').replace(/[ !-\/:-@\[-`{-~\t\n]/g, char => {
        if (char === '\n') return '<!---->&#10;<!---->'
        const entity = `&#${char.charCodeAt(0)};`
        return char === '@' ? entity + '<!---->' : entity
      })
      return protect(rawInlineHtml(`<code>${html}</code>`), referenceSourceText(match, protectedSources))
    }
    const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] }).replace(/\n$/, '')
    return protect(written, referenceSourceText(match, protectedSources))
  }
  line = escapeCarveOnlyMarker(line)
  // A definition cannot interrupt a Markdown paragraph, but it does interrupt a
  // Carve one, so a continuation line shaped like one is escaped (carve-js#1812).
  line = line.replace(/\n([ \t]*)\[(?=[^^\]\n][^\]\n]*\]:)/g, '\n$1\\[')

  // A backslash escape (`\*`, `\_`, `\\`, …) makes the next punctuation char
  // literal in both Markdown and Carve, so protect the pair verbatim.
  function writeLiteralAutolink(body: string, hrefPrefix = '', _bare = false): string {
    for (let pass = 0; pass < protectedSpans.length; pass++) {
      const restored = body.replace(RE_PROTECTED_SPAN_TOKEN, (_token, index: string) => protectedSpans[Number(index)] ?? _token)
      if (restored === body) break
      body = restored
    }
    const raw = (hrefPrefix + body).replace(/[\p{White_Space}\p{Cc}]/gu, encodeMarkdownDestinationCharacter)
    const href = table ? raw.replace(/\\\|/g, '\\%7C').replace(/\|/g, '%7C') : raw
    const written = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [
      { type: 'link', href, children: [{ type: 'text', value: body }] },
    ] }] }).replace(/\n$/, '')
    return table ? escapeTablePipes(written) : written
  }
  const protectReferenceAutolinks = (value: string): string => value.replace(/<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[a-zA-Z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/g, match => {
    const body = match.slice(1, -1)
    return protect(writeLiteralAutolink(body, /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(body) ? '' : 'mailto:'))
  })
  const writeLiteralReference = (value: string): string => value.split(/(\x00P\d+\x00|<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[a-zA-Z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>)/).map(part => {
    if (part.startsWith('<') && part.endsWith('>')) return protectReferenceAutolinks(part)
    const token = /^\x00P(\d+)\x00$/.exec(part)
    if (token && /^(?:!?)`/.test(protectedSpans[Number(token[1])] ?? '')) return part
    return referenceLiteralText(part, decodeHtmlEntitiesRaw, protectedSpans).replace(/\r\n?|\n/g, ' ').replace(/[!-\/:-@\[-`{-~]/g, '\\$&')
  }).join('')
  line = protectMarkdownSourceEscapes(line, protect, terminal)
  line = decodeLiteralFootnoteClosingEscapes(line, protectedSpans)





  const opaqueMathEnd = (subject: string, offset: number): number | undefined => {
    if (!dialect.math || subject[offset] !== '$') return undefined
    const match = /^(?:\$\$[^$]+\$\$|\$(?:[^$\s][^$]*[^$\s]|\S)\$(?!\d))/.exec(subject.slice(offset))
    return match ? offset + match[0].length : undefined
  }
  const validDestinationSource = (subject: string, open: number, end: number): boolean => {
    const destination = subject.slice(open, end + 1)
    if (!destination.includes('\x00')) return true
    const original = referenceSourceText(destination, protectedSources)
    return markdownInlineDestinationEnd(original, 0) === original.length - 1
  }
  if (line.includes('[') && line.includes(']')) {
    const subject = line
    const opaque = opaqueHtmlScanner(subject)
    const auto = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>/y
    line = escapeInactiveMarkdownLinkBrackets(subject, value => protect(value, value.slice(1)),
      label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined
        || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, protectedSpans),
      offset => {
        const mathEnd = opaqueMathEnd(subject, offset)
        if (mathEnd !== undefined) return mathEnd
        auto.lastIndex = offset
        const link = auto.exec(subject)
        return link ? offset + link[0].length : opaque(offset) ?? scanHtmlTag(subject, offset)?.end
      }, undefined, (open, end) => validDestinationSource(subject, open, end))
  }
  let opaqueSubject: string | undefined
  let opaqueRanges: Array<[number, number]> = []
  let activeEmptyDestinationOpeners = new Set<number>()
  let scalarBoundaryRanges: Array<[number, number]> = []
  let activeImageLabelRanges: Array<[number, number]> = []
  line = unwrapEmptyDestinations(line, protectedSpans, protect, decodeHtmlEntitiesRaw, undefined, (subject, offset) => {
    if (!unwrapEmptyLinks) return true
    if (subject !== opaqueSubject) {
      opaqueSubject = subject
      opaqueRanges = []
      scalarBoundaryRanges = []
      activeImageLabelRanges = []
      for (const scalar of subject.matchAll(/<code>((?:[^<\n]|<!---->)*)<\/code>|<span\s+class\s*=\s*"critic-comment"\s*>([^<]*)<\/span>/gi)) {
        const body = scalar[1] ?? scalar[2]!
        if (!decodeHtmlEntitiesRaw(referenceSourceText(body, protectedSources)).includes('@')) {
          scalarBoundaryRanges.push([scalar.index! + scalar[0].indexOf('>') + 1, scalar.index! + scalar[0].lastIndexOf('</')])
        }
      }
      if (dialect.math) {
        for (const math of subject.matchAll(/\$\$([^$]+)\$\$|\$([^$\s][^$]*[^$\s]|\S)\$(?!\d)/g)) {
          if (math[1] !== undefined || !/^[\d.,]+$/.test(math[2]!)) opaqueRanges.push([math.index!, math.index! + math[0].length])
        }
      }
      activeEmptyDestinationOpeners = new Set<number>()
      const emptyDestinationOpaque = opaqueHtmlScanner(subject)
      escapeInactiveMarkdownLinkBrackets(subject, value => value,
        label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined
          || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, protectedSpans),
        offset => opaqueMathEnd(subject, offset) ?? emptyDestinationOpaque(offset) ?? scanHtmlTag(subject, offset)?.end,
        (open, close, image) => {
          activeEmptyDestinationOpeners.add(open)
          if (image) activeImageLabelRanges.push([open, close])
          const end = markdownInlineDestinationEnd(subject, close + 1)
          if (end !== undefined && validDestinationSource(subject, close + 1, end)) opaqueRanges.push([close + 1, end + 1])
        }, (open, end) => validDestinationSource(subject, open, end))
      const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[a-zA-Z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y
      for (let cursor = 0; cursor < subject.length; cursor++) {
        if (subject[cursor] !== '<') continue
        autolink.lastIndex = cursor
        const auto = autolink.exec(subject)
        const end = auto ? cursor + auto[0].length : scanHtmlTag(subject, cursor)?.end
        if (end !== undefined) {
          opaqueRanges.push([cursor, end])
          cursor = end - 1
        }
      }
    }
    return opaqueRanges.some(([start, end]) => offset > start && offset < end)
      || !activeEmptyDestinationOpeners.has(subject[offset] === '!' ? offset + 1 : offset)
  }, label => {
    const masked = new Map<string, string>()
    if (label.includes('<') || label.includes('![') || label.includes('[^') || dialect.math && label.includes('$')) {
      const source = label
      const opaque = opaqueHtmlScanner(source)
      const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&\x27*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>/y
      const bracketEnd = (open: number): number | undefined => {
        let depth = 0
        for (let at = open; at < source.length; at++) {
          if (source[at] === '\\') { at++; continue }
          if (source[at] === '[') depth++
          else if (source[at] === ']' && --depth === 0) return at
        }
        return undefined
      }
      let output = ''
      for (let at = 0; at < source.length;) {
        let end: number | undefined
        if (source[at] === '!' && source[at + 1] === '[') {
          const close = bracketEnd(at + 1)
          if (close !== undefined) {
            const label = source.slice(at + 2, close)
            const inline = markdownInlineDestinationEnd(source, close + 1)
            const reference = /^\[([^\[\]\n]*)\]/.exec(source.slice(close + 1))
            if (inline !== undefined && validDestinationSource(source, close + 1, inline)) end = inline + 1
            else if (reference && (referenceDestinationLabel(reference[1] || label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined || isEmptyDestinationReference(reference[1] || label, decodeHtmlEntitiesRaw, protectedSpans))) end = close + 1 + reference[0].length
            else if (referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, protectedSpans)) end = close + 1
          }
        } else if (source[at] === '[' && source[at + 1] === '^') {
          const close = bracketEnd(at)
          if (close !== undefined) end = close + 1
        } else if (source[at] === '<') {
          autolink.lastIndex = at
          const angle = autolink.exec(source)
          end = angle ? at + angle[0].length : opaque(at) ?? scanHtmlTag(source, at, protectedSpans)?.end
        } else if (dialect.math && source[at] === '$') {
          const math = /^(?:\$\$[^$]+\$\$|\$(?:[^$\s][^$]*[^$\s]|\S)\$(?!\d))/.exec(source.slice(at))
          if (math) end = at + math[0].length
        }
        if (end === undefined) { output += source[at++]; continue }
        const scalar = source.slice(at, end)
        const token = protect(scalar, scalar)
        masked.set(token, scalar)
        output += token
        at = end
      }
      label = output
    }
    let depth = 0
    const converted = markdownEmphasis(label, reportFlattenedEmphasis, undefined, protectedSpans, false, true, 0, peak => { depth = peak }, true, value => protect(value), { before: '[', after: ']' }, true, decodeLeadingReference)
    if (depth > 0) {
      for (const match of converted.matchAll(RE_PROTECTED_SPAN_TOKEN)) {
        if (/^\{[*/~]/.test(protectedSpans[Number(match[1])] ?? '')) {
          recordMarkdownProtectedDepth(protectedSpans, match[0], depth)
          break
        }
      }
    }
    return masked.size === 0 ? converted : converted.replace(/\x00P\d+\x00/g, token => masked.get(token) ?? token)
  },
  (_subject, offset) => !scalarBoundaryRanges.some(([start, end]) => offset >= start && offset < end),
  (_subject, offset) => activeImageLabelRanges.some(([start, end]) => offset > start && offset < end))

  const encodeDest = (paren: string): string | undefined => {
    // Spaces and tabs around a destination are not part of it (CommonMark 6.3).
    const inner = trimMatchingEdges(paren.slice(1, -1), (code) => code === 32 || code === 9 || code === 10)
    // Non-ASCII spaces and a BOM belong to the URL, not the title separator.
    const pointyClose = inner.startsWith('<') ? /^<(?:[^<>\n\\]|\\[^\n])*>/.exec(inner) : null
    const pointyEnd = pointyClose ? pointyClose[0].length - 1 : inner.startsWith('<') ? inner.indexOf('>') : -1
    if (inner.startsWith('<') && pointyEnd < 0) return undefined
    const m = pointyEnd < 0 ? inner.match(/^((?:\x00P\d+\x00|[^\x00-\x20\x7f])+)([\s\S]*)$/u) : null
    const url = pointyEnd >= 0 ? inner.slice(1, pointyEnd) : m ? m[1]! : inner
    const rest = pointyEnd >= 0 ? inner.slice(pointyEnd + 1) : m ? m[2]! : ''
    if (rest.trim() && (!/^[ \t\n]/.test(rest) || !/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))$/s.test(rest.trim()))) return undefined
    // A destination and title are entity-decoded by cmark like any other text,
    // and this whole construct is protected from the later decode pass, so it
    // happens here or not at all. `&amp;` in a query string is the canonical
    // case: left literal, the migrated link points somewhere else.
    const enc = writeMarkdownDestination(url, protectedSpans, table)
    let title = decodeEntitiesInTitle(rest, protectedSpans, preserveSingleQuoteTitle).replace(/^[ \t\n]+/, ' ')
    if (table) {
      const quoted = RE_QUOTED_TITLE.exec(title)
      if (quoted) {
        const restored = quoted[3]!.replace(RE_PROTECTED_SPAN_TOKEN, (token, index: string) => protectedSpans[Number(index)] ?? token)
        const decoded = unescapeAttrValue(restored)
        const escaped = decoded.replace(/\\/g, '\\\\').split(quoted[2]!).join('\\' + quoted[2]).replaceAll('`', '\\`')
        title = `${quoted[1]}${quoted[2]}${escaped}${quoted[2]}${quoted[4]}`
      }
    }
    return `(${enc}${title})`
  }

  const activationSource = line
  const activationOpaque = opaqueHtmlScanner(activationSource)
  const activationAutolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y
  const activeLinkBoundaries = new Set<number>()
  line = escapeInactiveMarkdownLinkBrackets(activationSource, value => protect(value, value.slice(1)),
    label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined,
    offset => {
      const mathEnd = opaqueMathEnd(activationSource, offset)
      if (mathEnd !== undefined) return mathEnd
      const opaque = activationOpaque(offset)
      if (opaque !== undefined) return opaque
      activationAutolink.lastIndex = offset
      const autolink = activationAutolink.exec(activationSource)
      return autolink ? offset + autolink[0].length : scanHtmlTag(activationSource, offset)?.end
    }, (opener, closer) => { activeLinkBoundaries.add(opener); activeLinkBoundaries.add(closer) },
    (open, end) => validDestinationSource(activationSource, open, end))
  if (activeLinkBoundaries.size > 0) {
    activationOriginalSource = referenceSourceText(activationSource, protectedSources)
    let activationSourceOffset = 0
    const activationToken = /\x00P\d+\x00/y
    for (let at = 0; at < activationSource.length; at++) {
      if (activeLinkBoundaries.has(at)) activeHtmlCodeLinkBoundaries.push(activationSourceOffset)
      if (activationSource[at] === '\x00') {
        activationToken.lastIndex = at
        const token = activationToken.exec(activationSource)
        if (token) {
          activationSourceOffset += referenceSourceText(token[0], protectedSources).length
          at += token[0].length - 1
          continue
        }
      }
      activationSourceOffset++
    }
  }

  const referenceTail = (canonical: string, fallback: string, source = fallback): string => {
    const target = referenceInlineTarget(canonical, table)
    return protect(target === undefined ? fallback : encodeDest(`(${target})`) ?? fallback, source)
  }

  const imageLabel = (label: string): string => {
    const alt = plainAltText(label.slice(2, -1), protectedSpans, decodeHtmlEntitiesRaw, protectedSources)
    return `![${rawImageBracketRunCloses(alt) && unescapeAttrValue(alt) === alt ? alt : escapeUnclosedImageEditorialOpeners(alt.replace(/[\\[\]`]/g, '\\$&'))}]`
  }
  const protectDestination = (alt: string, dest: string, source = alt + dest, imageSourceLabel?: string): string => {
    const sourceDest = referenceSourceText(dest, protectedSources)
    const nativeValid = markdownInlineDestinationEnd(sourceDest, 0) === sourceDest.length - 1
    const encoded = nativeValid ? encodeDest(dest) : undefined
    if (encoded !== undefined) return protect(alt + encoded, source)
    const canonical = nativeValid || imageSourceLabel === undefined ? undefined : referenceDestinationLabel(imageSourceLabel, decodeHtmlEntitiesRaw, protectedSpans, table)
    const referenceTarget = canonical === undefined ? undefined : referenceInlineTarget(canonical, table)
    const referenceEncoded = referenceTarget === undefined ? undefined : encodeDest(`(${referenceTarget})`)
    const sourceLabel = source.slice(0, source.length - dest.length)
    const label = canonical === undefined || /[\[\]]/.test(canonical)
      ? sourceLabel : protect(alt + (referenceEncoded ?? `[${canonical}]`), sourceLabel)
    return label + protect('\\(', '(') + dest.slice(1)
  }
  type NativeDestination = { offset: number; label: string; dest: string }
  const protectDestinations = (pattern: RegExp | readonly NativeDestination[]): void => {
    const subject = line
    let cursor = 0, depth = 0, pairedEnd = -1
    let lineCursor = 0, lineNumber = 0
    const origins = joinedLines ? input.split('\n').map((_text, index) => index).filter(index => !joinedLines.has(index)) : []
    let commentEnd = subject.indexOf('-->')
    const autolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/y
    const replaceDestination = (match: string, label: string, dest: string, offset: number): string => {
      while (cursor < offset) {
        if (subject[cursor] === '<') {
          autolink.lastIndex = cursor
          const auto = autolink.exec(subject)
          const tag = scanHtmlTag(subject, cursor)
          if (subject.startsWith('<!--', cursor) && commentEnd >= 0 && commentEnd < cursor + 4) commentEnd = subject.indexOf('-->', cursor + 4)
          const comment = subject.startsWith('<!--', cursor) ? commentEnd : -1
          const end = auto ? cursor + auto[0].length : tag?.end ?? (comment >= 0 ? comment + 3 : cursor)
          if (end > cursor) { cursor = end; continue }
        }
        if (subject[cursor] === '[') depth++
        else if (subject[cursor] === ']' && depth > 0) { depth--; pairedEnd = cursor }
        cursor++
      }
      if (cursor > offset || (label === '' && pairedEnd !== offset - 1)) return match
      const image = label.startsWith('!')
      const written = protectDestination(image ? imageLabel(label) : '', dest, image ? label + dest : dest, image ? label.slice(2, -1) : undefined)
      if (written.startsWith('\x00P')) cursor = offset + match.length
      const destinationToken = /^\x00P(\d+)\x00$/.exec(written)
      if (joinedLines && destinationToken) {
        while (lineCursor < offset) {
          if (subject[lineCursor] === '\x00') {
            const token = /^\x00P(\d+)\x00/.exec(subject.slice(lineCursor))
            if (token) {
              lineNumber += (referenceSourceText(token[0], protectedSpans).match(/\n/g) ?? []).length
              lineCursor += token[0].length
              continue
            }
          }
          if (subject[lineCursor++] === '\n') lineNumber++
        }
        const result = (image ? '' : label) + protectedSpans[Number(destinationToken[1])]!
        const removed = (referenceSourceText(match, protectedSpans).match(/\n/g) ?? []).length - (result.match(/\n/g) ?? []).length
        for (let n = 1; n <= removed; n++) {
          const origin = origins[lineNumber + n]
          if (origin !== undefined) joinedLines.add(origin)
        }
      }
      return (image ? '' : label) + written
    }
    if (pattern instanceof RegExp) line = subject.replace(pattern, replaceDestination)
    else {
      const output: string[] = []
      let at = 0
      for (const { offset, label, dest } of pattern) {
        const match = label + dest
        output.push(subject.slice(at, offset), replaceDestination(match, label, dest, offset))
        at = offset + match.length
      }
      output.push(subject.slice(at))
      line = output.join('')
    }
    line = line.replace(/\[\^([^\[\]\n]+)\](?=\x00P(\d+)\x00)/g, (match, label: string, index: string) =>
      protectedSpans[Number(index)]?.startsWith('(') ? '[' + protect('\\^', '^') + label + ']' : match,
    )
  }

  if (line.includes('](') && /\]\([ \t\n]*(?:\\.|[^ \t\n()\\])*\(/.test(line)) {
    const subject = line
    const opaque = opaqueHtmlScanner(subject)
    const tokenAt = /\x00P\d+\x00/y
    const opens: { at: number; image: boolean }[] = []
    const destinations: NativeDestination[] = []
    let escapedPosition = -1
    for (let at = 0; at < subject.length; at++) {
      if (subject[at] === '\x00') {
        tokenAt.lastIndex = at
        const token = tokenAt.exec(subject)
        if (token) { at += token[0].length - 1; continue }
      }
      let htmlEnd: number | undefined
      if (subject[at] === '<') {
        activationAutolink.lastIndex = at
        const auto = activationAutolink.exec(subject)
        htmlEnd = opaque(at) ?? (auto ? at + auto[0].length : scanHtmlTag(subject, at)?.end)
      }
      const end = opaqueMathEnd(subject, at) ?? htmlEnd
      if (end !== undefined) { at = end - 1; continue }
      if (subject[at] === '\\') { escapedPosition = at + 1; at++; continue }
      if (subject[at] === '[') {
        opens.push({ at, image: subject[at - 1] === '!' && escapedPosition !== at - 1 })
        continue
      }
      if (subject[at] !== ']' || opens.length === 0) continue
      const opener = opens.pop()!
      const through = markdownInlineDestinationEnd(subject, at + 1)
      if (through === undefined || !validDestinationSource(subject, at + 1, through)) continue
      const offset = opener.image ? opener.at - 1 : at + 1
      if (opener.image) {
        while (destinations.length && destinations.at(-1)!.offset >= offset) destinations.pop()
      }
      destinations.push({ offset, label: opener.image ? subject.slice(offset, at + 1) : '', dest: subject.slice(at + 1, through + 1) })
      at = through
    }
    protectDestinations(destinations)
  }

  const pointyDestination = String.raw`\([ \t]*<[^<>\n]*>(?:[ \t]+(?:"(?:[^"\n]|\n(?![ \t]*\n))*"|'(?:[^'\n]|\n(?![ \t]*\n))*'))?[ \t]*\)`
  protectDestinations(new RegExp(String.raw`(!\[(?:[^[\]]|\[[^[\]]*\])*\])(${pointyDestination})`, 'g'))
  protectDestinations(new RegExp(String.raw`(?<=\])()(${pointyDestination})`, 'g'))

  const multilineTitle = /(!?\[(?:[^\[\]\n]|\n(?![ \t]*\n)|\[(?:[^\[\]\n]|\n(?![ \t]*\n))*\])*\])(\([ \t\n]*(?:[^()\s]|\([^()\n]*\))+[ \t\n]+(?:"(?:[^"\n]|\n(?![ \t]*\n))*"|'(?:[^'\n]|\n(?![ \t]*\n))*'|\((?:[^()\n]|\n(?![ \t]*\n))*\))[ \t\n]*\))/g
  protectDestinations(multilineTitle)
  protectDestinations(/(?<=\])()(\([ \t\n]*(?:[^()\s]|\([^()\n]*\))+[ \t\n]+(?:"(?:[^"\n]|\n(?![ \t]*\n))*"|'(?:[^'\n]|\n(?![ \t]*\n))*'|\((?:[^()\n]|\n(?![ \t]*\n))*\))[ \t\n]*\))/g)

  // Images `![alt](dest)`: Carve renders the alt as scalar text, so protect the
  // whole construct (alt and dest alike). The alt may contain one level of
  // nested brackets (`![a [b]](url)`); the dest is paren-normalized.
  protectDestinations(/(!\[(?:[^[\]]|\[[^[\]]*\])*\])(\((?:[ \t]*\n(?![ \t]*\n))?(?:[^()\n]|\([^()\n]*\)|\n(?=[ \t]*\)))*\))/g)

  // Link destinations `](dest "title")`. (Images already handled above.) The
  // delimiters in a URL (e.g. /_v1_/) are never markup, so protect it whole.
  protectDestinations(/(?<=\])()(\((?:[ \t]*\n(?![ \t]*\n))?(?:[^()\n]|\([^()\n]*\)|\n(?=[ \t]*\)))*\))/g)


  // In a plain three-label chain, an unknown full-reference label can begin
  // the next link. Protect the resolved tail before the ordinary reference pass.
  let chainCursor = 0
  const chainAutolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/y
  const chainSubject = line
  line = line.replace(/(?<![\\\]])\[([^[\]\n^]+)\]\[([^[\]\n^]+)\]\[([^[\]\n^]+)\]/gu,
    (match, first: string, second: string, third: string, offset: number) => {
      while (chainCursor < offset) {
        if (chainSubject[chainCursor] === '<') {
          chainAutolink.lastIndex = chainCursor
          const auto = chainAutolink.exec(chainSubject)
          const tag = scanHtmlTag(chainSubject, chainCursor)
          const end = auto ? chainCursor + auto[0].length : tag?.end
          if (end !== undefined) { chainCursor = end; continue }
        }
        chainCursor++
      }
      if (chainCursor > offset) return match
      const tail = /^\x00P(\d+)\x00/.exec(chainSubject.slice(offset + match.length))
      if (tail && protectedSpans[Number(tail[1])]?.startsWith('(')) return match
      const middle = referenceDestinationLabel(second, decodeHtmlEntitiesRaw, protectedSpans, table)
      const last = referenceDestinationLabel(third, decodeHtmlEntitiesRaw, protectedSpans, table)
      if (middle !== undefined) {
        if (chainSubject[offset - 1] === '!' || chainSubject[offset + match.length] === '[') return match
        return `[${first}]${referenceTail(middle, `[${middle}]`, `[${second}]`)}[${third}]${last !== undefined ? referenceTail(last, `[${last}]`, '') : ''}`
      }
      if (last !== undefined) return protect(`\\[${first}]`, `[${first}]`) + `[${second}]${referenceTail(last, `[${last}]`, `[${third}]`)}`
      return match
    })

  line = line.replace(/(?<!\\)!\[((?:[^\[\]]|\[[^[\]]*\])*)\](?:\[([^\]\n]*)\])?/g,
    (match, label: string, reference: string | undefined, offset: number, source: string) => {
      const open = offset + match.length
      const inlineEnd = markdownInlineDestinationEnd(source, open)
      if (inlineEnd !== undefined && validDestinationSource(source, open, inlineEnd)) return match
      const canonical = referenceDestinationLabel(reference || label, decodeHtmlEntitiesRaw, protectedSpans, table)
      if (canonical === undefined) return table && match.includes('|') ? protect(match.replace(/[\[\]]/g, '\\$&'), match) : match
      if (/[\[\]]/.test(canonical)) return match
      const target = referenceInlineTarget(canonical, table)
      return protect(`${imageLabel(`![${label}]`)}${target === undefined ? `[${canonical}]` : encodeDest(`(${target})`) ?? `[${canonical}]`}`, match)
    })

  line = line.replace(/\[\^(?=[^[\]\n]*\[(?!\^))/g, () => protect('\\[', '[') + '^')

  const footnoteSource = line
  let footnoteCursor = 0
  const footnoteOpaque = opaqueHtmlScanner(line)
  const footnoteAutolink = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/y
  line = line.replace(/\[\^([^[\]\n]+)\]/g, (match, label: string, offset: number) => {
    while (footnoteCursor < offset) {
      if (footnoteSource[footnoteCursor] === '<') {
        footnoteAutolink.lastIndex = footnoteCursor
        const auto = footnoteAutolink.exec(footnoteSource)
        const end = auto ? footnoteCursor + auto[0].length : footnoteOpaque(footnoteCursor) ?? scanHtmlTag(footnoteSource, footnoteCursor)?.end
        if (end !== undefined) { footnoteCursor = end; continue }
      }
      footnoteCursor++
    }
    if (footnoteCursor > offset) return match
    const renamed = importedFootnoteLabel(referenceSourceText(label, protectedSpans))
    return renamed === undefined ? match : protect(`[^${renamed}]`, match)
  })

  if (table) {
    line = line.replace(/(?<!\\)\[([^[\]\n^]+)\]\[([^[\]\n]+)\]/g, (match, label: string, reference: string) =>
      label.includes('|') && referenceDestinationLabel(reference, decodeHtmlEntitiesRaw, protectedSpans, table) === undefined
        ? protect(writeLiteralReference(match), match) : match,
    )
    line = line.replace(/(?<!\\)(!?)\[([^[\]\n^][^[\]\n]*)\]\[\]/g, (match, _image: string, label: string) =>
      label.includes('|') && referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) === undefined
        ? protect(writeLiteralReference(match), match) : match,
    )
  }

  // Reference-link use site `[text][label]`: the trailing `[label]` is a
  // literal reference key, not inline markup, so protect it too.
  let literalReferenceOpeners: Set<string> | undefined
  if (line.includes('][^') || /\]\x00P\d+\x00/.test(line)) {
    const footnotePrefixSource = line
    const opaque = opaqueHtmlScanner(line)
    let cursor = 0
    line = line.replace(/(?<!\\)\[((?!\^)(?:[^\[\]\n]|\[[^\]\n]*\])+)\](?=\[\^|\x00P\d+\x00)/g, (match, label: string, offset: number) => {
      const following = /^\x00P(\d+)\x00/.exec(footnotePrefixSource.slice(offset + match.length))
      if (following && !protectedSpans[Number(following[1])]?.startsWith('[^')) return match
      while (cursor < offset) {
        const end = footnotePrefixSource[cursor] === '<' ? opaque(cursor) ?? scanHtmlTag(footnotePrefixSource, cursor)?.end : undefined
        if (end !== undefined) { cursor = end; continue }
        if (dialect.math && footnotePrefixSource[cursor] === '$') {
          const math = /^(?:\$\$[^$]+\$\$|\$(?:[^$\s][^$]*[^$\s]|\S)\$(?!\d))/.exec(footnotePrefixSource.slice(cursor))
          if (math) { cursor += math[0].length; continue }
        }
        cursor++
      }
      if (footnotePrefixSource[offset - 1] === ']' && referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined) return match
      if (cursor > offset) return match
      const opener = protect('\\[', '[')
      ;(literalReferenceOpeners ??= new Set()).add(opener)
      return opener + label + protect('\\]', ']')
    })
  }
  const referenceSubject = line
  const referenceOpeners = new Map<number, number>()
  const referenceStack: number[] = []
  const referenceHtml = new Set<number>()
  const hasReferencePairs = referenceSubject.includes('][')
  for (let at = 0; hasReferencePairs && at < referenceSubject.length; at++) {
    if (referenceSubject[at] === '<') {
      const tag = scanHtmlTag(referenceSubject, at)
      if (tag) {
        for (; at < tag.end; at++) referenceHtml.add(at)
        at--
        continue
      }
    }
    if (referenceSubject[at] === '[') referenceStack.push(at)
    else if (referenceSubject[at] === ']' && referenceStack.length) referenceOpeners.set(at, referenceStack.pop()!)
  }
  line = line.replace(/(?<=\])\[([^\]]*)\]/g, (match, reference: string, offset: number, source: string) => {
    if (referenceHtml.has(offset)) return match
    if (reference.startsWith('^')) return protect(match, match)
    const labelStart = reference === '' ? source.lastIndexOf('[', offset - 2) : -1
    const preceding = labelStart >= 0 ? source.slice(labelStart + 1, offset - 1) : ''
    const label = reference || (!/[\]\n]/.test(preceding) ? preceding : undefined)
    const canonical = label !== undefined && (reference === '' || !/[\\&\x00]/.test(label)
      || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, protectedSpans))
      ? referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) : undefined
    const sourceLabel = referenceSourceLabel(reference, protectedSpans)
    if (sourceLabel !== undefined && referenceInlineTarget(sourceLabel, table) !== undefined) return referenceTail(sourceLabel, match)
    const literal = referenceLiteralText(reference, decodeHtmlEntitiesRaw, protectedSpans)
    if (canonical === undefined && sourceLabel === undefined && !reference.startsWith('^') && /\\[!*]/.test(referenceSourceText(reference, protectedSpans)) && literal !== reference && /[!*]/.test(literal)) {
      return protect(`\\[${writeLiteralReference(reference)}\\]`, match)
    }
    const keepCollapsed = reference === '' && label === canonical && /^[\w\s-]+$/u.test(label ?? '')
    if (canonical === undefined || /[\[\]]/.test(canonical)) {
      const tablePipe = table && referenceSourceText(reference, protectedSpans).includes('|')
      if (sourceLabel !== undefined && !tablePipe) return protect(match, match)
      const precedingOpener = referenceOpeners.get(offset - 1)
      const precedingLabel = precedingOpener === undefined ? '' : source.slice(precedingOpener + 1, offset - 1)
      if (!tablePipe && !/[*_`\\\x00<&~"'=^]/.test(reference + precedingLabel)) return protect(match, match)
      const opener = protect('\\[', '[')
      ;(literalReferenceOpeners ??= new Set()).add(opener)
      return opener + reference + protect('\\]', ']')
    }
    return referenceTail(canonical, keepCollapsed ? match : `[${canonical}]`, match)
  })

  // Reference-link definition `[label]: dest "title"` (optional space after
  // the colon). The whole line is consumed literally by Carve's ref-link
  // parser, so protect it. A footnote definition `[^id]: body` is excluded —
  // its body is normal inline content that must still be converted.
  // The destination and title are entity-decoded here for the same reason the
  // inline form is (encodeDest): protecting the line puts it out of reach of
  // the later decode pass, and a literal `&amp;` in the definition points the
  // link somewhere the Markdown source did not.
  // Destination boundaries use ASCII whitespace; a BOM remains URL data.
  line = line.replace(/^(\s*\[([^^\]][^\]]*)\]:[ \t]*)((?:\x00P\d+\x00|[^\x00-\x20\x7f])+)([\s\S]*)$/u, (match, head, label: string, dest, rest) =>
    referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) === undefined
      ? match
      : protect(head + writeMarkdownDestination(dest, protectedSpans, table) + decodeEntitiesInTitle(rest, protectedSpans, preserveSingleQuoteTitle), match),
  )

  line = writeHtmlCodeMarkup(line, protect, protectedSources, writeHtmlCode, htmlCodeLineAt,
    joinedLines ? (offset) => { htmlCodeLineAt(offset); joinedLines.add(codeSourceLines) } : undefined)

  const autolinkSubject = line
  let htmlCursor = 0
  line = line.replace(/<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*/g, (match, offset: number) => {
    while (htmlCursor < offset) {
      const tag = autolinkSubject[htmlCursor] === '<' ? scanHtmlTag(autolinkSubject, htmlCursor, protectedSpans) : undefined
      htmlCursor = tag?.end ?? htmlCursor + 1
    }
    if (htmlCursor > offset) return match
    for (const token of match.matchAll(RE_PROTECTED_SPAN_TOKEN)) {
      if (protectedSpans[Number(token[1])] !== '\\>') continue
      return protect(writeLiteralAutolink(match.slice(1, token.index) + '\\')) + match.slice(token.index + token[0].length)
    }
    return match
  })

  // Autolinks `<scheme:...>` and `<email>`: the URL/address is literal, so a
  // `_` or `*` inside it (e.g. /_v1_/) must not be rewritten as markup.
  line = line.replace(/<([A-Za-z][A-Za-z0-9+.-]*):[^<>\s]*>/g, (match, scheme: string) => {
    if (scheme.length < 2 || scheme.length > 32) return protect('\\<') + match.slice(1)
    let body = match.slice(1, -1)
    for (let pass = 0; pass < protectedSpans.length; pass++) {
      const restored = body.replace(RE_PROTECTED_SPAN_TOKEN, (_token, index: string) => protectedSpans[Number(index)] ?? _token)
      if (restored === body) break
      body = restored
    }
    if (!/["\\`{}|^\p{Cf}\p{Cc}\p{White_Space}]/u.test(body)) return protect(match)
    return protect(writeLiteralAutolink(body))
  })
  line = line.replace(/<[^>\s@]+@[^>\s]+>/g, match =>
    /[\\\x00]/.test(match) ? match : (table && match.includes('|')) || match.includes('`')
      ? protect(writeLiteralAutolink(match.slice(1, -1), 'mailto:')) : protect(match),
  )

  // Markdown inline HTML is live markup. Protect tags that have no lossless
  // Carve-native equivalent as explicit raw HTML before delimiter rewrites.
  const escapeLabelSlashes = (label: string, guard = false): string => {
    const opaqueEnd = opaqueHtmlScanner(label)
    const tokenAt = /\x00P\d+\x00/y
    let escaped = ''
    for (let at = 0; at < label.length;) {
      if (label[at] === '\\') { escaped += label.slice(at, at + 2); at += 2; continue }
      if (label[at] === '\x00') {
        tokenAt.lastIndex = at
        const token = tokenAt.exec(label)
        if (token) { escaped += token[0]; at += token[0].length; continue }
      }
      const tagEnd = label[at] === '<' ? opaqueEnd(at) ?? scanHtmlTag(label, at)?.end : undefined
      if (tagEnd !== undefined) { escaped += label.slice(at, tagEnd); at = tagEnd; continue }
      // An intraword slash, or one with whitespace on both sides, neither opens nor closes emphasis.
      const before = label[at - 1], next = label[at + 1]
      const delimiter = label[at] === '/' && (
        (next !== undefined && !/[ \t\n]/.test(next) && !/[A-Za-z0-9]/.test(before ?? ''))
        || (before !== undefined && !/[ \t\n]/.test(before) && !/[A-Za-z0-9]/.test(next ?? '')))
      escaped += delimiter ? (guard ? protect('\\/', '/') : '\\/') : label[at]!
      at++
    }
    return escaped
  }
  if (line.includes('/') && /[*_]|<(?:em|i)\b/i.test(line)) line = escapeLabelSlashes(line, true)
  line = convertInlineHtml(line, protect, protectedSpans, protectedSources)
  // escapeDestination and writeLiteralAutolink own backslashes in links and autolinks.
  // Protected spans and HTML tags are opaque; text between them uses writer spelling.
  line = respellTextBackslashes(line)

  const referenceUrls = plainMarkdownUrlRanges(line, protectedSpans, protectedSources)
  let referenceUrlAt = 0
  const destinationOpeners = completeDestinationOpeners(line)
  line = line.replace(/(?<![!\\\]])\[([^[\]\n]+)\](?!\[)/g, (match, label: string, offset: number, source: string) => {
    while (referenceUrlAt < referenceUrls.length && referenceUrls[referenceUrlAt]!.end <= offset) referenceUrlAt++
    const url = referenceUrls[referenceUrlAt]
    if (url && offset >= url.start && offset < url.end) return match
    if (destinationOpeners.has(offset + match.length)) return match
    const following = /^\x00P(\d+)\x00/.exec(source.slice(offset + match.length))
    if (following) {
      if (literalReferenceOpeners?.has(following[0])) return match
      const protectedTail = protectedSpans[Number(following[1])] ?? ''
      if (protectedTail.startsWith('(') || protectedTail.startsWith('{title=')) return match
      const reference = /^\[([^\]]*)\]$/.exec(protectedTail)
      if (reference && (reference[1] !== '' || referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined)) return match
    }
    const before = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset)
    if (source[offset + match.length] === ':' && /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*[ \t]*$/.test(before)) return match
    if (/^[ xX]$/.test(label) && ((taskBox && offset === 0) ||
      /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+$/.test(before))) return match
    const destinationLabel = referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSources, table)
    if (destinationLabel === undefined) return table && label.includes('|') ? match.replace(/[\[\]]/g, '\\$&') : match
    if (/[\[\]]/.test(destinationLabel)) return match
    if (url && offset < url.start) {
      const end = offset + match.length
      for (let at = referenceUrlAt; at < referenceUrls.length && referenceUrls[at]!.start < end; at++) {
        referenceUrls[at]!.end = Math.min(referenceUrls[at]!.end, end)
      }
    }
    return `${match}${referenceTail(destinationLabel, label === destinationLabel && /^[\w\s-]+$/u.test(label) ? '[]' : `[${destinationLabel}]`)}`
  })

  if (line.includes(':') || line.includes('www.')) {
    const urls = protectBareMarkdownUrls(line, protectedSpans, protectedSources, table, codeTokens,
      (body, prefix) => protect(writeLiteralAutolink(body, prefix, true)))
    line = urls.line
    if (urls.reparseCode) {
      line = line.replace(/\x00P\d+\x00/g, token => codeTokens.get(token) ?? token)
      line = protectCodeSpans(line, (span, offset) => writeCodeSpan(span, offset, false))
    }
  }

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

  // A Markdown HARD BREAK is two or more spaces before a newline; Carve spells
  // it with a trailing backslash. Trailing spaces mean NOTHING in Carve, so
  // carrying them across dropped the break: `a  \nb` migrated to a `<p>a\nb</p>`
  // with no `<br>`. Runs are joined before this call, so a newline here means
  // another line of the same paragraph follows - which is exactly CommonMark's
  // condition, a hard break being impossible at a paragraph's end. Code spans
  // are already protected, so a multi-line span keeps its own spacing.
  line = line.replace(/ +\n| +/g, (run) => run.endsWith('\n') && run.length > 2 ? '\\\n' : run)

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
  if (importedCrossrefIds !== null && !holdsFenceBody) line = protectUnresolvedCrossrefs(line, importedCrossrefIds, protect)
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
  if (dialect.attributes && !holdsFenceBody) {
    const wholeLine = line.trim()
    line = line.replace(/(?<!\\)\{((?:[^{}"'\\]|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/g,
      (match, inner: string, offset: number, source: string) =>
        (wholeLine === match || /[\x00\]/*_~=,^}]/.test(source[offset - 1] ?? '')) && isValidAttrPayload(inner) ? protect(match) : match)
  }
  // A native tag becomes a marker below, so its `/` is no text delimiter.
  const nativeTags = nativeInlineTagOffsets(line)
  line = nativeTags.size === 0
    ? escapePlainCarveInlineSyntax(line, HANDLED_MARKDOWN)
    : escapePlainCarveInlineSyntaxAround(line, offset => nativeTags.has(offset), HANDLED_MARKDOWN)
  // Numeric references are decoded below. Keep their hash available to that
  // pass even though the standalone escaper freezes it.
  line = line.replace(/&\\#(?=(?:[0-9]+|[xX][0-9A-Fa-f]+);)/g, '&#')
  line = escapeCarveConstructsSpelledLikeText(line, dialect, protectedSpans)
  if (!holdsFenceBody) line = escapeTypographicDashes(line, table)

  line = flattenHtmlAnchorsInLinkLabels(line, protectedSpans, protectedSources,
    label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined)
  line = protectMarkdownLinkLabels(line, protectedSpans, protect,
    label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined,
    reportFlattenedEmphasis, escapeLabelSlashes)
  line = line.replace(/\n([ \t]{4,}~{3,}[ \t]*)(?=\n|$)/g, (_match, run: string) => `\n${protect(run)}`)
  line = markdownEmphasis(line, reportFlattenedEmphasis, undefined, protectedSpans, false, true, 0, undefined, true, undefined, undefined, true, decodeLeadingReference)

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
    line = typeof repl === 'string' ? line.replace(re, repl) : line.replace(re, (match, body: string, offset: number, full: string) => repl(match, body, offset, full, protectedSpans))
  }

  if (!dialect.attributes) line = escapeAttributeListsThatAttach(line)

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

  if (dialect.attributes && !holdsFenceBody) {
    const wholeLine = line.trim()
    line = line.replace(/(?<!\\)\{((?:[^{}"'\\]|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*)\}/g,
      (match, inner: string, offset: number, source: string) =>
        (wholeLine === match || /[\x00\]/*_~=,^}]/.test(source[offset - 1] ?? '')) && isValidAttrPayload(inner) ? protect(match) : match)
  }


  if (!holdsFenceBody) {
    line = line.replace(/["']/g, '\\$&')
  }
  // In a table cell a `#` run is literal text, not a heading marker, so the
  // space after it is content Carve holds.
  line = decodeHtmlEntities(line, !table)

  if (table) line = escapeTablePipes(line)

  return escapeCaptionAfterImportedImage(restoreProtectedSpans(line, protectedSpans, table).replaceAll('\x00FNEMPTY\x00', '{empty}'))
}

/** Keep a later Markdown text line from attaching to a standalone imported image. */
function escapeCaptionAfterImportedImage(written: string): string {
  if (!written.includes('\n^ ') || !written.includes('![')) return written
  const lines = written.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]!.startsWith('^ ') || !lines[i - 1]!.includes('![')) continue
    if (parse(lines[i - 1]!).children[0]?.type === 'image') lines[i] = `\\${lines[i]}`
  }
  return lines.join('\n')
}

/**
 * Protect the bare URLs of `line` as literal autolinks, outside the labels of
 * active links. `reparseCode` is set when a URL took a code span's placeholder.
 */
function protectBareMarkdownUrls(
  line: string,
  protectedSpans: readonly string[],
  protectedSources: readonly string[],
  table: boolean,
  codeTokens: ReadonlyMap<string, string>,
  protectAutolink: (body: string, prefix: string | undefined) => string,
): { line: string; reparseCode: boolean } {
  const activeLabelRanges = markdownActiveLinkLabelRanges(line, protectedSpans,
    label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, protectedSpans, table) !== undefined)
  activeLabelRanges.sort((a, b) => a.start - b.start)
  let activeLabelAt = 0
  let cursor = 0
  let protectedUrls = ''
  let reparseCode = false
  for (const link of markdownBareLinks(line, token => {
    const index = Number(token.slice(2, -1))
    return markdownUrlTokenSource(index, protectedSpans, protectedSources)
  }, 'url')) {
    const offset = link.start
    while (activeLabelAt < activeLabelRanges.length && activeLabelRanges[activeLabelAt]!.end <= offset) activeLabelAt++
    const label = activeLabelRanges[activeLabelAt]
    if (label && offset >= label.start && offset < label.end) {
      continue
    }
    if (/\x00P\d+\x00/g.test(line.slice(offset, link.end)) && [...line.slice(offset, link.end).matchAll(/\x00P\d+\x00/g)].some(token => codeTokens.has(token[0]))) reparseCode = true
    protectedUrls += line.slice(cursor, offset) + protectAutolink(link.body ?? line.slice(offset, link.end), link.prefix) + (link.tail ?? '')
    cursor = link.end
  }
  return { line: protectedUrls + line.slice(cursor), reparseCode }
}

/**
 * Escape a triple reference chain `[a][b][c](dest)` whose middle label defines
 * nothing and whose last does, outside code spans, so the destination stays
 * literal text after the chain.
 */
function respellReferenceChainDestinations(input: string, table: boolean): string {
  const codeRanges: Array<[number, number]> = []
  const codeEnds = backtickRunEnds(input)
  if (codeEnds) for (let at = 0; at < input.length; at++) {
    if (input[at] !== '`') continue
    let slashes = 0
    for (let before = at - 1; before >= 0 && input[before] === '\\'; before--) slashes++
    if (slashes % 2) continue
    const end = codeEnds[at]!
    if (end > at) { codeRanges.push([at, end]); at = end - 1 }
  }
  return input.replace(/(?<!\\)\[([^\[\]\n]+)\]\[([^\[\]\n]+)\]\[([^\[\]\n]+)\](\([^()\n]+\))/g,
    (whole, first: string, second: string, third: string, destination: string, at: number) =>
      !codeRanges.some(([start, end]) => at < end && at + whole.length > start) &&
      referenceDestinationLabel(second, decodeHtmlEntitiesRaw, [], table) === undefined &&
      referenceDestinationLabel(third, decodeHtmlEntitiesRaw, [], table) !== undefined
        ? first.startsWith('^')
          ? `[${first}]${footChainMarker}[${second}][${third}]\\${destination}`
          : referenceDestinationLabel(first, decodeHtmlEntitiesRaw, [], table) === undefined
            ? `\\[${first}][${second}][${third}]\\${destination}` : whole
        : whole)
}

/**
 * Protect the backslash escapes and opaque HTML of a Markdown inline source,
 * and a backslash Carve would read as a hard break.
 */
function protectMarkdownSourceEscapes(line: string, protect: (s: string, source?: string) => string, terminal: boolean): string {
  let escaped = ''
  const opaqueEnd = opaqueHtmlScanner(line)
  for (let i = 0; i < line.length;) {
    if (line[i] === '<') {
      const opaque = opaqueEnd(i)
      if (opaque !== undefined) {
        const html = line.slice(i, opaque)
        escaped += html === '<!---->' ? html : protect(rawInlineHtml(html), html)
        i = opaque
        continue
      }
      const tag = scanHtmlTag(line, i)
      if (tag) {
        const sourceTag = line.slice(i, tag.end)
        escaped += sourceTag
        i = tag.end
        continue
      }
    }
    if (line[i] === '\\' && RE_MARKDOWN_ESCAPABLE.test(line[i + 1] ?? '')) {
      escaped += protect(line.slice(i, i + 2))
      i += 2
    } else {
      escaped += line[i] === '\\' && (line[i + 1] === ' ' || (terminal && i + 1 === line.length)) ? protect('\\\\', line[i]) : line[i]
      i++
    }
  }
  return escaped
}

/** Move an inactive footnote-shaped run's bracket escape to its opener. */
function decodeLiteralFootnoteClosingEscapes(line: string, protectedSpans: readonly string[]): string {
  if (!line.includes('[^') || !line.includes('\x00')) return line
  const replacements: Array<{ start: number; end: number; value: string }> = []
  const tokenAt = /\x00P(\d+)\x00/y
  let opener = -1
  let closing: { start: number; end: number } | undefined
  const keepLiteral = (): void => {
    if (opener < 0 || closing === undefined) return
    replacements.push({ start: opener, end: opener + 1, value: '\\[' })
    replacements.push({ start: closing.start, end: closing.end, value: ']' })
  }
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\n') { keepLiteral(); opener = -1; closing = undefined; continue }
    if (line[i] === '\x00') {
      tokenAt.lastIndex = i
      const token = tokenAt.exec(line)
      if (token) {
        if (opener >= 0 && closing === undefined && protectedSpans[Number(token[1])] === '\\]') {
          closing = { start: i, end: tokenAt.lastIndex }
        }
        i = tokenAt.lastIndex - 1
        continue
      }
    }
    if (line[i] === '\\') { i++; continue }
    if (line[i] === '[' && line[i + 1] === '^') {
      keepLiteral()
      opener = i
      closing = undefined
    } else if (line[i] === ']') {
      opener = -1
      closing = undefined
    }
  }
  keepLiteral()
  if (replacements.length === 0) return line
  let result = '', at = 0
  for (const replacement of replacements) {
    result += line.slice(at, replacement.start) + replacement.value
    at = replacement.end
  }
  return result + line.slice(at)
}

/**
 * Write the HTML `<code>` markup of an inline source: as a code span where
 * `writeHtmlCode` can spell one, else as protected raw HTML, with a line break
 * an entity spells inside it kept as one.
 */
function writeHtmlCodeMarkup(
  line: string,
  protect: (s: string, source?: string) => string,
  protectedSources: readonly string[],
  writeHtmlCode: (match: string, offset: number) => string | undefined,
  htmlCodeLineAt: (offset: number) => number | undefined,
  markJoinedLine: ((offset: number) => void) | undefined,
): string {
  let codeWritten = ''
  let htmlCodeDepth = 0
  const codeOpaqueEnd = opaqueHtmlScanner(line)
  for (let i = 0; i < line.length;) {
    if (htmlCodeDepth > 0 && line[i] === '&') {
      const entity = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(line.slice(i))
      if (entity && /[\r\n]/.test(decodeHtmlEntitiesRaw(entity[0]))) {
        const start = i
        i += entity[0].length
        if (decodeHtmlEntitiesRaw(entity[0]) === '\r') {
          const following = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(line.slice(i))
          if (following && decodeHtmlEntitiesRaw(following[0]) === '\n') i += following[0].length
          else if (line[i] === '\n') {
            markJoinedLine?.(i + 1)
            i++
            while (line[i] === ' ' || line[i] === '\t') i++
          }
        }
        codeWritten += protect(rawInlineHtml('<!---->&#10;<!---->'), referenceSourceText(line.slice(start, i), protectedSources))
        continue
      }
    }
    if (line[i] !== '<') { codeWritten += line[i++]; continue }
    const opaque = codeOpaqueEnd(i)
    if (opaque !== undefined) { codeWritten += line.slice(i, opaque); i = opaque; continue }
    const code = /^<code>((?:[^<\n]|<!---->)*)<\/code>/i.exec(line.slice(i))
    const written = code ? writeHtmlCode(code[0], i) : undefined
    if (code && written !== undefined) { codeWritten += written; i += code[0].length; continue }
    const tag = scanHtmlTag(line, i)
    if (tag) {
      const sourceTag = line.slice(i, tag.end)
      if (tag.name === 'code') {
        htmlCodeDepth = Math.max(0, htmlCodeDepth + (tag.closing ? -1 : 1))
        const codeSourceLine = htmlCodeLineAt(i)
        if (!tag.closing) importLosses.push({ code: 'raw-code-fallback', message: 'Preserved HTML code markup as raw HTML; targets and profiles that escape or omit raw HTML change its code structure and content', fidelity: 'degraded', ...(codeSourceLine === undefined ? {} : { line: codeSourceLine }) })
        codeWritten += protect(rawInlineHtml(sourceTag), sourceTag)
      } else codeWritten += sourceTag
      i = tag.end
    } else codeWritten += line[i++]
  }
  return codeWritten
}

/** Spell the backslashes between protected spans and native tags as the writer does. */
function respellTextBackslashes(line: string): string {
  let spelled = ''
  for (let at = 0; at < line.length;) {
    if (line[at] === '\x00') {
      RE_PROTECTED_SPAN_TOKEN.lastIndex = at
      const token = RE_PROTECTED_SPAN_TOKEN.exec(line)
      if (token && token.index === at) { spelled += token[0]; at += token[0].length; continue }
    }
    if (line[at] === '<') {
      RE_NATIVE_INLINE_TAG.lastIndex = 0
      const tag = RE_NATIVE_INLINE_TAG.exec(line.slice(at, at + 16))
      RE_NATIVE_INLINE_TAG.lastIndex = 0
      if (tag?.index === 0) { spelled += tag[0]; at += tag[0].length; continue }
    }
    if (line[at] === '\\' && line[at + 1] !== undefined) {
      const next = line[at + 1]!
      spelled += next === '\n' || RE_MARKDOWN_ESCAPABLE.test(next) ? '\\' + next : '\\\\' + next
      at += 2
      continue
    }
    spelled += line[at++]
  }
  return spelled
}

/**
 * Splice the protected spans back into `line`, until no placeholder a restored
 * span carried is left, keeping two adjacent code spans apart.
 */
function restoreProtectedSpans(line: string, protectedSpans: readonly string[], table: boolean): string {
  const maxRestorePasses = protectedSpans.length + 1
  for (let pass = 0; pass < maxRestorePasses; pass++) {
    const prev = line
    line = line.replace(/(\x00P(\d+)\x00)(?=\x00P(\d+)\x00)/g, (token, _leftToken: string, leftIndex: string, rightIndex: string) => {
      const left = protectedSpans[Number(leftIndex)] ?? ''
      const right = protectedSpans[Number(rightIndex)] ?? ''
      if (!left.endsWith('`') || !right.startsWith('`')) return token
      let start = left.length - 2
      while (start >= 0 && left[start] === '\\') start--
      return left.startsWith('`') || (left.length - 2 - start) % 2 === 0 ? token + '{%  %}' : token
    })
    line = line
      // A stash/protect index that has no stored value means the NUL-wrapped
      // sentinel came from the input itself (not one we emitted), so keep the
      // matched text verbatim rather than splicing the literal string
      // "undefined" into the output. Unreachable from an input NUL since the
      // replacement above - kept because it is the post-condition of the whole
      // restore, and the cost of being wrong about that is a document with
      // "undefined" written into it.
      .replace(RE_PROTECTED_SPAN_TOKEN, (m, i) => {
        const span = protectedSpans[Number(i)] ?? m
        return table && !/^!?`/.test(span)
          ? escapeTablePipes(span)
          : span
      })
    if (line === prev) break
  }
  return line
}

/** Escape list markers accepted by Carve but read as text by Markdown. */
function escapeCarveOnlyMarker(input: string): string {
  return input.replace(/^.*$/gm, line => {
    const prefixEnd = carveOnlyMarkerPrefixEnd(line)
    const prefix = line.slice(0, prefixEnd)
    const rest = line.slice(prefixEnd)
    const marker = /^(?:(\d{10,}|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)([.)])|(\.))(?=[ \t]|$|\{)/.exec(rest)
    if (marker === null) return line
    return `${prefix}${marker[1] ?? ''}\\${marker[2] ?? marker[3]}${rest.slice(marker[0].length)}`
  })
}

/** Read the quote and list prefix once, without regex backtracking across levels. */
function carveOnlyMarkerPrefixEnd(line: string): number {
  let at = 0
  const quote = /[ \t]*>[ \t]?/y
  const item = /[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/y
  for (;;) {
    quote.lastIndex = at
    if (!quote.exec(line)) break
    at = quote.lastIndex
  }
  while (line[at] === ' ' || line[at] === '\t') at++
  for (;;) {
    item.lastIndex = at
    if (!item.exec(line)) break
    at = item.lastIndex
  }
  return at
}

/**
 * The container markers a line opens with, quote and item alike, innermost last.
 */
function containerMarkersOnLine(prefix: string): string[] {
  const markers: string[] = []
  let rest = prefix
  for (;;) {
    const m = /^[ \t]*(?:(>)[ \t]?|([-*+]|\d{1,9}[.)])[ \t]+)/.exec(rest)
    if (m === null) return markers
    markers.push(m[1] ?? m[2]!)
    rest = rest.slice(m[0].length)
  }
}

/**
 * Keep a task pair cmark-gfm read as text as text, by escaping its bracket.
 *
 * GFM's tasklist extension takes a box off a line carrying ONE list marker,
 * bullet or ordered, and off the three states ` `, `x` and `X`. Carve reads a
 * box behind a quoted item, two markers on one line, or four further states,
 * where the source meant the characters
 * (carve-js#2047, carve-js#2048). cmark-gfm 0.29.0.gfm.13 is the reader the
 * importers answer to (carve#2187), extension scope included.
 *
 * Behind an ordered marker Carve reads no task at all, so an escape there would
 * guard nothing: `1. [x] done` is already the text it renders.
 */
function escapeUnreadTaskMarker(line: string): string {
  let at = 0
  const marker = /[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+)/y
  for (;;) {
    marker.lastIndex = at
    if (!marker.exec(line)) break
    at = marker.lastIndex
  }
  const m = /^\[([ xX\-_>/!?])\](?= +[ \t]*\S)/.exec(line.slice(at))
  if (m === null) return line
  const prefix = line.slice(0, at)
  const markers = containerMarkersOnLine(prefix)
  if (!/^[-*]$/.test(markers.at(-1) ?? '')) return line
  if (markers.length === 1 && /^[ xX]$/.test(m[1]!)) return line
  return `${prefix}\\[${m[1]!}]${line.slice(at + m[0].length)}`
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
    // The task escape first: once the pair is text, what follows it is the item
    // paragraph rather than a content position, so no marker there is structural.
    return escapeCarveOnlyMarker(escapeUnreadTaskMarker(line))
  }).join('\n').replace(RE_PROTECTED_SPAN_TOKEN, (match, index: string) => protectedSpans[Number(index)] ?? match)
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

/** An ATX heading line, as the writer emits it: the marker run at column 0. */
const RE_ATX_HEADING = /^#{1,6}(?:[ \t]|$)/

/**
 * A setext underline: a run of `=` or `-` with only spaces or tabs around it
 * (CommonMark 4.3); a form feed or a no-break space after the run leaves the
 * line paragraph text. Indentation is measured by the caller.
 */
const RE_MD_SETEXT_UNDERLINE = /^[ \t]*(=+|-+)[ \t]*$/

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
    if (ch === '\\' && row[i + 1] === '|') {
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
function escapeTablePipes(text: string): string {
  return text.replace(/(\\*)\||\\+/g, (run, slashes: string | undefined) =>
    slashes === undefined ? run : slashes + (slashes.length % 2 === 0 ? '\\|' : '|'),
  )
}

function writeTableRow(
  cells: readonly string[],
  prefixes: readonly string[],
  dialect: MarkdownDialect,
  width: number = cells.length,
  reportEmptyLosses = true,
): string {
  let row = ''
  for (let c = 0; c < width; c++) {
    const cell = convertInline((cells[c] ?? '').replace(/\\\|/g, '|'), dialect, false, false, undefined, true, true, reportEmptyLosses)
    const originalPrefix = prefixes[c] ?? ''
    const prefix = cell.trim() === '' ? originalPrefix.replace(/<|\^/g, '') : originalPrefix
    row += '|' + padCell(prefix, escapeSpanMarkerPayload(cell, prefix))
  }
  return row + '|'
}

/**
 * What the importer could not represent, in the shared migration report's
 * vocabulary (docs/migration-results.md). `migrateMarkdown` carries these out
 * as diagnostics; `markdownToCarve` returns the source alone.
 */
import {
  CARRIER_HEAD,
  CARRIER_PREFIX,
  carrierFenceWidth,
  carrierIsCaption,
  carrierIsCodeFence,
  carrierIsCloser,
  carrierMarker,
  carrierPayload,
} from './import/markdown/carrier-markers.js'
import { replaceLoneSurrogates } from './well-formed.js'

export type MarkdownImportLoss = {
  code: 'structure-unspellable' | 'frontmatter-synthesized' | 'raw-span-whitespace-trimmed'
    | 'carrier-marker-dropped' | 'carrier-markers-damaged' | 'raw-code-fallback' | 'markdown-html-comment'
  message: string
  line?: number
  /** Overrides the code's default, for a reading the importer derived. */
  confidence?: 'exact' | 'inferred' | 'fallback'
  /** Overrides the code's default, where the construct survives the text does not. */
  fidelity?: 'degraded' | 'normalized'
}


/**
 * PART 11 §10s: the carrier payloads this conversion lifted out of the source,
 * in the order their marker lines appeared.
 */
let carrierSlots: Array<{ payload: string; depth: number; closer: boolean; caption: boolean; replaceParagraph: boolean; equation?: string; fence?: true }> = []

/** The placeholder a lifted marker line stands in as, unique in the source. */
let carrierToken = ''

/** Which kind of marker, if any, produced a line of the restored Carve. */
type CarrierLineKind = 'open' | 'close' | 'caption' | undefined

/**
 * How many bold fallback lines the Markdown target wrote for an opener's own
 * metadata: one for a quoted title, one for a `[label]`. The payload carries
 * them now, so leaving the fallback would be the same text twice.
 */
function carrierFallbackLines(payload: string): number {
  // A CAPTION MARKER REPLACES ITS RENDERED PARAGRAPH rather than adding a
  // second copy of it: a caption, unlike an attribute line, also renders as
  // body text (PART 11 §10s).
  if (carrierIsCaption(payload)) return 1
  const width = carrierFenceWidth(payload)
  if (width === 0) return 0
  let rest = payload.slice(width)
  let lines = 0
  const label = /[ \t]?\[.*\]$/.exec(rest)
  if (label !== null) {
    lines++
    rest = rest.slice(0, rest.length - label[0].length)
  }
  if (/[ \t]"[^"]*"$/.test(rest)) lines++

  return lines
}

/**
 * Whether a marker set records a structure at all: every opener closed by a
 * bare fence of its own width, every attribute line against an opener, and
 * nothing left open.
 */
function carrierSetBalances(payloads: readonly string[]): boolean {
  const open: number[] = []
  for (const payload of payloads) {
    if (/^::[ \t]/.test(payload) || payload === ':' || payload === '') continue
    if (carrierIsCaption(payload) || carrierIsCodeFence(payload) || carrierListStyle(payload) !== undefined) continue
    if (/^\{.*\}$/.test(payload)) {
      if (!isValidAttrPayload(payload.slice(1, -1))) return false
      continue
    }
    const width = carrierFenceWidth(payload)
    if (width === 0) return false
    if (carrierIsCloser(payload)) {
      if (open.length === 0 || open.pop() !== width) return false
    } else {
      if (open.length > 0 && width <= open[open.length - 1]!) return false
      open.push(width)
    }
  }
  return open.length === 0
}

const isDefinitionPayload = (payload: string): boolean => /^::[ \t]/.test(payload) || payload === ':' || payload === ''

/** An ordered-list style carried by its first canonical Carve marker. */
function carrierListStyle(payload: string, start?: number): List['olType'] | undefined {
  const markers = /^([A-Za-z]+[.)])(?: ([A-Za-z]+[.)]))?$/.exec(payload)
  if (!markers) return undefined
  const probe = (marker: string): string => `${marker}${marker.endsWith('.') ? '  ' : ' '}item`
  if (markers[2] !== undefined) {
    const node = parse(`${probe(markers[1]!)}\n${probe(markers[2])}\n`).children[0]
    return node?.type === 'list' && node.ordered && node.items.length === 2 ? node.olType : undefined
  }
  const first = markers[1]!.slice(0, -1)
  if (start !== undefined && /^[IVXLCDM]$/i.test(first)) {
    const roman = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }[first.toLowerCase() as 'i' | 'v' | 'x' | 'l' | 'c' | 'd' | 'm']
    if (roman === start) return first === first.toLowerCase() ? 'i' : 'I'
    if (first.toLowerCase().charCodeAt(0) - 96 === start) return first === first.toLowerCase() ? 'a' : 'A'
  }
  const node = parse(`${probe(payload)}\n`).children[0]
  return node?.type === 'list' && node.ordered ? node.olType : undefined
}

/**
 * Whether the definition-list markers pair by depth (CARVE-P11-067): a list of
 * depth 2 or more opens only inside an open definition of the list one level up.
 */
function carrierDepthsPair(payloads: ReadonlyMap<number, string>, depths: ReadonlyMap<number, number>): boolean {
  const lists: Array<{ inDefinition: boolean }> = []
  for (const [at, payload] of payloads) {
    const depth = depths.get(at) ?? 1
    if (!isDefinitionPayload(payload)) {
      if (depth > 1) return false
      continue
    }
    if (/^::[ \t]/.test(payload)) {
      if (depth === lists.length) lists.at(-1)!.inDefinition = false
      else if (depth === lists.length + 1 && (depth === 1 || lists.at(-1)!.inDefinition)) lists.push({ inDefinition: false })
      else return false
    } else if (depth !== lists.length) return false
    else if (payload === ':') lists.at(-1)!.inDefinition = true
    else lists.pop()
  }
  return lists.length === 0
}

function carrierPlacementsValid(lines: string[], payloads: ReadonlyMap<number, string>, hosts: ReadonlyMap<number, string>, depths: ReadonlyMap<number, number>): boolean {
  let token = 'CARVEPROBE'
  while (lines.some(line => line.includes(token))) token += 'X'
  const probe = lines.map((line, at) => {
    if (!payloads.has(at)) return line
    const host = hosts.get(at)!
    const continuation = host.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ')
    const before = host === continuation ? `${continuation.trimEnd()}\n` : ''
    return `${before}${host}${token}${at}Z\n${continuation.trimEnd()}`
  }).join('\n')
  const openers: Array<{ payload: string; host: string }> = []
  let hostsValid = true
  const captionClosers = new Set<number>()
  for (const [at, payload] of payloads) {
    if (carrierFenceWidth(payload) === 0) continue
    if (carrierIsCloser(payload)) {
      const opener = openers.pop()
      if (opener?.host !== hosts.get(at)) hostsValid = false
      if (/^:{3,}[ \t]+figure(?:[ \t]|$)/.test(opener?.payload ?? '')) captionClosers.add(at)
    } else openers.push({ payload, host: hosts.get(at)!.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ') })
  }
  const savedLosses = importLosses
  importLosses = []
  let tree: Document
  try { tree = parse(convertMarkdown(probe, COMMONMARK_GFM)) } finally { importLosses = savedLosses }
  const found = new Set<number>()
  let valid = true
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      const definitions: Array<{ depth: number; list: number }> = []
      let depth = 0
      for (let i = 0; i < value.length; i++) {
        const node = value[i] as BlockNode
        if (node?.type === 'paragraph') {
          const text = node.children.map(child => child.type === 'text' ? child.value : '').join('')
          const match = new RegExp(`^${token}(\\d+)Z$`).exec(text)
          if (match) {
            const at = Number(match[1])
            found.add(at)
            const payload = payloads.get(at)!
            if (carrierFenceWidth(payload) > 0) depth += carrierIsCloser(payload) ? -1 : 1
            const list = depths.get(at) ?? 1
            if (/^::[ \t]/.test(payload)) {
              const last = definitions.at(-1)
              if (!last || last.depth !== depth || last.list < list) definitions.push({ depth, list })
            } else if (payload === ':') {
              const last = definitions.at(-1)
              if (!last || last.depth !== depth || last.list !== list) valid = false
            } else if (payload === '') {
              const last = definitions.pop()
              if (!last || last.depth !== depth || last.list !== list) valid = false
            }
            const next = value[i + 1] as BlockNode | undefined
            const previous = value[i - 1] as BlockNode | undefined
            const following = withoutCarrierHost(lines[at + 1] ?? '', hosts.get(at)!)
            if (/^\{.*\}$/.test(payload)) {
              const nextPayload = payloads.get(at + 1)
              const listPrelude = nextPayload !== undefined && /^::[ \t]/.test(nextPayload) &&
                (definitions.length === 0 || (depths.get(at + 1) ?? 1) > definitions.at(-1)!.list)
              const fencePrelude = nextPayload !== undefined && carrierIsCodeFence(nextPayload)
              const stylePrelude = nextPayload !== undefined && carrierListStyle(nextPayload) !== undefined
              if (!following || !next || (nextPayload !== undefined && !listPrelude && !fencePrelude && !stylePrelude && (carrierFenceWidth(nextPayload) === 0 || carrierIsCloser(nextPayload)))) valid = false
            }
            if (carrierIsCodeFence(payload) && (!/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(following) || next?.type !== 'code_block' || payloads.has(at + 1))) valid = false
            if (carrierListStyle(payload) !== undefined && (!/^[0-9]+[.)][ \t]+\S/.test(following) || next?.type !== 'list' || !next.ordered || payloads.has(at + 1))) valid = false
            if (carrierIsCaption(payload) || /^::[ \t]/.test(payload)) {
              if (!following || next?.type !== 'paragraph' || payloads.has(at + 1)) valid = false
            }
            if (carrierIsCaption(payload)) {
              let before = at - 1
              while (before >= 0 && withoutCarrierHost(lines[before]!, hosts.get(at)!) === '') before--
              const equation = /^\$\$[^$]+\$\$$/.test(carrierEquationContent(lines[before] ?? '', hosts.get(at)!))
              const captionable = previous && (['block_quote', 'table', 'image', 'code_block'].includes(previous.type) || (previous.type === 'paragraph' && equation))
              if (!captionable && !captionClosers.has(before)) valid = false
            }
          }
        }
        visit(value[i])
      }
      if (definitions.length > 0) valid = false
    } else for (const child of Object.values(value)) visit(child)
  }
  visit(tree.children)
  return valid && hostsValid && found.size === payloads.size
}

/**
 * Drop invalid payloads and lift valid carrier lines to placeholders.
 *
 * A set that does not balance is NEVER reconstructed: the source comes back
 * untouched, the markers import as the raw HTML they are, and one
 * `carrier-markers-damaged` loss is reported.
 */
function prepareCarrierMarkers(markdown: string, blockLines: ReadonlySet<number>, sourceLineNumbers?: readonly number[]): string {
  carrierSlots = []
  carrierToken = ''
  if (!markdown.includes(CARRIER_HEAD)) return markdown

  const { lines, lineNumbers, markerLines, spanned } = joinSpannedCarrierMarkers(markdown.replace(/\r\n?/g, '\n').split('\n'), blockLines, sourceLineNumbers)
  const dropped: MarkdownImportLoss[] = []
  const payloads = new Map<number, string>()
  const hosts = new Map<number, string>()
  const depths = new Map<number, number>()
  // A MARKER IS A LINE THE BLOCK STRUCTURE READ AS HTML. The payload of a code
  // construct is verbatim content, so a marker-shaped line in one records no
  // container and must be left where it is - lifting one rewrote the sample
  // inside the fence on this engine's own docs page. The structure the importer
  // derives answers that at every indent and behind every host prefix, which a
  // fence scan over the raw lines could not (markup-carve/carve#2850).
  for (const [at, line] of lines.entries()) {
    if (!markerLines.has(at)) continue
    const host = carrierHostPrefix(line)
    const marker = carrierMarker(spanned.get(at) ?? line.slice(host.length))
    if (marker !== undefined) {
      const { payload, depth } = marker
      if (depth === 1 && inlineCarriersEnabled && (payload === '[' || payload.startsWith(']{') || payload.startsWith('</#'))) continue
      payloads.set(at, payload)
      hosts.set(at, host)
      if (depth > 1) depths.set(at, depth)
    }
  }
  if (payloads.size === 0 && dropped.length === 0) return markdown
  classifyBareFencePayloads(payloads)
  // Pair by shape before checking whether each payload can be restored.
  const pairs = new Map<number, number>()
  const reversePairs = new Map<number, number>()
  const open: number[] = []
  let balanced = true
  for (const [at, payload] of payloads) {
    const width = carrierFenceWidth(payload)
    if (width === 0) continue
    if (carrierIsCloser(payload)) {
      const opener = open.pop()
      if (opener === undefined || carrierFenceWidth(payloads.get(opener)!) !== width) balanced = false
      else {
        pairs.set(opener, at)
        reversePairs.set(at, opener)
      }
    } else {
      if (open.length > 0 && width <= carrierFenceWidth(payloads.get(open.at(-1)!)!)) balanced = false
      open.push(at)
    }
  }
  balanced &&= open.length === 0
  if (balanced) {
    for (const [at, payload] of payloads) {
      if (!payloads.has(at)) continue
      const width = carrierFenceWidth(payload)
      const isOpener = width > 0 && !carrierIsCloser(payload)
      const closer = pairs.get(at)
      const tree = isOpener ? parse(`${payload}\n${payloads.get(closer!)!}\n`) : undefined
      const valid = ((depths.get(at) ?? 1) === 1 || isDefinitionPayload(payload)) && (tree
        ? tree.children.length === 1 && tree.children[0]!.type !== 'paragraph'
        : /^\{.*\}$/.test(payload)
          ? isValidAttrPayload(payload.slice(1, -1))
          : carrierIsCodeFence(payload)
            ? codeFenceCarrier(payload) !== undefined
            : width > 0 || carrierIsCaption(payload) || (carrierListStyle(payload) !== undefined &&
              !/(?:^|[ \t>])(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/.test(hosts.get(at)!)) || isDefinitionPayload(payload))
      if (valid) continue
      payloads.delete(at)
      depths.delete(at)
      if (closer !== undefined) {
        payloads.delete(closer)
        depths.delete(closer)
        let caption = closer + 1
        while (caption < lines.length && withoutCarrierHost(lines[caption]!, hosts.get(closer)!) === '') caption++
        if (carrierIsCaption(payloads.get(caption) ?? '') && hosts.get(caption) === hosts.get(closer)) {
          payloads.delete(caption)
          depths.delete(caption)
        }
      }
      const opener = reversePairs.get(at)
      if (opener !== undefined) {
        payloads.delete(opener)
        depths.delete(opener)
      }
      dropped.push({
        code: 'carrier-marker-dropped',
        message: `${isOpener ? CARRIER_MARKER_PAIR_DROPPED : CARRIER_MARKER_DROPPED}: ${lines[at]!.slice(hosts.get(at)!.length)}`,
        line: lineNumbers[at]!,
        fidelity: 'degraded',
        confidence: 'fallback',
      })
    }
  }
  if (!balanced || !carrierSetBalances([...payloads.values()]) || !carrierDepthsPair(payloads, depths) || !carrierPlacementsValid(lines, payloads, hosts, depths)) {
    importLosses.push({
      code: 'carrier-markers-damaged',
      message: CARRIER_MARKERS_DAMAGED,
      fidelity: 'degraded',
      confidence: 'fallback',
    })

    return markdown
  }

  importLosses.push(...dropped)

  let token = 'CARVECARRIER'
  while (markdown.includes(token)) token += 'X'
  carrierToken = token

  const out: string[] = []
  let drop = 0
  let skipBlank = false
  let host = ''
  const last = lines.length - 1
  for (const [at, line] of lines.entries()) {
    const payload = payloads.get(at)
    if (payload === undefined) {
      const body = withoutCarrierHost(line, host)
      if (drop > 0 && /^\*\*.+\*\*$/.test(body)) {
        drop--
        skipBlank = true
        continue
      }
      // The LAST element is the source's trailing newline, not a separator the
      // dropped fallback brought with it: consuming it would leave the Carve
      // output without its own final newline.
      if (skipBlank && at !== last && body === '') {
        skipBlank = false
        continue
      }
      skipBlank = false
      out.push(line)
      continue
    }
    host = hosts.get(at)!
    // The placeholder keeps the host prefix, so a marker inside a list item or
    // a block quote stays in that host when the lifted source is read.
    const continuation = host.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ')
    const replaces = carrierIsCaption(payload) || /^::[ \t]/.test(payload)
    const fallback = withoutCarrierHost(lines[at + 1] ?? '', host)
    const afterFallback = withoutCarrierHost(lines[at + 2] ?? '', host)
    const droppedBold = replaces && /^\*\*.+\*\*$/.test(fallback) && (afterFallback === '' || payloads.has(at + 2))
    if (!droppedBold && carrierIsCaption(payload) && at > 0 && withoutCarrierHost(lines[at - 1]!, host) !== '' && !payloads.has(at - 1)) out.push(continuation.trimEnd())
    if (host === continuation) out.push(continuation.trimEnd())
    out.push(`${host}${token}${carrierSlots.length}Z`)
    out.push(continuation.trimEnd())
    const equationLine = carrierEquationContent(lines[at - 1] ?? '', host)
    const equation = carrierIsCaption(payload) && /^\$\$[^$]+\$\$$/.test(equationLine) ? equationLine : undefined
    carrierSlots.push({ payload, depth: depths.get(at) ?? 1, closer: carrierIsCloser(payload) || payload === '', caption: carrierIsCaption(payload), replaceParagraph: replaces && !droppedBold, ...(equation !== undefined ? { equation } : {}), ...(carrierIsCodeFence(payload) ? { fence: true as const } : {}) })
    drop = droppedBold ? 1 : carrierIsCaption(payload) || carrierIsCloser(payload) ? 0 : carrierFallbackLines(payload)
  }

  return out.join('\n')
}

/**
 * Join a marker whose payload spans lines into one entry (CARVE-P11-063). The
 * entry keeps the raw lines, so an unlifted marker comes back verbatim, and
 * `spanned` holds the comment with each later line's host prefix removed.
 * The scan for the closing `-->` only moves forward, which keeps it linear.
 */
function joinSpannedCarrierMarkers(raw: readonly string[], blockLines: ReadonlySet<number>, sourceLineNumbers?: readonly number[]): {
  lines: string[]
  lineNumbers: number[]
  markerLines: Set<number>
  spanned: Map<number, string>
} {
  const lines: string[] = []
  const lineNumbers: number[] = []
  const markerLines = new Set<number>()
  const spanned = new Map<number, string>()
  let close = 0
  for (let at = 0; at < raw.length; at++) {
    const line = raw[at]!
    const number = sourceLineNumbers?.[at] ?? at + 1
    if (blockLines.has(at)) {
      const host = carrierHostPrefix(line)
      const head = line.slice(host.length)
      if (head.startsWith(CARRIER_HEAD) && !head.includes('-->')) {
        if (close <= at) close = at + 1
        while (close < raw.length && !raw[close]!.includes('-->')) close++
        const continuation = host.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ')
        const comment = close < raw.length ? [head, ...raw.slice(at + 1, close + 1).map(rest => withoutCarrierHost(rest, continuation))].join('\n') : ''
        if (comment !== '' && carrierMarker(comment) !== undefined) {
          markerLines.add(lines.length)
          spanned.set(lines.length, comment)
          lines.push(raw.slice(at, close + 1).join('\n'))
          lineNumbers.push(number)
          at = close
          continue
        }
      }
      markerLines.add(lines.length)
    }
    lines.push(line)
    lineNumbers.push(number)
  }
  return { lines, lineNumbers, markerLines, spanned }
}

/**
 * A bare div's opener and every closer are the same bytes, `:::` (CARVE-P11-063),
 * so which one a payload is follows from the open containers: a bare fence of
 * the innermost opener's width closes it, any other opens. An opener is given
 * the trailing space it keeps through the rest of the import, the spelling an
 * older export wrote, which is still read.
 */
function classifyBareFencePayloads(payloads: Map<number, string>): void {
  const open: number[] = []
  for (const [at, payload] of payloads) {
    const width = carrierFenceWidth(payload)
    if (width === 0) continue
    if (!carrierIsCloser(payload)) {
      open.push(width)
      continue
    }
    const innermost = open.at(-1)
    if (innermost !== undefined && width <= innermost) {
      open.pop()
      continue
    }
    payloads.set(at, `${payload} `)
    open.push(width)
  }
}

/**
 * The host prefix a marker line carries before the marker itself: a block
 * quote's `>` runs, a list item's indentation, and the item marker or task box
 * that opens it.
 */
function carrierHostPrefix(line: string): string {
  const at = line.indexOf(CARRIER_HEAD)
  return at === -1 ? '' : line.slice(0, at)
}

/**
 * A line with the recorded host prefix taken off, for the fallback lines
 * travelling under an opener. A block quote writes its blank lines as a bare
 * `>`, which the opener's own prefix does not cover.
 */
function withoutCarrierHost(line: string, host: string): string {
  if (host === '') return line
  if (line.startsWith(host)) return line.slice(host.length)
  return line.replace(/^[ \t>]+/, '')
}

function carrierEquationContent(line: string, host: string): string {
  return withoutCarrierHost(line, host).replace(/^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
}

/**
 * Give every restored marker line the blank lines the canonical writer puts
 * around it: a container's opener and closer hug its body, and what follows a
 * closer is a block of its own.
 */
function separateCarrierLines(items: readonly CarrierLine[]): CarrierLine[] {
  const blank = (item: CarrierLine): boolean => item.kind === undefined && item.text === ''
  const hugged = new Set<number>()
  for (let at = 0; at < items.length; at++) {
    if (!blank(items[at]!)) continue
    let end = at
    while (end < items.length && blank(items[end]!)) end++
    let before = at - 1
    while (before >= 0 && blank(items[before]!)) before--
    const above = before >= 0 ? items[before]!.kind : undefined
    const below = end < items.length ? items[end]!.kind : undefined
    // Placeholder separators at a host's edges do not separate its blocks.
    // Keep the final empty line for the newline, and one separator when the
    // next block remains in the same host.
    const openingHost = below === 'open' ? items[end]!.lead.trimEnd() : undefined
    if (openingHost !== undefined && (before < 0 || (
      openingHost.includes('>') && !items[before]!.lead.trimEnd().startsWith(openingHost)
      && items.slice(at, end).every(item => item.lead.trimEnd() === openingHost)
    ))) {
      for (let dropAt = at; dropAt < end; dropAt++) hugged.add(dropAt)
    }
    if (above === 'close' || above === 'caption') {
      const closingHost = items[before]!.lead
      const leavesHost = end === items.length || (
        !items[end]!.lead.startsWith(closingHost)
      )
      const dropStart = leavesHost ? at : at + 1
      const dropEnd = end === items.length ? end - 1 : end
      for (let dropAt = dropStart; dropAt < dropEnd; dropAt++) {
        hugged.add(dropAt)
      }
    }
    // A blank above a closer and one below an opener are both inside the
    // container, where the canonical writer puts none. A caption line hugs the
    // closer above it the same way, because its slot hangs on that fence.
    let marker: CarrierLine | undefined
    if (below === 'close' || below === 'caption') marker = items[end]
    else if (above === 'open') marker = items[before]
    // The blank has to share the marker's HOST to be inside it: a `>` line next
    // to a marker standing at column 0 belongs to a block quote of its own.
    if (marker !== undefined) {
      for (let dropAt = at; dropAt < end; dropAt++) {
        if (items[dropAt]!.lead.trimEnd() !== marker.lead.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ').trimEnd()) {
          marker = undefined
          break
        }
      }
    }
    if (marker !== undefined) {
      for (let dropAt = at; dropAt < end; dropAt++) hugged.add(dropAt)
    }
    at = end - 1
  }

  const out: CarrierLine[] = []
  for (const [at, item] of items.entries()) {
    if (hugged.has(at)) continue
    const last = out[out.length - 1]
    const closes = last !== undefined && (last.kind === 'close' || last.kind === 'caption')
    // A closer and what follows take a blank line between them only where they
    // are SIBLINGS. A list item opening after a closer is a block of the host
    // above, and a blank there would turn a tight list loose.
    if (
      closes && item.kind !== 'close' && item.kind !== 'caption' && item.text !== ''
      && item.lead.length >= last!.lead.length
    ) {
      out.push({ lead: last!.lead.trimEnd(), text: '', kind: undefined })
    }
    out.push(item)
  }

  return out
}

type CarrierLine = { lead: string; text: string; kind: CarrierLineKind; depth?: number; fence?: true }

/**
 * Put every restored closer at its OPENER's column.
 *
 * Where a container opens a list item and its body begins with a list, the
 * closer's placeholder is a lazy continuation of that inner item's paragraph,
 * so the written Carve puts it at the inner content column and the container
 * would close in the wrong host. The opener's own prefix is the answer, with
 * any list marker in it blanked out and any task box dropped: a closer cannot
 * repeat an item's marker, and a task box stands in the item's CONTENT, so the
 * body sits at the item's own content column rather than past the box.
 */
function anchorCarrierClosers(items: CarrierLine[]): CarrierLine[] {
  const open: string[] = []
  let closed: string | undefined
  for (const item of items) {
    if (item.kind === 'open' && carrierFenceWidth(item.text) > 0) {
      open.push(item.lead.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' '))
      closed = undefined
      continue
    }
    if (item.kind === 'close' && open.length > 0) {
      closed = open.pop()!
      item.lead = closed
      continue
    }
    // A CAPTION HANGS ON THE CLOSING FENCE, so it stands at that closer's
    // column. Its placeholder is a lazy continuation of the same inner item,
    // and a caption at the wrong column attaches to nothing.
    if (item.kind === 'caption' && closed !== undefined) item.lead = closed
  }

  return items
}

function restoreDefinitionBodies(items: CarrierLine[]): CarrierLine[] {
  const lists: Array<{ lead: string; depth: number; active: boolean; first: boolean }> = []
  const out: CarrierLine[] = []
  for (const item of items) {
    const term = item.kind === 'open' && /^::[ \t]/.test(item.text)
    const definition = item.kind === 'open' && item.text === ':'
    const closing = item.kind === 'close' && item.text === ''
    const depth = item.depth ?? 1
    const last = lists.at(-1)
    const normalizedLead = item.lead.replace(/\[[ xX]\][ \t]+$/, '').replace(/[^>\t]/g, ' ')
    // A deeper term opens a list nested in the open definition (CARVE-P11-067).
    const sameList = last?.lead === normalizedLead && last.depth === depth
    if ((term || definition || closing) && last?.first && sameList) {
      out.push({ lead: last.lead, text: ': {empty}', kind: 'open' })
      last.first = false
    }
    if (term) {
      if (sameList) { last!.active = false; last!.first = false }
      else lists.push({ lead: normalizedLead, depth, active: false, first: false })
    } else if (definition && last) {
      last.active = true
      last.first = true
      continue
    } else if (closing) {
      lists.pop()
      // The list closer carries no Carve text; its surrounding separator is
      // already retained by separateCarrierLines.
      continue
    }
    const active = lists.filter(list => list.active)
    const current = active.at(-1)
    if (current?.first && item.text === '') continue
    if (item.text === '' && item.lead.trim() === '') {
      out.push(item)
      continue
    }
    let lead = item.lead
    for (const list of [...active].reverse()) {
      const insertion = list.first ? ': ' : '  '
      lead = lead.slice(0, list.lead.length) + insertion + lead.slice(list.lead.length)
      if (item.text !== '') list.first = false
    }
    out.push({ ...item, lead })
  }
  return out
}

/** Write every lifted payload back as the Carve line it is. */
function restoreCarrierMarkers(carve: string): string {
  if (carrierSlots.length === 0) return carve
  const pattern = new RegExp(`^${carrierToken}(\\d+)Z$`)
  // Each line as its text plus which kind of marker, if any, produced it:
  // 'open' for an opener or the attribute line travelling with it, 'close' for
  // a bare closer, 'caption' for a composite figure's caption line.
  // THE PREFIX IS WHATEVER STANDS BEFORE THE TOKEN rather than a character
  // class: a container opening a list item puts the marker behind that item's
  // `-`, and leaving the token in the output would be corruption rather than a
  // missed restore. It is taken off the CARVE line, because the Markdown host
  // the placeholder was lifted from spells its prefix differently.
  const sourceLines = carve.split('\n')
  const removed = new Set<number>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (let at = 0; at < value.length; at++) {
        const node = value[at] as BlockNode
        if (node?.type === 'paragraph') {
          const text = node.children.map(child => child.type === 'text' ? child.value : '').join('')
          const slots = [...text.matchAll(new RegExp(`${carrierToken}(\\d+)Z`, 'g'))].map(match => carrierSlots[Number(match[1])])
          const equation = slots.find(slot => slot?.equation !== undefined)?.equation
          const previous = value[at - 1] as BlockNode | undefined
          if (equation !== undefined && previous?.type === 'paragraph' && previous.pos) {
            const savedLosses = importLosses
            importLosses = []
            let restored: string
            try { restored = convertMarkdown(equation, { math: true }).replace(/\n+$/, '') } finally { importLosses = savedLosses }
            for (let line = previous.pos.startLine - 1; line < previous.pos.endLine; line++) {
              const source = sourceLines[line]!
              if (!source.includes(carrierToken) && /\$\$[^$]+\$\$/.test(source)) {
                sourceLines[line] = source.replace(/\$\$[^$]+\$\$/, () => restored)
                break
              }
            }
          }
          if (slots.some(slot => slot?.replaceParagraph)) {
            const paragraph = value[at + 1] as BlockNode | undefined
            if (paragraph?.type === 'paragraph' && paragraph.pos) {
              for (let line = (node.pos?.endLine ?? paragraph.pos.startLine) + 1; line <= paragraph.pos.endLine; line++) removed.add(line - 1)
              const after = paragraph.pos.endLine
              if (after < sourceLines.length - 1 && /^[ \t>]*$/.test(sourceLines[after]!)) removed.add(after)
            }
          }
          const list = value[at + 1] as BlockNode | undefined
          const style = slots.map(slot => slot && carrierListStyle(slot.payload, list?.type === 'list' ? list.start ?? 1 : undefined)).find(value => value !== undefined)
          if (style !== undefined && list?.type === 'list' && list.ordered && node.pos) {
            removed.add(node.pos.startLine - 1)
            if (/^[ \t>]*$/.test(sourceLines[node.pos.endLine] ?? '')) removed.add(node.pos.endLine)
            if (node.pos.startLine > 1 && /^\s*>[\s>]*$/.test(sourceLines[node.pos.startLine - 2]!)) removed.add(node.pos.startLine - 2)
            for (const [index, item] of list.items.entries()) {
              if (!item.pos) continue
              const line = item.pos.startLine - 1
              sourceLines[line] = sourceLines[line]!.replace(/^([ \t>]*?)[0-9]+([.)])(?=[ \t])/, (_match, lead: string, delim: string) =>
                `${lead}${orderedMarker((list.start ?? 1) + index, style)}${delim}${delim === '.' ? ' ' : ''}`)
            }
          }
        }
        visit(value[at])
      }
    } else for (const child of Object.values(value)) visit(child)
  }
  visit(parse(carve).children)
  const items: CarrierLine[] = sourceLines.filter((_line, at) => !removed.has(at)).map((line) => {
    const at = line.indexOf(carrierToken)
    const match = at === -1 ? null : pattern.exec(line.slice(at).trimEnd())
    if (match === null) {
      const lead = /^[ \t>]*/.exec(line)![0]
      return { lead, text: line.slice(lead.length), kind: undefined as CarrierLineKind }
    }
    const slot = carrierSlots[Number(match[1])]!
    const kind: CarrierLineKind = slot.caption ? 'caption' : slot.closer ? 'close' : 'open'

    // The space classifyBareFencePayloads gave a bare opener is not source.
    const text = /^:{3,} $/.test(slot.payload) ? slot.payload.trimEnd() : slot.payload
    return { lead: line.slice(0, at), text, kind, ...(slot.depth > 1 ? { depth: slot.depth } : {}), ...(slot.fence ? { fence: true as const } : {}) }
  })

  // A payload spanning lines continues behind the lead's continuation (CARVE-P11-063).
  return restoreFenceCarriers(restoreDefinitionBodies(separateCarrierLines(anchorCarrierClosers(items))))
    .map((item) => item.lead + item.text.replace(/\n/g, `\n${item.lead.replace(/[^>\t]/g, ' ')}`)).join('\n')
}

/** The title and label a fence marker's opener holds, or undefined when it opens no fenced code block. */
function codeFenceCarrier(payload: string): { header?: string; label?: string; info: string } | undefined {
  const run = /^(?:`{3,}|~{3,})/.exec(payload)![0]
  const tree = parse(`${payload}\n${run}\n`)
  const block = tree.children[0]
  if (tree.children.length !== 1 || block?.type !== 'code_block' || (block.header === undefined && block.label === undefined)) return undefined
  // The info past the language token, as the canonical writer spelled it.
  const info = payload.slice(run.length).replace(block.lang === undefined ? /^[ \t]*/ : /^[ \t]*\S+[ \t]*/, '')
  return { ...(block.header !== undefined ? { header: block.header } : {}), ...(block.label !== undefined ? { label: block.label } : {}), info }
}

/**
 * Put a fence marker's title and label onto the opener below it and drop the
 * marker line: the import takes nothing else from it (CARVE-P11-067).
 */
function restoreFenceCarriers(items: CarrierLine[]): CarrierLine[] {
  const out: CarrierLine[] = []
  for (let at = 0; at < items.length; at++) {
    const item = items[at]!
    if (!item.fence) {
      out.push(item)
      continue
    }
    const carried = codeFenceCarrier(item.text)!
    let below = at + 1
    while (below < items.length && items[below]!.kind === undefined && items[below]!.text === '') below++
    const opener = items[below]
    const match = opener === undefined ? null : /^((?:`{3,}|~{3,}))(.*)$/.exec(opener.text)
    if (opener === undefined || match === null) {
      out.push(item)
      continue
    }
    const lang = match[2]!.trim()
    items[below] = { ...opener, text: `${match[1]}${lang}${lang === '' ? '' : ' '}${carried.info}` }
    at = below - 1
  }
  return out
}

let importLosses: MarkdownImportLoss[] = []

/**
 * The source line the inline run being converted starts on, so a loss found
 * inside it names a line of the INPUT rather than an index into the folded
 * array the importer writes from (markup-carve/carve#2792).
 */
let inlineRunSourceLine: number | undefined

/**
 * The source line of an index into the stripped line array, for a report
 * raised where that array is all the caller holds.
 */
let importSourceLine: ((index: number) => number | undefined) | undefined

function reportRawSpanTrailingWhitespace(content: string): void {
  const run = /[ \t\v\f]+\n/g
  let match: RegExpExecArray | null
  while ((match = run.exec(content)) !== null) {
    const line = inlineRunSourceLine === undefined
      ? undefined
      : inlineRunSourceLine + countNewlines(content.slice(0, match.index))
    importLosses.push({
      code: 'raw-span-whitespace-trimmed',
      message: RAW_SPAN_WHITESPACE_TRIMMED,
      fidelity: 'degraded',
      ...(line === undefined ? {} : { line }),
    })
  }
}

function countNewlines(s: string): number {
  let n = 0
  for (const ch of s) if (ch === '\n') n++
  return n
}

/** Whether an ordered task marker reaches the unspellable-item report. */
export function orderedTaskMarkerIsUnspellable(line: string): boolean {
  const match = /^([ \t]*\d{1,9}[.)][ \t]+)\[[ xX]\](?=[ \t])/.exec(line)
  return match !== null && itemContentColumn(match[1]!) >= columnWidth(match[1]!)
}

function reportOrderedTask(line: string, sourceLine?: number): void {
  if (!orderedTaskMarkerIsUnspellable(line)) return
  importLosses.push({
    code: 'structure-unspellable',
    message: ORDERED_TASK_ITEM_UNSPELLABLE,
    ...(sourceLine === undefined ? {} : { line: sourceLine }),
  })
}

/**
 * Whether a written header row is kept. A GFM header whose cells are all blank
 * and carry no alignment is the scaffolding the Markdown writer adds to a
 * headerless table, so it is dropped and reported rather than read back as an
 * empty header row (CARVE-P11-056). A blank BODY row is a row (CARVE-P9-082)
 * and never comes here.
 *
 * `sourceLine` is the line of the INPUT the dropped row stood on, an index into
 * the source, never into the stripped array the importer writes from
 * (markup-carve/carve#2792).
 */
function keepTableHeader(row: string, sourceLine?: number): boolean {
  const cells = splitTableRow(row)
  if (!cells.every((cell) => cell === '=')) return true
  importLosses.push({
    code: 'structure-unspellable',
    message: `Dropped an empty table header of ${cells.length} blank cells; it is the scaffolding a Markdown writer adds to a headerless table`,
    ...(sourceLine === undefined ? {} : { line: sourceLine }),
  })
  return false
}

function unescapePipesInCodeSpans(row: string): string {
  return protectCodeSpans(row, (span) => span.replace(/\\\|/g, '|'))
}

function isStandardTableRow(line: string): boolean {
  const trimmed = line.trim()
  // Any cell slot makes a row, blank ones included (CARVE-P9-082): `||` and
  // `| |` are rows, a lone `|` is not.
  return trimmed.length >= 2 && trimmed.startsWith('|') && trimmed.endsWith('|')
}

function hasFollowingSetextUnderline(lines: readonly string[], index: number): boolean {
  return index + 1 < lines.length && RE_MD_SETEXT_UNDERLINE.test(lines[index + 1]!)
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
  const underline = RE_MD_SETEXT_UNDERLINE.exec(below)?.[1]
  if (underline === undefined || indentColumns(below) < contentCol) return null
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
  if (/^\[\^((?:[^[\]\\]|\\.)+)\]:/.test(trimmed)) return false
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
  if (/^#{1,6}(?:[ \t]|$)/.test(trimmed) || trimmed.startsWith('>')) return false
  if (RE_MD_THEMATIC.test(line) || hasFollowingSetextUnderline(lines, index)) return false
  if (startsTableHeader(lines, index) || isStandardTableRow(line)) return false
  // An HTML block whose condition may interrupt a paragraph ends the run, the
  // way a heading or a fence does. Carried into the run instead, a `<div>` on
  // the line after prose stayed INSIDE the paragraph as an inline raw span.
  if (interruptingHtmlBlock(line)) return false

  const ordered = trimmed.match(/^(\d+)[.)][ \t]/)
  const isList =
    (/^[-*+][ \t]/.test(trimmed) || ordered !== null) &&
    !(prevType === 'text' && ordered !== null && Number(ordered[1]) !== 1)
  return !isList
}

type PrefixedInlineLine = {
  prefix: string
  text: string
  hadLeadingTab?: boolean | undefined
  // Continues the paragraph above lazily or from four columns past its
  // container, so it cannot be the delimiter row of a table.
  continued?: boolean | undefined
  lazyQuote?: boolean | undefined
  continuationIndents?: Array<boolean | string> | undefined
  nativeContinuationIndent?: string | undefined
  // The paragraph body the collector escaped, without that escape, for a setext
  // fold to write instead: the escape guards a marker at the start of a line,
  // and a folded heading is one line with the marker in its middle, where it
  // opens nothing (carve#2244).
  bareBody?: string | undefined
  // The line's index into the array the collector was given, so a loss found
  // inside a container names a line of the INPUT (markup-carve/carve-js#2668).
  source?: number | undefined
  sourceSegments?: Array<{ offset: number; line: number | undefined }> | undefined
}

const RE_EMPTY_ITEM_PLACEHOLDER = /^(\s*(?:[-*+]|\d+[.)]) )\+$/
const RE_LIST_MARKER = /^([ \t]*)(?:[-*+]|\d+[.)]) +/

/** A line opening with a list marker, padded with spaces or tabs. */
const RE_ITEM_LINE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/
const RE_SOURCE_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))(?=[ \t]|$)([ \t]*)(.*)$/

function sourceItem(line: string): { indent: string; bullet: string | undefined; number: string | undefined; delimiter: string | undefined; padding: string; content: string; marker: string } | null {
  const match = RE_SOURCE_ITEM.exec(line)
  return match ? { indent: match[1]!, bullet: match[2], number: match[3], delimiter: match[4], padding: match[5]!, content: match[6]!, marker: match[2] ?? match[3]! + match[4]! } : null
}

function nestedEmptyPlusItem(line: string): string {
  const outer = sourceItem(line)
  if (outer === null || columnWidth(outer.indent + outer.marker + outer.padding) - columnWidth(outer.indent + outer.marker) > 4) return line
  const inner = sourceItem(outer.content)
  return inner?.marker === '+' && inner.content.trim() === ''
    ? outer.indent + outer.marker + outer.padding + inner.indent + '- {empty}'
    : line
}

/** Whether a source marker may open an item at this paragraph's column. */
function opensInterruptingItem(line: string, paragraphOpen: boolean, paragraphColumn: number): boolean {
  const item = sourceItem(line)
  if (item === null) return false
  if (!paragraphOpen || columnWidth(item.indent) < paragraphColumn) return true
  return item.content.trim() !== '' && (item.bullet !== undefined || Number(item.number) === 1)
}

/**
 * The item markers and task checkbox a line opens with, as CARVE reads them:
 * any nesting of item markers, the innermost a `-` or `*` bullet, then a box.
 * Mirrors `RE_TASK` in the parser, which takes `[ xX-_>/!?]` and neither `+` nor
 * an ordered marker.
 *
 * Markdown's own reading stops at the bullet: the box is the first paragraph's
 * text there, so what follows it opened no block. Carve's reading does not, so
 * what follows the box stands at a content position, and a marker there opens
 * exactly what the source said was text.
 */
const RE_CARVE_TASK_LEAD = /^([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*?[-*][ \t]+)\[[ xX\-_>/!?]\][ \t]+/

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

type EmissionHost = { kind: 'list' | 'quote'; markerColumn: number; contentColumn: number }
type EmissionStack = { listDepth: number; quoteDepth: number; prefix: string; hosts?: readonly EmissionHost[]; afterCode?: boolean }
type EmissionKind = 'paragraph' | 'marker' | 'verbatim' | 'blank' | 'separator' | 'heading' | 'break' | 'definition'

function stripOptionalQuoteIndent(line: string): string {
  let at = 0
  while (at < 3 && (line[at] === ' ' || line[at] === '\t')) at++
  return at > 0 && line[at] === '>' ? line.slice(at) : line
}

function isSolidMarkerRun(text: string): boolean {
  return text.length >= 3 && [...text].every(char => '-*_'.includes(char))
}

function isSolidThematic(text: string): boolean {
  return isSolidMarkerRun(text) && RE_MD_THEMATIC.test(text)
}

function isAsciiAlphanumeric(char: string | undefined): boolean {
  if (char === undefined) return false
  const code = char.charCodeAt(0)
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
}

/** Tokens in a rendered chain of list and quote hosts. */
const RE_EMISSION_HOST = /(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+|[ \t]+)/g

/** A reference title using single quotes after a destination. */
const RE_SINGLE_QUOTED_DEFINITION = /^(\[[^\[\]\\\n]+\]:[ \t]*(?:<[^>\n]*>|\S+)[ \t]+)'([^'&\\\n]*)'$/

/** Space slack that a list marker may relinquish. */
const RE_FREE_MARKER_PADDING = /^ {2,4}(?=\S)/

function emissionHosts(prefix: string): EmissionHost[] {
  const hosts: EmissionHost[] = []
  let column = 0
  for (const token of prefix.matchAll(RE_EMISSION_HOST)) {
    const marker = token[0]
    if (marker.startsWith('>') || RE_ITEM_LINE.test(marker)) {
      hosts.push({ kind: marker.startsWith('>') ? 'quote' : 'list', markerColumn: column,
        contentColumn: column + columnWidth(marker) })
    }
    column += columnWidth(marker)
  }
  return hosts
}

/** Assemble a line while its body and container context are still separate. */
function emitContainerLine(
  body: string,
  kind: EmissionKind,
  stack: EmissionStack,
  marker?: { lead: string; text: string; tail: string; paddingFree: boolean; ordered: boolean },
): { line: string; continuationWidth: number } {
  if (kind === 'marker' && marker !== undefined) {
    const pad = marker.paddingFree ? (RE_FREE_MARKER_PADDING.exec(marker.tail)?.[0].length ?? 1) : 1
    return {
      line: marker.lead + marker.text + marker.tail.slice(pad - 1),
      continuationWidth: listContinuationWidth(marker.text + ' ', marker.ordered) - pad,
    }
  }
  if (kind === 'separator') return { line: stack.prefix, continuationWidth: 0 }
  if (kind === 'blank') return { line: stack.quoteDepth > 0 ? stack.prefix.trimEnd() : stack.prefix, continuationWidth: 0 }
  if (kind === 'heading') {
    const heading = RE_MD_HEADING_OPENER.exec(body)
    if (heading) return { line: `${heading[0].trimEnd()} ${trimHeadingText(body.slice(heading[0].length))}`, continuationWidth: 0 }
  }
  if (kind === 'definition' && stack.quoteDepth > 0) {
    const match = RE_SINGLE_QUOTED_DEFINITION.exec(body)
    if (match) return { line: `${match[1]}"${escapeQuoted(match[2]!)}"`, continuationWidth: 0 }
  }
  // The writer drops paragraph slack at the document edge and after quoted code.
  const atHostContent = stack.hosts !== undefined && stack.hosts.every(host =>
    host.markerColumn < host.contentColumn && host.contentColumn <= columnWidth(stack.prefix))
  if (kind === 'paragraph' && (atHostContent || stack.listDepth === 0 && (stack.quoteDepth === 0 || stack.afterCode)))
    return { line: paragraphLineText(body), continuationWidth: 0 }
  return { line: body, continuationWidth: 0 }
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
  write(line: string, paddingIsFree = false, nestedPaddingIsFree = false, paragraphOpen = false, paragraphColumn = 0): { line: string; separate: boolean; outer: number; shift: number } {
    if (!opensInterruptingItem(line, paragraphOpen, paragraphColumn)) return { line, separate: false, outer: 0, shift: 0 }
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
    const content = columnWidth(RE_LIST_MARKER.exec(line)?.[0] ?? m[0])
    const own = RE_LIST_MARKER.exec(line)?.[0].length ?? m[0].length
    const nested = nestedItemsOnLine(line, own)
    let nestedLine = respellNestedBullets(line, own)
    if (nestedPaddingIsFree) for (const inner of [...nested].reverse()) {
      const sourceMarker = line.slice(inner.marker, inner.end).trimEnd()
      const shortenedBy = inner.number === undefined ? 0 : inner.number.length - String(Number(inner.number)).length
      const start = inner.marker + sourceMarker.length - shortenedBy
      const tail = nestedLine.slice(start)
      nestedLine = nestedLine.slice(0, inner.marker) + emitContainerLine('', 'marker', {
        listDepth: this.open.length + 1, quoteDepth: 0, prefix: '',
      }, { lead: '', text: nestedLine.slice(inner.marker, start), tail, paddingFree: true, ordered: inner.number !== undefined }).line
    }
    const emitted = emitContainerLine('', 'marker', { listDepth: this.open.length, quoteDepth: 0, prefix: '' }, {
      lead: m[1]!, text: marker, tail: nestedLine.slice(m[0].length),
      paddingFree: paddingIsFree, ordered: m[3] !== undefined,
    })
    const shift = outer + emitted.continuationWidth - (m[0].length - m[1]!.length)
    this.open.push({ col, content, shift, outer, kind, bullet, next })
    // Items the first line nests (`- - a`) are written as they are, and move
    // with this one.
    let nestedShrink = 0
    for (const inner of nested) {
      const sourceMarker = line.slice(inner.marker, inner.end).trimEnd()
      const pad = inner.end - inner.marker - sourceMarker.length
      const innerOuter = shift - nestedShrink
      if (nestedPaddingIsFree) nestedShrink += Math.max(0, pad - 1)
      if (inner.number !== undefined) nestedShrink += inner.number.length - String(Number(inner.number)).length
      this.open.push({
        col: inner.col,
        content: inner.content,
        shift: shift - nestedShrink,
        outer: innerOuter,
        kind: inner.kind,
        bullet: inner.bullet === '+' ? '-' : (inner.bullet ?? ''),
        next: inner.number === undefined ? 0 : Number(inner.number) + 1,
      })
    }
    // The markers the line nests are respelled the way the leading one just
    // was. The kinds above stay the SOURCE characters, because whether the next
    // line is a sibling turns on the bullet the author wrote.
    return {
      line: emitted.line,
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
): Array<{ col: number; content: number; kind: string; bullet?: string; number?: string; marker: number; end: number }> {
  const items: Array<{
    col: number
    content: number
    kind: string
    bullet?: string
    number?: string
    marker: number
    end: number
  }> = []
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
      ...(m[2] === undefined ? {} : { bullet: m[2] }),
      ...(m[3] === undefined ? {} : { number: m[3] }),
      marker: at + m[1]!.length,
      end: at + m[0].length,
    })
    at += m[0].length
  }
}

function nestedMarkerPaddingIsFree(first: string, following: ReadonlySet<number>): boolean {
  const own = RE_LIST_MARKER.exec(first)?.[0].length ?? 0
  let shrink = 0
  for (const item of nestedItemsOnLine(first, own)) {
    const marker = first.slice(item.marker, item.end).trimEnd()
    shrink += Math.max(0, item.end - item.marker - marker.length - 1)
    if (shrink === 0) continue
    for (let col = item.content - shrink; col < item.content; col++) if (following.has(col)) return false
  }
  return true
}

/**
 * `line` with every `+` marker it nests past `from` written as `-`, which is
 * what `ListMarkers` already records for those items and what the leading
 * marker is written as. Carve reads `+` as the continuation marker, so one left
 * as it stands is the item's prose where cmark-gfm read a list
 * (markup-carve/carve-js#2061). Both characters are one column wide, so nothing
 * moves.
 */
function respellNestedBullets(line: string, from: number): string {
  let out = line
  for (const inner of nestedItemsOnLine(line, from).reverse()) {
    if (inner.bullet === '+') out = out.slice(0, inner.marker) + '-' + out.slice(inner.marker + 1)
    else if (inner.number !== undefined) out = out.slice(0, inner.marker) + String(Number(inner.number)) + out.slice(inner.marker + inner.number.length)
  }
  return out
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
  const marker = columnWidth(trimEndSpaceTab(prefix))
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
  return collectIndentedCodeItem(lines, start, prefix, first.slice(markerEnd + 5), contentCol)
}

function collectIndentedCodeItem(
  lines: readonly string[], start: number, prefix: string, firstBody: string, contentCol: number,
): { lines: string[]; end: number; verbatimFrom: number } {
  const code = [firstBody]
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

/** The source line a collected run line stands on, where the fold kept it. */
function runPartSourceLine(part: PrefixedInlineLine): number | undefined {
  return part.source === undefined ? undefined : importSourceLine?.(part.source)
}

function containerTableRows(run: readonly PrefixedInlineLine[], inheritedItemCol = 0): boolean[] {
  const held = heldByItem(run, inheritedItemCol)
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

  return inTable
}

function restorePrefixedInlineRun(
  run: readonly PrefixedInlineLine[],
  dialect: MarkdownDialect,
  terminal = true,
  inheritedItemCol = 0,
): string[] {
  const codeBreakMarker = '\x00CARVE_CODE_BREAK\x00'
  const expandCodeBreaks = (line: string, prefix: string): string[] => {
    if (!line.includes(codeBreakMarker)) return [line]
    const beforeCode = line.slice(0, line.indexOf(codeBreakMarker))
    const containers = /^(?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-*+]|\d+[.)])[ \t]+))*/.exec(beforeCode)![0]
    const continuation = (containers || prefix).replace(/(?:[-*+]|\d+[.)])[ \t]+/g, marker => ' '.repeat(marker.length))
    return line.split(codeBreakMarker).map((part, index) => index === 0 ? part : continuation + part)
  }
  const opensFence = isMarkdownFenceLine(run[0]?.text ?? '')
  const joinedLines = new Set<number>()
  const tableRows = containerTableRows(run, inheritedItemCol)
  let offset = 0
  const sourceSegments = run.flatMap((part, index) => {
    const entries = (part.sourceSegments ?? [{offset:0, line:runPartSourceLine(part)}]).map(entry => ({offset:offset + entry.offset, line:tableRows[index] ? null : entry.line}))
    offset += part.text.length + 1
    return entries
  })
  const continuationIndents = run.flatMap(part => part.continuationIndents ?? part.text.split('\n').map(() => part.nativeContinuationIndent ?? !part.lazyQuote))
  const converted = convertInline(
    run.map((part) => part.text).join('\n'),
    dialect,
    opensFence,
    /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+$/.test(run[0]?.prefix ?? ''),
    joinedLines,
    terminal,
    false,
    true,
    at => {
      let low = 0, high = sourceSegments.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (sourceSegments[mid]!.offset <= at) low = mid + 1
        else high = mid
      }
      return sourceSegments[low - 1]?.line
    },
    true, false, line => continuationIndents[line] ?? false,
    true, false, codeBreakMarker,
  ).split('\n')
  let physicalLine = 0
  run = run.flatMap(part => part.continuationIndents === undefined ? [part] : part.text.split('\n').map(text => ({ ...part, text })))
    .filter(part => {
      const keep = !joinedLines.has(physicalLine)
      physicalLine += countNewlines(part.text) + 1
      return keep
    })
  const held = heldByItem(run, inheritedItemCol)
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
  if (!modellable) return run.flatMap((part, idx) => {
    const line = converted[idx] ?? ''
    if (part.lazyQuote && nestedItemsOnLine(run[0]!.prefix + run[0]!.text, run[0]!.prefix.length).length > 0) {
      return expandCodeBreaks(part.prefix + /^[ \t]*/.exec(part.text)![0] + line.trimStart(), part.prefix)
    }
    const quoted = peelQuoteMarkers(line)
    const source = peelQuoteMarkers(part.text)
    if (RE_LIST_MARKER.test(part.prefix) && quoted.marker !== '' && source.marker !== '' &&
      isAsciiAlphanumeric(source.body.trimStart()[0])) {
      const prefix = part.prefix + quoted.marker
      return expandCodeBreaks(prefix + emitContainerLine(quoted.body, 'paragraph', {
        listDepth: 1, quoteDepth: quoteDepth(prefix), prefix, hosts: emissionHosts(prefix),
      }).line, prefix)
    }
    return expandCodeBreaks(part.prefix + emitContainerLine(line, 'verbatim', {
      listDepth: RE_LIST_MARKER.test(part.prefix) ? 1 : 0, quoteDepth: quoteDepth(part.prefix), prefix: part.prefix,
    }).line, part.prefix)
  })

  const container = run.map((part, idx) => `${part.prefix.length}:${quoteDepth(held[idx]!.marker)}:${held[idx]!.marker.length}`)
  const inTable = containerTableRows(run, inheritedItemCol)

  const out: string[] = []
  let tableWidth = 0
  let droppedPrefix: { opener: string; continuation: string; itemEnd: number } | null = null
  const openingPrefix = (prefix: string): string => {
    if (droppedPrefix === null) return prefix
    const { opener, continuation, itemEnd } = droppedPrefix
    droppedPrefix = null
    if (prefix.startsWith(continuation)) return opener + prefix.slice(continuation.length)
    if (continuation.startsWith(prefix) && prefix.length >= itemEnd) return opener.slice(0, prefix.length)
    if (continuation.startsWith(prefix) && itemEnd > prefix.length &&
        sourceItem(peelQuoteMarkers(opener.slice(0, prefix.length)).body) !== null) out.push(opener.trimEnd() + ' +')
    return prefix
  }
  let activeFence: { marker: string; width: number } | null = null
  for (let idx = 0; idx < run.length; idx++) {
    const part = run[idx]!
    const line = converted[idx] ?? ''
    const sourceFence = RE_MD_FENCE_LINE.exec(held[idx]!.body)
    const closesFence = activeFence !== null && sourceFence !== null &&
      sourceFence[2]![0] === activeFence.marker && sourceFence[2]!.length >= activeFence.width && sourceFence[3]!.trim() === ''
    const opensFence = activeFence === null && sourceFence !== null && fenceRunIsAFence(sourceFence[2]!, sourceFence[3]!)
    const insideFence = activeFence !== null || opensFence
    if (opensFence) activeFence = { marker: sourceFence![2]![0]!, width: sourceFence![2]!.length }
    else if (closesFence) activeFence = null
    if (inTable[idx] && !insideFence) {
      // The same rows the document-level table branch writes: a native `|=`
      // header in place of the header and delimiter rows, then each body row
      // rebuilt, so a table a container holds is canonical too.
      const { marker, body } = held[idx]!
      if (idx === 0 || !inTable[idx - 1] || container[idx - 1] !== container[idx]) {
        const delimiter = held[idx + 1]!.body.trim()
        const headerCells = splitTableRow(body.trim())
        const markers = splitTableRow(delimiter).map(alignMarker)
        const delimiterNeeded = headerCells.some((cell, column) => cell.trim() === '' && markers[column] === '<')
        const headers = delimiterNeeded ? [] : markers.map((align) => `=${align}`)
        tableWidth = headerCells.length
        const previousLine = inlineRunSourceLine
        inlineRunSourceLine = runPartSourceLine(part)
        const header = writeTableRow(headerCells, headers, dialect)
        inlineRunSourceLine = previousLine
        if (keepTableHeader(header, runPartSourceLine(part))) {
          out.push(openingPrefix(part.prefix + marker) + emitContainerLine(header, 'verbatim', {
            listDepth: RE_LIST_MARKER.test(part.prefix) ? 1 : 0, quoteDepth: quoteDepth(marker), prefix: part.prefix + marker,
          }).line)
          if (delimiterNeeded) out.push(openingPrefix(part.prefix + marker) + emitContainerLine(delimiter, 'verbatim', {
            listDepth: RE_LIST_MARKER.test(part.prefix) ? 1 : 0, quoteDepth: quoteDepth(marker), prefix: part.prefix + marker,
          }).line)
        }
        else if (droppedPrefix === null) {
          const opener = part.prefix + marker
          let continuation = opener
          let itemEnd = 0
          for (let at = 0; at < continuation.length;) {
            if (continuation[at] === '>') {
              at += continuation[at + 1] === ' ' ? 2 : 1
              continue
            }
            const item = sourceItem(continuation.slice(at))
            if (item === null) break
            const end = at + item.indent.length + item.marker.length + item.padding.length
            if (item.padding === '') break
            continuation = continuation.slice(0, at + item.indent.length) + ' '.repeat(item.marker.length + item.padding.length) + continuation.slice(end)
            itemEnd = end
            at = end
          }
          if (itemEnd > 0) droppedPrefix = {
            opener,
            continuation,
            itemEnd,
          }
        }
        idx++ // consume the delimiter row
        continue
      }
      const previousLine = inlineRunSourceLine
      inlineRunSourceLine = runPartSourceLine(part)
      const row = writeTableRow(splitTableRow(body.trim()), [], dialect, tableWidth)
      inlineRunSourceLine = previousLine
      const prefix = openingPrefix(part.prefix + marker)
      out.push(prefix + emitContainerLine(row, 'verbatim', {
        listDepth: RE_LIST_MARKER.test(part.prefix) ? 1 : 0, quoteDepth: quoteDepth(marker), prefix: part.prefix + marker,
      }).line)
      continue
    }
    // The same containers `held` peeled, so a row a quoted item holds is
    // escaped at the item's column as well.
    const { marker } = held[idx]!
    const body = line.startsWith(marker) ? line.slice(marker.length) : peelQuoteMarkers(line).body
    const kept = line.slice(0, line.length - body.length)
    const sourceBody = held[idx]!.body
    const kind: EmissionKind = insideFence || body === '' || isMarkdownFenceLine(body) ? 'verbatim'
      : RE_CARVE_HEADING_OPENER.test(sourceBody) && RE_CARVE_HEADING_OPENER.test(body) ? 'heading'
      : isSolidThematic(sourceBody.trim()) && isSolidMarkerRun(body.trim()) ? 'break' : 'paragraph'
    let writtenBody = !insideFence && isStandardTableRow(body) ? keepPipeRowLiteral(body) : body
    const nestedQuote = peelQuoteMarkers(writtenBody)
    const previousHeld = held[idx - 1]
    const previousQuote = previousHeld === undefined ? null : peelQuoteMarkers(previousHeld.body)
    const quotedHeading = !insideFence && previousHeld !== undefined && quoteDepth(marker) > 0 &&
      previousHeld.marker === marker && RE_CARVE_HEADING_OPENER.test(previousHeld.body) &&
      columnWidth(run[idx - 1]!.prefix) === columnWidth(part.prefix)
    const nestedHeading = !insideFence && previousQuote !== null && previousQuote.marker !== '' &&
      previousQuote.marker === nestedQuote.marker && RE_CARVE_HEADING_OPENER.test(previousQuote.body) &&
      part.prefix === run[idx - 1]?.prefix && columnWidth(previousHeld!.marker) === columnWidth(marker)
    if (quotedHeading || nestedHeading) {
      const prefix = quotedHeading ? part.prefix + marker : part.prefix + kept + nestedQuote.marker
      out.push(emitContainerLine('', 'blank', {
        listDepth: 1, quoteDepth: quoteDepth(prefix), prefix, hosts: emissionHosts(prefix),
      }).line)
    }
    if (kind === 'paragraph' && (RE_LIST_MARKER.test(part.text) || RE_LIST_MARKER.test(part.prefix))) {
      const nested = peelQuoteMarkers(writtenBody)
      if (nested.marker !== '' && isAsciiAlphanumeric(nested.body.trimStart()[0])) {
        writtenBody = nested.marker + emitContainerLine(nested.body, 'paragraph', {
          listDepth: 1, quoteDepth: quoteDepth(part.prefix) + quoteDepth(nested.marker),
          prefix: part.prefix + kept + nested.marker,
          hosts: emissionHosts(part.prefix + kept + nested.marker),
        }).line
      }
    }
    const prefix = openingPrefix(part.prefix + kept)
    out.push(...expandCodeBreaks(prefix + emitContainerLine(kind === 'paragraph' ? dropTrailingWs(writtenBody) : writtenBody, kind, {
      listDepth: RE_LIST_MARKER.test(kept) ? 1 : 0,
      quoteDepth: quoteDepth(part.prefix) + quoteDepth(kept), prefix: part.prefix + kept,
      hosts: emissionHosts(part.prefix + kept),
    }).line, prefix))
  }
  return out
}

/**
 * `peelQuoteMarkers` for each line of a run, with one level of list item a
 * quote holds peeled too: the item's marker, and the same columns under it, go
 * to `marker`, so a table inside a quoted item is found at the item's column.
 */
function heldByItem(run: readonly PrefixedInlineLine[], inheritedItemCol = 0): Array<{ marker: string; body: string }> {
  let itemCol = inheritedItemCol
  let itemKey = inheritedItemCol > 0 && run[0] ? `${run[0].prefix.length}:${peelQuoteMarkers(run[0].text).marker}` : ''
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
  if (part.continued) return text.trim() === '' ? null : { lead: '', body: headingLine(text, true) }
  const marker = RE_ITEM_LEAD.exec(text)![0]
  const opens = RE_ITEM_LINE.test(text)
  const body = headingLine(opens ? text.slice(marker.length) : text, true)
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
function headingLine(line: string, last = false): string {
  const trimmed = trimEndSpaceTab(line.replace(/^[ \t]+/, ''))
  if (last) return trimmed
  let backslashes = 0
  while (trimmed[trimmed.length - backslashes - 1] === '\\') backslashes++
  return trimEndSpaceTab(backslashes % 2 === 1 ? trimmed.slice(0, -1) : trimmed)
}

function headingParagraphParts(lines: string[], dialect: MarkdownDialect, lazyLines: boolean[] = []): { parts: string[]; joined: string; retainedLines: number[] } {
  const source = lines.join('\n')
  const retained = new Set<number>()
  if (source.includes('](') && source.includes('<') && source.includes('\\\n')) {
    const opaque = markdownDestinationOpaqueEnd(source, dialect)
    const bareLinks = source.includes(':') || source.includes('www.') ? markdownRawBareLinks(source, opaque) : []
    protectNativeMarkdownDestinationGlyphs(source, value => value,
      label => referenceDestinationLabel(label, decodeHtmlEntitiesRaw, [], false) !== undefined || isEmptyDestinationReference(label, decodeHtmlEntitiesRaw, []),
      opaque, false, at => retained.add(at), bareLinks)
  }
  let offset = 0
  const separators: string[] = []
  const retainedLines = [0]
  const parts = lines.map((line, index) => {
    const keep = retained.has(offset + line.length)
    offset += line.length + 1
    separators.push(keep ? '\n' : ' ')
    if (keep) retainedLines.push(index + 1)
    return index > 0 && separators[index - 1] === '\n' && lazyLines[index]
      ? /^[ \t]*/.exec(line)![0] + headingLine(line, index === lines.length - 1 || keep) : headingLine(line, index === lines.length - 1 || keep)
  })
  return { parts, joined: parts.map((part, index) => part + (index + 1 < parts.length ? separators[index] : '')).join(''), retainedLines }
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
function foldContainerSetext(run: readonly PrefixedInlineLine[], dialect: MarkdownDialect): PrefixedInlineLine[] {
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
        const entries = out.slice(start)
        const { parts, joined, retainedLines } = headingParagraphParts(entries.map(entry => entry.nativeContinuationIndent !== undefined
          ? entry.text.replace(/^[ \t]*/, entry.nativeContinuationIndent)
          : entry.lazyQuote ? entry.text : entry.bareBody ?? paragraphLine(entry, heldInContainer(entry).text)!.body), dialect, entries.map(entry => !!entry.lazyQuote))
        const head = `${held.lead}${quote}${indent}${rule[1]![0] === '=' ? '#' : '##'} `
        let offset = head.length
        const sourceSegments = parts.map((text, index) => {
          const entry = { offset, line: runPartSourceLine(entries[index]!) }
          offset += text.length + 1
          return entry
        })
        out.splice(start, out.length - start, { prefix: out[start]!.prefix, text: head + joined, source: out[start]!.source, sourceSegments, continuationIndents: retainedLines.map(index => entries[index]!.nativeContinuationIndent ?? !entries[index]!.lazyQuote) })
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
  return line.startsWith('>') ? quotedLine(line, 0, 3) : null
}

/**
 * A quote line as the quote holds it, for a quote whose container holds its
 * content at `contentCol`: the quote markers peeled into `prefix`, and the
 * whitespace before and between the item markers `text` opens with written as
 * the spaces it spans where it stands in the line. Measured from the start of
 * `text` instead, a tab after a quoted item's marker lost the columns the
 * quote marker stood in, and five columns of padding read as three.
 */
function quotedLine(line: string, contentCol: number, nestedIndent = contentCol > 0 ? 3 : 1): { prefix: string; text: string; hadLeadingTab: boolean } | null {
  let rest = stripColumns(line, contentCol)
  const slack = /^[ \t]{1,3}(?=>)/.exec(rest)?.[0] ?? ''
  let col = advanceColumns(contentCol, slack)
  rest = rest.slice(slack.length)
  let prefix = ''
  for (let marker = (nestedIndent === 1 ? /^ ?>[ \t]?/ : /^ {0,3}>[ \t]?/).exec(rest); marker; marker = (nestedIndent === 1 ? /^ ?>[ \t]?/ : /^ {0,3}>[ \t]?/).exec(rest)) {
    const tab = marker[0].endsWith('\t')
    const beforePad = advanceColumns(col, tab ? marker[0].slice(0, -1) : marker[0])
    const residue = tab ? advanceColumns(beforePad, '\t') - beforePad - 1 : 0
    col = beforePad + (tab ? 1 : 0)
    rest = ' '.repeat(residue) + rest.slice(marker[0].length)
    prefix += '> '
  }
  if (prefix === '') return null
  return { prefix, text: rest.includes('\t') ? expandItemLead(rest, col) : rest,
    hadLeadingTab: rest.slice(0, rest.indexOf('\t')).trim() === '' && rest.includes('\t') }
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
  const indent = text.slice(0, text.length - text.trimStart().length)
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
  return !/^#{1,6}(?:[ \t]|$)/.test(trimmed) && !RE_MD_THEMATIC.test(text) && !isStandardTableRow(text)
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
  const strip = (line: string): string =>
    stripOptionalQuoteIndent(stripColumns(line, contentCol))
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
    const plain = !RE_LIST_MARKER.test(line) && isParagraphRunLine([line], 0, 'text')
    const over = indentColumns(line) >= contentCol + 4
    if (!parsed && paragraph && line.trim() !== '' && (plain || over)) {
      const text = over && !plain ? escapeBlockOpener(strip(line).trimStart()) : strip(line)
      lazyPrefix ??= lazyQuotePrefix(run)
      run.push({ prefix: lazyPrefix, text, continued: true, lazyQuote: true, source: end })
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
    run.push(continues ? { ...parsed, continued: true, source: end } : { ...parsed, source: end })
    end++
  }
  if (run.length === 0) return collectEmptyQuoteRun(lines, start, dialect, contentCol, markers)
  return writeQuotedInlineRun(lines, start, end, run, dialect, contentCol, markers)
}

/**
 * A quote run that collected no line: the empty quote lines at `start`, or the
 * run behind them when the quote opens the document on an empty line.
 */
function collectEmptyQuoteRun(
  lines: readonly string[],
  start: number,
  dialect: MarkdownDialect,
  contentCol: number,
  markers: Map<string, ListMarkers>,
): { lines: string[]; end: number; blank?: boolean } {
  const pad = ' '.repeat(contentCol)
  const strip = (line: string): string =>
    stripOptionalQuoteIndent(stripColumns(line, contentCol))
  const empty = quotedLine(lines[start]!, contentCol)
  if (empty !== null && start === 0) {
    let next = start + 1
    while (next < lines.length) {
      const candidate = quotedLine(lines[next]!, contentCol)
      if (candidate === null || candidate.prefix !== empty.prefix) break
      if (candidate.text.trim() !== '') {
        // A GitHub alert label below an empty quote line is quote text
        // (CARVE-P2-033), so the empty line stays to keep it off the first line.
        const label = contentCol === 0 && empty.prefix.trim() === '>' && GITHUB_ALERT_LABEL.test(candidate.text.trim())
        if (!label && indentColumns(candidate.text) < 4 && canonicalQuoteBodyLines(['', candidate.text]).length === 1)
          return collectBlockquoteInlineRun(lines, next, dialect, contentCol, markers)
        break
      }
      next++
    }
  }
  let blankEnd = start + 1
  while (empty !== null && blankEnd < lines.length && quotedLine(lines[blankEnd]!, contentCol)?.prefix === empty.prefix &&
    quotedLine(lines[blankEnd]!, contentCol)?.text === '') blankEnd++
  return { lines: [pad + emitContainerLine(empty?.prefix ?? strip(lines[start]!), 'blank', {
    listDepth: 0, quoteDepth: quoteDepth(empty?.prefix ?? ''), prefix: empty?.prefix ?? strip(lines[start]!),
  }).line], end: blankEnd, blank: true }
}

/** Write a collected quote run back at its container's content column. */
function writeQuotedInlineRun(
  lines: readonly string[],
  start: number,
  end: number,
  run: PrefixedInlineLine[],
  dialect: MarkdownDialect,
  contentCol: number,
  markers: Map<string, ListMarkers>,
): { lines: string[]; end: number } {
  const pad = ' '.repeat(contentCol)
  let beforeRun = start - 1
  while (beforeRun >= 0 && lines[beforeRun]!.trim() === '') beforeRun--
  const priorQuote = beforeRun >= 0 ? quotedLine(lines[beforeRun]!, contentCol) : null
  const priorBody = priorQuote === null ? null : peelQuoteMarkers(priorQuote.text)
  const afterCode = contentCol === 0 && priorQuote !== null && priorBody !== null &&
    (indentColumns(priorBody.body) >= 4 || RE_MD_FENCE_LINE.exec(priorBody.body.trimStart())?.[3]?.trim() === '')
  const quoteEnds = end === lines.length || quotedLine(lines[end]!, contentCol) === null
  const last = run.at(-1)
  const lastMarkerItem = last === undefined ? null : quotedItemLead(last.text)
  let next = end
  while (next < lines.length && quotedLine(lines[next]!, contentCol)?.text.trim() === '') next++
  const resumed = next < lines.length ? quotedLine(lines[next]!, contentCol) : null
  const resumedIndent = resumed === null ? 0 : indentColumns(resumed.text)
  const paddingFreeAtBlank = lastMarkerItem !== null && last !== undefined && resumed?.prefix === last.prefix &&
    (resumedIndent >= columnWidth(lastMarkerItem.lead) ||
      !resumed.hadLeadingTab && resumedIndent < 4 && isAsciiAlphanumeric(resumed.text.trimStart()[0]))
  const inheritedItemCol = markers.get(run[0]?.prefix ?? '')?.itemAt(indentColumns(run[0]?.text ?? ''))?.content ?? 0
  let emptyToken = '\uE0FD'
  while (run.some(part => part.text.includes(emptyToken))) emptyToken += '\uE0FD'
  const written = restorePrefixedInlineRun(respellQuotedBlocks(foldContainerSetext(canonicalQuotedFences(quoteEmptyItems(run, emptyToken), afterCode, quoteEnds && quotedLine(lines[end] ?? '', contentCol)?.text.trim() !== '', dialect), dialect), markers, quoteEnds || paddingFreeAtBlank), dialect, true, inheritedItemCol)
      .map((l) => pad + (/^(?:> )+$/.test(l) ? emitContainerLine(l, 'blank', {
        listDepth: 0, quoteDepth: quoteDepth(l), prefix: l,
      }).line : l))
  return {
    lines: canonicalItemHeldTildeFence(written).map(line => line.replaceAll(emptyToken, '{empty}')),
    end,
  }
}

/** Give quoted empty Markdown items a temporary body before block conversion. */
function quoteEmptyItems(run: readonly PrefixedInlineLine[], emptyToken: string): PrefixedInlineLine[] {
  let fence: { prefix: string; char: string; width: number } | null = null
  let previousEmptyItem = false
  return run.map((part, index) => {
    const acceptedPreviousEmptyItem = previousEmptyItem
    previousEmptyItem = false
    if (fence !== null && part.prefix !== fence.prefix) fence = null
    const lead = quotedItemLead(part.text)?.lead ?? ''
    const match = RE_MD_FENCE_LINE.exec(part.text.slice(lead.length))
    if (fence !== null) {
      if (match && match[2]![0] === fence.char && match[2]!.length >= fence.width && match[3]!.trim() === '') fence = null
      return part
    }
    if (match && fenceRunIsAFence(match[2]!, match[3]!)) {
      fence = { prefix: part.prefix, char: match[2]![0]!, width: match[2]!.length }
      return part
    }
    const empty = /^([ \t]*(?:[-*+]|\d{1,9}[.)]))[ \t]*$/.exec(part.text)
    if (!empty || part.continued) return part
    const previous = run[index - 1]
    const previousItem = previous !== undefined &&
      /^(?:[ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(previous.text) &&
      (!/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*$/.test(previous.text) || acceptedPreviousEmptyItem)
    if (previous?.prefix === part.prefix && quoteParagraphIsOpen(previous.text) && !previousItem) return part
    previousEmptyItem = true
    return { ...part, text: `${empty[1]} ${emptyToken}` }
  })
}

/** Canonicalize a closed tilde fence opened by a quote on a list marker line. */
function canonicalItemHeldTildeFence(lines: string[]): string[] {
  let pending: { at: number; opening: RegExpExecArray; prefix: string; closer: RegExp } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (pending !== null) {
      if (line.trim() === '' || line === pending.prefix.trimEnd() || line.startsWith(pending.prefix)) {
        if (line.startsWith(pending.prefix) && pending.closer.test(line.slice(pending.prefix.length))) {
          const fence = canonicalFence(lines.slice(pending.at + 1, index).map((body) =>
            body.startsWith(pending!.prefix) ? body.slice(pending!.prefix.length) : body))
          const open = pending.opening
          lines[pending.at] = open[1]! + open[2]! + open[3]! + open[4]! + fence + open[6]!
          lines[index] = pending.prefix + fence
          pending = null
        }
        continue
      }
      pending = null
    }
    const opening = /^((?:> )*)((?:[-*+]|\d{1,9}[.)]) +)((?:> )+)( {0,3})(~{3,})([^\n]*)$/.exec(line)
    if (opening === null || !fenceRunIsAFence(opening[5]!, opening[6]!)) continue
    const prefix = opening[1]! + ' '.repeat(columnWidth(opening[2]!)) + opening[3]!
    pending = { at: index, opening, prefix, closer: new RegExp(`^ {0,3}~{${opening[5]!.length},}[ \t]*$`) }
  }
  return lines
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
function canonicalQuotedFences(run: readonly PrefixedInlineLine[], afterCode: boolean, quoteEnds = true, dialect: MarkdownDialect = COMMONMARK_GFM): PrefixedInlineLine[] {
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
      out[opener + 1 + offset] = { prefix: part.prefix, text, source: part.source }
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
    const itemQuote = item === null ? null : blockquotePrefix(part.text.slice(item.lead.length))
    const directFence = itemQuote === null ? null : RE_MD_FENCE_LINE.exec(itemQuote.text)
    if (itemQuote !== null && quoteEnds && directFence?.[2]?.[0] !== '~') {
      const column = columnWidth(item!.lead)
      const nested: PrefixedInlineLine[] = [{ ...part, prefix: itemQuote.prefix, text: itemQuote.text }]
      let ahead = idx + 1
      while (ahead < run.length && run[ahead]!.prefix === part.prefix) {
        const next = run[ahead]!
        if (indentColumns(next.text) < column) break
        const parsed = blockquotePrefix(stripColumns(next.text, column))
        if (parsed === null || parsed.prefix !== itemQuote.prefix) break
        nested.push({ ...next, prefix: parsed.prefix, text: parsed.text })
        ahead++
      }
      // Measure both fence lines from the source item's content column.
      let sourceColumn = 0
      let sourceFence: { char: string; width: number } | null = null
      let sourceDepth = 0
      let sawFence = false
      for (const line of nested) {
        let body = line.text
        if (sourceFence !== null) {
          // Fence bodies contain text, not new item or quote markers.
          body = stripColumns(body, sourceColumn)
          let depth = 0
          while (depth < sourceDepth) {
            const quote = blockquotePrefix(body.trimStart())
            if (quote === null) break
            body = quote.text
            depth++
          }
          const closerMatch = depth === sourceDepth ? RE_MD_FENCE_LINE.exec(body) : null
          if (closerMatch !== null && columnWidth(closerMatch[1]!) <= 3 && closerMatch[2]![0] === sourceFence.char &&
            closerMatch[2]!.length >= sourceFence.width && closerMatch[3]!.trim() === '') sourceFence = null
          continue
        }
        const heldItem = quotedItemLead(body)
        if (heldItem !== null) {
          sourceColumn = columnWidth(heldItem.lead)
          body = body.slice(heldItem.lead.length)
        } else {
          if (body.trim() !== '' && indentColumns(body) < sourceColumn) sourceColumn = 0
          body = stripColumns(body, sourceColumn)
        }
        let depth = 0
        for (;;) {
          const quote = blockquotePrefix(body.trimStart())
          if (quote === null) break
          body = quote.text
          depth++
        }
        const openMatch = RE_MD_FENCE_LINE.exec(body)
        if (openMatch !== null && isMarkdownFenceLine(body)) {
          sourceFence = { char: openMatch[2]![0]!, width: openMatch[2]!.length }
          sourceDepth = depth
          sawFence = true
        }
      }
      // A quoted blank may keep an item open beyond this run.
      if (sawFence && sourceFence === null &&
        !nested.some(line => line.text.trim() === '') &&
        (ahead === run.length || run[ahead]!.prefix === part.prefix) &&
        !nested.slice(1).some(line => blockquotePrefix(line.text.trimStart()) !== null)) {
        const written = respellQuotedBlocks(foldContainerSetext(canonicalQuotedFences(nested, afterCode, true, dialect), dialect), new Map(), ahead === run.length)
        for (const [offset, line] of written.entries()) {
          out.push({ ...line, prefix: part.prefix, text: (offset === 0 ? item!.lead : ' '.repeat(column)) + line.prefix + line.text })
        }
        lastItem.set(part.prefix, column)
        idx = ahead - 1
        continue
      }
    }
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
      const standaloneParagraph = idx === 0 && run.length === 1 && item === null && held === undefined && !part.continued
      const quoted = peelQuoteMarkers(part.text)
      out.push({ ...part, text: quoted.marker + emitContainerLine(quoted.body, standaloneParagraph ? 'paragraph' : 'verbatim', {
        listDepth: 0, quoteDepth: quoteDepth(part.prefix) + quoteDepth(quoted.marker), prefix: part.prefix + quoted.marker, afterCode,
      }).line })
      continue
    }
    opener = out.length
    out.push(part)
    info = fenceInfo(open[3]!, runPartSourceLine(part))
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
  const indentsByPrefix = new Map<string, Set<number>>()
  for (const part of run) {
    let columns = indentsByPrefix.get(part.prefix)
    if (columns === undefined) indentsByPrefix.set(part.prefix, columns = new Set())
    if (part.text.trim() !== '') columns.add(indentColumns(part.text))
  }
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
    if (prev !== undefined && prev.prefix === prefix && prev.text.trim() !== '') out.push({
      prefix, text: emitContainerLine('', 'separator', { listDepth: 0, quoteDepth: quoteDepth(prefix), prefix: '' }).line,
    })
  }
  // A line the quote's open item holds moves with the item.
  const moved = (part: PrefixedInlineLine): PrefixedInlineLine => {
    const item = markers.get(part.prefix)?.itemAt(indentColumns(part.text))
    return item ? { ...part, text: moveIndent(part.text, item.content, item.content + item.shift) } : part
  }
  const tableRow = quotedTableRows(run)
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
      const carried = moved(part)
      out.push(closerCol > 0 && carried.text.trim() === '' && columnWidth(carried.text) === closerCol
        ? { ...carried, text: stripColumns(carried.text, closerCol) } : carried)
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
      const lazy = lazyDeeperQuoteLine(prev, part, inTable)
      if (lazy !== null) {
        out.push(lazy)
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
    const quoteParagraphOpen = prev?.prefix === part.prefix && opensParagraph(prev.text.replace(RE_LIST_MARKER, ''))
    const asText =
      overIndented ||
      (RE_ITEM_LINE.test(part.text) && !opensInterruptingItem(part.text, quoteParagraphOpen, holder?.content ?? 0)) ||
      (ordered !== null && orderedMarkerIsQuotedText(ordered, part, prev, list, markerCol))
    // Marker padding collapses as fmt writes it when nothing the item could
    // take in follows the lines it holds, which move with it: the quote ends,
    // or the next line is another item of this list or an outer one.
    const paddingIsFree = !asText && quotedMarkerPaddingIsFree(run, idx, markerCol, quoteEnds)
    const strands = narrowedPaddingStrands(part, run[idx + 1], markerCol)
    const written = asText ? { line: part.text, separate: false, outer: 0 } : list.write(
      nestedEmptyPlusItem(part.text), paddingIsFree || ordered !== null && quoteDepth(part.prefix) > 0 && !strands,
      nestedMarkerPaddingIsFree(part.text, indentsByPrefix.get(part.prefix) ?? new Set()),
      quoteParagraphOpen, holder?.content ?? 0,
    )
    let text = moveIndent(written.line, markerCol, markerCol + written.outer)
    if (asText || !RE_LIST_MARKER.test(part.text)) {
      const unmarked = respellUnmarkedQuoteLine(part, prev, list, markerCol, asText, overIndented, item, tableRow[idx]!, moved)
      text = unmarked.text
      leavesList = unmarked.leavesList
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
    if (!asText) text = emitQuotedBreakOrHeading(text, part, list.itemAt(markerCol) !== undefined)
    const paragraphBody = text.trimStart()
    const paragraphText = !opensAtTheContentColumn(paragraphBody) && !RE_LIST_MARKER.test(paragraphBody) &&
      !isMarkdownFenceLine(paragraphBody) && !'<[|]'.includes(paragraphBody[0] ?? '')
    const outsideItem = list.itemAt(markerCol) === undefined && (list.itemAt(Infinity) === undefined || prev === undefined)
    if (outsideItem && !part.hadLeadingTab && indentColumns(text) > 0 && indentColumns(text) < 4 &&
      paragraphText && !part.continued) {
      text = emitContainerLine(text, 'paragraph', {
        listDepth: 0, quoteDepth: quoteDepth(part.prefix), prefix: part.prefix,
        hosts: emissionHosts(part.prefix),
      }).line
    }
    if (leavesList) separate(part.prefix)
    leavesList = false
    if (quotedBlockFollowsParagraph(part, text, prev)) separate(part.prefix)
    if (quotedBlockFollowsBreak(part, text, prev)) separate(part.prefix)
    out.push({ ...part, text, sourceSegments: part.sourceSegments?.map(entry => ({...entry, offset:entry.offset + text.length - part.text.length})) })
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
 * The rows of the tables each stretch of one quote depth holds. Any other pipe
 * row is paragraph text.
 */
function quotedTableRows(run: readonly PrefixedInlineLine[]): boolean[] {
  const tableRow = new Array<boolean>(run.length).fill(false)
  const bodies = heldByItem(run).map((held) => held.body)
  for (let start = 0; start < run.length; ) {
    let end = start + 1
    while (end < run.length && run[end]!.prefix === run[start]!.prefix && !run[end]!.continued) end++
    gfmTableRowLines(bodies.slice(start, end)).forEach((row, offset) => (tableRow[start + offset] = row))
    start = end
  }
  return tableRow
}

/**
 * `part`, with fewer quote markers than the paragraph `prev` holds, written as
 * that paragraph's lazy line inside the deeper quote, or null where it opens a
 * block of its own.
 */
function lazyDeeperQuoteLine(prev: PrefixedInlineLine, part: PrefixedInlineLine, inTable: boolean): PrefixedInlineLine | null {
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
  if (!lazy) return null
  return { ...part, prefix: prev.prefix, text: ' '.repeat(indentColumns(held)) + (over ? escapeBlockOpener(trimmed) : trimmed), continued: true, lazyQuote: true, nativeContinuationIndent: /^[ \t]*/.exec(part.text)![0] }
}

/**
 * Whether an ordered marker other than 1 is paragraph text under the quoted
 * paragraph above it: it continues no list open at its column and sits at or
 * right of the item holding the paragraph.
 */
function orderedMarkerIsQuotedText(
  ordered: RegExpExecArray,
  part: PrefixedInlineLine,
  prev: PrefixedInlineLine | undefined,
  list: ListMarkers,
  markerCol: number,
): boolean {
  const holder = list.itemAt(Infinity)
  return (holder === undefined || markerCol >= holder.content) &&
    Number(ordered[1]) !== 1 &&
    prev?.prefix === part.prefix &&
    opensParagraph(prev.text.replace(RE_LIST_MARKER, '')) &&
    !list.continues(markerCol, ordered[2]!)
}

/**
 * Marker padding collapses as fmt writes it when nothing the item could take in
 * follows the lines it holds, which move with it: the quote ends, or the next
 * line is another item of this list or an outer one.
 */
function quotedMarkerPaddingIsFree(run: readonly PrefixedInlineLine[], idx: number, markerCol: number, quoteEnds: boolean): boolean {
  const part = run[idx]!
  if (!/^[ \t]*(?:[-*+]|\d+[.)]) {2}/.test(part.text)) return false
  const content = columnWidth(RE_LIST_MARKER.exec(part.text)![0])
  let at = idx + 1
  const holds = (entry: PrefixedInlineLine): boolean =>
    entry.prefix === part.prefix && (entry.continued === true || entry.text.trim() === '' || indentColumns(entry.text) >= content)
  while (at < run.length && holds(run[at]!)) at++
  const next = run[at]
  return next === undefined
    ? quoteEnds
    : next.prefix !== part.prefix || opensParagraph(part.text.replace(RE_LIST_MARKER, '')) &&
      indentColumns(next.text) < content && !next.continued ||
      (RE_ITEM_LINE.test(next.text) && indentColumns(next.text) <= markerCol + 3)
}

/** Whether narrowing the padding would pull in a next line the source item leaves. */
function narrowedPaddingStrands(part: PrefixedInlineLine, following: PrefixedInlineLine | undefined, markerCol: number): boolean {
  const sourceContent = columnWidth(RE_LIST_MARKER.exec(part.text)?.[0] ?? '')
  const tightContent = markerCol + (RE_LIST_MARKER.exec(part.text)?.[0].trim().length ?? 0) + 1
  return following !== undefined && following.prefix === part.prefix && following.continued !== true &&
    following.text.trim() !== '' && indentColumns(following.text) >= tightContent && indentColumns(following.text) < sourceContent
}

/**
 * Write a quoted line that carries no list marker, or one read as text: as a
 * lazy line of the open item or the quote it holds, or as a block that may
 * leave the quote's list.
 */
function respellUnmarkedQuoteLine(
  part: PrefixedInlineLine,
  prev: PrefixedInlineLine | undefined,
  list: ListMarkers,
  markerCol: number,
  asText: boolean,
  overIndented: boolean,
  item: OpenList | undefined,
  isTableRow: boolean,
  moved: (part: PrefixedInlineLine) => PrefixedInlineLine,
): { text: string; leavesList: boolean } {
  const above = prev?.prefix === part.prefix ? prev.text.replace(RE_LIST_MARKER, '') : null
  let text: string
  let leavesList = false
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
  const plain = part.text.trimStart()
  const markerItem = sourceItem(plain)
  const trimmed = asText && (markerItem === null || markerItem.content.trim() !== '') ? escapeBlockOpener(plain) : plain
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
      (isTableRow || !isStandardTableRow(part.text))
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
  return { text, leavesList }
}

/** A quoted break or heading, written as fmt writes it at its container. */
function emitQuotedBreakOrHeading(text: string, part: PrefixedInlineLine, inItem: boolean): string {
  const indent = text.slice(0, text.length - text.trimStart().length)
  const body = text.slice(indent.length)
  const sourceBody = part.text.trimStart()
  const kind: EmissionKind | null = isSolidThematic(sourceBody.trim()) && isSolidMarkerRun(body.trim()) ? 'break'
    : RE_CARVE_HEADING_OPENER.test(sourceBody) && RE_CARVE_HEADING_OPENER.test(body) ? 'heading' : null
  if (kind === null) return text
  return indent + emitContainerLine(body, kind, {
    listDepth: inItem ? 1 : 0,
    quoteDepth: quoteDepth(part.prefix), prefix: part.prefix + indent,
    hosts: emissionHosts(part.prefix + indent),
  }).line
}

/**
 * Whether the quoted block `text` writes follows the paragraph above it, which
 * fmt sets apart with an empty quote line. Carve reads the block either way;
 * without it the import was not a fixed point of fmt (carve-js#2031).
 */
function quotedBlockFollowsParagraph(part: PrefixedInlineLine, text: string, prev: PrefixedInlineLine | undefined): boolean {
  return (
    part.continued !== true &&
    indentColumns(text) === 0 &&
    prev !== undefined &&
    prev.prefix === part.prefix &&
    prev.text.trim() !== '' &&
    opensParagraph(prev.text.replace(RE_LIST_MARKER, '')) &&
    opensAtTheContentColumn(text)
  )
}

/**
 * Whether the quoted block `text` writes follows a break or heading, which fmt
 * sets apart too (carve-js#2633, carve-js#2642).
 *
 * Asked of the EMITTED lines, since neither construct need be spelled that
 * way in the source: a Markdown `***` can be read back as paragraph text,
 * and a setext underline reaches here already written as `# h`. A block the
 * quote's list item holds is indented past the content column and stays
 * tight, which is where a bare separator would make the list loose.
 */
function quotedBlockFollowsBreak(part: PrefixedInlineLine, text: string, prev: PrefixedInlineLine | undefined): boolean {
  return (
    part.continued !== true &&
    indentColumns(text) === 0 &&
    text.trim() !== '' &&
    prev !== undefined &&
    prev.prefix === part.prefix &&
    indentColumns(prev.text) === 0 &&
    (RE_MD_THEMATIC.test(prev.text) || RE_ATX_HEADING.test(prev.text))
  )
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
      stripColumns(line, contentCol + 4),
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
function closeFence(out: string[], openerAt: number, pad: string, info: string, openerPrefix = ''): string {
  const fence = canonicalFence(out.slice(openerAt + 1).map((line) => stripColumns(line, pad.length)))
  out[openerAt] = (openerPrefix || pad) + fence + info
  return pad + fence
}

/**
 * A Markdown info string reduced to the one token a Carve fence takes, or
 * nothing when the complete word is outside Carve's language charset.
 */
function fenceInfo(rest: string, sourceLine?: number): string {
  const escapesAndEntities = new RegExp(String.raw`\\([!-/:-@\[-\x60{-~])|${RE_HTML_ENTITY.source}`, 'g')
  rest = rest.replace(escapesAndEntities, (match, escaped: string | undefined) => escaped ?? decodeHtmlEntitiesRaw(match))
  const firstInfoWord = trimMatchingEdges(rest, (code) => code === 32 || code === 9).split(/[ \t]/, 1)[0] ?? ''
  if (!firstInfoWord || /^[A-Za-z0-9_+#/.-]+$/.test(firstInfoWord)) return firstInfoWord
  importLosses.push({
    code: 'structure-unspellable',
    message: `Dropped code-block language ${JSON.stringify(firstInfoWord)}; Carve cannot spell this language token.`,
    ...(sourceLine === undefined ? {} : { line: sourceLine }),
  })
  return ''
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
  emptyMarker = false,
): {
  lines: string[]
  end: number
  verbatimFrom?: number
} {
  const first = lines[start]!
  const marker = first.match(RE_LIST_MARKER)
  if (!marker) return { lines: [convertInline(first, dialect)], end: start + 1 }
  const lead = collectListItemLead(lines, start, marker[0], emptyMarker)
  if (lead !== null) return lead
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
    return collectItemFence(lines, start, first.slice(0, nestedEnd), fence[2]!, fenceInfo(fence[3]!, importSourceLine?.(start)))
  }

  if (RE_MD_THEMATIC.test(first.slice(nestedEnd))) {
    return { lines: [first.slice(0, nestedEnd) + '---'], end: start + 1 }
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
  const run: PrefixedInlineLine[] = [{ prefix: marker[0], text: firstLineText, source: start }]
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
  let terminal = true

  while (end < lines.length) {
    const line = lines[end]!
    if (line.trim() === '') break

    const indent = indentColumns(line)
    // A code fence has no lazy quote continuation. Leave the first line
    // without an explicit quote marker for the surrounding item to collect.
    if (quotedFence !== null && indent >= contentCol && blockquotePrefix(stripColumns(line, contentCol)) === null) break
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
    if (indent < contentCol) { terminal = !lazyText; break }

    // Star and underscore rules interrupt the paragraph; dashes may be setext.
    if (RE_MD_THEMATIC.test(text) && !/^[ \t]*-/.test(text)) break

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
      openFence !== null &&
      (quote === null || openFence.prefix === quote) &&
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
    if (!continues && quote === null && quotedFence === null && quotedIndentedCodeAt(lines, end, base) !== null) break

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
      const written = restorePrefixedInlineRun(foldContainerSetext(run, dialect), dialect)
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
    const hosted = quoteHoldsItem ? hostedQuoteParagraphPrefix(above) : null
    const explicit = blockquotePrefix(trimmed)
    const continuation = explicit !== null && explicit.prefix === quote ? explicit.text.trimStart() : trimmed
    if (hosted !== null && continuation !== '' && isParagraphRunLine([continuation], 0, 'text')) {
      run.push({ prefix, text: pad + hosted + continuation, continued: true, bareBody: plain, source: end })
    } else if (inner !== null && inner.prefix === quote && inner.text.trim() !== '' && (definition || /^[ \t]/.test(inner.text))) {
      const body = inner.text.trimStart()
      const asText = definition || indentColumns(inner.text) >= 4
      run.push({ prefix, text: pad + quote + (asText ? escapeBlockOpener(body) : body), bareBody: body, source: end })
    } else if (continues && quote === null && !(lazyText && indent < itemCols.at(-1)!)) run.push({ prefix, text: pad + escapeBlockOpener(trimmed), continued: true, bareBody: plain, source: end })
    else if (quote !== null && (over >= 4 || (!trimmed.startsWith('>') && isParagraphRunLine([trimmed], 0, 'text')))) {
      // A lazy line of the quote the item holds, written with its marker.
      run.push({ prefix, text: pad + quote + (over >= 4 ? escapeBlockOpener(trimmed) : trimmed), continued: true, bareBody: plain, source: end })
    } else if (lazyText && opensParagraph(above) && indent < itemCols.at(-1)!) {
      // A lazy line of the innermost item's paragraph, at that item's column.
      run.push({ prefix, text: ' '.repeat(itemCols.at(-1)! - contentCol) + trimmed, continued: true, lazyQuote: true, nativeContinuationIndent: text.slice(0, text.length - text.trimStart().length), source: end })
    } else if (over > 0 && over < 4) run.push({ prefix, text: pad + respellHeldQuoteMarkers(trimmed), source: end })
    // A later line the item holds, at the column the quote opens at. As text
    // the marker is escaped above, so a `>` arriving here is structural.
    else run.push({ prefix, text: orderedText ? pad + trimmed : respellHeldQuoteMarkers(text), source: end })
    quoteHoldsItem ||= quotesAnItem(run.at(-1)!.text)
    end++
  }

  return writeListInlineRun(lines, run, end, firstLineText, marker[0], contentCol, dialect, terminal)
}

/**
 * The blocks a list item's marker line opens that its paragraph run does not
 * collect: indented code under an empty marker, code past the content column,
 * and an HTML block filling the quote the item holds. Null for none.
 */
function collectListItemLead(
  lines: readonly string[],
  start: number,
  markerText: string,
  emptyMarker: boolean,
): { lines: string[]; end: number; verbatimFrom?: number } | null {
  const first = lines[start]!
  if (emptyMarker && lines[start + 1]?.trim() && indentColumns(lines[start + 1]!) >= columnWidth(markerText) + 4) {
    const contentCol = columnWidth(markerText)
    return collectIndentedCodeItem(lines, start + 1, markerText, stripColumns(lines[start + 1]!, contentCol + 4), contentCol)
  }
  if (emptyMarker) {
    const next = lines[start + 1]
    const body = next === undefined ? '' : stripColumns(next, columnWidth(markerText))
    if (next === undefined || next.includes('\t') || next.trim() === '' ||
        indentColumns(next) < columnWidth(markerText) || /^(?:[-*+]|\d+[.)])(?:[ \t]|$)/.test(body) || RE_LIST_MARKER.test(body) ||
        RE_MD_THEMATIC.test(body) || RE_MD_SETEXT_UNDERLINE.test(body) || RE_MD_LINK_REFERENCE.test(body) || RE_ATX_HEADING.test(body)) {
      return { lines: [first], end: start + 1 }
    }
  }
  if (itemContentColumn(markerText) < columnWidth(markerText) && first.trim() !== markerText.trim()) {
    return collectItemIndentedCode(lines, start, markerText.trimEnd().length)
  }
  const contentCol = columnWidth(markerText)
  const firstQuote = blockquotePrefix(first.slice(markerText.length))
  if (firstQuote !== null) {
    const html = htmlBlockAt(lines, start, at => {
      if (at === start) return firstQuote.text
      const next = lines[at]
      if (next === undefined || indentColumns(next) < contentCol) return null
      const parsed = blockquotePrefix(stripColumns(next, contentCol))
      return parsed?.prefix === firstQuote.prefix ? parsed.text : null
    })
    // Only a quote the block fills: this return cannot carry the item's later
    // quoted lines, which would otherwise leave the item.
    const after = html === null ? undefined : lines[html.end + 1]
    const quoteGoesOn = after !== undefined && indentColumns(after) >= contentCol &&
      blockquotePrefix(stripColumns(after, contentCol)) !== null
    if (html !== null && !quoteGoesOn) {
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(html.lines.join('\n')) + 1))
      const emitted = [`${fence}=html`, ...html.lines, fence]
      return { lines: emitted.map((line, at) => {
        const prefix = (at === 0 ? markerText : ' '.repeat(contentCol)) + firstQuote.prefix
        return line === '' ? prefix.trimEnd() : prefix + line
      }), end: html.end + 1 }
    }
  }
  return null
}

/**
 * Write a list item's collected paragraph run, as the quote the marker line
 * holds when that quote opens a fence.
 */
function writeListInlineRun(
  lines: readonly string[],
  run: PrefixedInlineLine[],
  end: number,
  firstLineText: string,
  markerText: string,
  contentCol: number,
  dialect: MarkdownDialect,
  terminal: boolean,
): { lines: string[]; end: number } {
  const heldQuote = blockquotePrefix(firstLineText)
  const heldFence = heldQuote === null ? null : RE_MD_FENCE_LINE.exec(heldQuote.text)
  if (heldQuote !== null && quotedFenceCloser(firstLineText) !== null && heldFence?.[2]?.[0] !== '~') {
    const quoteRun: PrefixedInlineLine[] = []
    for (const part of run) {
      const parsed = blockquotePrefix(part.text.trimStart())
      if (parsed === null || parsed.prefix !== heldQuote.prefix) break
      quoteRun.push({ ...part, prefix: parsed.prefix, text: parsed.text })
    }
    const fenceOpen = quotedFenceCloser(firstLineText)
    const explicitQuote = run.slice(1).every(part => {
      const source = part.source === undefined ? null : blockquotePrefix(stripColumns(lines[part.source]!, contentCol))
      return source?.prefix === heldQuote.prefix
    })
    if (quoteRun.length === run.length && explicitQuote && fenceOpen !== null) {
      const quoteLines = restorePrefixedInlineRun(foldContainerSetext(canonicalQuotedFences(quoteRun, false, true, dialect), dialect), dialect, terminal)
      return { lines: quoteLines.map((line, at) => (at === 0 ? markerText : ' '.repeat(contentCol)) + line), end }
    }
  }
  const written = restorePrefixedInlineRun(foldContainerSetext(run, dialect), dialect, terminal)
  if (!terminal && / {2,}$/.test(run.at(-1)?.text ?? '') && written.length > 0) {
    written[written.length - 1] += '\\'
  }
  return { lines: canonicalItemHeldTildeFence(written), end }
}

/**
 * The quote markers of `text` when it is a quote line whose paragraph is still
 * open for a lazy line, else null.
 */
function openQuoteParagraph(text: string): string | null {
  const quote = blockquotePrefix(text.trimStart())
  return quote !== null && quote.text.trim() !== '' && quoteParagraphIsOpen(quote.text) ? quote.prefix : null
}

/** The content prefix of a paragraph inside alternating quote and item hosts. */
function hostedQuoteParagraphPrefix(text: string): string | null {
  let body = text.trimStart()
  let prefix = ''
  let sawItem = false
  let sawInnerQuote = false
  for (;;) {
    const quote = blockquotePrefix(body)
    if (quote !== null) {
      prefix += quote.prefix
      body = quote.text
      if (sawItem) sawInnerQuote = true
      continue
    }
    const item = RE_LIST_MARKER.exec(body)
    if (item !== null) {
      prefix += ' '.repeat(columnWidth(item[0]))
      body = body.slice(item[0].length)
      sawItem = true
      continue
    }
    return sawInnerQuote && quoteParagraphIsOpen(body) ? prefix : null
  }
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
  const item = quoted === null ? null : quotedItemLead(quoted.text)
  const column = item === null ? 0 : columnWidth(item.lead)
  const open = quoted === null ? null : RE_MD_FENCE_LINE.exec(quoted.text.slice(item?.lead.length ?? 0))
  if (open === null || columnWidth(open[1]!) > 3 || !fenceRunIsAFence(open[2]!, open[3]!)) return null
  return new RegExp(`^ {${column},${column + 3}}${open[2]![0]}{${open[2]!.length},}[ \t]*$`)
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
 *
 * The opener's trailing padding is `[ \t]`, as in the parser: a form feed or a
 * no-break space after the token is content, so the line is not an opener.
 */
const RE_MD_FRONTMATTER_OPEN = /^--- ?([A-Za-z0-9]*)[ \t]*$/
const RE_MD_FRONTMATTER_CLOSE = /^---[ \t]*$/

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

function htmlBlockAt(
  lines: readonly string[],
  start: number,
  readLine: (at: number) => string | null = at => lines[at] ?? null,
): HtmlBlockRun | null {
  const first = readLine(start)
  if (first === null) return null
  if (/^(?: {4,}|\t)/.test(first)) return null
  const trimmed = first.replace(/^ {0,3}/, '')
  if (inlineCarriersEnabled && trimmed.startsWith(CARRIER_PREFIX)) {
    const end = trimmed.indexOf(' -->')
    if (/^<!-- carve: (?:\[|\]\{|<\/#)/.test(trimmed) || end >= 0 && trimmed.slice(end + 4).trim() !== '') return null
  }
  const collectUntil = (endRe: RegExp, fallbackBlank: boolean, interrupts = true): HtmlBlockRun => {
    const block: string[] = []
    for (let i = start; i < lines.length; i++) {
      const line = readLine(i)
      if (line === null) return { lines: block, end: i - 1, interrupts }
      // `split('\n')` leaves one empty sentinel after a final newline. It is
      // not an additional blank line inside an unclosed HTML block.
      if (i === lines.length - 1 && lines[i] === '') break
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

  const raw = /^<([A-Za-z][A-Za-z0-9-]*)(?=[ \t>]|$)/.exec(trimmed)
  if (raw && RAWTEXT_HTML_BLOCK_TAGS.has(raw[1]!.toLowerCase())) {
    return collectUntil(/<\/(?:script|pre|style|textarea)>/i, false)
  }
  // Known block tags run to a blank line, even after a closing tag.
  const block = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[ \t>]|\/>|$)/.exec(trimmed)
  if (block && HTML_BLOCK_TAGS.has(block[1]!.toLowerCase())) return collectUntil(RE_NEVER, true)
  const tag = scanHtmlTag(trimmed, 0)
  if (!tag) return null
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
  quoteMarkers?: Map<string, ListMarkers>,
): { prefix: string; openerPrefix?: string; lines: string[]; end: number } | null {
  const stripLeadingQuoteIndent = stripOptionalQuoteIndent
  const quoted = blockquotePrefix(stripLeadingQuoteIndent(lines[start]!))
  const collect = (
    prefix: string,
    readLine: (at: number) => string | null,
  ): { prefix: string; lines: string[]; end: number } | null => {
    const block = htmlBlockAt(lines, start, readLine)
    if (!block) return null
    const pad = ' '.repeat(Math.min(3, indentColumns(block.lines[0]!)))
    const keep = prefix.includes('>') ? Math.min(pad.length, quotedItemColumns(lines)[start] ?? 0) : pad.length
    const dedent = new RegExp(`^ {0,${keep}}`)
    return {
      prefix: prefix + pad.slice(0, keep),
      lines: block.lines.map((line) => line.replace(dedent, '')),
      end: block.end,
    }
  }

  if (quoted) {
    const item = RE_MD_THEMATIC.test(quoted.text) ? null : RE_LIST_MARKER.exec(quoted.text)
    if (item !== null) {
      const column = itemContentColumn(item[0])
      const readItemLine = (at: number): string | null => {
        if (at === start) return ' '.repeat(columnWidth(item[0]) - column) + quoted.text.slice(item[0].length)
        const line = lines[at]
        if (line === undefined) return null
        const parsed = blockquotePrefix(stripLeadingQuoteIndent(line))
        if (parsed === null || parsed.prefix !== quoted.prefix ||
          parsed.text.trim() !== '' && indentColumns(parsed.text) < column) return null
        return parsed.text.trim() === '' ? '' : stripColumns(parsed.text, column)
      }
      const block = htmlBlockAt(lines, start, readItemLine)
      const following = block === null ? null : readItemLine(block.end + 1)
      // The quote writer preserves separate raw blocks when later tags occur.
      if (block?.interrupts && (following === null || following.trim() === '') &&
        !block.lines.slice(1).some(line => scanHtmlTag(line.trimStart(), 0) !== null)) {
        let markers = quoteMarkers?.get(quoted.prefix)
        if (markers === undefined) {
          markers = new ListMarkers()
          quoteMarkers?.set(quoted.prefix, markers)
        }
        const writtenMarker = RE_LIST_MARKER.exec(markers.write(quoted.text).line)?.[0] ?? item[0]
        const pad = ' '.repeat(Math.min(3, indentColumns(block.lines[0]!)))
        const dedent = new RegExp(`^ {0,${pad.length}}`)
        return {
          prefix: quoted.prefix + ' '.repeat(columnWidth(writtenMarker)) + pad,
          openerPrefix: quoted.prefix + writtenMarker + pad,
          lines: block.lines.map(line => line.replace(dedent, '')),
          end: block.end,
        }
      }
    }
    return collect(quoted.prefix, at => {
      const line = lines[at]
      if (line === undefined) return null
      const parsed = blockquotePrefix(stripLeadingQuoteIndent(line))
      return parsed?.prefix === quoted.prefix ? parsed.text : null
    })
  }

  const contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
  if (contentCol === 0) return null
  // Columns, matching the unit the stack is kept in - a tab is four of them.
  if (indentColumns(lines[start]!) < contentCol) return null
  return collect(' '.repeat(contentCol), at => {
    const line = lines[at]
    if (line === undefined || line.trim() !== '' && indentColumns(line) < contentCol) return null
    return line.trim() === '' ? '' : stripColumns(line, contentCol)
  })
}

const quotedItemColumnCache = new WeakMap<readonly string[], number[]>()

/** Source item columns at each quote line, computed once per input array. */
function quotedItemColumns(lines: readonly string[]): number[] {
  const cached = quotedItemColumnCache.get(lines)
  if (cached) return cached
  const columns = new Array<number>(lines.length).fill(0)
  let prefix = ''
  const itemCols: number[] = []
  let preceding = ''
  for (let at = 0; at < lines.length; at++) {
    const parsed = blockquotePrefix(stripOptionalQuoteIndent(lines[at]!))
    if (!parsed) { prefix = ''; itemCols.length = 0; preceding = ''; continue }
    if (parsed.prefix !== prefix) { prefix = parsed.prefix; itemCols.length = 0; preceding = '' }
    const body = parsed.text
    if (body.trim() === '') preceding = ''
    else {
      const lazy = itemCols.length > 0 && opensParagraph(preceding.replace(RE_LIST_MARKER, '')) &&
        isParagraphRunLine([body.trimStart()], 0, 'text')
      if (!lazy) while (itemCols.length && indentColumns(body) < itemCols[itemCols.length - 1]!) itemCols.pop()
      const marker = RE_MD_THEMATIC.test(body) ? null : RE_LIST_MARKER.exec(body)
      const ordered = marker === null ? undefined : sourceItem(body)?.number
      if (marker && !(ordered !== undefined && Number(ordered) !== 1 && opensParagraph(preceding))) itemCols.push(itemContentColumn(marker[0]))
      preceding = body
    }
    columns[at] = itemCols[itemCols.length - 1] ?? 0
  }
  quotedItemColumnCache.set(lines, columns)
  return columns
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
    stripOptionalQuoteIndent(stripColumns(line, contentCol))
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
      body.push(stripColumns(parsed.text, base + 4))
      end++
      continue
    }
    if (!isCode(parsed.text)) break
    body.push(peel(parsed.text))
    end++
  }
  // A blank line does not end an indented code block, but trailing blanks
  // belong to the quote rather than to the code.
  while (body.length > 0 && body[body.length - 1]!.trim() === '') {
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
 * The fence must enclose content shaped like a MAPPING. An empty pair
 * (`---\n---`), a comment-only one, and a scalar one (CommonMark example 96's
 * `---\nFoo\n---`) all carry no metadata, so the CommonMark reading - a
 * thematic break and setext headings - is the meaning-preserving one, and they
 * stay on the thematic-break path guarded at the end of markdownToCarve.
 */
function splitFrontmatter(lines: readonly string[]): { frontmatter: string[]; bodyStart: number; typedOpener: boolean } {
  const none = { frontmatter: [], bodyStart: 0, typedOpener: false }
  const opener = lines.length < 2 ? null : RE_MD_FRONTMATTER_OPEN.exec(lines[0]!)
  if (opener === null) return none
  for (let i = 1; i < lines.length; i++) {
    if (!RE_MD_FRONTMATTER_CLOSE.test(lines[i]!)) continue
    if (!isMappingShaped(lines.slice(1, i), opener[1]!)) return none
    const frontmatter = lines.slice(0, i + 1)
    // The metadata between the fences is opaque and survives byte-for-byte, but
    // both fences are delimiters the canonical writer owns: a bare `---` and a
    // spaced `--- toml` both read fine and neither is the canonical spelling.
    frontmatter[0] = canonicalFrontmatterOpener(opener[1] || 'yaml')
    // A reader accepts a trailing run of spaces and tabs on the closer, so
    // `---<TAB>` closes the block, but the writer spells it bare - echoing the
    // source's run left the import failing this engine's own `fmt --check`
    // (carve-js#2638).
    frontmatter[frontmatter.length - 1] = FRONTMATTER_CLOSER
    return { frontmatter, bodyStart: i + 1, typedOpener: opener[1] !== '' }
  }
  return none
}

/**
 * A front matter key: a quoted string, or a run that starts with neither
 * whitespace nor a character that opens some other YAML or TOML production,
 * and holds no `:`.
 */
const FM_KEY = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s\-\[\{"'#:][^:]*)`

/** `key:` followed by a space, a tab, or the end of the line. */
const RE_FM_YAML_MAPPING = new RegExp(`^${FM_KEY}:(?:[ \t]|$)`)

/**
 * Whether the lines between a leading `---` pair have the SHAPE of a mapping,
 * and so are front matter rather than a thematic break over setext headings
 * (markup-carve/carve#2799).
 *
 * This is a string inspection, deliberately NOT a YAML or TOML parse. A real
 * parser would disagree with carve-php and carve-rs on edge cases, and the
 * three engines have to agree byte for byte; a shared regex cannot drift. The
 * cost is that malformed content such as `title: [unclosed` counts as front
 * matter here where a parser would reject it. That is the intended trade.
 *
 * The test governs the BARE `---` ONLY. A typed opener - `---yaml`, `---toml`,
 * `---json`, any `frontmatter_format` - says what the block is, so there is
 * nothing to infer, and PART 1's "a break is a dash run and nothing else"
 * means it is not a thematic break under any reading. The collision this test
 * resolves can only happen on a bare `---`, so a typed opener keeps the prior
 * reading, the "at least one non-blank line" check, and `---yaml` / `Foo` /
 * `---` is front matter whose payload is a scalar.
 *
 * The refinement's TOML spelling - `[` or `key =` - was written for a `---toml`
 * opener, and the narrowing takes every typed opener off this path, so no
 * reachable caller is left for it. It is not carried here as a branch that
 * cannot run: a bare `---` is YAML by convention in every Markdown toolchain
 * that writes one, and accepting `---` / `[table]` / `---` as front matter
 * would decide a case the ruling does not name.
 */
function isMappingShaped(content: readonly string[], format: string): boolean {
  if (format !== '') return content.some((line) => line.trim() !== '')
  const first = content.find((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
  if (first === undefined) return false
  return RE_FM_YAML_MAPPING.test(first)
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
  rewriteHeadingFragments = true,
): { value: string; losses: MarkdownImportLoss[]; unfixed?: string; fixups?: FragmentFixup[]; authored?: AuthoredDestinations } {
  const result = convertMarkdownSource(markdown, dialect, rewriteHeadingFragments)
  return {
    ...result,
    value: spellEmptyItemPlaceholders(result.value),
    ...(result.unfixed === undefined ? {} : { unfixed: spellEmptyItemPlaceholders(result.unfixed) }),
  }
}

function convertMarkdownSource(
  markdown: string,
  dialect: MarkdownDialect,
  rewriteHeadingFragments: boolean,
): { value: string; losses: MarkdownImportLoss[]; unfixed?: string; fixups?: FragmentFixup[]; authored?: AuthoredDestinations } {
  markdown = replaceLoneSurrogates(markdown)
  const losses: MarkdownImportLoss[] = []
  const outerAuthored = authoredDestinations
  authoredDestinations = new Map()
  // Present only when some destination changed, so a plain result keeps its shape.
  const authored = (): { authored?: AuthoredDestinations } => {
    const map = new Map([...authoredDestinations].filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== entry[0]))
    return map.size > 0 ? { authored: map } : {}
  }
  importLosses = losses
  const decoded = markdown.includes('&') ? decodeHtmlEntitiesRaw(markdown) : markdown
  let emptyDestinationKey: string | undefined
  if (decoded.includes('@')) {
    const keySource = decoded.includes('\\') ? decoded.replace(/\\([!-\/:-@\[-`{-~])/g, '$1') : decoded
    const occupied = new Set([...keySource.toLowerCase().matchAll(/carve-md-empty-(\d+)/g)].map(match => match[1]))
    let slot = 0
    while (occupied.has(String(slot))) slot++
    emptyDestinationKey = `carve-md-empty-${slot}`
  }
  useEmptyDestinationBoundaryKey(emptyDestinationKey)
  try {
    // PART 11 §10s: a carrier marker is lifted to a placeholder before the
    // conversion and written back as the Carve line it is afterwards, so the
    // Markdown reading in between never sees a comment it would carry across as
    // raw HTML.
    inlineCarriersEnabled = !Object.values(dialect).some(Boolean)
    inlineCarriersDamaged = false
    const footnoteStyles = prepareFootnoteListStyles(markdown)
    if (footnoteStyles.damaged) losses.push({ code: 'carrier-markers-damaged', message: CARRIER_MARKERS_DAMAGED, fidelity: 'degraded', confidence: 'fallback' })
    const prepared = footnoteStyles.damaged ? markdown : prepareCarrierMarkers(footnoteStyles.source, markdownBlockHtmlLines(footnoteStyles.source), footnoteStyles.lineNumbers)
    if (losses.some(loss => loss.message === CARRIER_MARKERS_DAMAGED)) inlineCarriersEnabled = false

    let value = restoreInlineCarriers(restoreCarrierMarkers(convertMarkdown(prepared, dialect)))
    const restoredFootnotes = footnoteStyles.damaged ? value : restoreFootnoteListStyles(value, footnoteStyles.token, footnoteStyles.payloads)
    if (restoredFootnotes === undefined) {
      losses.push({ code: 'carrier-markers-damaged', message: CARRIER_MARKERS_DAMAGED, fidelity: 'degraded', confidence: 'fallback' })
      value = convertMarkdown(markdown, dialect)
    } else value = restoredFootnotes
    if (inlineCarriersDamaged) {
      inlineCarriersEnabled = false
      carrierSlots = []
      losses.length = 0
      losses.push({ code: 'carrier-markers-damaged', message: CARRIER_MARKERS_DAMAGED, fidelity: 'degraded', confidence: 'fallback' })
      value = convertMarkdown(markdown, dialect)
    }
    if (dialect.abbreviations !== false && value.includes('{abbr="')) value = foldDefinedAbbreviations(value)
    const usedBoundaryKey = emptyDestinationKey !== undefined && value.includes(emptyDestinationKey) ? emptyDestinationKey : undefined
    const trailingNewline = value.endsWith('\n')
    const changesLinks = value.includes('@') || usedBoundaryKey !== undefined
    const written = value
    value = canonicalCarveWrite(value, {
      onRenderLoss: loss => losses.push({ code: 'structure-unspellable', message: loss.message }),
    }, document => {
      const alerts = importGithubAlerts(document, written)
      return (changesLinks && linkMarkdownEmailText(document, usedBoundaryKey)) || alerts
    },
    value)
    if (!trailingNewline) value = value.replace(/\n$/, '')
    if (usedBoundaryKey !== undefined && value.includes('`<!--' + usedBoundaryKey + '-->`{=html}')) {
      throw new Error('Markdown import could not remove its internal empty-destination boundary')
    }
    if (importedCrossrefIds === null && markdown.includes('</#')) {
      importedCrossrefIds = convertedIds(value)
      try { return markdownToCarveWithLosses(markdown, dialect, rewriteHeadingFragments) }
      finally { importedCrossrefIds = null }
    }
    if (rewriteHeadingFragments && value.includes('](#')) {
      const rewritten = rewriteSameFileHeadingLinks(value, message => losses.push({ code: 'structure-unspellable', message }), authored().authored)
      if (rewritten.fixups.length > 0) return { value: rewritten.value, losses, unfixed: rewritten.unfixed, fixups: rewritten.fixups, ...authored() }
    }
    return { value, losses, ...authored() }
  } finally {
    authoredDestinations = outerAuthored
    inlineCarriersEnabled = false
    inlineCarriersDamaged = false
    carrierSlots = []
    carrierToken = ''
    useEmptyDestinationReferences(null)
    useEmptyDestinationBoundaryKey()
    importLosses = []
    inlineRunSourceLine = undefined
    importSourceLine = undefined
  }
}

/**
 * An `<abbr>` whose title is the expansion a definition in the document gives
 * its text comes back as the plain term that definition resolves
 * (CARVE-P11-033 T1). Only a span written exactly as the abbr import spells
 * it is replaced.
 */
function foldDefinedAbbreviations(carve: string): string {
  const document = parse(carve)
  const expansions = new Map<string, string>()
  const spans: Array<{ start: number; end: number; term: string }> = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const node = value as Record<string, any>
    if (node.type === 'abbreviation_def' && !expansions.has(node.abbr)) expansions.set(node.abbr, node.expansion)
    // The span's text must itself resolve as the abbreviation, or the plain
    // term would come back without one.
    if (node.type === 'span' && node.pos?.startOffset !== undefined && node.children?.length === 1 && node.children[0].type === 'abbreviation') {
      const attrs = node.attrs
      const keys = Object.keys(attrs?.keyValues ?? {})
      if (keys.length === 1 && keys[0] === 'abbr' && attrs.id === undefined && !(attrs.classes?.length) && node.children[0].expansion === attrs.keyValues.abbr) {
        spans.push({ start: node.pos.startOffset, end: node.pos.endOffset, term: node.children[0].abbr })
      }
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(document.children)
  if (expansions.size === 0) return carve
  let out = carve
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    const expansion = expansions.get(span.term)
    if (expansion === undefined || out.slice(span.start, span.end) !== `[${span.term}]{abbr="${expansion}"}`) continue
    out = out.slice(0, span.start) + span.term + out.slice(span.end)
  }
  return out
}

/**
 * A list item's collected lines with the marker `carve fmt` writes, the marker
 * line moved with the items around it and the lines under it with the item.
 */
function writeItemRun(
  run: { lines: string[] },
  markers: ListMarkers,
  paddingIsFree = false,
  foldPlaceholder = true,
  syntheticEmpty = false,
  paragraphOpen = false,
  paragraphColumn = 0,
): { lines: string[]; separate: boolean } {
  const first = syntheticEmpty ? run.lines[0]! : nestedEmptyPlusItem(run.lines[0]!)
  const followingColumns = new Set(run.lines.slice(1).filter(line => line.trim() !== '').map(indentColumns))
  const written = markers.write(first, paddingIsFree, nestedMarkerPaddingIsFree(first, followingColumns), paragraphOpen, paragraphColumn)
  const markerCol = indentColumns(first)
  const content = columnWidth(RE_LIST_MARKER.exec(first)?.[0] ?? '')
  const rewrittenNestedNumber = nestedItemsOnLine(first, RE_LIST_MARKER.exec(first)?.[0].length ?? 0)
    .some((item) => item.number !== undefined && (item.number.length > String(Number(item.number)).length ||
      item.end - item.marker - item.number.length - 1 > 1))
  const result = [
      moveIndent(written.line, markerCol, markerCol + written.outer),
      ...run.lines.slice(1).map((line) => {
        const col = indentColumns(line)
        return rewrittenNestedNumber
          ? moveIndent(line, col, col + markers.shiftAt(col))
          : moveIndent(line, content, content + markers.shiftAt(col))
      }),
    ]
  const placeholder = RE_EMPTY_ITEM_PLACEHOLDER.exec(result[0] ?? '')
  if (foldPlaceholder && placeholder && result[1]?.trim()) {
    const folded = foldEmptyItemBody('+', stripColumns(result[1]!, columnWidth(placeholder[1]!)), true)
    if (folded.consumeNext) result.splice(0, 2, placeholder[1] + folded.first)
  }
  return {
    lines: result,
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
  // A list-style marker line and the blank lines around it go when the marker
  // is restored, so looseness is read without them: the export writes those
  // blanks, and they part nothing of the author's item.
  const styleLines = new Set<number>()
  if (carrierToken !== '') {
    const token = new RegExp(`^[ \\t>]*${carrierToken}(\\d+)Z$`)
    for (const [at, line] of lines.entries()) {
      const slot = carrierSlots[Number(token.exec(line)?.[1] ?? -1)]
      if (slot === undefined || carrierListStyle(slot.payload) === undefined) continue
      styleLines.add(at)
      for (let k = at - 1; k >= 0 && isBlank(k); k--) styleLines.add(k)
      for (let k = at + 1; k < lines.length && isBlank(k); k++) styleLines.add(k)
    }
  }
  const kept = [...lines.keys()].filter((at) => !styleLines.has(at))
  const decide = styleLines.size === 0 ? source : kept.map((at) => lines[at]).join('\n')
  const origin = (at: number): number => (styleLines.size === 0 ? at : kept[at]!)
  const decideBlanks = styleLines.size === 0
    ? sourceBlanks
    : new Set(kept.flatMap((at, idx) => (sourceBlanks.has(at) ? [idx] : [])))
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
        for (let at = prev.pos.endLine; at < child.pos.startLine - 1; at++) if (decideBlanks.has(at)) return true
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
        const at = origin(block.pos.startLine - 1)
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
          for (const start of starts) if (start.pos) before.push(origin(start.pos.startLine - 1))
        }
      }
    }
    for (const child of [...(block.items ?? []), ...(block.children ?? [])]) visit(child)
  }
  visit(parse(decide))
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
function joinOutput(out: readonly string[], fromSource: readonly boolean[], hardBlanks: ReadonlySet<number>): { text: string; sourceBlanks: Set<number> } {
  const lines: string[] = []
  const flags: boolean[] = []
  const hard: boolean[] = []
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
      lines.push(fence !== null && !closer || line.indexOf('`<') > 0 ? line : dropTrailingWs(line))
      flags.push(fromSource[idx]! && /^[ \t>]*$/.test(line))
      hard.push(hardBlanks.has(idx))
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
    const keep = hard.slice(at, end).some(Boolean) ? 3 : fenced.slice(at, end).some(Boolean)
      ? end - at
      : at === 0 && end === lines.length ? Math.min(end - at, 2)
        : at === 0 && end < lines.length ? 0
        : end === lines.length ? 1
          : newlines < 3 ? end - at : 1
    for (let k = 0; k < keep; k++) {
      if (flagged) sourceBlanks.add(text.length)
      text.push('')
    }
    at = end
  }
  return { text: text.join('\n'), sourceBlanks }
}

/**
 * Which lines of the given source this importer reads as HTML BLOCK content,
 * as indices into the whole source.
 *
 * The answer is the reference-definition pass's own, because that pass already
 * carries fence state, a block quote's `>` prefix and a list item's content
 * column; a marker at a list item's content column is HTML there and one at
 * four columns is code text, which is the distinction a flat scan cannot make.
 * A line opening a list item whose content is a task box plus an HTML comment
 * is admitted too: `[ ] ` is inline content, so no HTML block can begin after
 * it (markup-carve/carve#2850).
 */
function markdownBlockHtmlLines(markdown: string): ReadonlySet<number> {
  if (!markdown.includes(CARRIER_HEAD)) return new Set()
  const allLines = markdown.replace(/\0/g, '\ufffd').replace(/\r\n?/g, '\n').split('\n')
  const { bodyStart } = splitFrontmatter(allLines)
  const read = extractReferenceDefinitions(allLines.slice(bodyStart), decodeHtmlEntitiesRaw, (line) =>
    interruptingHtmlBlock(line) || isMarkdownFenceLine(line) || RE_MD_THEMATIC.test(line) ||
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|(?:[-*+]|0{0,8}1[.)])[ \t]+\S|=+[ \t]*$)/.test(line),
    (line, atBlockStart) => {
      const block = htmlBlockAt([line], 0)
      return block !== null && (atBlockStart || block.interrupts)
    },
  )
  const lines = new Set<number>()
  for (const at of read.htmlLines) lines.add(at + bodyStart)
  for (const at of read.taskHtmlLines) lines.add(at + bodyStart)

  return lines
}

/** Footnote bodies use four spaces as their content column, not a code indent. */
function prepareFootnoteListStyles(markdown: string): { source: string; token: string; payloads: string[]; damaged: boolean; lineNumbers?: number[] } {
  if (!markdown.includes(CARRIER_HEAD) || !markdown.includes('[^')) return { source: markdown, token: '', payloads: [], damaged: false }
  let token = 'CARVEFOOTSTYLE'
  while (markdown.includes(token)) token += 'X'
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const lineNumbers = lines.map((_line, at) => at + 1)
  const payloads: string[] = []
  let footnote = false
  let emptyOpening = false
  let fence: { char: string; width: number } | undefined
  let outerFence: { char: string; width: number } | undefined
  let damaged = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    const outerRun = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (outerFence) {
      if (outerRun?.[0] === outerFence.char && outerRun.length >= outerFence.width && line.slice(line.indexOf(outerRun) + outerRun.length).trim() === '') outerFence = undefined
      continue
    }
    if (!footnote && outerRun) { outerFence = { char: outerRun[0]!, width: outerRun.length }; continue }
    if (/^ {0,3}\[\^[^\]]+\]:/.test(line)) { footnote = true; emptyOpening = /^ {0,3}\[\^[^\]]+\]:[ \t]*$/.test(line); fence = undefined; continue }
    if (!footnote || line.trim() === '') continue
    if (!line.startsWith('    ')) {
      footnote = false
      fence = undefined
      if (outerRun) outerFence = { char: outerRun[0]!, width: outerRun.length }
      continue
    }
    const body = line.slice(4)
    if (body.trim() !== '' && carrierMarker(body) === undefined) emptyOpening = false
    const run = /^(`{3,}|~{3,})/.exec(body)?.[1]
    if (fence) {
      if (run?.[0] === fence.char && run.length >= fence.width && body.slice(run.length).trim() === '') fence = undefined
      continue
    }
    if (run) { fence = { char: run[0]!, width: run.length }; continue }
    const marker = carrierMarker(body)
    if (marker === undefined || marker.depth !== 1 || carrierListStyle(marker.payload) === undefined) continue
    if (emptyOpening) { damaged = true; continue }
    if (!/^ {4}[0-9]+[.)][ \t]+\S/.test(lines[at + 1] ?? '')) { damaged = true; continue }
    lines[at] = `    ${token}${payloads.length}Z`
    lines.splice(at + 1, 0, '')
    lineNumbers.splice(at + 1, 0, lineNumbers[at]!)
    payloads.push(marker.payload)
    at++
  }
  return { source: damaged ? markdown : lines.join('\n'), token, payloads, damaged, lineNumbers }
}

function restoreFootnoteListStyles(carve: string, token: string, payloads: readonly string[]): string | undefined {
  if (payloads.length === 0) return carve
  const lines = carve.split('\n')
  const removed = new Set<number>()
  const found = new Set<number>()
  for (const blocks of Object.values(parse(carve).footnoteDefs ?? {})) {
    for (let at = 0; at < blocks.length; at++) {
      const block = blocks[at]!
      if (block.type !== 'paragraph' || !block.pos) continue
      const match = new RegExp(`^${token}(\\d+)Z$`).exec(block.children.map(child => child.type === 'text' ? child.value : '').join(''))
      if (!match) continue
      const index = Number(match[1])
      const list = blocks[at + 1]
      if (list?.type !== 'list' || !list.ordered || !list.pos || found.has(index)) return undefined
      const style = carrierListStyle(payloads[index] ?? '', list.start ?? 1)
      if (style === undefined) return undefined
      found.add(index)
      removed.add(block.pos.startLine - 1)
      if (lines[block.pos.endLine]?.trim() === '') removed.add(block.pos.endLine)
      for (const [itemIndex, item] of list.items.entries()) {
        if (!item.pos) return undefined
        const line = item.pos.startLine - 1
        lines[line] = lines[line]!.replace(/^([ \t]*)[0-9]+([.)])(?=[ \t])/, (_match, lead: string, delim: string) =>
          `${lead}${orderedMarker((list.start ?? 1) + itemIndex, style)}${delim}${delim === '.' ? ' ' : ''}`)
      }
    }
  }
  return found.size === payloads.length ? lines.filter((_line, at) => !removed.has(at)).join('\n') : undefined
}

/**
 * Whether `source` spells an ordered marker other than 1 that continues no list
 * open at its column, which cannot interrupt an item's paragraph.
 */
function orderedInItemParagraph(listMarkers: ListMarkers, source: string): boolean {
  const candidate = /^[ \t]*(\d+)[.)](?=[ \t])/.exec(source)
  return candidate !== null && Number(candidate[1]) !== 1 &&
    !listMarkers.hasListAt(indentColumns(source))
}

/** The kind of block the last source line wrote. */
type MarkdownBlockKind = 'blank' | 'heading' | 'list' | 'block_quote' | 'code_fence' | 'code' | 'raw_block' | 'text'

/** What one Markdown conversion carries from line to line. */
interface MarkdownConversion {
  readonly lines: string[]
  readonly dialect: MarkdownDialect
  readonly markdown: string
  readonly sourceLine: (index: number) => number | undefined
  readonly referenceSeparatedLists: ReadonlySet<number>
  readonly hardBlanks: Set<number>
  readonly out: string[]
  terminalHtmlBlock: boolean
  // Where `out` holds a blank line of the source, as opposed to one the
  // conversion put in to separate two blocks.
  readonly sourceBlanks: Set<number>
  // Where `out` holds a thematic break this conversion wrote, so the
  // frontmatter-collision guard in `convertMarkdown` can respell those lines and nothing else.
  readonly breakLines: Set<number>
  inCode: boolean
  fenceChar: string
  fenceLen: number
  // How many leading spaces to strip from the open fence's opener/body/closer,
  // so the migrated fence sits at its container's content column. See the
  // opener handler for how it is derived.
  fenceStrip: number
  // The content column of the list item holding the open fence, 0 outside one.
  fenceCol: number
  // Where the open fence's opener sits in `out`, and its info string. The
  // opener is rewritten at the closer, once the body says how long the
  // backtick fence `carve fmt` writes has to be.
  fenceOut: number
  fenceOpenerPrefix: string
  fenceInfoText: string
  // How far the open fence's item moved (see `ListMarkers`), and whether a
  // blank line put the fence apart from the item content above it.
  fenceShift: number
  fenceAfterBlank: boolean
  // Stack of enclosing list items' content columns (outermost first), so a
  // fence is re-based to the DEEPEST item that still contains it. A Markdown
  // fence indented to a list item's content stays in the item (strip nothing);
  // a document-level 1-3 space fence dedents to column 0.
  readonly listCols: number[]
  // Which source lines GFM reads as part of a table. Answered once, from the
  // SOURCE, because that is where the delimiter row still is - by the time a
  // header has been rewritten to `|=` the row that made it a table is gone.
  // Lines a fence or a container holds get an answer here too and are never
  // asked for it: a fenced line never reaches the text branch below, and a
  // contained one is answered again by `restorePrefixedInlineRun` against what
  // its container holds, marker peeled.
  readonly inGfmTable: boolean[]
  inTableBody: boolean
  tableWidth: number
  readonly listMarkers: ListMarkers
  recentChildKind: { col: number; kind: string } | null
  // The same for the lists a quote holds, kept across the empty quote lines
  // that split a quote into several runs, and dropped when the quote ends.
  readonly quoteMarkers: Map<string, ListMarkers>
  // Was the previous line blank? A dedented line only leaves a list item when a
  // blank precedes it; without a blank it is lazy paragraph continuation and
  // the item stays open (CommonMark).
  prevBlank: boolean
  // Whether the last line left a paragraph open inside a list item, which a
  // lazy line can continue.
  itemParagraph: boolean
  emptyMarkerColumn: number | null
  readonly emptyMarkerLines: Set<number>
  // The quote markers of a quote paragraph the last item line left open, or
  // null. A lazy line continues that paragraph.
  itemQuote: { prefix: string; col: number } | null
  // The content column of the item the last line lazily continued, or -1.
  lazyCol: number
  // Whether the last line ended a fence opened on an item's own line, or a
  // table the item holds: neither takes a lazy line.
  fenceItem: boolean
  // The container column of the last quote written.
  quoteCol: number
  // The lines the current iteration wrote move with the items holding them:
  // those at or past `shiftCol` by `shiftBy` columns. Branches that place their
  // lines themselves set `shiftBy` to 0.
  shiftFrom: number
  shiftCol: number
  shiftBy: number
  prevType: MarkdownBlockKind
  footnoteEnd: number
}

function referenceSeparatedListStarts(
  source: readonly string[], kept: readonly string[], sourceLines: readonly number[],
): Set<number> {
  const starts = new Set<number>()
  const marker = /^([ \t]*)([-*+]|\d+[.)])(?=[ \t])/
  const reference = /^[ \t]*\[[^\]\n]+\]:[ \t]*/
  let previous = -1
  for (let at = 0; at < kept.length; at++) {
    const line = kept[at] ?? ''
    const next = marker.exec(line)
    if (next === null) {
      if (line.trim() !== '' && !reference.test(line)) previous = -1
      continue
    }
    const prior = previous < 0 ? null : marker.exec(kept[previous] ?? '')
    if (prior && prior[1] === next[1] &&
        (prior[2] === next[2] || /^\d/.test(prior[2]!) && /^\d/.test(next[2]!) && prior[2]!.at(-1) === next[2]!.at(-1))) {
      const between = source.slice((sourceLines[previous] ?? -1) + 1, sourceLines[at] ?? 0)
      if (between.some(line => reference.test(line) && indentColumns(line) <= indentColumns(next[1]!)) &&
          between.every(line => line.trim() === '' || reference.test(line))) starts.add(at)
    }
    previous = at
  }
  return starts
}

/** What the phases of one source line hand each other. */
interface MarkdownLine {
  footnote: RegExpExecArray | null
  leftEmptyItem: boolean
  paragraphOpen: boolean
  paragraphColumn: number
  refusedItem: boolean
  line: string
  trimmed: string
  wasPrevBlank: boolean
  lazyAllowed: boolean
  lazyQuote: { prefix: string; col: number } | null
  afterLazy: number
  orderedContinuesItem: boolean
  afterTable: boolean
  leftItems: boolean
  afterFence: boolean
  reachesMovedItem: boolean
  marker: RegExpMatchArray | null
  overMarker: boolean
  contentCol: number
  containerPad: string
  held: string
  startsOwnList: boolean
  isList: boolean
  isHeading: boolean
  indent: number
  relIndent: number
  isBlockquote: boolean
  body: string
}

/** A line's phase values before its phases measure them. */
function blankMarkdownLine(): MarkdownLine {
  return {
    footnote: null,
    leftEmptyItem: false,
    paragraphOpen: false,
    paragraphColumn: 0,
    refusedItem: false,
    line: '',
    trimmed: '',
    wasPrevBlank: false,
    lazyAllowed: false,
    lazyQuote: null,
    afterLazy: -1,
    orderedContinuesItem: false,
    afterTable: false,
    leftItems: false,
    afterFence: false,
    reachesMovedItem: false,
    marker: null,
    overMarker: false,
    contentCol: 0,
    containerPad: '',
    held: '',
    startsOwnList: false,
    isList: false,
    isHeading: false,
    indent: 0,
    relIndent: 0,
    isBlockquote: false,
    body: '',
  }
}

/** A paragraph line at the depth of the items holding it. */
function emitParagraph(st: MarkdownConversion, body: string): string {
  const { listCols } = st
  return emitContainerLine(body, 'paragraph', { listDepth: listCols.length, quoteDepth: 0, prefix: '' }).line
}

/**
 * A table starts only where its delimiter row sits in the container whose
 * paragraph the header line ends, lazily continued or not: a lazy delimiter,
 * or one four columns in, continues the paragraph instead.
 */
function headsTable(st: MarkdownConversion, at: number, col: number): boolean {
  const { lines } = st
  if (!startsTableHeader(lines, at)) return false
  const over = indentColumns(lines[at + 1]!) - col
  return over >= 0 && over < 4
}

/**
 * A pipe line no table takes is paragraph text, so an item paragraph takes it
 * as a lazy line.
 */
function lazyPipeLine(st: MarkdownConversion, at: number, col: number): boolean {
  const { lines } = st
  const text = lines[at]!.trim()
  if (/^(?:>|#{1,6}(?:[ \t]|$))/.test(text) || RE_LIST_MARKER.test(lines[at]!) || isMarkdownFenceLine(text)) return false
  return (isStandardTableRow(lines[at]!) || startsTableHeader(lines, at)) && !headsTable(st, at, col)
}

/**
 * Whether the line at `at` continues the paragraph of an item whose content
 * starts at `col`. What a line opens is measured from the innermost item
 * that holds it, and a setext underline cannot be lazy, so only one in the
 * item makes a heading.
 */
function continuesItemParagraph(st: MarkdownConversion, at: number, col: number): boolean {
  const { lines, listCols } = st
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
  return isParagraphRunLine(pair, 0, 'text') || lazyPipeLine(st, at, col)
}

/**
 * Move the lines the last iteration wrote with the items holding them: those
 * at or past `shiftCol`, by `shiftBy` columns.
 */
function applyShift(st: MarkdownConversion): void {
  const { out } = st
  if (st.shiftBy !== 0) {
    for (let at = st.shiftFrom; at < out.length; at++) {
      out[at] = out[at]!
        .split('\n')
        .map((text) => moveIndent(text, st.shiftCol, st.shiftCol + st.shiftBy))
        .join('\n')
    }
  }
  st.shiftFrom = out.length
  st.shiftBy = 0
}

/**
 * Respell line `i` before its block is read: a footnote definition as the list
 * item that reads it, the marker of an empty item, a tab after a marker.
 */
function prepareMarkdownLine(st: MarkdownConversion, ln: MarkdownLine, i: number): void {
  const { lines, sourceLine, listCols, inGfmTable, listMarkers, emptyMarkerLines } = st
  applyShift(st)
  if (lines[i]!.trim() === '' || listCols.length === 0) st.recentChildKind = null
  inlineRunSourceLine = sourceLine(i)
  if (i === st.footnoteEnd) {
    // Markdown starts a new list here. Carve keeps a marker in an open note
    // paragraph, so carry the source block boundary into the output.
    if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/.test(lines[i]!)) {
      if (st.out.at(-1)?.trim() !== '') st.out.push('')
      st.prevBlank = true
      // The source list is at document level even with three optional spaces.
      lines[i] = lines[i]!.replace(/^ {1,3}(?=(?:[-*+]|\d{1,9}[.)])[ \t])/, '')
    }
    listCols.length = 0
    listMarkers.leave(0)
    st.itemParagraph = false
    st.itemQuote = null
    st.footnoteEnd = -1
  }
  ln.footnote = !st.inCode && (listCols.length === 0 || indentColumns(lines[i]!) < listCols[0]!)
      ? /^ {0,3}(\[\^((?:[^\[\]\\]|\\.)+)\]:)[ \t]*(.*)$/.exec(lines[i]!)
      : null
  if (ln.footnote !== null) {
    let end = i + 1
    let last = end
    const interrupts = (text: string): boolean =>
      isMarkdownFenceLine(text) || RE_MD_THEMATIC.test(text) || interruptingHtmlBlock(text) ||
      /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|\[\^(?:[^\[\]\\]|\\.)+\]:)/.test(text)
    let paragraph = ln.footnote[3]!.trim() !== '' && !interrupts(ln.footnote[3]!)
    let fence: string | null = isMarkdownFenceLine(ln.footnote[3]!) ? RE_MD_FENCE_LINE.exec(ln.footnote[3]!)![2]! : null
    let htmlEnd = -1
    const htmlThrough = (body: string, at: number): number => {
      if (!body.trimStart().startsWith('<')) return -1
      const held = [body]
      for (let next = at + 1; next < lines.length; next++) {
        if (lines[next]!.trim() !== '' && indentColumns(lines[next]!) < 4) break
        held.push(stripColumns(lines[next]!, 4))
      }
      const html = htmlBlockAt(held, 0)
      return html === null ? -1 : at + html.end
    }
    if (fence === null) {
      htmlEnd = htmlThrough(ln.footnote[3]!, i)
      if (htmlEnd >= i) paragraph = false
    }
    while (end < lines.length) {
      const text = lines[end]!
      if (text.trim() !== '') {
        const indented = indentColumns(text) >= 4
        const body = indented ? stripColumns(text, 4) : text
        if (!indented && (!paragraph || interrupts(body))) break
        const marker = RE_MD_FENCE_LINE.exec(body)
        if (end <= htmlEnd) {
          paragraph = false
        } else if (fence !== null) {
          if (marker && marker[2]![0] === fence[0] && marker[2]!.length >= fence.length && marker[3]!.trim() === '') fence = null
          paragraph = false
        } else if (isMarkdownFenceLine(body)) {
          fence = marker![2]!
          paragraph = false
        } else {
          htmlEnd = !paragraph || interruptingHtmlBlock(body) ? htmlThrough(body, end) : -1
          paragraph = htmlEnd < end && !interrupts(body) && (paragraph || indentColumns(body) < 4)
        }
        last = end + 1
      } else paragraph = false
      end++
    }
    // Reuse the list container reader, rebasing Markdown's four columns to Carve's two.
    lines[i] = `- ${ln.footnote[3] || '+'}`
    for (let at = i + 1; at < last; at++) {
      if (lines[at]!.trim() !== '') lines[at] = '  ' + stripColumns(lines[at]!, Math.min(4, indentColumns(lines[at]!)))
    }
    st.footnoteEnd = last
    listCols.length = 0
    listMarkers.leave(0)
    const bodyTables = gfmTableRowLines(lines.slice(i, last))
    for (let at = i; at < last; at++) inGfmTable[at] = bodyTables[at - i]!
  }
  ln.leftEmptyItem = false
  if (!st.inCode && st.emptyMarkerColumn !== null && lines[i]!.trim() !== '') {
    if (st.prevBlank && indentColumns(lines[i]!) > st.emptyMarkerColumn) {
      while (listCols.length && listCols.at(-1)! > st.emptyMarkerColumn) listCols.pop()
      listMarkers.end(st.emptyMarkerColumn)
      ln.leftEmptyItem = true
    }
    st.emptyMarkerColumn = null
  }
  ln.paragraphOpen = !st.prevBlank && (st.itemParagraph || st.prevType === 'text' && !st.inTableBody)
  ln.paragraphColumn = listCols.at(-1) ?? 0
  ln.refusedItem = !st.inCode && sourceItem(lines[i]!) !== null &&
    !opensInterruptingItem(lines[i]!, ln.paragraphOpen, ln.paragraphColumn)
  // A tab after the marker of an item this line opens pads it to the next
  // tab stop. Not on a line four columns past the item holding it, which is
  // code or text, nor on an ordered marker other than 1 under a paragraph.
  if (!st.inCode && /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/.test(lines[i]!) && lines[i]!.includes('\t')) {
    const at = indentColumns(lines[i]!)
    let holder = 0
    for (const col of listCols) if (col <= at) holder = col
    const ordered = /^[ \t]*(\d+)[.)]/.exec(lines[i]!)
    const prose = ln.refusedItem || st.prevType === 'text' && ordered !== null && Number(ordered[1]) !== 1 && !listMarkers.hasListAt(at)
    if (at - holder < 4 && !prose) lines[i] = spaceMarkerPadding(lines[i]!)
  }
  // Carve needs the first-block marker for an empty item. Empty markers
  // cannot interrupt a paragraph; a dash there remains a setext underline.
  if (!st.inCode && /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]*$/.test(lines[i]!)) {
    const column = indentColumns(lines[i]!)
    let holder = 0
    for (const content of listCols) if (content <= column) holder = content
    if (!ln.refusedItem && column - holder < 4 && (st.prevType !== 'text' || listMarkers.hasListAt(column))) {
      lines[i] = lines[i]!.trimEnd() + ' +'
      emptyMarkerLines.add(i)
      if (lines[i + 1]?.trim() === '') st.emptyMarkerColumn = column
    }
  }
}

/**
 * Take the state the last line left for line `i`, and keep the stack of open
 * list items' content columns.
 */
function trackListItems(st: MarkdownConversion, ln: MarkdownLine, i: number): void {
  const { lines, out, listCols, listMarkers, quoteMarkers } = st
  const { refusedItem } = ln
  ln.line = lines[i]!
  ln.trimmed = ln.line.trim()
  ln.wasPrevBlank = st.prevBlank
  ln.lazyAllowed = st.itemParagraph
  st.itemParagraph = false
  ln.lazyQuote = st.itemQuote
  st.itemQuote = null
  ln.afterLazy = st.lazyCol
  st.lazyCol = -1
  ln.orderedContinuesItem = !ln.wasPrevBlank && ln.lazyAllowed && listCols.length > 0 &&
    orderedInItemParagraph(listMarkers, ln.line)
  const closedItem = st.fenceItem
  ln.afterTable = st.inTableBody
  // Whether this line left items no paragraph was open in.
  ln.leftItems = false
  ln.afterFence = st.prevType === 'code_fence' || st.fenceItem
  st.fenceItem = false
  st.prevBlank = ln.trimmed === ''
  if (!ln.trimmed.startsWith('>')) quoteMarkers.clear()
  ln.reachesMovedItem = ln.trimmed !== '' && listMarkers.reachedByMove(indentColumns(ln.line))

  // Maintain the list-item content-column stack. A marker opens an item whose
  // content starts after the marker (the task checkbox is content, so its
  // width is NOT part of the column); a blank line is transparent (a loose
  // item continues); a non-blank line pops items whose content starts to its
  // right. Code content never changes list tracking.
  ln.marker = null
  ln.overMarker = false
  if (!st.inCode) {
    // A thematic break wins over a list item on a line that could be read as
    // either (CommonMark: `* * *` is a rule, not a bullet holding `* *`).
    // Counted as a marker its columns became a content column, and the rule
    // itself - and every block after it - was padded out to them.
    let openCol = 0
    for (const col of listCols) if (col <= indentColumns(ln.line)) openCol = col
    ln.marker = RE_MD_THEMATIC.test(stripColumns(ln.line, openCol))
      ? null
      : ln.line.match(/^([ \t]*)(?:[-*+]|\d+[.)]) +/)
    if (ln.orderedContinuesItem || refusedItem) ln.marker = null
    // Four columns past the item holding it, a marker under an open
    // paragraph is text of that paragraph (indented code cannot interrupt).
    const anyMarker = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/.exec(ln.line)
    if (anyMarker && (ln.lazyAllowed || ln.lazyQuote !== null)) {
      const markerIndent = columnWidth(anyMarker[1]!)
      let parentContent = 0
      for (const col of listCols) if (col <= markerIndent) parentContent = col
      if (markerIndent >= parentContent + 4) {
        ln.marker = null
        ln.overMarker = true
      }
    }
    // Anywhere else, four columns past the item holding it a marker line is
    // indented code, never an item.
    if (anyMarker && !ln.overMarker) {
      const markerIndent = columnWidth(anyMarker[1]!)
      let parentContent = 0
      for (const col of listCols) if (col <= markerIndent) parentContent = col
      if (markerIndent >= parentContent + 4) ln.marker = null
    }
    // Columns, not characters: the stack is compared against a line's indent
    // and a tab is worth four of them.
    const indent = indentColumns(ln.line)
    // A dedented line leaves a list item when a blank precedes it OR the line
    // itself starts a block (heading, block quote, fence, thematic break) --
    // those interrupt lazy paragraph continuation, so the item ends (§10).
    // Four columns past the item holding it, an opener starts nothing.
    let holder = 0
    for (const col of listCols) if (col <= indent) holder = col
    const startsBlock =
      indent - holder < 4 &&
      (/^#{1,6}([ \t]|$)/.test(ln.trimmed) ||
      ln.trimmed.startsWith('>') ||
      isMarkdownFenceLine(ln.trimmed) ||
      htmlBlockAt(lines, i) !== null ||
      RE_MD_THEMATIC.test(ln.trimmed))
    // A block a fence or table ended every item for is set apart from the
    // list, as fmt writes it.
    if (closedItem && ln.trimmed !== '' && !ln.marker && listCols.length && listCols[0]! > indent && out.at(-1)?.trim() !== '') {
      out.push('')
    }
    // Only a paragraph takes a lazy line, so after any other block a line
    // left of the item's content leaves it.
    const noLazy = !ln.lazyAllowed && ln.lazyQuote === null && (st.prevType === 'list' || st.prevType === 'heading')
    if (ln.marker && /\S/.test(ln.line.slice(ln.marker[0].length))) {
      const markerIndent = columnWidth(ln.marker[1]!)
      while (listCols.length && listCols[listCols.length - 1]! > markerIndent) listCols.pop()
      listCols.push(itemContentColumn(ln.marker[0]!))
      // And the items the line nests (`- - a`), the innermost perhaps holding
      // indented code.
      const nested = nestedItemsOnLine(ln.line, ln.marker[0].length)
      for (const inner of nested) listCols.push(inner.content)
      const nestedEnd = nested.at(-1)?.end ?? ln.marker[0].length
      const codeItem = /^(?:[-*+]|\d{1,9}[.)])(?= {5,}\S)/.exec(ln.line.slice(nestedEnd))
      if (codeItem && itemContentColumn(ln.marker[0]!) === columnWidth(ln.marker[0]!)) {
        listCols.push(columnWidth(ln.line.slice(0, nestedEnd + codeItem[0].length)) + 1)
      }
    } else if (ln.trimmed !== '' && (ln.wasPrevBlank || startsBlock || ln.afterFence || noLazy)) {
      while (listCols.length && listCols[listCols.length - 1]! > indent) {
        listCols.pop()
        ln.leftItems = noLazy
      }
    }
    if (ln.trimmed !== '' && !ln.marker) listMarkers.end(listCols.length ? listCols[listCols.length - 1]! : 0)
    // A line left of an item whose last block was a fence ends the item's
    // list, a fence taking no lazy line; an item after it numbers from its
    // own marker.
    if (ln.trimmed !== '' && !ln.marker && ln.afterFence && listCols.length && indent < listCols[listCols.length - 1]!) {
      listMarkers.leave(indent)
    }
  }

  // The column at which the innermost open container holds its content, and
  // the padding that puts a block back there. Every block branch below both
  // MEASURES from here and WRITES BACK to here: a line is indented code only
  // four columns past it, Markdown's 0-3 space slack is counted from it, and
  // an emitted block that ignores it leaves the item that held it. Nothing on
  // the stack means column 0, the document itself.
  ln.contentCol = listCols.length ? listCols[listCols.length - 1]! : 0
  ln.containerPad = ' '.repeat(ln.contentCol)
  // What that container holds on this line, its content column removed. The
  // block tests run against this rather than the raw line.
  ln.held = stripColumns(ln.line, ln.contentCol)
  st.shiftCol = st.inCode ? st.fenceCol : ln.contentCol
  st.shiftBy = st.inCode ? st.fenceShift : listMarkers.shiftAt(ln.contentCol)
}

/**
 * Write line `i` where it continues an item's paragraph: as text, lazily, or
 * four columns past a marker. The index to resume at, or undefined.
 */
function writeItemContinuation(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, dialect, out, listCols, listMarkers } = st
  const { paragraphColumn, refusedItem, line, trimmed, lazyAllowed, lazyQuote, afterLazy, marker, overMarker, contentCol, containerPad } = ln
  if (refusedItem && indentColumns(line) >= paragraphColumn) {
    const body = paragraphLineText(stripColumns(line, paragraphColumn))
    const markerBody = sourceItem(body)?.content ?? ''
    const text = markerBody.trim() === '' ? body.trimEnd() : escapeBlockOpener(body)
    out.push(convertInline(' '.repeat(paragraphColumn) + text, dialect))
    st.itemParagraph = listCols.length > 0
    st.prevType = 'text'
    return i
  }

  if (overMarker) {
    const text = escapeBlockOpener(line.trimStart())
    if (lazyQuote !== null) {
      st.shiftCol = lazyQuote.col
      st.shiftBy = listMarkers.shiftAt(lazyQuote.col)
      out.push(convertInline(' '.repeat(lazyQuote.col) + lazyQuote.prefix + text, dialect, false, false, undefined, i + 1 >= lines.length || !continuesItemParagraph(st, i + 1, contentCol)))
      st.itemQuote = lazyQuote
    } else {
      out.push(convertInline(containerPad + text, dialect, false, false, undefined, i + 1 >= lines.length || !continuesItemParagraph(st, i + 1, contentCol)))
      st.itemParagraph = true
    }
    st.prevType = 'list'
    return i
  }

  // A lazy line continues the paragraph of the item above it (CommonMark
  // 5.2), and is written at that item's content column, as fmt writes it.
  if (
    (lazyAllowed || lazyQuote !== null) &&
    !st.inCode &&
    !marker &&
    listCols.length > 0 &&
    indentColumns(line) < contentCol &&
    continuesItemParagraph(st, i, contentCol)
  ) {
    const run: string[] = []
    let end = i
    // Under a quote the item holds, every line continues the quote, at the
    // quote's column.
    if (lazyQuote !== null) {
      st.shiftCol = lazyQuote.col
      st.shiftBy = listMarkers.shiftAt(lazyQuote.col)
    }
    while (
      end < lines.length &&
      (!RE_LIST_MARKER.test(lines[end]!) || orderedInItemParagraph(listMarkers, lines[end]!)) &&
      continuesItemParagraph(st, end, contentCol)
    ) {
      const next = lines[end]!
      let holder = 0
      for (const col of listCols) if (col <= indentColumns(next)) holder = col
      const lazyText = indentColumns(next) - holder >= 4 || orderedInItemParagraph(listMarkers, next)
        ? escapeBlockOpener(next.trimStart()) : next.trimStart()
      if (lazyQuote !== null) run.push(' '.repeat(lazyQuote.col) + lazyQuote.prefix + lazyText)
      else run.push(indentColumns(next) < contentCol ? containerPad + lazyText
        : orderedInItemParagraph(listMarkers, next) || indentColumns(next) - holder >= 4
          ? ' '.repeat(indentColumns(next)) + lazyText : next)
      end++
    }
    out.push(keepPipeRowsLiteral(convertInline(run.join('\n'), dialect)))
    i = end - 1
    st.itemParagraph = true
    st.itemQuote = lazyQuote
    st.lazyCol = contentCol
    st.prevType = 'list'
    return i
  }
  // Past a lazy line, what the item holds reads as after the item line. A
  // block left of the item follows a paragraph instead, except an item of a
  // list open at its column; any other marker there starts a list of its
  // own, whatever its number, since it is outside the paragraph's item.
  ln.startsOwnList = false
  if (afterLazy >= 0 && trimmed !== '' && indentColumns(line) < afterLazy) {
    const isMarker = RE_LIST_MARKER.test(line)
    if (!isMarker || !listMarkers.hasListAt(indentColumns(line))) {
      st.prevType = 'text'
      ln.startsOwnList = isMarker
    }
  }
  return undefined
}

/** Open, carry or close a fenced code block. The index to resume at, or undefined. */
function writeFenceLine(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, sourceLine, out } = st
  const { line, trimmed, wasPrevBlank, contentCol, containerPad, held } = ln
  // Opening fence — a >=3 run of ` or ~, indented at most 3 spaces (the
  // Markdown rule). Carve accepts a single language token over a real-world
  // charset (c++, c#, asp.net, text/html are valid), so the Markdown info
  // string is normalized to its first such token — keeping `c++`/`text/html`
  // intact and reducing an extended info (```js title="x") to ```js (still a
  // code block). The charset matches RE_FENCE in parse.ts, including `/`.
  // Four columns past the container, a tab counted where it stands, the line
  // is indented code.
  const open = !st.inCode && indentColumns(line) - contentCol < 4 ? RE_MD_FENCE_LINE.exec(held) : null
  if (open && fenceRunIsAFence(open[2]!, open[3]!)) {
    // A fence interrupts the paragraph of the item holding it.
    if (st.prevType !== 'blank' && !(contentCol > 0 && (st.prevType === 'list' || st.prevType === 'block_quote')) && out.length > 0) out.push('')
    st.inCode = true
    st.fenceChar = open[2]![0]!
    st.fenceLen = open[2]!.length
    const info = fenceInfo(open[3]!, sourceLine(i))
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
    st.fenceStrip = Math.max(0, indentColumns(line) - contentCol)
    st.fenceCol = contentCol
    st.fenceShift = st.shiftBy
    st.fenceAfterBlank = wasPrevBlank && contentCol > 0
    // Whatever the opener's own indent was, what survives the strip is
    // exactly the content column, so the fence goes back there.
    const emptyItem = columnWidth(containerPad) === contentCol && contentCol > 0 && lines[i - 1]?.trim() !== '' ? RE_EMPTY_ITEM_PLACEHOLDER.exec(out.at(-1) ?? '') : null
    const folded = emptyItem ? foldEmptyItemBody('+', open[2]! + info, true) : null
    st.fenceOpenerPrefix = folded?.consumeNext ? emptyItem![1]! : ''
    st.fenceOut = st.fenceOpenerPrefix ? out.length - 1 : out.length
    st.fenceInfoText = info
    if (st.fenceOpenerPrefix) out[st.fenceOut] = st.fenceOpenerPrefix + open[2]! + info
    else out.push(containerPad + open[2]! + info)
    st.prevType = 'code_fence'
    return i
  }

  // Inside a fence — a closer is a run of the same char at least as long as
  // the opener (indented by at most 3 spaces); a shorter inner run is code.
  if (st.inCode) {
    // A fence cannot continue lazily, so a line left of its item's content
    // ends the item and the fence with it (CommonMark 5.2).
    if (trimmed !== '' && indentColumns(line) < st.fenceCol) {
      st.shiftBy = 0
      out.push(closeFence(out, st.fenceOut, ' '.repeat(st.fenceCol + st.fenceShift), st.fenceInfoText, st.fenceOpenerPrefix))
      st.fenceOpenerPrefix = ''
      st.inCode = false
      st.fenceChar = ''
      st.fenceLen = 0
      st.fenceStrip = 0
      st.fenceCol = 0
      st.prevType = 'code_fence'
      i--
      return i
    }
    // The strip comes off past the content column, which the body keeps.
    const dedented =
      line.trim() === ''
        ? stripColumns(line, st.fenceStrip)
        : ' '.repeat(st.fenceCol) + stripColumns(line, Math.min(indentColumns(line), st.fenceCol + st.fenceStrip))
    // CommonMark 4.5: a closing fence is followed only by spaces or tabs.
    if (new RegExp(`^[ \\t]{0,3}(${st.fenceChar}{${st.fenceLen},})[ \\t]*$`).test(stripColumns(line, st.fenceCol))) {
      st.inCode = false
      st.fenceChar = ''
      st.fenceLen = 0
      st.fenceStrip = 0
      st.shiftBy = 0
      out.push(closeFence(out, st.fenceOut, ' '.repeat(st.fenceCol + st.fenceShift), st.fenceInfoText, st.fenceOpenerPrefix))
      st.fenceOpenerPrefix = ''
      // A source blank before the fence makes a following line in that item
      // a separate block. Without it, keep the item tight.
      const next = lines[i + 1]
      const nextIndent = next === undefined ? 0 : indentColumns(next)
      const nextIsItem = next !== undefined && /^[ \t]*(?:[-*+]|\d+[.)])(?=[ \t]|$)/.test(next)
      const staysTight = nextIndent > 0 &&
        (nextIndent < st.fenceCol || !st.fenceAfterBlank)
      if (next !== undefined && next.trim() !== '' && !nextIsItem && !staysTight) out.push('')
      st.prevType = 'code_fence'
    } else {
      out.push(dedented)
      st.prevType = 'code'
    }
    return i
  }
  return undefined
}

/**
 * Write an HTML block or indented code, held by a container or not, as a
 * fence. The index to resume at, or undefined.
 */
function writeHeldBlock(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, markdown, out, listCols, listMarkers, quoteMarkers, emptyMarkerLines } = st
  const { trimmed, wasPrevBlank, afterTable, leftItems, afterFence, contentCol } = ln
  // An HTML block held by a container: a raw fence carrying the container's
  // own prefix, so the block stays where the source put it. Placed BEFORE the
  // indented-code branch, because a line four columns in is code only when
  // those columns are four past its container's content column - inside a
  // nested item whose content starts at column 4 it is an ordinary block.
  const contained = containerHtmlBlockAt(lines, i, listCols, quoteMarkers)
  if (contained) {
    const converted = markdownHtmlBlock(contained.lines, st.sourceLine(i))
    const prefix = contained.prefix.includes('>') ? contained.prefix
      : ' '.repeat(Math.max(0, contentCol + listMarkers.shiftAt(contentCol)))
    for (const [offset, emitted] of converted.entries()) {
      const linePrefix = offset === 0 ? contained.openerPrefix ?? prefix : prefix
      out.push(emitted === '' ? linePrefix.trimEnd() : linePrefix + emitContainerLine(emitted, 'verbatim', {
        listDepth: listCols.length, quoteDepth: quoteDepth(prefix), prefix,
        hosts: emissionHosts(prefix),
      }).line)
    }
    const nextQuote = contained.prefix.includes('>') && lines[contained.end + 1] !== undefined
      ? blockquotePrefix(stripOptionalQuoteIndent(stripColumns(lines[contained.end + 1]!, contentCol)))
      : null
    const nextRawBlock = nextQuote !== null
      ? containerHtmlBlockAt(lines, contained.end + 1, listCols) : null
    const currentQuote = blockquotePrefix(stripOptionalQuoteIndent(stripColumns(lines[i]!, contentCol)))
    const quotedItem = currentQuote !== null && quotedItemColumn(
      line => stripOptionalQuoteIndent(stripColumns(line, contentCol)), lines, i, currentQuote.prefix,
    ) > 0
    const adjacentItemRawBlock = nextRawBlock !== null && nextQuote?.prefix === currentQuote?.prefix &&
      (listCols.length > 0 || quotedItem)
    const nextIndex = contained.end + 1
    const sourceItemCol = quotedItemColumns(lines)[i] ?? 0
    const sameSourceItem = sourceItemCol > 0 && (quotedItemColumns(lines)[nextIndex] ?? 0) >= sourceItemCol
    if (nextQuote !== null && nextQuote.text.trim() !== '' && !adjacentItemRawBlock && !sameSourceItem) {
      const separatorPrefix = quoteDepth(nextQuote.prefix) < quoteDepth(contained.prefix)
        ? nextQuote.prefix : contained.prefix
      out.push(emitContainerLine('', 'separator', {
        listDepth: listCols.length, quoteDepth: quoteDepth(separatorPrefix),
        prefix: separatorPrefix.trimEnd(), hosts: emissionHosts(separatorPrefix),
      }).line)
    }
    i = contained.end
    if (markdown.endsWith('\n') && i >= lines.length - 2) st.terminalHtmlBlock = true
    st.prevType = contained.prefix.trimStart().startsWith('>') ? 'block_quote' : 'list'
    return i
  }

  // Indented code a block quote holds. Placed before the indented-code branch
  // below, which measures from column 0 and so never fires on a line that
  // begins with `>`, and after the HTML one, which reads the same content and
  // is the narrower match.
  const quotedCode = quotedIndentedCodeAt(lines, i, contentCol)
  if (quotedCode) {
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(quotedCode.lines.join('\n')) + 1))
    // A quote interrupts the paragraph of the item holding it.
    const inItem = st.prevType === 'list' && contentCol > 0
    if (st.prevType !== 'blank' && st.prevType !== 'block_quote' && !inItem && out.length > 0) out.push('')
    for (const emitted of [fence, ...quotedCode.lines, fence]) {
      out.push(emitted === '' ? quotedCode.prefix.trimEnd() : quotedCode.prefix + emitted)
    }
    // A block after the code in the same quote, or in one nested or around
    // it, is set apart from it by an empty line of the outer quote.
    const after = quotedCode.end < lines.length ? blockquotePrefix(stripOptionalQuoteIndent(stripColumns(lines[quotedCode.end]!, contentCol))) : null
    if (after !== null && after.text.trim() !== '') {
      const outer = ' '.repeat(contentCol) + (after.prefix.length < quotedCode.prefix.length - contentCol ? after.prefix : quotedCode.prefix.slice(contentCol))
      out.push(outer.trimEnd())
    }
    i = quotedCode.end - 1
    st.quoteCol = contentCol
    st.prevType = 'block_quote'
    return i
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
    (emptyMarkerLines.has(i - 1) || wasPrevBlank || st.prevType === 'blank' || st.prevType === 'code' || st.prevType === 'heading' || st.prevType === 'block_quote' || afterFence || afterTable || leftItems) &&
    trimmed !== '' &&
    // Measured on the line, as `relIndent` below is.
    indentColumns(ln.line) - contentCol >= 4
  ) {
    const block = collectIndentedCode(lines, i, contentCol)
    const sibling = /^([ \t]*)([-*+]|\d+[.)])(?=[ \t]|$)/.exec(lines[block.end] ?? '')
    if (emptyMarkerLines.has(i - 1) && sibling && listMarkers.continues(columnWidth(sibling[1]!), sibling[2]!.slice(-1)) && block.lines.at(-1) === '') block.lines.pop()
    if (st.prevType !== 'blank' && out.length > 0 && !emptyMarkerLines.has(i - 1)) out.push('')
    out.push(...block.lines)
    i = block.end - 1
    st.prevType = 'code_fence'
    return i
  }

  const htmlBlock = htmlBlockAt(lines, i)
  if (htmlBlock) {
    if (st.prevType !== 'blank' && out.length > 0) out.push('')
    out.push(...markdownHtmlBlock(htmlBlock.lines, st.sourceLine(i)))
    i = htmlBlock.end
    if (markdown.endsWith('\n') && i >= lines.length - 2) st.terminalHtmlBlock = true
    if (i + 1 === lines.length - 1 && lines[i + 1] === '') {
      out.push('')
      i++
    } else if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
    st.prevType = 'raw_block'
    return i
  }
  return undefined
}

/** Write a GFM table header or body row. The index to resume at, or undefined. */
function writeTableLine(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, dialect, sourceLine, out, inGfmTable, listMarkers } = st
  const { paragraphOpen, refusedItem, line, trimmed, orderedContinuesItem, contentCol, containerPad, startsOwnList } = ln
  // An ordered marker other than `1` cannot interrupt a paragraph
  // (CommonMark), so after a paragraph it stays prose; bullets and `1.`
  // always start/continue a list. Mid-list, any number continues.
  const ordered = trimmed.match(/^(\d+)[.)][ \t]/)
  ln.isList = (/^[-*+][ \t]/.test(trimmed) || ordered !== null) &&
    !refusedItem &&
    !orderedContinuesItem &&
    !(
      paragraphOpen &&
      !startsOwnList &&
      ordered !== null &&
      Number(ordered[1]) !== 1 &&
      // The next item of an open list is one, whatever its number.
      !listMarkers.hasListAt(indentColumns(line))
    )
  // A header GFM would not take here leaves its rows as text.
  if (inGfmTable[i] && startsTableHeader(lines, i) && !headsTable(st, i, contentCol)) {
    for (let at = i; at < lines.length && inGfmTable[at]; at++) inGfmTable[at] = false
  }
  // GFM table header: a `| ... |` row immediately followed by a delimiter
  // row (`| --- | :--: |`). Carve marks header cells with `|=` (alignment
  // glued as `<`/`>`/`~`) and needs no delimiter row, so rewrite the header
  // and drop the delimiter. Body rows are already valid Carve and fall
  // through as plain text below, so only the header is special-cased here.
  // An item or quote line is left to its collector, which finds a table the
  // item or quote holds.
  if (!ln.isList && !trimmed.startsWith('>') && !/^#{1,6}([ \t]|$)/.test(trimmed) && headsTable(st, i, contentCol)) {
    const next = lines[i + 1]!.trim()
    if (next.includes('-') && RE_TABLE_DELIMITER.test(next)) {
      const headerCells = splitTableRow(trimmed)
      const aligns = splitTableRow(next).map(alignMarker)
      // GFM requires the delimiter row to have the same column count as the
      // header; a mismatch (e.g. `a | b` over `---`) is not a table, so leave
      // it for the setext/thematic-break handling below.
      if (aligns.length === headerCells.length) {
        const delimiterNeeded = headerCells.some((cell, column) => cell.trim() === '' && aligns[column] === '<')
        const header = writeTableRow(headerCells, delimiterNeeded ? [] : aligns.map((align) => `=${align}`), dialect)
        if (st.prevType !== 'blank' && out.length > 0) out.push('')
        // At the container's content column, so the converted header keeps
        // the item that holds it. Written at column 0 it left the item while
        // the body rows stayed behind, splitting one table into two blocks.
        if (keepTableHeader(header, sourceLine(i))) {
          out.push(containerPad + header)
          if (delimiterNeeded) out.push(containerPad + next)
        }
        i++ // consume the delimiter row
        st.prevType = 'text'
        st.inTableBody = true
        st.tableWidth = headerCells.length
        return i
      }
    }
  }

  // A body row of the table above. Rebuilt rather than passed through, so its
  // padding matches the formatter's and a pipeless row stays in the table.
  if (st.inTableBody && inGfmTable[i] && trimmed !== '') {
    const row = writeTableRow(splitTableRow(trimmed), [], dialect, st.tableWidth)
    out.push(containerPad + row)
    return i
  }
  st.inTableBody = false
  return undefined
}

/**
 * Write a blank line, indented code, or a line an open list item holds. The
 * index to resume at, or undefined.
 */
function writeItemHeldLine(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, dialect, sourceLine, out, sourceBlanks, listCols, listMarkers, quoteMarkers, emptyMarkerLines } = st
  const { paragraphOpen, paragraphColumn, line, trimmed, lazyQuote, afterLazy, orderedContinuesItem, afterTable, contentCol, containerPad, held, isList } = ln
  const isBlank = trimmed === ''
  ln.isHeading = /^#{1,6}(?:[ \t]|$)/.test(trimmed)
  ln.indent = line.length - line.replace(/^\s+/, '').length
  // How far the line sits PAST its container's content column - the measure
  // Markdown's 0-3 space slack and its four-column code rule are both stated
  // in. `indent` is the absolute one, which is the same number only at the
  // document level.
  // Measured on the line: a tab `held` starts with is narrower than four
  // columns when the content column is not on a tab stop.
  ln.relIndent = Math.max(0, indentColumns(line) - contentCol)
  ln.isBlockquote = trimmed.startsWith('>')

  if (isBlank) {
    sourceBlanks.add(out.length)
    out.push(line)
    st.prevType = 'blank'
    return i
  }

  if (ln.relIndent >= 4 && (st.prevType === 'blank' || st.prevType === 'code')) {
    out.push(line)
    st.prevType = 'code'
    return i
  }

  // Indented content directly under a list item (a nested sublist, an
  // indented blockquote/heading, or a lazy continuation) belongs to that
  // item. Carve keeps it there by indentation, so pass it through with
  // inline conversion only — no top-level block spacing or dedent.
  if (st.prevType === 'list' && ln.indent >= 1 && listCols.length > (isList ? 1 : 0)) {
    if (isList) {
      reportOrderedTask(line, sourceLine(i))
      const run = collectListInlineRun(lines, i, dialect, emptyMarkerLines.has(i))
      const item = sourceItem(line)
      const kind = item?.bullet ?? item?.delimiter ?? ''
      if ((afterTable || listCols.length === 0 && isStandardTableRow(out.at(-1) ?? '') || paragraphOpen && st.recentChildKind?.col === indentColumns(line) && st.recentChildKind.kind !== kind && !RE_LIST_MARKER.test(out.at(-1) ?? '')) && out.at(-1)?.trim() !== '') out.push('')
      if (lazyQuote !== null && indentColumns(line) >= lazyQuote.col) out.push('')
      const fold = lines[i + 1]?.trim() !== '' && !RE_MD_SETEXT_UNDERLINE.test(lines[i + 1] ?? '')
      out.push(...writeItemRun(run, listMarkers, true, fold, emptyMarkerLines.has(i), paragraphOpen, paragraphColumn).lines)
      if (listCols.length > 1 && run.verbatimFrom !== undefined) st.recentChildKind = { col: indentColumns(line), kind }
      st.shiftBy = 0
      st.itemParagraph = !emptyMarkerLines.has(i) && leavesItemParagraph(run)
      st.itemQuote = leavesItemQuote(run)
      st.fenceItem = run.verbatimFrom !== undefined || endsInTable(run)
      i = run.end - 1
      st.prevType = 'list'
      return i
    }
    // One to three columns past the item's content read as none.
    const slack = ln.relIndent
    // A fence a quote opens here is the quote collector's to write and close.
    const quoted = blockquotePrefix(held.trimStart())
    const prevInItem = i > 0 && lines[i - 1]!.trim() !== '' && indentColumns(lines[i - 1]!) >= contentCol
    if (
      // `lazyQuote` is the quote the item run above left open, which is where
      // this fence stands when the item's own marker line opened that quote:
      // `prevInItem` cannot see that line, since a marker line sits LEFT of
      // the content column it establishes (carve-js#2028).
      (afterLazy >= 0 || prevInItem || lazyQuote !== null || listCols.includes(contentCol)) &&
      indentColumns(line) >= contentCol &&
      slack < 4 &&
      quoted !== null &&
      isMarkdownFenceLine(quoted.text)
    ) {
      const run = collectBlockquoteInlineRun(lines, i, dialect, contentCol, quoteMarkers)
      st.quoteCol = contentCol
      if (run.blank) sourceBlanks.add(out.length)
      // The paragraph this fence interrupts is on the item's own marker line,
      // so it is not in this run and the collector cannot set the two apart
      // the way `fmt` does.
      if (lazyQuote !== null) out.push(' '.repeat(contentCol) + quoted.prefix.trimEnd())
      out.push(...run.lines)
      i = run.end - 1
      st.prevType = 'block_quote'
      return i
    }
    const content = slack >= 1 && slack <= 3 ? containerPad + held.trimStart() : line
    const written = convertInline(orderedContinuesItem
      ? content.replace(/^(\s*)(\S.*)$/, (_match, indent: string, body: string) => indent + escapeBlockOpener(body))
      : content, dialect, false, false, undefined, i + 1 >= lines.length || !continuesItemParagraph(st, i + 1, contentCol))
    // No table starts here, so a pipe row is paragraph text, in a quote too
    // unless a delimiter row makes it a quoted table.
    const pipeText = isStandardTableRow(written)
    const quotedBody = (text: string | undefined): string =>
      peelQuoteMarkers(stripColumns(text ?? '', contentCol).trimStart()).body.trim()
    const quotedTable = [quotedBody(line), quotedBody(lines[i + 1])].some((body) => RE_TABLE_DELIMITER.test(body) && body.includes('-'))
    out.push(RE_MD_THEMATIC.test(held) ? containerPad + emitContainerLine(held.trim(), 'break', {
      listDepth: listCols.length, quoteDepth: 0, prefix: containerPad, hosts: emissionHosts(containerPad),
    }).line : pipeText ? keepPipeRowLiteral(written) : quotedTable ? written : keepPipeRowsLiteral(written))
    st.itemParagraph = indentColumns(line) >= contentCol && (pipeText || opensParagraph(held))
    const quote = indentColumns(line) >= contentCol ? openQuoteParagraph(held) : null
    if (quote !== null) st.itemQuote = { prefix: quote, col: contentCol }
    st.prevType = 'list'
    return i
  }
  return undefined
}

/** Write a setext heading or a thematic break, quoted or not. The index to resume at, or undefined. */
function writeBreakLine(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, dialect, out, breakLines } = st
  const { line, contentCol, containerPad, held, isList, isHeading, isBlockquote } = ln
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
  const underline = i + 1 < lines.length ? RE_MD_SETEXT_UNDERLINE.exec(lines[i + 1]!)?.[1] : undefined
  if (
    !isHeading &&
    !isBlockquote &&
    !isList &&
    // A line that is ITSELF a Markdown thematic break (`***`, `---`, …) is a
    // rule, not a setext heading text line. CommonMark: `***\n---` is two
    // thematic breaks, not an h2 titled `***`; guard so the rule falls
    // through to the thematic-break normalization below.
    !RE_MD_THEMATIC.test(held) &&
    underline !== undefined &&
    // Four columns past its container an underline is paragraph text.
    indentColumns(stripColumns(lines[i + 1]!, contentCol)) < 4
  ) {
    if (st.prevType !== 'blank' && out.length > 0) out.push('')
    out.push(
      containerPad + convertInline(`${underline[0] === '=' ? '#' : '##'} ${headingLine(line, true)}`, dialect),
    )
    i++ // consume the underline line
    if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
    st.prevType = 'heading'
    return i
  }

  // Markdown thematic break (`***`, `- - -`, `_ _ _`, indented ` ***`, …) ->
  // Carve's canonical contiguous col-0 `---`. Placed AFTER the setext block: a
  // contiguous `---` UNDER a paragraph is consumed there as a setext h2
  // (CommonMark: setext wins over a thematic break under a paragraph), while a
  // rule line that is not a setext underline for a preceding paragraph falls
  // through to here (the setext guard above skips rule lines themselves).
  if (RE_MD_THEMATIC.test(held)) {
    if (st.prevType !== 'blank' && out.length > 0) out.push('')
    breakLines.add(out.length)
    out.push(containerPad + '---')
    if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
    st.prevType = 'blank'
    return i
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
    if (st.prevType !== 'blank' && st.prevType !== 'block_quote' && out.length > 0) out.push('')
    breakLines.add(out.length)
    out.push(containerPad + '> '.repeat(depth) + '---')
    // `fmt` sets the block under the break apart from it, and inside a quote
    // that separator is the quote's own markers: a bare blank would end the
    // quote and split it in two (carve-js#2633). Only when a line follows
    // inside a quote at all: a blank one below needs nothing, and a line
    // that leaves the quote altogether is separated by the source's blank.
    const below = i + 1 < lines.length
      ? lines[i + 1]!.match(/^ {0,3}((?:>[ \t]?){1,})(.*)$/)
      : null
    // Between two quote depths the separator carries the SHALLOWER one, the
    // way the writer's own separator does: markers the deeper quote does not
    // hold would reopen it.
    if (below !== null && below[2]!.trim() !== '') {
      const shallower = Math.min(depth, (below[1]!.match(/>/g) ?? []).length)
      out.push(containerPad + '> '.repeat(shallower).trimEnd())
    }
    st.prevType = 'block_quote'
    return i
  }
  return undefined
}

/**
 * Set a heading, quote or list apart from the block above it and write it.
 * The index to resume at, or undefined.
 */
function writeContainerOpener(st: MarkdownConversion, ln: MarkdownLine, i: number): number | undefined {
  const { lines, dialect, sourceLine, out, sourceBlanks, listCols, listMarkers, quoteMarkers, emptyMarkerLines } = st
  const { footnote, leftEmptyItem, paragraphOpen, paragraphColumn, line, trimmed, lazyQuote, afterTable, reachesMovedItem, contentCol, containerPad, isList, isHeading, indent, relIndent, isBlockquote } = ln
  if (isHeading && st.prevType !== 'blank' && out.length > 0) out.push('')
  // A quote at another container column than the one above is another quote.
  if (isBlockquote && st.prevType !== 'blank' && (st.prevType !== 'block_quote' || st.quoteCol !== contentCol)) out.push('')
  // A blockquote ends at the first non-`>` line; Carve needs a blank line
  // between it and the following paragraph to keep them separate blocks.
  if (!isBlockquote && !isHeading && !isList && st.prevType === 'block_quote') out.push('')
  // A top-level list needs a blank line before it. A list line right after
  // another list item is a sibling/nested item — Carve already handles both
  // by indentation, so no blank there (it would wrongly make the list loose).
  const isTopLevelList = isList && st.prevType !== 'list'
  const siblingMarker = /^([ \t]*)(?:([-*+])|\d+([.)]))(?=[ \t])/.exec(line)
  const listSibling = siblingMarker !== null &&
    listMarkers.continues(columnWidth(siblingMarker[1]!), siblingMarker[2] ?? siblingMarker[3]!)
  if (isTopLevelList && st.prevType !== 'blank' && !listSibling) out.push('')
  if (isList && st.referenceSeparatedLists.has(i)) {
    listMarkers.end(indentColumns(line))
    let blanks = 0
    for (let at = out.length - 1; at >= 0 && out[at] === ''; at--) blanks++
    while (blanks++ < 3) {
      st.hardBlanks.add(out.length)
      out.push('')
    }
  }

  // Carve recognizes `#` headings and `>` blockquotes at their container's
  // content column, but Markdown allows 1-3 further spaces of indent — dedent
  // that slack so the block survives. The slack is measured from the content
  // column, and the block goes back to it: measured from column 0, a heading
  // or a quote sitting AT a list item's content column looked like slack and
  // was dedented out of the item.
  // So does a paragraph an item above it would take in once that item's
  // content column moved left.
  // Lists are dedented by `ListMarkers`, which moves their siblings along.
  const dedent = relIndent >= 1 && relIndent <= 3 && (isHeading || isBlockquote || ((leftEmptyItem || reachesMovedItem || listCols.length > 0) && !isList))
  ln.body = dedent ? containerPad + line.slice(indent) : line
  // Strip an ATX heading's optional closing `#` run (Carve keeps it as text).
  if (isHeading) ln.body = ln.body.replace(/^([ \t]*#{1,6})[ \t]+/, '$1 ').replace(/[ \t]+#+[ \t]*$|[ \t]+/g, (run) => run.includes('#') ? '' : run)
  if (isHeading && /^[ \t]*(#{1,6})(?:[ \t]+#*)?[ \t]*$/.test(line)) {
    const level = /^#+/.exec(trimmed)![0].length
    if (out.length && out.at(-1)!.trim() !== '') out.push('')
    out.push(...rawBlockHtml([`<h${level}></h${level}>`]).map(text => containerPad + text))
    st.prevType = 'heading'
    return i
  }
  if (isBlockquote) {
    const run = collectBlockquoteInlineRun(lines, i, dialect, contentCol, quoteMarkers)
    st.quoteCol = contentCol
    if (run.blank) sourceBlanks.add(out.length)
    out.push(...run.lines)
    i = run.end - 1
    st.prevType = 'block_quote'
    return i
  }
  if (isList) {
    reportOrderedTask(line, sourceLine(i))
    const run = collectListInlineRun(footnote === null ? lines : lines.slice(0, st.footnoteEnd),
      i, dialect, emptyMarkerLines.has(i))
    const item = sourceItem(line)
    const kind = item?.bullet ?? item?.delimiter ?? ''
    if ((afterTable || listCols.length === 0 && isStandardTableRow(out.at(-1) ?? '') || paragraphOpen && st.recentChildKind?.col === indentColumns(line) && st.recentChildKind.kind !== kind && !RE_LIST_MARKER.test(out.at(-1) ?? '')) && out.at(-1)?.trim() !== '') out.push('')
    const fold = footnote === null && lines[i + 1]?.trim() !== '' && !RE_MD_SETEXT_UNDERLINE.test(lines[i + 1] ?? '')
    const written = writeItemRun(run, listMarkers, true, fold, emptyMarkerLines.has(i), paragraphOpen, paragraphColumn)
    if (listCols.length > 1 && run.verbatimFrom !== undefined) st.recentChildKind = { col: indentColumns(line), kind }
    if (footnote !== null) {
      const marker = convertInline(
        footnote[1]!,
        dialect,
        false,
        false,
        undefined,
        true,
        false,
        false,
        undefined,
        false,
      )
      const firstBody =
        footnote[3] === ''
          ? stripColumns(written.lines.splice(1, 1)[0] ?? '{empty}', 2)
          : written.lines[0]!.replace(/^[-*+] /, '')
      written.lines[0] = marker + ' ' + firstBody
    }
    // A list under a quote an item holds is set apart from it, or Carve reads
    // the marker line as the quote's lazy continuation.
    if ((written.separate && st.prevType === 'list') || (lazyQuote !== null && indentColumns(line) >= lazyQuote.col)) out.push('')
    out.push(...written.lines)
    st.shiftBy = 0
    st.itemParagraph = !emptyMarkerLines.has(i) && leavesItemParagraph(run)
    st.itemQuote = leavesItemQuote(run)
    st.fenceItem = run.verbatimFrom !== undefined || endsInTable(run)
    i = run.end - 1
    st.prevType = 'list'
    return i
  }
  return undefined
}

/** Write a paragraph, a heading, or the text line left over. The index to resume at. */
function writeParagraphLine(st: MarkdownConversion, ln: MarkdownLine, i: number): number {
  const { lines, dialect, sourceLine, out, listCols, inGfmTable, listMarkers } = st
  const { trimmed, contentCol, containerPad, held, isList, isHeading, isBlockquote } = ln
  if (!isHeading && !isList && !isBlockquote && (!isStandardTableRow(ln.body) || !inGfmTable[i])) {
    const run = [emitParagraph(st, ln.body)]
    // The same lines with no block-opener escape, for the fold below. An
    // escape has to earn its place by protecting against something, and a
    // marker in the middle of a one-line heading could not have opened a
    // block, so escaping it there spells a construct that is not present
    // (carve#2244). The paragraph branch keeps `run`, where each line does
    // start one and the escape is load-bearing.
    const bare = [ln.body]
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
      if (RE_MD_SETEXT_UNDERLINE.exec(next)?.[1]![0] === '=' && indentColumns(next) >= contentCol && indentColumns(inside(next)) < 4) break
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
      // The thematic run and a valid fence opener, which interrupts a Carve
      // paragraph (carve#4018). A lone pipe is no table without its delimiter
      // row and an equals line opens nothing at all, so an escape on those
      // would guard nothing (carve#2244).
      const structural = opens || RE_MD_THEMATIC.test(trimmedNext) || opensCodeFence(trimmedNext)
      run.push(structural ? emitParagraph(st, next.slice(0, next.length - trimmedNext.length)) + escapeBlockOpener(trimmedNext) : emitParagraph(st, next))
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
      if (st.prevType !== 'blank' && out.length > 0) out.push('')
      const { parts, joined } = headingParagraphParts(bare, dialect, bare.map((text, index) => index > 0 && listCols.length > 0 && indentColumns(text) < contentCol))
      let offset = heading.length + 1
      const sourceLines = parts.map((text, index) => {
        const entry = { offset, line: sourceLine(i + index) }
        offset += text.length + 1
        return entry
      })
      out.push(containerPad + convertInline(`${heading} ${joined}`, dialect, false, false, undefined, true, false, true, at => {
        let line = sourceLines[0]?.line
        for (const entry of sourceLines) {
          if (entry.offset > at) break
          line = entry.line
        }
        return line
      }))
      i = end
      if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') out.push('')
      st.prevType = 'heading'
      return i
    }
    if (run.length > 1) {
      // A line of the run left of the item's content column is lazy.
      const inItem = listCols.length > 0 && indentColumns(ln.line) >= contentCol
      out.push(
        keepPipeRowsLiteral(
          convertInline(
            run
              .map((text) =>
                inItem && indentColumns(text) < contentCol && !RE_LIST_MARKER.test(text) ? containerPad + text.trimStart() : text,
              )
              .join('\n'),
            dialect, false, false, undefined, true, false, true, undefined, true, false,
            listCols.length === 0 && !/^[ \t]*>/.test(ln.line),
            listCols.length === 0 && !/^[ \t]*>/.test(ln.line),
          ),
        ),
      )
      st.itemParagraph = inItem
      i = end - 1
      st.prevType = 'text'
      return i
    }
  }
  if (isStandardTableRow(ln.body)) ln.body = unescapePipesInCodeSpans(ln.body)
  const converted = convertInline(!isHeading && !isList && !isBlockquote ? emitParagraph(st, ln.body) : ln.body, dialect, false, false, undefined, true, false, true, undefined, true, !isHeading && listCols.length === 0 && !/^[ \t]*>/.test(ln.body), false, !isHeading && listCols.length === 0 && !/^[ \t]*>/.test(ln.body))
  // A pipe row GFM did NOT read as a table row stays text. Carve needs no
  // delimiter row, so passing the line through was itself the conversion and
  // the migrated document grew a table the author never saw
  // (markup-carve/carve-js#1061). Escaping only the opening pipe keeps the
  // line in the paragraph it belongs to.
  if (isHeading && /^[ \t]*#{1,6}[ \t]*$/.test(converted)) {
    const level = /^#+/.exec(trimmed)![0].length
    out.push(...rawBlockHtml([`<h${level}></h${level}>`]).map(text => containerPad + text))
  } else out.push(
    !inGfmTable[i] && isStandardTableRow(converted) ? keepPipeRowLiteral(converted) : converted,
  )
  st.itemParagraph = listCols.length > 0 && indentColumns(ln.line) >= contentCol && !isHeading && opensParagraph(held)

  if (isHeading && i + 1 < lines.length) {
    const next = lines[i + 1]!.trim()
    if (next !== '' && !/^#{1,6}[ \t]/.test(next)) out.push('')
  }

  if (isHeading) st.prevType = 'heading'
  else if (isList) st.prevType = 'list'
  else if (isBlockquote) st.prevType = 'block_quote'
  else st.prevType = 'text'
  return i
}

function convertMarkdown(markdown: string, dialect: MarkdownDialect): string {
  markdown = markdown.replace(/\r\n?/g, '\n')
  const footChainSerial = freeMarkerSerial(markdown, 'CARVEMDFOOTCHAIN')
  footChainMarker = `CARVEMDFOOTCHAIN${footChainSerial}Z`
  const brokenAngle = /^\[([^\[\]\n]+)\]\(<[^<>\n]*(?<!\\)\n[^<>\n]*>\)\n(?:=+|-+)[ \t]*\n?$/.exec(markdown)
  if (brokenAngle) return markdown.replace(/^\[[^\[\]\n]+\]\(/, () => `[${convertInline(brokenAngle[1]!, dialect)}]\\(`)
  const allLines = markdown
    .replace(/\0/g, '\ufffd')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const { frontmatter, bodyStart, typedOpener } = splitFrontmatter(allLines)
  if (frontmatter.length > 0) {
    // A synthesized block starts at line 1, and the confidence follows the
    // opener: a bare `---` was claimed by the shape test, while a typed one
    // named its format and is front matter unconditionally under CARVE-P2-030
    // (markup-carve/carve#2806).
    importLosses.push({
      code: 'frontmatter-synthesized',
      message: FRONTMATTER_SYNTHESIZED,
      line: 1,
      confidence: typedOpener ? 'exact' : 'inferred',
    })
  }
  const removed = extractReferenceDefinitions(allLines.slice(bodyStart), decodeHtmlEntitiesRaw, (line) =>
    interruptingHtmlBlock(line) || isMarkdownFenceLine(line) || RE_MD_THEMATIC.test(line) ||
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|(?:[-*+]|0{0,8}1[.)])[ \t]+\S|=+[ \t]*$)/.test(line),
    (line, atBlockStart) => {
      const block = htmlBlockAt([line], 0)
      return block !== null && (atBlockStart || block.interrupts)
    },
  )
  for (const definition of removed.discardedEmptyDefinitions) {
    importLosses.push({
      code: 'structure-unspellable',
      message: `Dropped titled empty reference definition [${definition.label}]:; uses become inline links`,
      line: definition.line + bodyStart + 1,
      confidence: 'exact',
    })
  }
  useEmptyDestinationReferences(removed.references)
  const lines = removed.lines
  // Membership is measured from source columns before marker and footnote
  // spelling changes mutate this array during the conversion loop.
  quotedItemColumns(lines)
  // A diagnostic's `path` names the line in the source the importer was given,
  // never an index into this stripped array (markup-carve/carve#2792).
  const sourceLine = (index: number): number | undefined => {
    const at = removed.sourceLines[index]
    return at === undefined ? undefined : at + bodyStart + 1
  }
  importSourceLine = sourceLine
  const st: MarkdownConversion = {
    lines, dialect, markdown, sourceLine,
    referenceSeparatedLists: referenceSeparatedListStarts(allLines.slice(bodyStart), lines, removed.sourceLines),
    hardBlanks: new Set<number>(),
    out: [],
    terminalHtmlBlock: false,
    sourceBlanks: new Set<number>(),
    breakLines: new Set<number>(),
    inCode: false,
    fenceChar: '',
    fenceLen: 0,
    fenceStrip: 0,
    fenceCol: 0,
    fenceOut: -1,
    fenceOpenerPrefix: '',
    fenceInfoText: '',
    fenceShift: 0,
    fenceAfterBlank: false,
    listCols: [],
    inGfmTable: gfmTableRowLines(lines),
    inTableBody: false,
    tableWidth: 0,
    listMarkers: new ListMarkers(),
    recentChildKind: null,
    quoteMarkers: new Map<string, ListMarkers>(),
    prevBlank: true,
    itemParagraph: false,
    emptyMarkerColumn: null,
    emptyMarkerLines: new Set<number>(),
    itemQuote: null,
    lazyCol: -1,
    fenceItem: false,
    quoteCol: 0,
    shiftFrom: 0,
    shiftCol: 0,
    shiftBy: 0,
    prevType: 'blank',
    footnoteEnd: -1,
  }
  const { out, sourceBlanks, breakLines } = st

  for (let i = 0; i < lines.length; i++) {
    const ln = blankMarkdownLine()
    prepareMarkdownLine(st, ln, i)
    trackListItems(st, ln, i)
    i = writeItemContinuation(st, ln, i)
      ?? writeFenceLine(st, ln, i)
      ?? writeHeldBlock(st, ln, i)
      ?? writeTableLine(st, ln, i)
      ?? writeItemHeldLine(st, ln, i)
      ?? writeBreakLine(st, ln, i)
      ?? writeContainerOpener(st, ln, i)
      ?? writeParagraphLine(st, ln, i)
  }

  applyShift(st)
  // A fence the document never closed runs to its end, blank lines included,
  // and is closed there; the line the final newline leaves stays last.
  //
  // Not one set apart from its item's content by a blank line with a blank
  // line of its own before more code: GFM reads that item loose, and so does
  // Carve while the fence is open, but closed it reads tight (a fence attaches
  // to the content above it), and only `{loose}` could say otherwise.
  let lastCode = out.length - 1
  while (lastCode > st.fenceOut && out[lastCode]!.trim() === '') lastCode--
  const blankInside = out.slice(st.fenceOut + 1, lastCode).some((text) => text.trim() === '')
  if (st.inCode) {
    const finalNewline = lines.at(-1) === '' && out.at(-1) === ''
    if (finalNewline) out.pop()
    const closer = closeFence(out, st.fenceOut, ' '.repeat(st.fenceCol + st.fenceShift), st.fenceInfoText, st.fenceOpenerPrefix)
    if (!(st.fenceAfterBlank && blankInside)) out.push(closer)
    if (finalNewline) out.push('')
  }

  const fromSource = out.map((_, idx) => sourceBlanks.has(idx))

  if (removed.definitions.length > 0) {
    while (out.length > 0 && out.at(-1)!.trim() === '') out.pop()
    for (const [index, definition] of removed.definitions.entries()) {
      if (out.length > 0) out.push('')
      out.push(convertInline(emitContainerLine(definition, 'definition', {
        listDepth: 0, quoteDepth: removed.definitionContainers[index] ? 1 : 0, prefix: '', hosts: [],
      }).line, dialect, false, false, undefined, true, false, false, undefined, false,
        false, false, false, removed.definitionContainers[index]))
    }
    if (markdown.endsWith('\n')) out.push('')
  }
  const assemble = (): string => {
    const written = joinOutput(out, fromSource, st.hardBlanks)
    let text = separateLooseItems(escapeCarveOnlyMarkersOutsideFences(written.text), written.sourceBlanks)
      .replace(/\x00REFITEM\x00/g, '%%')
    if (st.terminalHtmlBlock && !text.endsWith('\n')) text += '\n'
    return text
  }
  let body = assemble()
  // Frontmatter-collision guard: Carve reads a line-0 `---` as a frontmatter
  // OPEN fence and, with a later closer, swallows everything between as opaque
  // metadata, so a document that opens with a break and holds another bare
  // `---` would vanish. The canonical writer meets the same hazard and answers
  // it by respelling every break in the document (PART 11 section 1a), which is
  // what `carve fmt` then writes - so the import takes the same answer, by the
  // writer's own parser test and its own marker, rather than a leading blank
  // that moved line 0 off `---` and lost the round trip (carve-js#2606).
  if (frontmatter.length === 0 && opensFrontmatter(body)) {
    for (const at of breakLines) {
      const line = out[at]
      if (line?.endsWith('---')) out[at] = line.slice(0, -3) + FRONTMATTER_SAFE_BREAK
    }
    const respelled = assemble()
    if (!opensFrontmatter(respelled)) body = renderCarve(parse(spellEmptyItemPlaceholders(respelled)))
  }
  // The boundary under a frontmatter closer is the writer's own block
  // separator, and a frontmatter-only document still ends on a newline, so the
  // import is a `carve fmt` fixed point (carve-js#2614). Any blank the body
  // already carries is that same boundary spelled twice.
  const separated = body.replace(/^\n+/, '')
  let output = frontmatter.length === 0
    ? body
    : separated === ''
      ? `${frontmatter.join('\n')}\n`
      : `${frontmatter.join('\n')}${BLOCK_SEPARATOR}${separated}`
  output = output.replaceAll(removed.titleBreakMarker, '\n  ')
  const titleWrap = removed.references.titleWrap
  if (titleWrap !== undefined && output.includes(titleWrap)) {
    // A wrapped title continues inside the quote that holds its use.
    output = output.split('\n').map(line => line.includes(titleWrap)
      ? line.replaceAll(titleWrap, `\n${/^(?:[ \t]*>[ \t]?)*/.exec(line)![0].replace(/[ \t]*$/, '').replace(/>$/, '> ')}`)
      : line).join('\n')
  }
  output = output.replaceAll(footChainMarker, '')
  // The writer collects footnote definitions at document end. Apply that
  // ordering only when the parsed import actually defines a footnote.
  if (removed.references.footnotes.size > 0 || /(?:^|\n)[ \t]{0,3}\[\^[^\]\n]+\]:/.test(output)) {
    const doc = parse(output)
    const undefinedNames = new Map<string, string>()
    for (const [label, renamed] of removed.references.footnotes) {
      if (Object.hasOwn(doc.footnoteDefs ?? {}, renamed)) continue
      const value = `[^${referenceLiteralText(label, decodeHtmlEntitiesRaw, [])}]`
      const literal = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }).replace(/\n$/, '')
      undefinedNames.set(renamed, escapeTablePipes(literal))
    }
    if (undefinedNames.size > 0) {
      output = output.replace(/\[\^(carve-import-footnote-\d+)\]/g, (match, label: string) => undefinedNames.get(label) ?? match)
    }
    if (Object.keys(doc.footnoteDefs ?? {}).length > 0) {
      const ordered = renderCarve(undefinedNames.size > 0 ? parse(output) : doc)
      return markdown.endsWith('\n') ? ordered : ordered.replace(/\n$/, '')
    }
  }
  return output
}

function markdownUrlTokenSource(index: number, spans: readonly string[], sources: readonly string[]): string | { source: string; opaque: boolean } | undefined {
  const span = spans[index] ?? ''
  const source = sources[index] ?? span
  if (/^\\[!-/:-@\[-`{-~]$/.test(span) || span === '\\') return source
  if (/^!?`/.test(span) || span.startsWith('(') || span.startsWith('![') || span.startsWith('[')) return { source, opaque: true }
  return undefined
}

function plainMarkdownUrlRanges(line: string, spans: readonly string[], sources: readonly string[]): { start: number; end: number }[] {
  return markdownBareLinks(line, token => {
    const index = Number(token.slice(2, -1))
    return markdownUrlTokenSource(index, spans, sources)
  }, 'url')
}
