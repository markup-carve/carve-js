/*
 * HTML renderer — emits the canonical output the spec corpus expects.
 *
 * Output style: minimal indentation, block elements on their own line,
 * inline content stays flat within block element. Nested block
 * structures (table, blockquote, figure, admonition) get two-space
 * indented children for readability.
 */

import type {
  Admonition,
  Attrs,
  BlockNode,
  BlockQuote,
  Document,
  Figure,
  FigureGroup,
  Heading,
  Image,
  InlineNode,
  List,
  ListItem,
  Paragraph,
  Span,
  Table,
  TableCell,
  TableRow,
} from './ast.js'
import { CANONICAL_ADMONITION_KINDS, SMART_PUNCTUATION_GLYPHS } from './ast.js'
import type {
  BlockExtensionRenderContext,
  CarveExtension,
  ExtensionRenderContext,
  StaticRenderers,
} from './extension.js'
import { AbbrBudget, budgetForDocument, utf8ByteLength } from './abbr-budget.js'
import { collectDocumentIds, type DocumentIdRegistry } from './document-ids.js'
import { stripBidiControls } from './bidi-controls.js'
import { normalizeLegacyInline } from './legacy-nodes.js'
import { numberFootnotes } from './footnote-numbering.js'
import { ownValue } from './own-property.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from './render-depth.js'
import { isUnresolvedReference } from './unresolved-reference.js'

// Per-render abbreviation-expansion budget (DoS guard). Set at the top of
// renderHtml() and reset to null when it returns, so it never leaks across
// calls. Rendering is synchronous and single-threaded, so a module-scoped
// tracker is safe and avoids threading a counter through every signature.
let abbrBudget: AbbrBudget | null = null
let suppressAutomaticAbbreviation = false

// Per-render document id namespace (extensions contract §2.6): seeded with
// every explicit / heading id in the resolved AST, consumed by extensions via
// ctx.uniqueId(). Same save/restore discipline as abbrBudget above.
let docIds: DocumentIdRegistry | null = null

export interface RenderOptions {
  /**
   * The semantic span names this render consumes, inner to outer.
   *
   * Absent means core's three (PART 9 §9). The SemanticSpan extension passes
   * the seven-name order (PART 9 §10) so its four extra names behave exactly
   * as core's do - one code path, one nesting order, one riding rule.
   */
  semanticSpanNames?: readonly string[]
  /**
   * Render mode. `"interactive"` (default) emits the live forms - clickable
   * tabs, client-script diagrams, KaTeX-ready math. `"static"` emits a
   * self-contained page for a medium that cannot interact or run client
   * scripts (print, PDF source, archival HTML): each extension renders through
   * its `renderStatic` path (tabs flatten to labeled sections, disclosures
   * expand, diagrams/math become build-rendered output or source), and any
   * unconsumed div grouping `[label]` renders as a `<p class="div-label">`
   * caption floor. An unknown value is rejected. Omitting it means
   * `"interactive"`, so existing callers are unaffected. `"print"` / `"email"`
   * are reserved for future named presets.
   */
  mode?: 'interactive' | 'static'
  /**
   * Build-time renderers for client-script extensions, used only in
   * `mode: "static"`. Maps an extension's source to self-contained output
   * (e.g. `{ mermaid: src => svg }`). When the renderer a node needs is
   * absent, that extension's static path falls back to the source as a code
   * block - content is never dropped.
   */
  renderers?: StaticRenderers
  mentionUrl?: string
  tagUrl?: string
  /** Symbol shortcode -> trusted raw output map. `:name:` with no entry renders literally. */
  symbols?: Record<string, string>
  /** Registered extensions (renderers consulted; transforms run by carveToHtml). */
  extensions?: CarveExtension[]
  /**
   * Stamp each block element with `data-source-line="{n}"` (the
   * 1-based source line it starts on). Requires the AST to carry positions
   * (parse with `{ positions: true }`; `carveToHtml` enables this for you).
   * Off by default so canonical output is unchanged. Intended for editor
   * integrations that map rendered blocks back to source lines.
   */
  sourceLine?: boolean
  /**
   * Filter dangerous URL schemes on link `href` and image `src` so authored
   * Carve cannot inject script via a crafted URL. On by default (safe by
   * default). A blocked URL renders as an empty value (`href=""`) so the link
   * text / image alt is still shown but inert.
   *
   * Default policy is a DENYLIST: `javascript:`, `vbscript:`, `data:`, `file:`
   * are blocked; every other scheme and any scheme-less URL (relative,
   * fragment, protocol-relative) passes. Set `false` ONLY for fully trusted
   * input where you want authored URLs passed through verbatim.
   */
  sanitizeUrls?: boolean
  /**
   * Wrap each top-level heading, and the content following it up to the next
   * same-or-shallower heading, in a `<section id="{slug}">` (grammar PART 9
   * §13). On by default, which is what the conformance corpus pins.
   *
   * Set `false` to render headings flat: the id goes back on the `<h*>`
   * alongside its other attributes, and the blocks that would have been the
   * section's children stay as siblings - so they also lose the two-space
   * indentation they carried as container children.
   *
   * ```
   * # A          sections: true      sections: false
   * p            <section id="A">    <h1 id="A">A</h1>
   *                <h1>A</h1>        <p>p</p>
   *                <p>p</p>
   *              </section>
   * ```
   *
   * For a site whose CSS or JS assumes rendered blocks are direct children of
   * the content container (the `.stack > * + *` spacing idiom, `:first-child`,
   * `nth-child()` counting, `element.children` walks), the wrapper is the one
   * output change a clean source migration still breaks.
   *
   * Nothing else is affected: ids, the dedup namespace, `</#id>` crossrefs,
   * implicit `[Heading][]` references, `::: toc`, endnotes placement and
   * heading numbering all resolve against the slug rather than the element
   * carrying it. The `<section role="doc-endnotes">` region is a separate
   * construct and is emitted either way. A heading inside a container was
   * never wrapped, so it renders identically under both settings - which is
   * the point: with this off, one placement rule covers the whole document.
   */
  sections?: boolean
  /**
   * Turn the smart-typography substitution OFF for the whole document
   * (default `true`, i.e. on). PART 9 §8's optional off switch.
   *
   * This is a RENDERING decision, not a parsing one: the nodes are still
   * produced, so the AST does not depend on it. With it off, each
   * `smart_punctuation` node emits the author's SOURCE RUN instead of its
   * glyph - dashes, ellipsis, quotes, arrows, comparisons and the typographic
   * symbols - exactly as the canonical writer already does.
   *
   * Escaping is unaffected, deliberately: that is a separate concern with its
   * own rationale (carve#357).
   */
  smartTypography?: 'glyph' | 'source' | boolean
  /**
   * Opt in to a strict ALLOWLIST instead of the default denylist: when set,
   * ONLY these schemes pass on `href`/`src` (case-insensitive); everything
   * else is blanked. No effect when `sanitizeUrls` is `false`.
   */
  allowedUrlSchemes?: string[]
  /**
   * Customize the default scheme DENYLIST (case-insensitive). Ignored when
   * `allowedUrlSchemes` is set. Defaults to the `DANGEROUS_URL_SCHEMES` set:
   * the script class (`javascript`, `vbscript`, `data`, `file`) plus the
   * OS protocol-handler / command-execution class (`ms-office`, `ms-msdt`,
   * `search-ms`, `shell`, `vscode`, `jar`, …) behind CVE-2026-20841.
   */
  deniedUrlSchemes?: string[]
  /**
   * Allow raw HTML passthrough (the `` `…`{=html} `` inline and ` ```=html `
   * block forms) to emit verbatim. On by default, matching the conformance
   * corpus. Set `false` for UNTRUSTED input: raw-HTML content is then escaped
   * to text instead of emitted, closing the one author-controlled raw-HTML
   * injection vector. Non-HTML raw formats are unaffected.
   */
  allowRawHtml?: boolean
}

/**
 * Dangerous URL schemes blocked by default on links/images/autolinks and
 * `{href=…}` / `{src=…}` attribute overrides (denylist). Two classes:
 *
 *  1. Script / inline-content schemes: `javascript`, `vbscript`, `data`,
 *     `file` - the classic XSS / local-file vectors.
 *  2. OS protocol-handler / command-execution schemes (the CVE-2026-20841
 *     class): a markup link a consumer routes to the operating-system handler
 *     can open a macro document or run a command - e.g. `ms-office:ofe|u|…`,
 *     `ms-msdt:` (Follina), `search-ms:`, `shell:`, `vscode://`, `jar:`. These
 *     never have a legitimate use in a content-markup document, so they are
 *     blanked exactly like the script class above.
 *
 * This is the SINGLE source of truth referenced by both the link/image URL
 * sanitizer and the attribute-override value sanitizer, so the spec corpus and
 * sibling engines can pin the exact set. Match is case-insensitive and
 * obfuscation-resistant (see `SCHEME_PROBE_STRIP_RE`). Legitimate non-command
 * schemes (`http`, `https`, `mailto`, `tel`, `ftp`, `sms`, …) stay allowed.
 */
export const DANGEROUS_URL_SCHEMES = [
  // Script / inline-content / local-file vectors.
  'javascript',
  'vbscript',
  'data',
  'file',
  // OS protocol-handler / command-execution schemes (CVE-2026-20841 class).
  'ms-msdt',
  'ms-office',
  'ms-word',
  'ms-excel',
  'ms-powerpoint',
  'ms-access',
  'ms-visio',
  'ms-project',
  'ms-publisher',
  'ms-infopath',
  'ms-spd',
  'ms-search',
  'search-ms',
  'ms-cxh',
  'ms-cxh-full',
  'shell',
  'vscode',
  'vscode-insiders',
  'jar',
]

/**
 * Neutralize a dangerous URL on a link `href` or image `src`, defeating
 * `javascript:` / `data:` style injection.
 *
 * Default policy is a DENYLIST: a URL whose scheme is `javascript`,
 * `vbscript`, `data`, or `file` collapses to an empty string (link text /
 * image alt still shows, element inert); every other scheme and any
 * scheme-less URL (relative, query, fragment, protocol-relative `//host`)
 * passes. Pass `allowedUrlSchemes` to switch to a strict ALLOWLIST instead;
 * pass `deniedUrlSchemes` to customize the denylist.
 *
 * Scheme detection ignores leading C0 control characters, whitespace, and
 * Unicode separators, which browsers strip (or that obfuscate) before a
 * scheme is parsed - so `\tjavascript:`, ` javascript:`, and a NBSP-prefixed
 * scheme are caught, not bypassed. The returned value is still passed through
 * `escapeAttr` by the caller.
 */
/**
 * Characters dropped before scheme detection: every control character plus
 * every whitespace character. Written as explicit ranges rather than
 * `[\p{Cc}\s]` - which it is exactly equal to - so the class is auditable in a
 * diff and a future narrowing has to name what it drops.
 *
 * The `\s` class (with the `u` flag) covers every Unicode space separator -
 * NBSP (U+00A0), NARROW NO-BREAK SPACE (U+202F), the U+2000..U+200A spaces,
 * MEDIUM MATHEMATICAL SPACE (U+205F), IDEOGRAPHIC SPACE (U+3000), OGHAM SPACE
 * MARK (U+1680), line/paragraph separators (U+2028 / U+2029), the BOM /
 * zero-width no-break space (U+FEFF), and ASCII whitespace - while the explicit
 * ranges strip the non-whitespace controls `\s` omits: U+0000..U+0008,
 * U+000E..U+001F, DEL (U+007F) and the C1 block (U+0080..U+009F).
 *
 * THIS IS A PROBE CLASS AND IT IS DELIBERATELY WIDER THAN PART 9 section 29's
 * EMIT CLASS. Section 29 governs what a target may write; this governs what the
 * scheme probe must see THROUGH, and the two answer different questions. DEL
 * and the C1 block sit OUTSIDE section 29 by T5, and that is precisely why they
 * have to be named here: while the class was the section 29 one,
 * `java<DEL>script:alert(1)` reached an `href` with the raw `7f` byte intact
 * while the plain spelling was blanked (markup-carve/carve-js#915).
 *
 * The membership test is "may a URL consumer discard this character before it
 * reads the scheme", NOT "is this character a control". Stripping only ever
 * REMOVES characters, so widening the class can deny more and can never allow
 * more - which is what makes the wide class the safe default here.
 */
export const SCHEME_PROBE_STRIP_RE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\s]+/gu

function sanitizeUrl(url: string, opts: RenderOptions): string {
  if (opts.sanitizeUrls === false) return url
  // Browsers ignore C0 controls and whitespace when reading the scheme;
  // strip them for detection so obfuscated schemes can't slip through.
  const probe = url.replace(SCHEME_PROBE_STRIP_RE, '')
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe)
  if (!scheme) return url
  const s = scheme[1].toLowerCase()
  // Explicit allowlist (opt-in): only the listed schemes pass.
  if (opts.allowedUrlSchemes) {
    return opts.allowedUrlSchemes.some((a) => a.toLowerCase() === s) ? url : ''
  }
  // Default: denylist of dangerous schemes.
  const denied = opts.deniedUrlSchemes ?? DANGEROUS_URL_SCHEMES
  return denied.some((d) => d.toLowerCase() === s) ? '' : url
}

/** HTML-injection sink attributes that are unsafe regardless of value. Event
 *  handlers (`on*`) and these are stripped from ALL rendered attributes, always
 *  - there is no legitimate use in a content-markup document. */
const DANGEROUS_ATTR_NAMES = new Set(['srcdoc', 'formaction'])
function isDangerousAttrName(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('on') || DANGEROUS_ATTR_NAMES.has(n)
}

const HTML_ATTR_NAME_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/

/** URL schemes that must never appear in an attribute value. Derived from the
 *  single `DANGEROUS_URL_SCHEMES` denylist so `{href=…}` / `{src=…}` overrides
 *  block exactly the same set as link/image URLs (script class + the
 *  OS protocol-handler / command-execution class, CVE-2026-20841). */
const DANGEROUS_VALUE_SCHEMES = new Set(DANGEROUS_URL_SCHEMES)

/**
 * Blank an attribute value that carries a dangerous URL scheme or a CSS
 * `expression(...)`, so an author cannot smuggle script through an attribute
 * the name filter allows (e.g. `background`, `style`). The scheme is
 * normalized (C0 controls + spaces stripped) before comparison to defeat
 * `java\tscript:` style evasion, matching the link/image URL sanitizer.
 */
function sanitizeAttrValue(name: string, value: string): string {
  const colon = value.indexOf(':')
  if (colon !== -1) {
    const scheme = value.slice(0, colon).replace(SCHEME_PROBE_STRIP_RE, '').toLowerCase()
    if (DANGEROUS_VALUE_SCHEMES.has(scheme)) return ''
  }
  if (name.toLowerCase() === 'style' && hasDangerousCss(value)) return ''
  return value
}

/**
 * The value this renderer WRITES for a raw `name="…"` attribute, before
 * escaping - which is to say, the authored text unless the sanitizer above
 * blanked it.
 *
 * The single place that answers "what does the output actually contain?" for a
 * raw attribute, so a caller outside the renderer cannot answer it from a
 * second copy of the rules. `lint.ts` quotes it in
 * `semantic-attribute-outside-span` (markup-carve/carve-js#1058), where naming
 * the authored text instead would describe an output that does not exist:
 * `{kbd="javascript:alert(1)"}` renders `kbd=""`.
 */
export function renderedAttrValue(name: string, value: string): string {
  return sanitizeAttrValue(name, value)
}

/** How this renderer escapes a value it writes inside `name="…"`. */
export function escapeAttrValue(value: string): string {
  return escapeAttr(value)
}

/** Detect script-bearing / fetching constructs in a CSS `style` value. Blanks
 *  the whole value rather than attempting CSS surgery: `expression()` (legacy
 *  IE script), `url(...)` (can fetch or carry `javascript:`), `@import`, and
 *  the legacy `behavior` / `-moz-binding` script bindings. Whitespace is
 *  collapsed first so `expr ession (` cannot evade. */
function hasDangerousCss(value: string): boolean {
  // Decode CSS escapes BEFORE lowercasing: an escaped uppercase code point
  // (e.g. `\55` -> `U`) must fold to lowercase too, or `\55rl(` would slip past
  // the lowercase needles.
  const compact = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, ''))
    .toLowerCase()
    .replace(/\s+/g, '')
  return (
    compact.includes('expression(') ||
    compact.includes('url(') ||
    compact.includes('@import') ||
    compact.includes('behavior:') ||
    compact.includes('-moz-binding')
  )
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_m, esc: string) => {
    if (/^[0-9a-f]/i.test(esc)) {
      const hex = esc.trim()
      const cp = Number.parseInt(hex, 16)
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    }
    return esc
  })
}

/** Inject `data-source-line` into the first opening tag of a rendered block. */
/**
 * Inject `data-source-line` into the first opening tag of a rendered block,
 * placed after any author attributes (immediately before the closing `>` or
 * `/>`), byte-for-byte with carve-php and carve-rs which append it last.
 */
function withSourceLine(html: string, line: number | undefined): string {
  if (line === undefined) return html
  const open = /^\s*<[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?>/.exec(html)?.[0]
  if (open && /\sdata-source-line(?:\s|=|>)/i.test(open)) return html
  // $1 = `<tag` + author attrs, $2 = the closing `>` or ` />`. The attr scan
  // steps over quoted values so a `>` inside a quoted attribute (possible in
  // extension-rendered raw HTML, e.g. `<div title="a > b">`) is not mistaken
  // for the end of the tag. Core output escapes `>` in values, so this only
  // matters for extension HTML.
  return html.replace(
    /^(\s*<[A-Za-z][A-Za-z0-9-]*(?:"[^"]*"|'[^']*'|[^>"'])*?)(\s*\/?>)/,
    `$1 data-source-line="${line}"$2`,
  )
}

function hasAuthoredSourceLine(attrs?: Attrs): boolean {
  return Object.keys(attrs?.keyValues ?? {}).some((k) => k.toLowerCase() === 'data-source-line')
}

function sourceLineAttr(
  opts: RenderOptions,
  line: number | undefined,
  attrs?: Attrs,
): string {
  return opts.sourceLine && line !== undefined && !hasAuthoredSourceLine(attrs)
    ? ` data-source-line="${line}"`
    : ''
}

/** Allowed render modes. `"print"` / `"email"` are reserved, not yet valid. */
const RENDER_MODES = new Set(['interactive', 'static'])

export function renderHtml(ast: Document, opts: RenderOptions = {}): string {
  // PART 9 §10: an extension may add semantic span names. Core renders them,
  // so the order below is the union in the canonical order rather than
  // whatever sequence the extensions were registered in.
  const declared = opts.extensions?.flatMap((e) => e.semanticSpanNames ?? []) ?? []
  if (declared.length > 0 && opts.semanticSpanNames === undefined) {
    opts = {
      ...opts,
      semanticSpanNames: EXTENDED_SEMANTIC_SPAN_ORDER.filter(
        (name) => CORE_SEMANTIC_SPAN_ORDER.includes(name as never) || declared.includes(name),
      ),
    }
  }
  // Reject an unknown mode rather than guess (spec: an impl MUST reject an
  // unknown mode value). Omitting it means "interactive".
  if (opts.mode !== undefined && !RENDER_MODES.has(opts.mode)) {
    throw new Error(
      `renderHtml: unknown render mode ${JSON.stringify(opts.mode)} ` +
        `(expected "interactive" or "static")`,
    )
  }
  // Save/restore (not clear-to-null): an extension HTML renderer may call
  // renderHtml() recursively while the outer document renders. Restoring the
  // previous tracker keeps the outer document's abbreviation budget intact.
  const prevBudget = abbrBudget
  const prevDocIds = docIds
  const prevOptions = activeRenderOptions
  abbrBudget = budgetForDocument(ast)
  docIds = collectDocumentIds(ast)
  activeRenderOptions = opts
  try {
    return renderDocumentBody(ast, opts)
  } finally {
    abbrBudget = prevBudget
    docIds = prevDocIds
    activeRenderOptions = prevOptions
  }
}

function renderDocumentBody(ast: Document, opts: RenderOptions): string {
  const out: string[] = []
  // Section-wrapping pass (grammar PART 9 §13): every top-level heading
  // opens a <section id="{slug}"> that holds the heading and the content
  // up to the next same-or-shallower heading. The id lives on the
  // <section>, not on the <h*>. Sections nest by heading level.
  //
  // With `sections: false` no wrapper is emitted and the id stays on the
  // <h*>, which is exactly how a heading inside a container has always
  // rendered. The stack then never grows, so `closeTo` and the
  // `sectionStack.length` indent both fall to no-ops rather than needing a
  // second code path. The endnotes `<section role="doc-endnotes">` is a
  // different construct and is unaffected by the option.
  const wrapSections = opts.sections !== false
  const sectionStack: number[] = [] // open section heading-levels, outer→inner

  const closeTo = (level: number): void => {
    while (sectionStack.length && sectionStack[sectionStack.length - 1]! >= level) {
      sectionStack.pop()
      out.push(`${indent(sectionStack.length)}</section>`)
    }
  }

  // Number footnote refs by document reference order before rendering.
  const footnotes = collectFootnotes(ast)
  // `::: footnotes` placement directive: when present, the endnotes section is
  // flushed at the marker instead of at document end (see the intercept below).
  let footnotesPlaced = false

  // Document TRAILERS: blocks held in `children` that belong to the document
  // rather than to the section a heading opened around them. Skipped here and
  // emitted after `closeTo(1)` below, which is the only way out of a `<section>`
  // - see `Document.trailerBlocks` for why one option produced four placements
  // without it (markup-carve/carve-js#728).
  //
  // Identity, not shape: the marker is a reference to the very node in
  // `children`, so an authored `raw_block` that happens to look like the one an
  // extension inserted is never mistaken for it.
  const trailers = new Set<BlockNode>(ast.trailerBlocks ?? [])
  // The other half of the same identity test, and the one that has to be here.
  // A profile REMOVES a denied node from `children` while the mark that named
  // it stays behind, so a trailer loop reading the mark alone would re-emit
  // content the profile stripped. Answered where the emission happens rather
  // than where the removal does: this is the only place that can resurrect it,
  // so it is the only place the check can fail. A copy of it in the filter was
  // green under every mutation, which is what a check that cannot fail looks
  // like.
  const documentChildren = new Set<BlockNode>(ast.children)

  for (const node of ast.children) {
    if (node.type === 'abbreviation_def') continue
    if (trailers.has(node)) continue
    // `::: footnotes` flushes the endnotes section HERE instead of at document
    // end. Only the first marker in a document that actually has footnotes
    // places; any other `::: footnotes` (or one in a document with no notes)
    // falls through to its default typed-div rendering. A document without the
    // marker is byte-identical to the previous behavior (default end append).
    if (isFootnotePlacement(node) && footnotes.order.length && !footnotesPlaced) {
      // Preserve any blocks authored inside the placeholder before flushing.
      for (const child of (node as Admonition).children) {
        const r = renderBlock(child, opts, sectionStack.length)
        if (r !== '') out.push(r)
      }
      // Flush the endnotes in place at the marker. Do NOT close open sections:
      // that would drop any following content out of its section (and diverged
      // from carve-php / carve-rs, which insert the section at the marker).
      out.push(renderFootnoteSection(ast, footnotes, opts))
      footnotesPlaced = true
      continue
    }
    if (node.type === 'heading') {
      closeTo(node.level)
      const depth = sectionStack.length
      if (wrapSections) {
        // The id moves to <section>; any other heading attrs (classes,
        // key-values) stay on the <h*>.
        const id = node.attrs?.id
        // `!== undefined` so an explicit empty `id=""` renders `id=""` on the
        // <section> (it already suppressed the auto-slug in resolveHeadingIds).
        const sectionId = id !== undefined ? ` id="${escapeAttr(id)}"` : ''
        out.push(`${indent(depth)}<section${sectionId}>`)
        sectionStack.push(node.level)
      }
      // Where the <h*> sits: one level in when a wrapper opened above it,
      // at the document level when it did not.
      const headingLevel = wrapSections ? depth + 1 : depth
      // An extension may render the <h*> element itself (e.g. heading
      // permalinks); the <section> wrapper above stays core. Returns undefined
      // to fall through to the default heading rendering. The node it receives
      // carries the id under either setting - only the emission site moves.
      const custom = renderHeadingElement(node, opts, headingLevel)
      if (custom !== undefined) {
        out.push(opts.sourceLine ? withSourceLine(custom, node.pos?.startLine) : custom)
        continue
      }
      const headingAttrs = wrapSections ? stripId(node.attrs) : node.attrs
      const inner = renderInlines(node.children, opts)
      const slAttr = sourceLineAttr(opts, node.pos?.startLine, headingAttrs)
      out.push(
        `${indent(headingLevel)}<h${node.level}${renderAttrs(headingAttrs)}${slAttr}>${inner}</h${node.level}>`,
      )
      continue
    }
    const rendered = renderBlock(node, opts, sectionStack.length)
    if (rendered !== '') out.push(rendered)
  }
  closeTo(1) // close any sections still open at end of document
  if (footnotes.order.length && !footnotesPlaced) out.push(renderFootnoteSection(ast, footnotes, opts))
  // AFTER the endnotes, which are themselves a `<section>` - so "after the last
  // section" means after that one too. carve-php reaches the same place from
  // the other end: its TOC extension is a render listener that appends to the
  // finished HTML string, `$html . $separator . $tocHtml`.
  for (const node of trailers) {
    if (!documentChildren.has(node)) continue
    const rendered = renderBlock(node, opts, 0)
    if (rendered !== '') out.push(rendered)
  }
  return out.join('\n')
}

/** A `::: footnotes` placement directive (typed admonition, kind `footnotes`):
 *  marks where the endnotes section should render instead of at document end. */
function isFootnotePlacement(node: BlockNode): boolean {
  return node.type === 'admonition' && (node as Admonition).kind === 'footnotes'
}

interface FootnoteEntry {
  /** Reference label, for a `[^label]` note; undefined for an inline note. */
  label?: string
  /** Inline content, for an `^[content]` note; undefined for a reference note. */
  inline?: InlineNode[]
  /** 1-based source line of the note body, when known. */
  sourceLine?: number
  /** Backlink-target ids in reference order. */
  backrefs: string[]
}

interface FootnoteState {
  /** Note instances in document order; index + 1 = number. */
  order: FootnoteEntry[]
}

/**
 * Number footnotes (shared with `resolve()`, carve-js#479) then build the
 * rendering-only parts on top: the `order` list an endnotes section walks,
 * and per-reference `refId` backlink anchors. `number` may already be set
 * (this document went through `resolve()` first) or not (renderHtml called
 * standalone) - `numberFootnotes` is idempotent either way, since it is pure
 * document order.
 */
function collectFootnotes(ast: Document): FootnoteState {
  const { order: numbered, refs } = numberFootnotes(ast)
  const order: FootnoteEntry[] = numbered.map((e) => {
    const entry: FootnoteEntry = { backrefs: [] }
    if (e.label !== undefined) entry.label = e.label
    if (e.inline !== undefined) entry.inline = e.inline
    if (e.sourceLine !== undefined) entry.sourceLine = e.sourceLine
    return entry
  })
  // Occurrence count keyed by orderIndex (not label): an inline footnote's
  // orderIndex is unique to itself, so this counts reference-footnote
  // repeats and inline single-occurrences uniformly.
  const seen: Record<number, number> = {}
  for (const { node: n, orderIndex } of refs) {
    const number = orderIndex + 1
    const occ = (seen[orderIndex] = (seen[orderIndex] ?? 0) + 1)
    const refId = occ === 1 ? `fnref${number}` : `fnref${number}-${occ}`
    n.refId = refId
    order[orderIndex]!.backrefs.push(refId)
  }
  return { order }
}

/**
 * Endnotes section, djot-compatible roles. The backlink glyph is the
 * plain return arrow `↩` (Carve's choice; djot appends a variation
 * selector). Indentation follows Carve's house style.
 */
function renderFootnoteSection(ast: Document, st: FootnoteState, opts: RenderOptions): string {
  // The endnotes render outside every anchor, whatever the reference sites
  // were inside, so a crossref in a note body is a real link again.
  return outsideLink(() => renderFootnoteSectionInner(ast, st, opts))
}

function renderFootnoteSectionInner(
  ast: Document,
  st: FootnoteState,
  opts: RenderOptions,
): string {
  const defs = ast.footnoteDefs ?? {}
  const lines: string[] = ['<section role="doc-endnotes">', `${indent(1)}<hr>`, `${indent(1)}<ol>`]
  st.order.forEach((entry, idx) => {
    const number = idx + 1
    const body = entry.inline
      ? [`${indent(3)}<p>${renderInlines(entry.inline, opts)}</p>`]
      : (ownValue(defs, entry.label!) ?? []).map((b) => renderBlock(b, opts, 3))
    // A note referenced once gets a plain `↩`; a note referenced N>1 times gets
    // one numbered backlink per reference (`↩<sup>k</sup>`, space-separated) so
    // each return arrow is distinct (matches carve-php + pandoc).
    const multiRef = entry.backrefs.length > 1
    const blink = entry.backrefs
      .map(
        (rid, k) =>
          `<a href="#${rid}" role="doc-backlink">↩${multiRef ? `<sup>${k + 1}</sup>` : ''}</a>`,
      )
      .join(multiRef ? ' ' : '')
    const last = body.length - 1
    if (last >= 0 && /<\/p>\s*$/.test(body[last]!)) {
      body[last] = body[last]!.replace(/<\/p>(\s*)$/, `${blink}</p>$1`)
    } else {
      body.push(`${indent(3)}<p>${blink}</p>`)
    }
    lines.push(
      // The endnote item carries the definition's source line so editor
      // integrations can map the rendered footnote back to its source.
      `${indent(2)}<li id="fn${number}"${sourceLineAttr(opts, entry.sourceLine)}>`,
      ...body,
      `${indent(2)}</li>`,
    )
  })
  lines.push(`${indent(1)}</ol>`, '</section>')
  return lines.join('\n')
}

/** Copy attrs without the `id` (the id moves to the enclosing <section>). */
function stripId(attrs?: Attrs): Attrs | undefined {
  if (!attrs) return undefined
  if (attrs.id === undefined) return attrs
  const { id: _omit, ...rest } = attrs
  return rest
}

/** Copy attrs without a given key-value (e.g. a structural `href`). */
function stripKeyValue(attrs: Attrs | undefined, key: string): Attrs | undefined {
  if (!attrs?.keyValues) return attrs
  // HTML attribute names are case-insensitive, so a `{HREF=...}` override
  // must be dropped just like `{href=...}` - otherwise it slips past the
  // structural-URL sanitization as a second, unsanitized attribute.
  const lower = key.toLowerCase()
  const matches = (k: string) => k.toLowerCase() === lower
  if (!Object.keys(attrs.keyValues).some(matches)) return attrs
  const kv: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs.keyValues)) if (!matches(k)) kv[k] = v
  const result: Attrs = { ...attrs, keyValues: kv }
  if (attrs.order) result.order = attrs.order.filter((s) => !matches(s))
  return result
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function renderAttrs(attrs?: Attrs): string {
  if (!attrs) return ''
  const parts: string[] = []
  const classAttr = () =>
    attrs.classes && attrs.classes.length
      ? // Merge into one class attribute, deduping repeats keeping first-
        // occurrence order (`{.a .a}` -> `class="a"`), matching carve-php (§15).
        `class="${[...new Set(attrs.classes)].map(escapeAttr).join(' ')}"`
      : ''
  // Escape the id value: an `#id` is identifier-restricted (escaping is a
  // no-op), but `id=value` (which now also feeds this slot, last-wins §15) can
  // carry arbitrary quoted text and must not inject markup.
  // `!== undefined`, not truthiness: an explicit `id=""` is a real (empty) id
  // and must render `id=""` (matches carve-php), the same last-wins slot as
  // `#id`/`id=value`. Escape the value: `#id` is identifier-restricted (escape
  // is a no-op), but `id=value` can carry arbitrary quoted text.
  const idAttr = () => (attrs.id !== undefined ? `id="${escapeAttr(attrs.id)}"` : '')
  const kvAttr = (k: string) => {
    // Always strip event-handler / injection-sink attribute names, and blank a
    // dangerous-scheme or CSS-expression value, regardless of render options.
    if (isDangerousAttrName(k)) return ''
    if (!HTML_ATTR_NAME_RE.test(k)) return ''
    const v = attrs.keyValues?.[k]
    return v !== undefined ? `${k}="${escapeAttr(sanitizeAttrValue(k, v))}"` : ''
  }
  // Emit the recorded source order first (matches djot + carve-php),
  // then append any populated slot not covered by `order` -- so an attr
  // added programmatically after parse() (with stale/no `order`) still
  // renders rather than being silently dropped.
  const seen = new Set(attrs.order ?? [])
  if (attrs.order) {
    for (const slot of attrs.order) {
      const p = slot === '.class' ? classAttr() : slot === '#id' ? idAttr() : kvAttr(slot)
      if (p) parts.push(p)
    }
  }
  if (!seen.has('.class')) {
    const c = classAttr()
    if (c) parts.push(c)
  }
  if (!seen.has('#id')) {
    const i = idAttr()
    if (i) parts.push(i)
  }
  if (attrs.keyValues) {
    for (const k of Object.keys(attrs.keyValues)) {
      if (!seen.has(k)) {
        const p = kvAttr(k)
        if (p) parts.push(p)
      }
    }
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

/**
 * PART 9 §9: the names core reserves on a span, inner to outer.
 *
 * THREE, not the seven this once carried. A name is core when it carries data
 * the author would otherwise lose (`abbr`'s expansion, `time`'s machine-readable
 * value) or when a core clause already rules its interaction (`abbr` again,
 * against abbreviation definitions); `kbd` is core on ubiquity alone. `samp`,
 * `var`, `cite` and `dfn` are the SemanticSpan extension's (PART 9 §10) and
 * reach this renderer through {@link RenderOptions.semanticSpanNames}.
 */
export const CORE_SEMANTIC_SPAN_ORDER = ['abbr', 'time', 'kbd'] as const

/** The extension's full order, for the four names it adds. */
export const EXTENDED_SEMANTIC_SPAN_ORDER = ['abbr', 'time', 'samp', 'var', 'kbd', 'cite', 'dfn'] as const

/** The attribute a non-empty value maps to, per name. */
const SEMANTIC_VALUE_ATTRIBUTE: Record<string, string | undefined> = {
  abbr: 'title',
  dfn: 'title',
  time: 'datetime',
}

/** Render PART 9 §9 semantic attributes on an ordinary span. */
export function renderSemanticSpanWith(
  node: Span,
  opts: RenderOptions,
  order: readonly string[],
): string {
  const values = node.attrs?.keyValues
  const names = order.filter((name) => values?.[name] !== undefined)
  const previousSuppress = suppressAutomaticAbbreviation
  if (values?.abbr !== undefined) suppressAutomaticAbbreviation = true
  let body: string
  try {
    body = renderInlines(node.children, opts)
  } finally {
    suppressAutomaticAbbreviation = previousSuppress
  }
  if (names.length === 0) return `<span${renderAttrs(node.attrs)}>${body}</span>`

  // PART 9 §9: leftovers RIDE the outermost semantic element. A consumed name
  // RENAMES the span rather than wrapping it, so the author's id, classes and
  // remaining key/values land on the element they were written on.
  const isSemantic = (key: string) => order.includes(key)
  const keyValues = Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => !isSemantic(key)))
  const riding: Attrs = { ...node.attrs, keyValues }
  if (riding.order) riding.order = riding.order.filter((key) => !isSemantic(key))

  let html = body
  const outermost = names[names.length - 1]
  for (const name of names) {
    const value = values![name]!
    const mapsTo = value !== '' ? SEMANTIC_VALUE_ATTRIBUTE[name] : undefined
    // A DERIVED ATTRIBUTE YIELDS TO AN AUTHORED ONE of the same name: `title`
    // and `datetime` are names an author may also write, and one element never
    // carries the same attribute twice.
    const attrs: Attrs = name === outermost ? riding : {}
    const derived = mapsTo !== undefined && attrs.keyValues?.[mapsTo] === undefined
      ? ` ${mapsTo}="${escapeAttr(value)}"`
      : ''
    html = `<${name}${derived}${renderAttrs(attrs)}>${html}</${name}>`
  }
  return html
}

function renderSemanticSpan(node: Span, opts: RenderOptions): string {
  return renderSemanticSpanWith(node, opts, opts.semanticSpanNames ?? CORE_SEMANTIC_SPAN_ORDER)
}

/**
 * Like renderAttrs, but merges a mandatory `baseClass` ahead of author
 * classes (math keeps `math inline` while honoring `{.foo}`), and can
 * drop the author id when a structural id already exists (footnote refs).
 * With no attrs and no baseClass it returns '' — unchanged output.
 */
function renderAttrs2(
  attrs: Attrs | undefined,
  opts: { baseClass?: string; trailingClass?: string; dropId?: boolean } = {},
): string {
  if (!attrs && !opts.baseClass && !opts.trailingClass) return ''
  // Build a synthetic Attrs and delegate to renderAttrs so author
  // attributes still emit in source order (PART 10 §1): merge a
  // mandatory base class ahead of author classes (math keeps
  // `math inline` while honoring `{.foo}`), and optionally drop the
  // author id when a structural id already exists (footnote refs).
  const a: Attrs = attrs ? { ...attrs } : {}
  if (opts.baseClass) {
    a.classes = [opts.baseClass, ...(a.classes ?? [])]
    if (a.order && !a.order.includes('.class')) a.order = ['.class', ...a.order]
  }
  // A structural class the CONSTRUCT owns (not one the author wrote) trails the
  // author's own attributes: `{.foo #v}` on a line block renders
  // `class="foo line-block" id="v"`, matching carve-php and carve-rs.
  if (opts.trailingClass) {
    a.classes = [...(a.classes ?? []), opts.trailingClass]
    if (a.order && !a.order.includes('.class')) a.order = [...a.order, '.class']
  }
  if (opts.dropId) {
    delete a.id
    if (a.order) a.order = a.order.filter((s) => s !== '#id')
  }
  return renderAttrs(a)
}

function renderLeadingBaseClassAttrs(attrs: Attrs | undefined, baseClass: string): string {
  const a = attrs?.order?.includes('.class')
    ? {
        ...attrs,
        order: ['.class', ...attrs.order.filter((slot) => slot !== '.class')],
      }
    : attrs
  return renderAttrs2(a, { baseClass })
}

function renderSocialLinkAttrs(
  attrs: Attrs | undefined,
  baseClass: 'mention' | 'tag',
  href: string,
): string {
  const rendered = renderLeadingBaseClassAttrs(stripKeyValue(attrs, 'href'), baseClass)
  return rendered.replace(/^ class="[^"]*"/, `$& href="${escapeAttr(href)}"`)
}

/** Build the block-extension render context for a given level. Carries the
 *  active `mode` and `renderers` so a `renderStatic` impl can branch. */
function blockCtx(opts: RenderOptions, level: number): BlockExtensionRenderContext {
  return {
    level,
    indent,
    renderChildren: (nodes, lvl) => renderBlocks(nodes, opts, lvl),
    renderInlines: (nodes) => renderInlines(nodes, opts),
    escapeHtml,
    escapeAttr,
    renderAttrs,
    uniqueId,
    mode: opts.mode ?? 'interactive',
    renderers: opts.renderers ?? {},
    sections: opts.sections !== false,
  }
}

/** The shared inline-extension render context. */
function inlineCtx(opts: RenderOptions): ExtensionRenderContext {
  return {
    renderInlines: (nodes) => renderInlines(nodes, opts),
    escapeHtml,
    escapeAttr,
    renderAttrs,
    uniqueId,
    mode: opts.mode ?? 'interactive',
    renderers: opts.renderers ?? {},
  }
}

/** Reserve an id in the per-render document id namespace (ctx.uniqueId). A
 *  render always installs a registry; the bare fallback only covers an
 *  extension calling a saved ctx outside renderHtml(). */
function uniqueId(baseId: string): string {
  return docIds ? docIds.uniqueId(baseId) : baseId
}

// Let an extension render a top-level heading's <h*> element via a
// `blockRenderers.heading` renderer (the <section> wrapper stays core), tried
// in registration order. In static mode an extension's `staticBlockRenderers.
// heading` takes precedence, then its normal `blockRenderers.heading` -
// consistent with every other core block type. Returns undefined when no
// extension claims it, so core renders the default heading.
function renderHeadingElement(
  node: Heading,
  opts: RenderOptions,
  level: number,
): string | undefined {
  if (!opts.extensions?.length) return undefined
  const isStatic = opts.mode === 'static'
  const ctx = blockCtx(opts, level)
  for (const e of opts.extensions) {
    const staticFn = isStatic ? e.staticBlockRenderers?.heading : undefined
    if (staticFn) {
      const out = staticFn(node, ctx)
      if (out !== undefined) return out
    }
    const fn = e.blockRenderers?.heading
    if (fn) {
      const out = fn(node, ctx)
      if (out !== undefined) return out
    }
  }
  return undefined
}

/** Render a container's children into its body.
 *
 *  A block that renders to nothing - a comment, an abbreviation definition, a
 *  non-HTML raw block - contributes no line. Joining its `''` in leaves a blank
 *  line where the block stood (`<div>\n\n  <p>a</p>`), which carve-php never
 *  emitted. The list item filtered already; every other container did not.
 *
 *  An all-empty body comes back as `''`, which each caller hands to the same
 *  path a childless container takes, so a genuinely empty container renders as
 *  it always did. */
function renderBlocks(nodes: BlockNode[], opts: RenderOptions, level: number): string {
  return nodes
    .map((c) => renderBlock(c, opts, level))
    .filter((s) => s !== '')
    .join('\n')
}

/**
 * Block-nesting depth of the render in progress, and its inline counterpart.
 *
 * Module-scoped rather than threaded through `opts` because `renderBlock` and
 * `renderInline` are both reached from several call sites that do not go
 * through `renderBlocks`/`renderInlines` (a figure's target, a details body),
 * so counting at the two dispatch functions is the only placement that bounds
 * EVERY path. The `finally` unwind means a refusal thrown deep in a tree leaves
 * the counters where the next render expects them.
 *
 * DELIBERATELY NOT SAVED AND RESTORED across a nested `renderHtml()`, unlike
 * `abbrBudget` and `docIds` above. Those are per-DOCUMENT resources, so a
 * nested document rightly gets its own; depth is a property of the HOST STACK,
 * which a nested render adds to rather than restarts. Resetting it would hand
 * an extension a way to defeat the ceiling entirely - re-enter `renderHtml()`
 * at each level and the count never reaches the cap while the real stack does,
 * which is the `RangeError` §25 forbids. So an extension that renders a
 * sub-document 100 levels down has 132 levels left, not another 232.
 */
let blockDepth = 0
let inlineDepth = 0

function renderBlock(node: BlockNode, opts: RenderOptions, level: number): string {
  // §25: AT THE RENDER CEILING, A RENDERER REFUSES. This renderer had no
  // ceiling at all and recursed until the host stack gave out with a
  // `RangeError` -- the "crashing" §25 forbids, and the one renderer in the
  // ecosystem that behaved unlike its own siblings (carve#526).
  if (blockDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderHtml', MAX_RENDER_DEPTH)
  blockDepth++
  try {
    return renderBlockNode(node, opts, level)
  } finally {
    blockDepth--
  }
}

function renderBlockNode(node: BlockNode, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  // Extension block renderers (keyed by node type) get first claim, tried in
  // registration order: each may return undefined to defer to the next
  // extension's renderer (so one extension can claim only some nodes of a
  // type, e.g. mermaid claims only `mermaid` code blocks), then to core.
  // Headings are excluded here: a top-level heading is rendered by the
  // section-wrapping pass (renderHeadingElement), where the id lives on the
  // <section>. A heading nested in a container keeps its id on the <h*> and is
  // rendered by core below, so heading renderers do not apply to it.
  const isStatic = opts.mode === 'static'
  // Per-node resolution, walking extensions in REGISTRATION ORDER so an
  // earlier extension's renderer always wins over a later one's (the same
  // precedence interactive mode has). For each extension in turn, static mode
  // tries (1) its `staticBlockRenderers` (the `renderStatic` hook), then (2)
  // its normal `blockRenderers`; interactive mode tries only (2). Whichever
  // returns a string takes the node; `undefined` defers to the next extension,
  // then to core (which applies the caption floor for an unconsumed div label).
  // Headings are excluded: a top-level heading is rendered by the
  // section-wrapping pass (renderHeadingElement), where the id lives on the
  // <section>. A heading nested in a container keeps its id on the <h*> and is
  // rendered by core below.
  if (node.type !== 'heading' && opts.extensions?.length) {
    const ctx = blockCtx(opts, level)
    for (const e of opts.extensions) {
      const staticFn = isStatic ? ownValue(e.staticBlockRenderers, node.type) : undefined
      if (staticFn) {
        const out = staticFn(node, ctx)
        if (out !== undefined) return opts.sourceLine ? withSourceLine(out, node.pos?.startLine) : out
      }
      const fn = ownValue(e.blockRenderers, node.type)
      if (fn) {
        const out = fn(node, ctx)
        if (out !== undefined) return opts.sourceLine ? withSourceLine(out, node.pos?.startLine) : out
      }
    }
  }
  switch (node.type) {
    case 'heading': {
      const inner = renderInlines(node.children, opts)
      return `${pad}<h${node.level}${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>${inner}</h${node.level}>`
    }
    case 'paragraph': {
      const inner = renderInlines(node.children, opts)
      return `${pad}<p${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>${inner}</p>`
    }
    case 'thematic_break':
      return `${pad}<hr${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`
    case 'code_block': {
      // The opener "header" is resolved to a `title` attribute at parse time
      // (see parseBlocks), so it renders here AND wherever else a code block is
      // emitted (e.g. inside a code-group).
      const langAttr = node.lang ? ` class="language-${node.lang}"` : ''
      const escaped = escapeHtml(node.content)
      return `${pad}<pre${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}><code${langAttr}>${escaped}\n</code></pre>`
    }
    case 'block_quote':
      return renderBlockQuote(node, opts, level)
    case 'list':
      return renderList(node, opts, level)
    case 'image': {
      const rendered = `${pad}${renderImage(node, opts)}`
      return opts.sourceLine ? withSourceLine(rendered, node.pos?.startLine) : rendered
    }
    case 'table':
      return renderTable(node, opts, level)
    case 'admonition':
      return renderAdmonition(node, opts, level)
    case 'div': {
      const open = `${pad}<div${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`
      // Core caption floor (graceful degradation): a grouping `[label]` that
      // no extension consumed must not be silently dropped. Surface it as a
      // `<p class="div-label">` at the start of the div content. (A group
      // extension consumes the node before it reaches core, so there is no
      // double rendering when one is active.)
      const floor = labelFloor(node.label, level + 1)
      const body = renderBlocks(node.children, opts, level + 1)
      if (body === '') {
        return floor ? `${open}\n${floor}\n${pad}</div>` : `${open}\n${pad}</div>`
      }
      return `${open}\n${floor ? `${floor}\n` : ''}${body}\n${pad}</div>`
    }
    case 'line_block': {
      // A line block renders as a div carrying the `line-block` class. The
      // class is part of the OUTPUT contract, not of the AST: the node type is
      // what records that every newline inside is a hard break, so a plain div
      // an author gave that class stays an ordinary div.
      const open = `${pad}<div${renderAttrs2(node.attrs, { trailingClass: 'line-block' })}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`
      const body = renderBlocks(node.children, opts, level + 1)
      if (body === '') return `${open}\n${pad}</div>`
      return `${open}\n${body}\n${pad}</div>`
    }
    case 'definition_list': {
      const lines = [
        `${pad}<dl${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`,
      ]
      for (const it of node.items) {
        for (const t of it.terms)
          lines.push(`${pad}  <dt${sourceLineAttr(opts, t[0]?.pos?.startLine)}>${renderInlines(t, opts)}</dt>`)
        for (const [di, d] of it.definitions.entries()) {
          // The dd anchors at its `:  ` marker line (the body may start
          // later, e.g. the `:  +` first-block form), matching carve-php.
          const ddLine = it.definitionLines?.[di] ?? d[0]?.pos?.startLine
          if (d.length === 1 && d[0]!.type === 'paragraph') {
            lines.push(
              `${pad}  <dd${sourceLineAttr(opts, ddLine)}>${renderInlines((d[0] as Paragraph).children, opts)}</dd>`,
            )
          } else {
            const body = renderBlocks(d, opts, level + 2)
            // A definition whose whole body renders to nothing (a lone comment)
            // closes on its own line, like the single-paragraph form above and
            // like carve-php.
            lines.push(
              body === ''
                ? `${pad}  <dd${sourceLineAttr(opts, ddLine)}></dd>`
                : `${pad}  <dd${sourceLineAttr(opts, ddLine)}>\n${body}\n${pad}  </dd>`,
            )
          }
        }
      }
      lines.push(`${pad}</dl>`)
      return lines.join('\n')
    }
    case 'figure':
      return renderFigure(node, opts, level)
    case 'figure_group':
      return renderFigureGroup(node, opts, level)
    case 'abbreviation_def':
      return ''
    case 'raw_block':
      // Raw HTML passthrough; escape it instead when raw HTML is disabled
      // (untrusted input). Non-HTML raw formats are always dropped.
      //
      // `pad` places the block where any other block would sit - inside a
      // footnote body or a list item it had been emitted flush at column 0,
      // breaking the surrounding markup's indentation (carve-js#727, corpus
      // 225-...-for-the-backlink-5). Only the OPENING position is indented: the
      // content's own line structure is passed through untouched, because
      // re-indenting a raw block's interior changes bytes the author wrote and
      // is visible inside a `<pre>`. Which of the three readings is canonical
      // for a multi-line raw block is open at markup-carve/carve#800; this
      // matches what the corpus pins without deciding it.
      return node.format === 'html'
        ? opts.allowRawHtml === false
          ? `${pad}${escapeHtml(node.content)}`
          : `${pad}${node.content}`
        : ''
    case 'comment':
      // Comments are not rendered (§4.13).
      return ''
    case 'link_reference_definition':
      // PART 12 §10: the definition line renders NOTHING itself - it feeds every
      // link or image that resolves the label (PART 9R R1). carve-php emits nothing
      // for it on this target too, which is what keeps the two in agreement.
      return ''
    case 'citation_definition':
      // PART 12 §18, and the same argument: the definition renders nothing
      // where it sits. Its entry renders in the references list the citations
      // extension builds, which is why giving the line a node moved no HTML.
      return ''
    default: {
      const t: never = node
      throw new Error(`renderHtml: unknown block ${(t as { type: string }).type}`)
    }
  }
}

function renderBlockQuote(node: BlockQuote, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  const attrs = sourceLineAttr(opts, node.pos?.startLine, node.attrs) + renderAttrs(node.attrs)
  // FRAMING COUNTS ONLY CHILDREN THAT RENDER SOMETHING, exactly as it does for
  // a list item. A comment (PART 9 section 4.13) and a raw block for another
  // target both render '', and an invisible child was enough to push a
  // single-paragraph quote into the expanded form: `> %% c` then `> y` gave
  // `<blockquote>\n  <p>y</p>\n</blockquote>` where the oracle gives the
  // compact one (markup-carve/carve#1106).
  //
  // Decided by rendering rather than by a type list, so a third node type that
  // renders nothing cannot be added silently.
  // Rendered ONCE and reused for the expanded form below. Calling `renderBlock`
  // here and letting `renderBlocks` render the same children again doubles the
  // work at every nesting level, which is exponential in depth: a 24-deep quote
  // went from under a millisecond to 3.6 seconds, and a 32-deep one did not
  // finish. The list-item renderer caches for the same reason.
  const rendered = node.children.map((child) =>
    child.type === 'paragraph' ? null : renderBlock(child, opts, level + 1),
  )
  const visible = node.children.filter((_, i) => rendered[i] !== '')
  if (visible.length === 1 && visible[0]!.type === 'paragraph') {
    const para = visible[0] as Paragraph
    const inner = renderInlines(para.children, opts)
    return `${pad}<blockquote${attrs}><p${renderAttrs(para.attrs)}${sourceLineAttr(opts, para.pos?.startLine, para.attrs)}>${inner}</p></blockquote>`
  }
  const inner = node.children
    .map((child, i) => rendered[i] ?? renderBlock(child, opts, level + 1))
    .filter((piece) => piece !== '')
    .join('\n')
  return `${pad}<blockquote${attrs}>\n${inner}\n${pad}</blockquote>`
}

function renderList(node: List, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  const tag = node.ordered ? 'ol' : 'ul'
  // An ordered list emits `type` for alpha/roman dialects and `start` when
  // it begins at n != 1 (the `)` vs `.` delimiter affects list-splitting,
  // not the rendered <ol>).
  const typeAttr = node.ordered && node.olType ? ` type="${node.olType}"` : ''
  const startAttr = node.ordered && node.start !== undefined && node.start !== 1
    ? ` start="${node.start}"`
    : ''
  const items = node.items
    .map((it) => renderListItem(it, opts, level + 1, node.tight))
    .join('\n')
  return `${pad}<${tag}${typeAttr}${startAttr}${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>\n${items}\n${pad}</${tag}>`
}

function renderListItem(
  item: ListItem,
  opts: RenderOptions,
  level: number,
  tight: boolean,
): string {
  const pad = indent(level)
  const checkbox =
    item.checked === undefined
      ? ''
      : item.checked
        ? '<input type="checkbox" checked disabled> '
        : '<input type="checkbox" disabled> '

  // `isLead` is the item's FIRST paragraph. In a tight item only the lead
  // paragraph is unwrapped (it sits on the <li> line); a SUBSEQUENT paragraph
  // -- e.g. one attached via `+` after the lead -- still renders as a real <p>
  // even though the list is tight (Bug B; carve-php parity).
  const wrapPara = (p: Paragraph, isLead: boolean) => {
    const inner = renderInlines(p.children, opts)
    // Tight items normally omit the <p> on the lead paragraph, but a paragraph
    // carrying its own attributes (e.g. a leading block-attribute line, §15)
    // must keep the <p> so the attributes survive.
    if (tight && isLead && !p.attrs) return inner
    return `<p${renderAttrs(p.attrs)}${sourceLineAttr(opts, p.pos?.startLine, p.attrs)}>${inner}</p>`
  }

  // FRAMING COUNTS ONLY CHILDREN THAT RENDER SOMETHING. A comment (§4.13) and a
  // raw block for another target both render '', and an invisible child was
  // enough to push a single-paragraph item into the expanded form:
  // `- %% c` then `  y` gave `<li>\n    y\n  </li>` where the oracle and
  // carve-php give `<li>y</li>` (carve-js#990).
  //
  // "Renders nothing" is decided by rendering, not by a type list, because two
  // unrelated node types reach it - a comment and a non-HTML raw block - and a
  // third would be added silently otherwise. The result is cached so no child
  // is rendered twice.
  const prerendered = item.children.map((child) =>
    child.type === 'paragraph' ? null : renderBlock(child, opts, level + 1),
  )
  const visible = item.children.filter((_, i) => prerendered[i] !== '')

  // Single paragraph: stays on the <li> line. Tight omits <p>, loose keeps it.
  if (visible.length === 1 && visible[0]!.type === 'paragraph') {
    return `${pad}<li${renderAttrs(item.attrs)}${sourceLineAttr(opts, item.pos?.startLine, item.attrs)}>${checkbox}${wrapPara(visible[0] as Paragraph, true)}</li>`
  }

  // Mixed content (e.g. a lead paragraph followed by a nested list): the
  // first paragraph sits on the <li> line; remaining blocks go below,
  // indented one level deeper, with the closing </li> back at item indent.
  let head = `${pad}<li${renderAttrs(item.attrs)}${sourceLineAttr(opts, item.pos?.startLine, item.attrs)}>${checkbox}`
  const body: string[] = []
  // TIGHTNESS IS A PROPERTY OF THE WHOLE ITEM, not of an individual block. PART 9
  // §17 L1 is explicit (grammar.ebnf:2991-2994): "a tight item's paragraphs ALL
  // render WITHOUT `<p>`, every one of them, not only the first".
  //
  // This carried an exception for a paragraph in the consecutive run from index
  // 0 - a `+`-attached second paragraph - which rendered a real `<p>` in a tight
  // item, on the belief that carve-php did the same. Measured, it does not:
  // carve-php and carve-rs both render it bare, and the exception was this
  // engine alone against the stated rule (carve-js#749, markup-carve/carve#809).
  //
  // It is also what made corpus 228 fail here: the item is tight, and the second
  // paragraph was the one getting wrapped.
  let seenVisible = 0
  item.children.forEach((child, i) => {
    if (child.type === 'paragraph') {
      const rendered = wrapPara(child as Paragraph, true)
      // The LEAD is the first child that renders something, not index 0: an
      // invisible child ahead of it does not take the <li> line.
      if (seenVisible === 0) head += rendered
      else body.push(`${indent(level + 1)}${rendered}`)
      seenVisible++
    } else {
      // Blocks that render to nothing are skipped: pushing `''` would leave
      // stray blank lines inside the <li> (`<p>a</p>\n\n  </li>`). Matches
      // carve-rs.
      const rendered = prerendered[i]!
      if (rendered !== '') {
        body.push(rendered)
        seenVisible++
      }
    }
  })
  if (body.length === 0) return `${head}</li>`
  return `${head}\n${body.join('\n')}\n${pad}</li>`
}

function renderTable(node: Table, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  const lines: string[] = [
    `${pad}<table${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`,
  ]
  if (node.caption) {
    lines.push(`${pad}  <caption>${renderInlines(node.caption, opts)}</caption>`)
  }

  // Build effective rowspan/colspan by walking rows.
  // For each cell, compute span counts: a '^' cell extends the cell above;
  // a '<' cell extends the cell to its left.
  const grid: Array<Array<{ row: TableRow; cell: TableCell; rowspan: number; colspan: number; skip: boolean; align?: 'left' | 'right' | 'center' }>> = []
  for (let r = 0; r < node.rows.length; r++) {
    const row = node.rows[r]!
    const gridRow: typeof grid[number] = []
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c]!
      gridRow.push({ row, cell, rowspan: 1, colspan: 1, skip: false })
    }
    grid.push(gridRow)
  }
  // Per column, the last row index (above the current one) a '^' resolves
  // against. Maintained incrementally so a '^' resolves in O(1) instead of
  // walking up every prior row (an all-'^' table was O(rows^2)).
  const base: number[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const entry = grid[r]![c]!
      if (entry.skip) continue
      if (entry.cell.span === 'rowspan' && r > 0) {
        const up = base[c]
        const src = up !== undefined ? grid[up]?.[c] : undefined
        if (src) {
          // A '^' standing under a merged '<' is ABSORBED: it renders nothing.
          // A cell spanning both ways carries a mark into each column it
          // covers, and the origin's rowspan is grown by the mark at the
          // origin's own index; the count this one adds lands on the merged
          // '<', which renders nothing either, so it is discarded with it. (A
          // branch skipping the increment was here and no mutation of it could
          // change an output.) Before this, such a mark found no source at all
          // and rendered an empty cell, putting a `<td>` in a row the spans
          // above it already cover.
          src.rowspan++
          entry.skip = true
        }
      } else if (entry.cell.span === 'colspan' && c > 0) {
        let left = c - 1
        while (left >= 0 && grid[r]![left]!.skip) left--
        const src = grid[r]![left]
        if (src) {
          src.colspan++
          entry.skip = true
        }
      }
      // Any cell that is not a RESOLVED '^' is what the cells below it in this
      // column resolve against - a merged '<' included, because the column it
      // covers is still a column of the grid.
      if (!entry.skip || entry.cell.span === 'colspan') base[c] = r
    }
  }

  // Detect header section: leading consecutive rows where all cells are headers
  let headerEnd = 0
  while (
    headerEnd < grid.length &&
    grid[headerEnd]!.some((e) => !e.skip) &&
    grid[headerEnd]!.every((e) => e.cell.header || e.skip)
  ) {
    headerEnd++
  }

  // Column defaults come from the header section. With multiple header
  // rows the last row that specifies an alignment for a column wins;
  // omission does not reset (so we only overwrite on an explicit marker).
  // A header colspan seeds every column it covers. Headerless tables
  // (headerEnd === 0) have no column default — body markers are the only
  // alignment available.
  const columnAlign: Array<'left' | 'right' | 'center' | undefined> = []
  for (let r = 0; r < headerEnd; r++) {
    const hr = grid[r]!
    for (let c = 0; c < hr.length; c++) {
      const entry = hr[c]!
      if (entry.skip || !entry.cell.align) continue
      for (let k = c; k < c + entry.colspan; k++) columnAlign[k] = entry.cell.align
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      const a = grid[r]![c]!.cell.align ?? columnAlign[c]
      if (a) grid[r]![c]!.align = a
    }
  }
  if (headerEnd > 0) {
    const rows = grid.slice(0, headerEnd).map((r) => renderTableRowFlat(r, opts, true))
    lines.push(`${pad}  <thead>${rows.join('')}</thead>`)
  }
  if (headerEnd < grid.length) {
    lines.push(`${pad}  <tbody>`)
    for (let r = headerEnd; r < grid.length; r++) {
      lines.push(`${pad}    ${renderTableRowFlat(grid[r]!, opts)}`)
    }
    lines.push(`${pad}  </tbody>`)
  }
  lines.push(`${pad}</table>`)
  return lines.join('\n')
}

/**
 * Drop author cell attributes that collide with a structural attribute this
 * renderer ACTUALLY emits for the cell (a computed `rowspan` / `colspan` /
 * `style` from `^`/`<` markers or column alignment) -- the computed value is
 * authoritative, so an author copy would duplicate it. Comparison is
 * case-insensitive (HTML attribute names are). When no structural attribute is
 * emitted, the author's value (e.g. a custom `style`) is preserved.
 */
function stripStructuralAttrs(attrs: Attrs | undefined, emitted: Set<string>): Attrs | undefined {
  if (!attrs?.keyValues || emitted.size === 0) return attrs
  const collides = (k: string): boolean => emitted.has(k.toLowerCase())
  if (!Object.keys(attrs.keyValues).some(collides)) return attrs
  const keyValues = Object.fromEntries(
    Object.entries(attrs.keyValues).filter(([k]) => !collides(k)),
  )
  const out: Attrs = { ...attrs, keyValues }
  if (attrs.order) out.order = attrs.order.filter((s) => !collides(s))
  return out
}

/**
 * PART 10 §T9: a header cell states what it heads - `col` in the leading
 * header-row run, `row` below it. Empty when the cell is not a header, or when
 * the author named a `scope` themselves.
 *
 * An authored value REPLACES the default rather than joining it: emitting both
 * gives `<th scope="col" scope="colgroup">`, two attributes of one name and
 * invalid HTML. Suppressing it is also what keeps `colgroup` and `rowgroup`
 * reachable, since neither has a marker spelling here.
 *
 * The test is case-INSENSITIVE, the one place this departs from Carve's
 * case-sensitive attribute names: `{Scope=…}` stays a different Carve attribute
 * and still reaches the output as `Scope`, but HTML attribute names are not
 * case-sensitive, so emitting the default beside it is the same collision by
 * another spelling.
 */
function cellScopeAttr(cell: TableCell, isHeaderCell: boolean, inHeaderRun: boolean): string {
  if (!isHeaderCell) return ''
  const keys = Object.keys(cell.attrs?.keyValues ?? {})
  if (keys.some((key) => key.toLowerCase() === 'scope')) return ''

  return ` scope="${inHeaderRun ? 'col' : 'row'}"`
}

function renderTableRowFlat(
  cells: Array<{ row: TableRow; cell: TableCell; rowspan: number; colspan: number; skip: boolean; align?: 'left' | 'right' | 'center' }>,
  opts: RenderOptions,
  inHeaderRun = false,
): string {
  // A row attribute block (`| … |{.x}`) lives on the TableRow, shared by every
  // grid entry in this row.
  const parts: string[] = [`<tr${renderAttrs(cells[0]?.row.attrs)}>`]
  for (const entry of cells) {
    if (entry.skip) continue
    const tag = entry.cell.header ? 'th' : 'td'
    const attrs: string[] = []
    const emitted = new Set<string>()
    if (entry.rowspan > 1) {
      attrs.push(`rowspan="${entry.rowspan}"`)
      emitted.add('rowspan')
    }
    if (entry.colspan > 1) {
      attrs.push(`colspan="${entry.colspan}"`)
      emitted.add('colspan')
    }
    if (entry.align) {
      attrs.push(`style="text-align: ${entry.align};"`)
      emitted.add('style')
    }
    // Author cell attributes (a `{...}` glued to the opening pipe) come first,
    // then the structural span / alignment attributes; any author copy of a
    // structural key actually emitted here is dropped to avoid a duplicate.
    // The scope default LEADS the author's attributes, which is the order the
    // corpus pins (`<th scope="col" class="highlight">`).
    const attrStr =
      cellScopeAttr(entry.cell, tag === 'th', inHeaderRun) +
      renderAttrs(stripStructuralAttrs(entry.cell.attrs, emitted)) +
      (attrs.length ? ' ' + attrs.join(' ') : '')
    parts.push(`<${tag}${attrStr}>${renderInlines(entry.cell.children, opts)}</${tag}>`)
  }
  parts.push('</tr>')
  return parts.join('')
}

/**
 * The core caption floor for an unconsumed grouping `[label]`: a
 * `<p class="div-label">` (label HTML-escaped) at the given indent level, or
 * `''` when there is no label. The label text survives in every target even
 * when no group extension (tabs / code-group) consumed it.
 */
function labelFloor(label: string | undefined, level: number): string {
  if (label === undefined || label === '') return ''
  return `${indent(level)}<p class="div-label">${escapeHtml(label)}</p>`
}

function renderAdmonition(node: Admonition, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  // `node.title` undefined => no title supplied; an empty-but-defined
  // title (`::: note ""`) still emits an (empty) title element.
  const titleLine =
    node.title !== undefined
      ? `${pad}  <p class="admonition-title">${renderInlines(node.title, opts)}</p>\n`
      : ''
  // Core caption floor: surface an unconsumed `[label]` after the title (the
  // title is rendered first when a block carries both).
  const floor = labelFloor(node.label, level + 1)
  const labelLine = floor ? `${floor}\n` : ''
  const body = renderBlocks(node.children, opts, level + 1)
  // Leading block attributes (§15) merge with the admonition's own
  // wrapper class: extra classes append, id/key attach to the wrapper.
  const canonical = CANONICAL_ADMONITION_KINDS.has(node.kind)
  const baseClass = canonical ? `admonition ${node.kind}` : node.kind
  const classValue = [baseClass, ...(node.attrs?.classes ?? [])].map(escapeAttr).join(' ')
  const restAttrs: Attrs = {}
  if (node.attrs?.id !== undefined) restAttrs.id = node.attrs.id
  if (node.attrs?.keyValues) restAttrs.keyValues = node.attrs.keyValues
  // The class is structurally first (`admonition {type}`); the id/key
  // attrs after it keep their source order (order minus the class slot).
  if (node.attrs?.order) restAttrs.order = node.attrs.order.filter((s) => s !== '.class')
  const rest = renderAttrs(restAttrs)
  const tag = canonical ? 'aside' : 'div'
  return `${pad}<${tag}${sourceLineAttr(opts, node.pos?.startLine, restAttrs)} class="${classValue}"${rest}>\n${titleLine}${labelLine}${body}\n${pad}</${tag}>`
}

function renderFigure(node: Figure, opts: RenderOptions, level: number, leadClass?: string): string {
  const pad = indent(level)
  let inner: string
  if (node.target.type === 'image') {
    inner = `${pad}  ${renderImage(node.target, opts)}`
  } else if (node.target.type === 'block_quote') {
    const bq = renderBlockQuote(node.target, opts, level + 1)
    inner = bq
  } else if (node.target.type === 'code_block' || node.target.type === 'paragraph') {
    inner = renderBlock(node.target, opts, level + 1)
  } else {
    inner = renderTable(node.target, opts, level + 1)
  }
  // A composite figure's PANEL leads its classes with the panel marker, the
  // way the group's own wrapper leads with `carve-figure-group` - the
  // class-first injection renderAdmonition uses (PART 9 §4c).
  const open =
    leadClass === undefined
      ? `${pad}<figure${renderAttrs(node.attrs)}${sourceLineAttr(opts, node.pos?.startLine, node.attrs)}>`
      : `${pad}<figure${sourceLineAttr(opts, node.pos?.startLine, node.attrs)} class="${[
          ...new Set([leadClass, ...(node.attrs?.classes ?? [])]),
        ]
          .map(escapeAttr)
          .join(' ')}"${renderAttrs(withoutClassSlot(node.attrs))}>`
  return `${open}\n${inner}\n${pad}  <figcaption>${renderInlines(
    node.caption,
    opts,
  )}</figcaption>\n${pad}</figure>`
}

/** A copy of `attrs` with the class slot removed (the caller renders it). */
function withoutClassSlot(attrs: Attrs | undefined): Attrs {
  const rest: Attrs = {}
  if (attrs?.id !== undefined) rest.id = attrs.id
  if (attrs?.keyValues) rest.keyValues = attrs.keyValues
  // The class is structurally first; the id/key attrs after it keep their
  // source order (order minus the class slot) - same rule as renderAdmonition.
  if (attrs?.order) rest.order = attrs.order.filter((s) => s !== '.class')
  return rest
}

function renderFigureGroup(node: FigureGroup, opts: RenderOptions, level: number): string {
  const pad = indent(level)
  // Class-first injection like renderAdmonition: `carve-figure-group` leads,
  // attribute-line classes merge after it, id and the rest keep source order.
  // DEDUPED, first occurrence kept - the oracle's renderBlockAttrs rule - so
  // an authored `.carve-figure-group` does not double the marker.
  const classValue = [...new Set(['carve-figure-group', ...(node.attrs?.classes ?? [])])]
    .map(escapeAttr)
    .join(' ')
  const rest = withoutClassSlot(node.attrs)
  const lines = [
    `${pad}<figure${sourceLineAttr(opts, node.pos?.startLine, rest)} class="${classValue}"${renderAttrs(rest)}>`,
  ]
  // FLAT: panels and stray content nest DIRECTLY in the group figure, no
  // wrapper div. HTML's figure content model is one figcaption first-or-last
  // plus flow content, and figure is itself flow content, so the panel
  // figures are legal direct children - the shape Pandoc's subfigure HTML
  // takes as well. The group figcaption stays last.
  const inner = node.children
    .map((c) => {
      // §4c panels: the `figure` and `table` children, in source order. A
      // captioned host already renders as a <figure> and takes the panel
      // class; a table does not render as a figure on its own, so its panel
      // wrapper is explicit and the table keeps its own attrs and <caption>.
      if (c.type === 'figure') return renderFigure(c, opts, level + 1, 'carve-figure-panel')
      if (c.type === 'table') {
        const t = renderTable(c, opts, level + 2)
        return `${pad}  <figure class="carve-figure-panel">\n${t}\n${pad}  </figure>`
      }
      // Non-panel stray content is preserved in place.
      return renderBlock(c, opts, level + 1)
    })
    .filter((s) => s !== '')
    .join('\n')
  if (inner !== '') lines.push(inner)
  if (node.caption !== undefined) {
    lines.push(`${pad}  <figcaption>${renderInlines(node.caption, opts)}</figcaption>`)
  }
  lines.push(`${pad}</figure>`)
  return lines.join('\n')
}

function renderImage(img: Image, opts: RenderOptions): string {
  // An unresolved reference image is literal source, not an image (PART 12
  // §3a), exactly like the unresolved reference link above. Without this the
  // node rendered as `<img src="">` - it only looked right because resolve()
  // used to replace it with a text node first, which a document decoded from
  // JSON never goes through.
  // UNRESOLVED means no destination, not "carries a ref": PART 12 §3a keeps
  // `ref` and `rawRef` on a RESOLVED reference too, so the presence of a ref
  // no longer answers this question (carve#596) - the shared predicate is the
  // one the footnote-numbering pass asks as well.
  if (isUnresolvedReference(img)) return escapeHtml(img.rawRef ?? '')
  const titleAttr = img.title !== undefined ? ` title="${escapeAttr(img.title)}"` : ''
  const src = escapeAttr(sanitizeUrl(img.src, opts))
  // The sanitized structural src wins; never re-emit an author-supplied
  // `src` from an attribute block, which would bypass sanitization.
  return `<img src="${src}" alt="${escapeAttr(img.alt)}"${titleAttr}${renderAttrs(stripKeyValue(img.attrs, 'src'))}>`
}

// ============================================================================
// Inline rendering
// ============================================================================

/**
 * Is the renderer inside a link's text right now?
 *
 * Module-scoped rather than threaded through every signature: rendering is
 * synchronous and single-threaded, and the only reader is the crossref arm.
 * A footnote body renders outside any anchor, so the flag is cleared for it.
 */
let insideLink = false

/**
 * Charge a rendered cross-reference label against the per-render expansion
 * budget, degrading an over-budget label to the authored target.
 *
 * A crossref republishes the target heading's whole display text while the
 * reference costs only the slug, so K references to one long heading amplify
 * output K x heading_len. That is the abbreviation expansion's shape, so it
 * takes the abbreviation expansion's budget rather than a second one, and it
 * degrades the way that one does: to the text the author actually typed
 * (markup-carve/carve-js#892).
 */
function chargeCrossrefLabel(label: string, target: string): string {
  if (abbrBudget?.charge(utf8ByteLength(label)) ?? true) return label

  return escapeHtml(target)
}

function withinLink<T>(fn: () => T): T {
  const previous = insideLink
  insideLink = true
  try {
    return fn()
  } finally {
    insideLink = previous
  }
}

function outsideLink<T>(fn: () => T): T {
  const previous = insideLink
  insideLink = false
  try {
    return fn()
  } finally {
    insideLink = previous
  }
}

function renderInlines(nodes: InlineNode[], opts: RenderOptions): string {
  return nodes.map((n) => renderInline(n, opts)).join('')
}

/**
 * Render an inline run on its own, AS IF it sat inside an anchor.
 *
 * For a consumer that derives display text from a heading and lands it inside a
 * link of its own - a table-of-contents entry (PART 9R R4,
 * markup-carve/carve#957). Those clone the heading's inline NODES, so they need
 * the core's inline renderer rather than a flatten, and they need it in the LINK
 * context: a resolved `heading_ref` renders its display text instead of an
 * anchor there, exactly as it does inside an authored link.
 *
 * Rendering the run through a synthetic one-paragraph document is what this
 * replaces, and it was wrong twice: the flag defaulted to false, so a crossref
 * in a heading published a nested anchor; and a document render emits
 * DOCUMENT-level output, so an inline footnote in a heading dragged a whole
 * endnotes section into the nav.
 */
export function renderInlinesInLinkContext(nodes: InlineNode[], opts?: RenderOptions): string {
  return withinLink(() => renderInlines(nodes, opts ?? activeRenderOptions))
}

/**
 * The options the render currently in progress was called with, or `{}` outside
 * one.
 *
 * Module-scoped for the same reason `insideLink` is: rendering is synchronous
 * and single-threaded. It exists because a caller can reach the inline renderer
 * from a BLOCK renderer without being handed the options - the extension render
 * context does not carry them - and rendering a label with defaults is not a
 * cosmetic difference. `allowRawHtml: false` escaped a heading's raw inline HTML
 * and a table-of-contents entry built from the same nodes emitted it live
 * (raised by codex review).
 *
 * A transform that runs BEFORE the render still sees `{}`, which is correct:
 * there is no active render to inherit from. markup-carve/carve-js#871 tracks
 * giving `beforeRender` the options directly.
 */
let activeRenderOptions: RenderOptions = {}

function renderInline(node: InlineNode, opts: RenderOptions): string {
  if (inlineDepth >= MAX_RENDER_DEPTH) throw new RenderDepthError('renderHtml', MAX_RENDER_DEPTH)
  inlineDepth++
  try {
    return renderInlineNode(node, opts)
  } finally {
    inlineDepth--
  }
}

function renderInlineNode(node: InlineNode, opts: RenderOptions): string {
  // A stored tree may still carry a type this engine no longer emits; map it
  // before dispatch so the switch below only ever sees current types.
  node = normalizeLegacyInline(node)

  switch (node.type) {
    case 'text':
      return escapeHtml(node.value)
    case 'escaped_text':
      // The backslash is authoring syntax; the reader sees the character.
      return escapeHtml(node.value)
    case 'emphasis':
      return `<em${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</em>`
    case 'strong':
      return `<strong${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</strong>`
    case 'underline':
      return `<u${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</u>`
    case 'strike':
      return `<s${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</s>`
    case 'superscript':
      return `<sup${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</sup>`
    case 'subscript':
      return `<sub${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</sub>`
    case 'highlight':
      return `<mark${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</mark>`
    case 'code':
      return `<code${renderAttrs(node.attrs)}>${escapeHtml(node.value)}</code>`
    case 'link': {
      // An unresolved reference is literal source, not a link (PART 12 §3a):
      // the node survives serialization so the reference is not lost from the
      // tree, and every render target writes it back out as written.
      if (isUnresolvedReference(node)) return escapeHtml(node.rawRef ?? '')
      // LINKS NEVER NEST, AT THE RENDER SEAM (PART 12 §3a,
      // markup-carve/carve#817). An anchor may not contain another anchor, and
      // that is a RENDERING rule: the node reaches the serialized tree as the
      // author wrote it, and the unwrap happens here. Only the outermost
      // destination applies, so the inner link contributes its display text.
      //
      // This used to run in the resolver, which flattened the tree itself and
      // lost the inner destination from every consumer of the AST.
      if (insideLink) return renderInlines(node.children, opts)
      const titleAttr = node.title !== undefined ? ` title="${escapeAttr(node.title)}"` : ''
      const href = escapeAttr(sanitizeUrl(node.href, opts))
      // The sanitized structural href wins; never re-emit an author-supplied
      // `href` from an attribute block, which would bypass sanitization.
      const label = withinLink(() => renderInlines(node.children, opts))
      return `<a href="${href}"${titleAttr}${renderAttrs(stripKeyValue(node.attrs, 'href'))}>${label}</a>`
    }
    case 'image':
      return renderImage(node, opts)
    case 'span':
      return renderSemanticSpan(node, opts)
    case 'math': {
      const base = node.display ? 'math display' : 'math inline'
      // Static mode: if a build-time math renderer is supplied, emit its
      // server-side output (MathML/HTML) inside the math span so the page needs
      // no client KaTeX/MathJax. Absent a renderer, fall back to the same
      // delimiter-wrapped source the interactive path emits (never blank).
      if (opts.mode === 'static' && opts.renderers?.math) {
        const ssr = opts.renderers.math(node.content, node.display)
        return `<span${renderAttrs2(node.attrs, { baseClass: base })}>${ssr}</span>`
      }
      const body = node.display
        ? `\\[${escapeHtml(node.content)}\\]`
        : `\\(${escapeHtml(node.content)}\\)`
      return `<span${renderAttrs2(node.attrs, { baseClass: base })}>${body}</span>`
    }
    case 'raw_inline':
      // Verbatim only when the format matches this output; else dropped.
      // Escape it instead when raw HTML is disabled (untrusted input).
      return node.format === 'html'
        ? opts.allowRawHtml === false
          ? escapeHtml(node.content)
          : node.content
        : ''
    case 'literal_inline': {
      // §27: content is escaped and ALWAYS emitted (never target-routed like
      // raw passthrough), with the `<code>` wrapper dropped. An element is
      // emitted only when an attribute needs somewhere to live.
      const text = escapeHtml(node.content)
      const attrs = renderAttrs(node.attrs)
      return attrs ? `<span${attrs}>${text}</span>` : text
    }
    case 'symbol': {
      // Resolution precedence (§ Symbols): a registered inline-renderer for
      // the `symbol` node type wins (static mode tries `staticInlineRenderers`
      // first, then `inlineRenderers`; each may return undefined to defer),
      // then the `symbols` map (emitted raw, trusted processor config), then
      // the literal `:name:`. Attributes wrap the resolved body in a span so
      // they have a target.
      let body: string | undefined
      const isStatic = opts.mode === 'static'
      if (opts.extensions?.length) {
        const ctx = inlineCtx(opts)
        for (const e of opts.extensions) {
          const staticFn = isStatic ? ownValue(e.staticInlineRenderers, node.type) : undefined
          if (staticFn) {
            const out = staticFn(node, ctx)
            if (out !== undefined) { body = out; break }
          }
          const fn = ownValue(e.inlineRenderers, node.type)
          if (fn) {
            const out = fn(node, ctx)
            if (out !== undefined) { body = out; break }
          }
        }
      }
      if (body === undefined) body = ownValue(opts.symbols, node.name) ?? escapeHtml(`:${node.name}:`)
      return node.attrs ? `<span${renderAttrs(node.attrs)}>${body}</span>` : body
    }
    case 'autolink': {
      // Display the raw autolink content (a URI autolink keeps its scheme);
      // fall back to stripping an auto-added `mailto:` for nodes without `text`.
      const display =
        node.text ?? (node.href.startsWith('mailto:') ? node.href.slice(7) : node.href)
      // Inside a link it is plain text, for the reason the `link` arm above
      // gives. The `mailto:` scheme comes off here whatever `text` said, which
      // is what the resolver's unwrap did and what the corpus pins: an author
      // writing `<mailto:a@b.c>` in a label sees the address, not the scheme.
      if (insideLink) {
        return escapeHtml(node.href.startsWith('mailto:') ? node.href.slice(7) : display)
      }
      // The structural href always wins; never re-emit an author-supplied
      // `href` from an attribute block (it would duplicate the attribute).
      const href = escapeAttr(sanitizeUrl(node.href, opts))
      return `<a href="${href}"${renderAttrs(stripKeyValue(node.attrs, 'href'))}>${escapeHtml(display)}</a>`
    }
    case 'mention': {
      const text = `@${escapeHtml(node.user)}`
      if (insideLink || !opts.mentionUrl)
        return `<span${renderLeadingBaseClassAttrs(node.attrs, 'mention')}><strong>${text}</strong></span>`
      // Canonical placeholder is `{name}` (matching tags and carve-php);
      // `{user}` stays as a legacy alias.
      const enc = encodeURIComponent(node.user)
      const href = sanitizeUrl(
        opts.mentionUrl.replaceAll('{name}', enc).replaceAll('{user}', enc),
        opts,
      )
      return `<a${renderSocialLinkAttrs(node.attrs, 'mention', href)}>${text}</a>`
    }
    case 'tag': {
      const text = `#${escapeHtml(node.name)}`
      if (insideLink || !opts.tagUrl)
        return `<span${renderLeadingBaseClassAttrs(node.attrs, 'tag')}><strong>${text}</strong></span>`
      const href = sanitizeUrl(
        opts.tagUrl
          .replaceAll('{name}', encodeURIComponent(node.name))
          .replaceAll('{tag}', encodeURIComponent(node.name)),
        opts,
      )
      return `<a${renderSocialLinkAttrs(node.attrs, 'tag', href)}>${text}</a>`
    }
    case 'inline_extension': {
      // Per-extension resolution in registration order (mirrors the block
      // path): for each extension, static mode tries its `staticInlineRenderers`
      // (the inline `renderStatic` hook, keyed by node type `extension`) first,
      // then its name-keyed `renderers`; interactive tries only `renderers`.
      // Fall through to the generic inline fallback.
      const isStatic = opts.mode === 'static'
      if (opts.extensions?.length) {
        const ctx = inlineCtx(opts)
        for (const e of opts.extensions) {
          const staticFn = isStatic ? ownValue(e.staticInlineRenderers, node.type) : undefined
          if (staticFn) {
            const out = staticFn(node, ctx)
            if (out !== undefined) return out
          }
          const fn = ownValue(e.renderers, node.name)
          if (fn) {
            const out = fn(node, ctx)
            if (out !== undefined) return out
          }
        }
      }
      return renderExtension(node.name, node.content, node.attrs, opts)
    }
    case 'abbreviation': {
      if (suppressAutomaticAbbreviation) return escapeHtml(node.abbr)
      // DoS guard: once cumulative expansion bytes exceed the budget, degrade
      // to plain key text (no <abbr>, no title). charge() accounts for the
      // expansion's UTF-8 bytes.
      const fit = abbrBudget?.charge(utf8ByteLength(node.expansion)) ?? true
      if (!fit) return escapeHtml(node.abbr)
      return `<abbr title="${escapeAttr(node.expansion)}">${escapeHtml(node.abbr)}</abbr>`
    }
    case 'footnote_ref':
    case 'inline_footnote':
      // number is assigned by collectFootnotes for refs with a matching
      // definition; an unresolved ref falls back to literal source.
      return node.number === undefined
        ? escapeHtml(`[^${node.id ?? ''}]`)
        : `<a id="${node.refId}" href="#fn${node.number}" role="doc-noteref"${renderAttrs2(node.attrs, { dropId: true })}><sup>${node.number}</sup></a>`
    case 'soft_break':
      return '\n'
    case 'hard_break':
      return '<br>\n'
    case 'insert':
      return `<ins${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</ins>`
    case 'delete':
      return `<del${renderAttrs(node.attrs)}>${renderInlines(node.children, opts)}</del>`
    case 'substitution':
      return `<del>${escapeHtml(node.oldText)}</del><ins>${escapeHtml(node.newText)}</ins>`
    case 'critic_comment':
      return `<span class="critic-comment">${escapeHtml(node.text)}</span>`
    case 'heading_ref':
      // Inside a link's text an anchor may not nest (CommonMark), and the node
      // is still in the tree because PART 12 §3a keeps it there - so the
      // suppression is here, at the point of rendering, rather than by
      // dropping the node during resolution.
      if (node.href && insideLink)
        return chargeCrossrefLabel(renderInlines(node.resolvedText ?? [], opts), node.target)
      // Resolved: the anchor this crossref always rendered as. The node keeps
      // the authored `target` (PART 12 §3a) and carries the destination in
      // `href`, so the rendering is unchanged - only the tree moved.
      if (node.href) {
        const crossrefHref = escapeAttr(sanitizeUrl(node.href, opts))
        // The cloned display text renders INSIDE this anchor, so it renders in
        // the link context: a heading holding a link would otherwise nest one
        // here. The resolver used to unwrap the clone before the renderer saw
        // it; with that pass gone (markup-carve/carve#817) the seam has to say
        // so itself, exactly as the `link` arm does for an authored label.
        const label = chargeCrossrefLabel(
          withinLink(() => renderInlines(node.resolvedText ?? [], opts)),
          node.target,
        )
        return `<a href="${crossrefHref}"${renderAttrs(stripKeyValue(node.attrs, 'href'))}>${label}</a>`
      }
      // Unresolved: literal source, the same as an unresolved reference link.
      return `&lt;/#${escapeHtml(node.target)}&gt;`
    case 'caption_number':
      // Filled by resolve(); an unresolved placeholder renders its authored
      // spelling - the unresolved-reference precedent (PART 12 §3a), the
      // visible failure this language prefers to a silent one, and what the
      // Markdown/plain/ANSI arms already do. A composite figure's PANEL
      // caption keeps its placeholder un-numbered by design (PART 9 §4c), so
      // this arm is what makes it render as the literal `#` the author wrote.
      return node.n === undefined ? '#' : String(node.n)
    case 'citation_group': {
      // Extension-produced node: per-extension resolution in registration order
      // (mirrors the block path). For each extension, static mode tries its
      // `staticInlineRenderers` first, then its `inlineRenderers`; each may
      // return undefined to defer. Fall back to the verbatim source.
      const isStatic = opts.mode === 'static'
      if (opts.extensions?.length) {
        const ctx = inlineCtx(opts)
        for (const e of opts.extensions) {
          const staticFn = isStatic ? ownValue(e.staticInlineRenderers, node.type) : undefined
          if (staticFn) {
            const out = staticFn(node, ctx)
            if (out !== undefined) return out
          }
          const fn = ownValue(e.inlineRenderers, node.type)
          if (fn) {
            const out = fn(node, ctx)
            if (out !== undefined) return out
          }
        }
      }
      return escapeHtml(node.raw)
    }
    case 'comment':
      // Comments are not rendered (§4.13); inline form mirrors the block one.
      return ''
    case 'smart_punctuation':
      // With the switch off, emit what the author typed. The node carries the
      // source run in `value`, so this needs no parser cooperation (PART 9 §8).
      if (opts.smartTypography === false || opts.smartTypography === 'source')
        return escapeHtml(node.value)
      // The resolved glyph, escaped like any other text: a locale quote glyph
      // can carry a non-breaking space (French guillemets are `«` + U+00A0).
      return escapeHtml(node.glyph ?? SMART_PUNCTUATION_GLYPHS[node.kind] ?? node.value)
    default: {
      const t: never = node
      throw new Error(`renderHtml: unknown inline ${(t as { type: string }).type}`)
    }
  }
}

function renderExtension(
  name: string,
  content: InlineNode[],
  attrs: Attrs | undefined,
  opts: RenderOptions,
): string {
  const inner = renderInlines(content, opts)
  // Author attributes on the extension (grammar §415 `extension_inline …
  // [attributes]`) attach to its output element, e.g. `:kbd[x]{.foo}`.
  // PART 9 §10: CORE REGISTERS NO `:name[…]` HANDLER AT ALL, semantic or
  // otherwise. The extension SYNTAX is core; the handlers are Tier-2/3, which
  // is what docs/extensions.md always said and what this function stopped
  // doing when a hardcoded set of seven tags lived here. The SemanticSpan
  // extension re-registers them as a soft-deprecated spelling; without it
  // every name takes the readable fallback.
  return `<span${renderAttrs2(attrs, { baseClass: `ext-${name}` })}>${inner}</span>`
}

// ============================================================================
// Escaping
// ============================================================================

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\u00a0': '&nbsp;',
  // Internal non-breaking-space placeholder (line-block indent / escaped space).
  '\ue000': '&nbsp;',
}

/**
 * Bidi-override / isolate controls (CVE-2021-42574, "Trojan Source"). These can
 * silently reorder the visual order of rendered text/code so the displayed
 * source differs from what executes. We STRIP each wherever it appears in
 * rendered TEXT or CODE. Stripping (not escaping to a numeric reference) is the
 * mitigation that actually holds: an HTML parser DECODES `&#x202e;` back to the
 * raw control, so an entity-escaped override still reorders the live DOM \u2014 only
 * removing the character is DOM-inert. The directional MARKS U+200E / U+200F
 * (LRM / RLM) are NOT stripped \u2014 they are legitimate for laying out genuine
 * right-to-left text and do not reorder surrounding runs the way the
 * overrides/isolates do. Zero-width characters are likewise left as-is in text
 * (they are only stripped from generated ids; see heading-ids.ts).
 */
function escapeHtml(s: string): string {
  // Strip the Trojan-Source bidi controls, then escape the structural HTML
  // metacharacters.
  return stripBidiControls(s).replace(/[&<>\u00a0\ue000]/g, (c) => HTML_ESCAPE[c]!)
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '"' ? '&quot;' : c === "'" ? '&apos;' : HTML_ESCAPE[c]!,
  )
}
