/**
 * Hand-rolled SVG sanitizer (Tier-3, zero-dependency). Powers the `img` fence
 * (see {@link file://./svg-fence.ts}); usable standalone.
 *
 * A real tokenizer, NOT a regex scrub — regex "sanitizers" for SVG are
 * routinely bypassed. It walks the source tag by tag, drops any element not on
 * a presentational allowlist **together with its subtree**, drops any attribute
 * not on the allowlist (and every `on*` handler), scrubs URL/style values, and
 * re-serializes only the survivors. Text nodes pass through with `&<>`
 * re-escaped. Anything unrecognized is dropped, never echoed.
 *
 * The output is guaranteed to contain no `<script>`, no event handlers, no
 * `<foreignObject>`, no `javascript:`/external URLs, and no active CSS — so it
 * is safe to inline into the DOM or to encode into a `data:image/svg+xml` URI.
 */

import { isUrlAllowed } from '../../src/html-attributes.ts'
import type { UrlPolicy } from '../../src/index.ts'
import { STYLE_PATTERNS } from '../../src/render-tables.ts'

/** Options gate the small set of constructs that are safe only in some
 *  contexts. All default OFF. */
export interface SanitizeSvgOptions {
  urlPolicy?: UrlPolicy
  /** Keep the `style` **attribute** (value scrubbed of `url()`/`expression()`/…).
   *  The `<style>` *element* is always dropped regardless — its selectors can
   *  reach the whole page and its text can carry `@import`/`url()`. */
  allowStyle?: boolean
  /** Keep `<a>` elements and external `href`/`xlink:href` (safe schemes only). */
  allowLinks?: boolean
  /** Keep SMIL animation elements (`<animate>`, `<set>`, …). */
  allowAnimation?: boolean
  /** Keep `<image>` and its external raster `href` (safe schemes only; note
   *  `data:` is still rejected as a dangerous scheme). */
  allowExternalImages?: boolean
}

export interface SanitizeResult {
  /** The sanitized SVG. Meaningful only when {@link ok} is true. */
  svg: string
  /** True when the input parsed to a single well-formed `<svg>` root. When
   *  false, callers should fall back to showing the source, never the raw
   *  input. */
  ok: boolean
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
// The only prefixed names written, each exactly in this spelling: prefixes are case-sensitive
// and the root binds `xlink` when needed (carve#6782, carve#6783).
const PREFIXED_NAMES = new Set(['xlink:href', 'xmlns:xlink', 'xml:space'])
// A namespace name of XML whitespace only, literal or as a character reference, is no URI reference (carve#6783).
const BLANK_NAMESPACE_RE = /^(?:[ \t\n\r]|&#(?:0*(?:9|10|13|32)|[xX]0*(?:9|[aAdD]|20));)*$/

// Presentational SVG element allowlist. Deliberately excludes script,
// foreignObject, style, a, image, metadata, and SMIL — those are gated by an
// option or dropped outright.
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'marker', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feComponentTransfer', 'feFuncA', 'feFuncR', 'feFuncG', 'feFuncB',
  'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feMorphology',
  'feTile', 'feTurbulence', 'feDropShadow', 'feImage', 'feDisplacementMap',
])

// Elements permitted only when the matching option is set.
const LINK_TAGS = new Set(['a'])
// Lower case: tagAllowed looks names up lowered (carve#6765).
const ANIMATION_TAGS = new Set(['animate', 'animatetransform', 'animatemotion', 'set', 'mpath'])
const EXTERNAL_IMAGE_TAGS = new Set(['image'])

// Attribute-name allowlist (case-insensitive). Geometry + presentation only.
const ALLOWED_ATTRS = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'viewbox', 'points', 'transform', 'pathlength',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-opacity', 'opacity', 'color', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'patternunits',
  'patterntransform', 'patterncontentunits', 'clippathunits', 'maskunits',
  'maskcontentunits', 'markerwidth', 'markerheight', 'markerunits', 'orient',
  'refx', 'refy', 'preserveaspectratio', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'word-spacing',
  'clip-path', 'clip-rule', 'mask', 'marker-start', 'marker-mid', 'marker-end',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'operator', 'values', 'type',
  'flood-color', 'flood-opacity', 'attributename', 'begin', 'dur', 'from', 'to',
  'repeatcount', 'keytimes', 'keysplines', 'calcmode', 'additive', 'accumulate',
  'class', 'id', 'role', 'xmlns', 'xmlns:xlink', 'xml:space', 'version',
])
// Reference-carrying attrs get URL scrubbing rather than a value passthrough.
const URL_ATTRS = new Set(['href', 'xlink:href'])

// Kept byte-identical to the core renderer's DANGEROUS_URL_SCHEMES (render-html.ts):
// script / inline-content / local-file vectors plus the OS protocol-handler /
// command-execution schemes (CVE-2026-20841 class). Must not drift narrower.
const DANGEROUS_URL_SCHEMES = new Set([
  'javascript', 'vbscript', 'data', 'file',
  'ms-msdt', 'ms-office', 'ms-word', 'ms-excel', 'ms-powerpoint', 'ms-access',
  'ms-visio', 'ms-project', 'ms-publisher', 'ms-infopath', 'ms-spd', 'ms-search',
  'search-ms', 'ms-cxh', 'ms-cxh-full', 'shell', 'vscode', 'vscode-insiders', 'jar',
])
/**
 * Characters dropped before this file reads a scheme. The second spelling of
 * the core renderer's `SCHEME_PROBE_STRIP_RE`, and it has to stay as wide:
 * this is a PROBE class, not an emit class, so it names DEL (U+007F) and the
 * C1 block (U+0080..U+009F) even though PART 9 section 29 T5 puts them outside
 * the class a target may emit. While they were missing, `<a href>` and
 * `<image href>` under `allowLinks` / `allowExternalImages` carried
 * `java<DEL>script:alert(1)` through with the raw `7f` byte, and
 * `refAttrUnsafe`'s reject-every-absolute-scheme rule matched nothing at all
 * (markup-carve/carve-js#915). Stripping only removes characters, so a wider
 * class can refuse more and can never permit more.
 */
const SCHEME_STRIP_RE =
  /[\x00-\x20\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g

function schemeIsSafe(url: string): boolean {
  if (!url.includes(':')) return true
  const probe = url.replace(SCHEME_STRIP_RE, '')
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe)
  if (!m) return true // relative / fragment — safe
  return !DANGEROUS_URL_SCHEMES.has(m[1]!.toLowerCase())
}

// Decode CSS escapes (`\72` → `r`, `\/` → `/`) so an escaped `url(` / `expression(`
// cannot slip past the needle checks. Mirrors the core renderer's decodeCssEscapes.
function decodeCssEscapes(value: string): string {
  if (!value.includes('\\')) return value
  return value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_m, esc: string) => {
    if (/^[0-9a-f]/i.test(esc)) {
      const cp = Number.parseInt(esc.trim(), 16)
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    }
    return esc
  })
}

// Named character references that can obfuscate a URL scheme (form a `:`, `/`,
// whitespace, `(`, or `&`). Numeric refs are handled generically below.
const NAMED_REFS: Record<string, string> = {
  colon: ':', semi: ';', sol: '/', tab: '\t', newline: '\n',
  lpar: '(', rpar: ')', amp: '&', quot: '"', apos: "'", nbsp: ' ',
}
// Decode XML/HTML character references (numeric `&#x61;`/`&#97;` + the named set
// above) so an entity-encoded scheme — `jav&#x61;script:` / `javascript&colon;` —
// is normalized before a URL/scheme check. The browser decodes these back, so
// the sanitizer must too. Used ONLY for validation, never for output.
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    const named = Object.hasOwn(NAMED_REFS, body.toLowerCase()) ? NAMED_REFS[body.toLowerCase()] : undefined
    return named ?? m
  })
}

// Full normalization for any URL/reference/style check: undo both entity and
// CSS-escape obfuscation.
function normalizeForCheck(value: string): string {
  return decodeCssEscapes(decodeEntities(value))
}

// Blank a style value that can fetch or execute: the core renderer's STYLE_PATTERNS
// (C2-H-162, CSS image functions included) plus `javascript:`. Whole-value rejection,
// not CSS surgery. CSS escapes are decoded first so `u\72l(` folds to `url(`.
export function styleIsDangerous(value: string): boolean {
  const compact = normalizeForCheck(value.replace(/\/\*[\s\S]*?\*\//g, ''))
    .toLowerCase()
    .replace(/\s+/g, '')
  return compact.includes('javascript:') || STYLE_PATTERNS.some((pattern) => compact.includes(pattern))
}

// A `url(...)` whose content does not begin with `#` is a NON-LOCAL reference.
// Anchoring on the START of the url content (after optional quote/space) sidesteps
// quoting and internal `)` — `url("https://a)b#x")` still matches because the char
// right after `url("` is not `#`. Local `url(#id)` refs never match. The lookahead
// group reads the space and quote atomically: a backtracking `\s*['"]?` let `(?!#)`
// pass one character early on `url('#g')` (carve#6763). Only CSS whitespace is skipped:
// a URL keeps a leading no-break space, so `url(\u00a0#g)` names another resource (carve#6773).
const NONLOCAL_URL_RE = /url\((?=([\t\n\f\r ]*['"]?[\t\n\f\r ]*))\1(?!#)/i
// Any absolute-URL scheme (`https:`, `ms-msdt:`, …). Used to reject URLs inside
// reference/animation values, which the plain scheme *denylist* would wave through
// (e.g. an external `https:` retargeting an animated `href`).
const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

// Attributes whose value is a paint/filter/animation REFERENCE. These may only
// carry local `#id` refs or literals — never a non-local `url()` or any absolute
// URL. SMIL value lists (`values`, `from`, `to`, `by`) are validated per
// `;`-separated segment so a later entry cannot smuggle a remote target.
const REF_VALUE_ATTRS = new Set([
  'fill', 'stroke', 'filter', 'clip-path', 'mask',
  'marker-start', 'marker-mid', 'marker-end',
  'color', 'stop-color', 'flood-color',
  'values', 'from', 'to', 'by',
])
function refAttrUnsafe(value: string): boolean {
  const decoded = normalizeForCheck(value)
  for (const seg of decoded.split(';')) {
    const s = seg.trim()
    if (NONLOCAL_URL_RE.test(s)) return true
    if (!s.includes(':') && !s.includes('/')) continue
    const probe = s.replace(SCHEME_STRIP_RE, '')
    if (ABSOLUTE_SCHEME_RE.test(probe)) return true
    // A leading `/` is a path reference: `//host/x` (protocol-relative) or
    // `/abs/path` both fetch remotely. A legit reference value is a local `#id`,
    // a `url(#id)`, or a scheme-less literal (number/color/keyword) — never a
    // slash-led path.
    if (probe.startsWith('/')) return true
  }
  return false
}

// For any other allowlisted attribute: reject a non-local `url()` or a
// denylisted dangerous scheme.
function valueHasExternalRef(value: string): boolean {
  const decoded = normalizeForCheck(value)
  if (NONLOCAL_URL_RE.test(decoded)) return true
  return !schemeIsSafe(decoded)
}

// Escape a bare `&` but leave intact the entities valid in an XML document: the
// five predefined names (`amp lt gt quot apos`) and numeric refs (`&#38;`,
// `&#x26;`). Other HTML named entities (`&nbsp;`, `&copy;`) are NOT defined in
// XML, so a `data:image/svg+xml` parse would fail on them — escape their `&`
// (`&nbsp;` → `&amp;nbsp;`) so the output stays well-formed. Existing predefined
// entities are preserved, so reserialization stays idempotent and un-double-escaped.
// A numeric reference survives only when it names an XML 1.0 `Char`; any other
// keeps no parser happy, so its `&` is escaped (carve#6764).
function escapeAmp(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#\d+;|#x[0-9a-fA-F]+;|(?:amp|lt|gt|quot|apos);)?/g, (m, ref: string | undefined) => {
    if (ref === undefined) return '&amp;'
    if (ref[0] !== '#') return m
    const cp = ref[1] === 'x' ? Number.parseInt(ref.slice(2, -1), 16) : Number.parseInt(ref.slice(1, -1), 10)
    return isXmlChar(cp) ? m : `&amp;${ref}`
  })
}
const TEXT_SPECIAL_RE = /[&<>]/
const ATTR_SPECIAL_RE = /[&"<>]/
function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff)
}
function escapeText(s: string): string {
  if (!TEXT_SPECIAL_RE.test(s)) return s
  return escapeAmp(s).replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  if (!ATTR_SPECIAL_RE.test(s)) return s
  return escapeAmp(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tagAllowed(name: string, opts: SanitizeSvgOptions): boolean {
  if (ALLOWED_TAGS.has(name)) return true
  const n = name.toLowerCase()
  if (ALLOWED_TAGS.has(n)) return true
  if (opts.allowLinks && LINK_TAGS.has(n)) return true
  // Note: the `<style>` *element* is never allowed — its text can carry
  // `@import`/`url()` that no attribute scrub would catch. `allowStyle` governs
  // only the `style` attribute (see sanitizeAttrs).
  if (opts.allowAnimation && ANIMATION_TAGS.has(n)) return true
  if (opts.allowExternalImages && EXTERNAL_IMAGE_TAGS.has(n)) return true
  return false
}

interface ParsedAttr {
  name: string
  value: string | null
}

// One attribute: a name, then an optional `=` and a double-quoted, single-quoted or bare value.
// A quoted value with no closing quote runs to the end of the tag.
const ATTR_RE = /\s*([A-Za-z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>]*)))?/y
const SPACE_RUN_RE = /\s*/y

function parseAttrs(raw: string): ParsedAttr[] {
  const out: ParsedAttr[] = []
  let at = 0
  while (at < raw.length) {
    ATTR_RE.lastIndex = at
    const m = ATTR_RE.exec(raw)
    if (m === null) {
      // No name here: step over one character.
      SPACE_RUN_RE.lastIndex = at
      SPACE_RUN_RE.test(raw)
      at = SPACE_RUN_RE.lastIndex + 1
      continue
    }
    out.push({ name: m[1]!, value: m[2] ?? m[3] ?? m[4] ?? null })
    at = ATTR_RE.lastIndex
  }
  return out
}

function sanitizeAttribute(name: string, n: string, value: string | null, opts: SanitizeSvgOptions, allowExternalHref: boolean): string {
  // XML has no valueless attributes, and none on the allowlist is boolean (carve#6774).
  if (value === null || n.startsWith('on')) return ''
  if (namespaceUnwritable(name, value)) return ''
  if (URL_ATTRS.has(n)) return sanitizeUrlAttribute(name, value, opts, allowExternalHref)
  if (n === 'style') return opts.allowStyle && !styleIsDangerous(value) ? ` ${name}="${escapeAttr(value)}"` : ''
  if (!n.startsWith('aria-') && !n.startsWith('data-') && !ALLOWED_ATTRS.has(n)) return ''
  if (REF_VALUE_ATTRS.has(n) ? refAttrUnsafe(value) : valueHasExternalRef(value)) return ''
  return ` ${name}="${escapeAttr(value)}"`
}

function namespaceUnwritable(name: string, value: string): boolean {
  if (!name.includes(':')) return false
  // Namespaces in XML forbids undeclaring a prefix (carve#6779).
  return !PREFIXED_NAMES.has(name) || (name === 'xmlns:xlink' && BLANK_NAMESPACE_RE.test(value))
}

function sanitizeUrlAttribute(name: string, value: string, opts: SanitizeSvgOptions, allowExternalHref: boolean): string {
  const decoded = normalizeForCheck(value)
  if (!decoded.startsWith('#') && !allowExternalHref) return ''
  if (!schemeIsSafe(decoded) || !isUrlAllowed(decoded, opts.urlPolicy)) return ''
  return ` ${name}="${escapeAttr(value)}"`
}

const ANIMATION_VALUE_ATTRS = new Set(['values', 'from', 'to', 'by'])

interface XlinkUse {
  declared: boolean
  used: boolean
}

function sanitizeAttrs(raw: string, opts: SanitizeSvgOptions, tag: string, isRoot: boolean, xlink: XlinkUse): string {
  const allowExternalHref = (opts.allowLinks === true && tag.toLowerCase() === 'a') ||
    (opts.allowExternalImages === true && tag.toLowerCase() === 'image')
  const attrs = parseAttrs(raw)
  const hrefAnimation = animatesHref(attrs)
  let out = ''
  const seen = attrs.length > 1 ? new Set<string>() : null
  for (const { name, value } of attrs) {
    if (seen !== null) {
      if (seen.has(name)) continue
      seen.add(name)
    }
    const n = name.toLowerCase()
    // carve#6755: the root's own xmlns is replaced by name, never by searching the written attributes.
    if (isRoot && n === 'xmlns') continue
    if (hrefAnimation && value !== null && ANIMATION_VALUE_ATTRS.has(n) && !localRefs(value)) continue
    out += noteXlink(name, sanitizeAttribute(name, n, value, opts, allowExternalHref), xlink)
  }
  return out
}

function noteXlink(name: string, written: string, xlink: XlinkUse): string {
  if (written === '') return written
  if (name === 'xlink:href') xlink.used = true
  else if (name === 'xmlns:xlink') xlink.declared = true
  return written
}

// carve#6761: an animation of `href` may only write `#id` entries, like the `href` it changes.
function animatesHref(attrs: ParsedAttr[]): boolean {
  return attrs.some(({ name, value }) => {
    if (name.length !== 13 || value === null || name.toLowerCase() !== 'attributename') return false
    const target = normalizeForCheck(value).trim().toLowerCase()
    return target === 'href' || target === 'xlink:href'
  })
}

function localRefs(value: string): boolean {
  return normalizeForCheck(value).split(';').every((segment) => {
    const s = segment.trim()
    return s === '' || s.startsWith('#')
  })
}

const TAG_STOP_RE = /["'<>]/g

function tokenEnd(source: string, start: number): number {
  const next = source[start + 1]
  if (next === '!' || next === '?') {
    if (source.startsWith('<!--', start)) return markerEnd(source, '-->', start + 4)
    if (source.startsWith('<![CDATA[', start)) return markerEnd(source, ']]>', start + 9)
    if (next === '?') return markerEnd(source, '?>', start + 2)
  }
  TAG_STOP_RE.lastIndex = start + 1
  for (let m = TAG_STOP_RE.exec(source); m !== null; m = TAG_STOP_RE.exec(source)) {
    const char = m[0]
    if (char === '>') return m.index + 1
    if (char === '<') return -1
    const close = source.indexOf(char, m.index + 1)
    if (close < 0) return -1
    TAG_STOP_RE.lastIndex = close + 1
  }
  return -1
}

function markerEnd(source: string, marker: string, from: number): number {
  const at = source.indexOf(marker, from)
  return at < 0 ? -1 : at + marker.length
}

interface SvgState {
  out: string[]
  dropStack: string[]
  kept: { name: string, contentStart: number, xlinkBound: boolean }[]
  sawRoot: boolean
  rootSelfClosed: boolean
  /** An `xlink:` attribute was written with no `xmlns:xlink` in scope (carve#6782). */
  bindXlink: boolean
}

function closeTag(name: string, state: SvgState): boolean {
  if (state.dropStack.length > 0) return state.dropStack.pop() === name
  const frame = state.kept.pop()
  if (frame?.name !== name) return false
  if (state.out.length === frame.contentStart) {
    const opener = state.out.pop()!
    state.out.push(`${opener.slice(0, -1)}/>`)
    if (name === 'svg') state.rootSelfClosed = true
  } else state.out.push(`</${name}>`)
  return true
}

function openTag(name: string, raw: string, selfClose: boolean, state: SvgState, opts: SanitizeSvgOptions): boolean {
  const isRoot = state.kept.length === 0 && state.dropStack.length === 0 && !state.sawRoot
  if (rootInvalid(name, isRoot, state)) return false
  if (state.dropStack.length > 0 || !tagAllowed(name, opts)) {
    if (!selfClose) state.dropStack.push(name)
    return true
  }
  if (isRoot) markRoot(state, selfClose)
  const xlink: XlinkUse = { declared: false, used: false }
  let attrs = sanitizeAttrs(raw, opts, name, isRoot, xlink)
  if (isRoot) attrs = ` xmlns="${SVG_NS}"` + attrs
  const xlinkBound = xlink.declared || state.kept.at(-1)?.xlinkBound === true
  if (xlink.used && !xlinkBound) state.bindXlink = true
  state.out.push(`<${name}${attrs}${selfClose ? '/>' : '>'}`)
  if (!selfClose) state.kept.push({ name, contentStart: state.out.length, xlinkBound })
  return true
}

function rootInvalid(name: string, isRoot: boolean, state: SvgState): boolean {
  return (isRoot && name !== 'svg') || (!isRoot && state.kept.length === 0 && state.dropStack.length === 0 && state.sawRoot)
}

function markRoot(state: SvgState, selfClose: boolean): void {
  state.sawRoot = true
  state.rootSelfClosed = selfClose
}

function consumeToken(token: string, state: SvgState, opts: SanitizeSvgOptions): boolean {
  if (token[1] === '/') {
    const closing = /^<\/([A-Za-z][\w:.-]*)\s*>$/.exec(token)
    return closing?.[1] === undefined || closeTag(closing[1], state)
  }
  const name = /^<([A-Za-z][\w:.-]*)/.exec(token)?.[1]
  if (name === undefined) return true
  const selfClose = token.endsWith('/>')
  const raw = token.slice(name.length + 1, token.length - (selfClose ? 2 : 1))
  return openTag(name, raw, selfClose, state, opts)
}

// A plain closing or opening tag, read in one step: the same token tokenEnd and consumeToken find.
// Name and body sit in lookaheads so a failed match never backtracks into them (no quadratic tail).
const PLAIN_TAG_RE = /<(?:\/(?=([A-Za-z][\w:.-]*))\1\s*|(?=([A-Za-z][\w:.-]*))\2(?=((?:"[^"]*"|'[^']*'|[^"'<>])*))\3)>/y

// The cursor after the tag at `start`, or -1 when the source is not well-formed.
function consumeTag(src: string, start: number, state: SvgState, opts: SanitizeSvgOptions): number {
  PLAIN_TAG_RE.lastIndex = start
  const plain = PLAIN_TAG_RE.exec(src)
  if (plain !== null) {
    const end = PLAIN_TAG_RE.lastIndex
    if (plain[1] !== undefined) return closeTag(plain[1], state) ? end : -1
    const raw = plain[3]!
    const selfClose = raw.endsWith('/')
    return openTag(plain[2]!, selfClose ? raw.slice(0, -1) : raw, selfClose, state, opts) ? end : -1
  }
  const end = tokenEnd(src, start)
  if (end < 0) return -1
  return consumeToken(src.slice(start, end), state, opts) ? end : -1
}

function consumeText(src: string, start: number, end: number, state: SvgState): boolean {
  if (end <= start || (state.sawRoot && state.dropStack.length > 0)) return true
  const between = src.slice(start, end)
  if (!state.sawRoot) return between.trim() === ''
  if (state.dropStack.length === 0) state.out.push(escapeText(between))
  return true
}

// Raw characters outside the XML 1.0 `Char` production: C0 controls other than tab,
// LF and CR, U+FFFE, U+FFFF and unpaired surrogates (carve#6764). Dropped from the
// source before any check, so a check never sees a value the output does not hold.
// Every character NON_XML_CHAR_RE can drop, paired surrogates included: absent, the replace is a no-op.
const NON_XML_CANDIDATE_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/
const NON_XML_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/**
 * Sanitize an SVG source string. See the module docblock for the guarantees.
 */
export function sanitizeSvg(source: string, opts: SanitizeSvgOptions = {}): SanitizeResult {
  const src = (NON_XML_CANDIDATE_RE.test(source) ? source.replace(NON_XML_CHAR_RE, '') : source).trim()
  let cursor = 0
  const state: SvgState = { out: [], dropStack: [], kept: [], sawRoot: false, rootSelfClosed: false, bindXlink: false }
  while (cursor < src.length) {
    const start = src.indexOf('<', cursor)
    if (start < 0) break
    if (!consumeText(src, cursor, start, state)) return { svg: '', ok: false }
    cursor = consumeTag(src, start, state, opts)
    if (cursor < 0) return { svg: '', ok: false }
  }
  if (!consumeText(src, cursor, src.length, state)) return { svg: '', ok: false }
  if (!state.sawRoot || state.kept.length !== 0 || state.dropStack.length !== 0) return { svg: '', ok: false }
  if (state.bindXlink) state.out[0] = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"${state.out[0]!.slice(`<svg xmlns="${SVG_NS}"`.length)}`
  const svg = state.out.join('')
  const tailOk = state.rootSelfClosed ? /\/>\s*$/.test(svg) : /<\/svg>\s*$/i.test(svg)
  return /^<svg[\s/>]/i.test(svg) && tailOk ? { svg, ok: true } : { svg: '', ok: false }
}
