/*
 * Heading identifier generation + cross-reference resolution.
 *
 * Behavior is fixed by markup-carve/carve PR #1 ("Automatic Identifiers")
 * plus the ASCII-safety transliteration step ported from djot-php #183
 * (so a heading id survives being shared as a URL fragment through
 * auto-linkers, which routinely truncate or mis-encode non-ASCII).
 * slugify is pure and context-free; dedup lives in resolveHeadingIds.
 */

import type {
  Attrs,
  BlockNode,
  CaptionNumber,
  Document,
  Figure,
  FigureGroup,
  Image,
  InlineNode,
  Table,
  Text,
} from './ast.js'
import type { DocumentIdRegistry } from './document-ids.js'
import { SMART_PUNCTUATION_GLYPHS } from './ast.js'
import { normalizeRefLabel, mergeAttrs, parseRefLabelInlines } from './parse.js'
import { TRANSLIT_MAP } from './translit-map.js'
import { isUnresolvedReference } from './unresolved-reference.js'

/**
 * Implicit heading references match a heading's visible TEXT, which is a
 * fuzzier lookup than an explicit `[label]: url` reference (kept
 * case-sensitive in normalizeRefLabel). `[getting started][]` should still
 * resolve `# Getting Started`, so heading-text matching folds case here.
 */
/**
 * The key an implicit heading reference and a heading's text are compared on:
 * trimmed, internal whitespace collapsed (both in `normalizeRefLabel`),
 * NFC-normalized, then case-folded - PART 9R R1.
 *
 * NFC is here because heading IDS are NFC-normalized (§25), and without it a
 * document publishes `id="Café"` and then declines `[Café][]` against the very
 * heading that produced it. It is also a WEAKER fold than the case fold beside
 * it: case folding relates codepoints Unicode calls distinct, NFC relates
 * sequences Unicode DEFINES as the same (carve#725).
 *
 * NFC and NOT NFKC: `[file][]` must not reach `# ﬁle`. Compatibility folding
 * changes which text the author is quoting, not how it is spelled.
 *
 * Exported because `lint.ts` carried a second copy of this predicate. Two
 * copies of a matching rule drift, and this fix would have landed in one of
 * them.
 */
export function normalizeHeadingRefLabel(label: string): string {
  return normalizeRefLabel(label).normalize('NFC').toLowerCase()
}

/**
 * The heading-index key a REFERENCE LABEL contributes (PART 9R R1,
 * markup-carve/carve#949).
 *
 * The index is keyed by each heading's RENDERED PLAIN TEXT, so `# *bold*
 * heading` is keyed `bold heading`. R1 says the label enters that comparison as
 * the same string kind, i.e. its inline markup is stripped exactly as the
 * heading's was - otherwise no heading containing emphasis, a code span or a
 * link is reachable by its collapsed spelling at all, and the author sees no
 * reason why. The four normalizations then apply to that plain text.
 *
 * THE STRIP IS SCOPED TO THE HEADING INDEX. `linkDefs` matching keys on the
 * label AS WRITTEN and is untouched: `[*bold*]: /x` is matched by `[*bold*][]`
 * and not by `[bold][]`, and `[bold]: /x` is not matched by `[*bold*][]`.
 * markup-carve/carve-php#768 is the cautionary precedent - it generalized this
 * into stripping markup from every collapsed label and inverted that rule in
 * both directions.
 */
export function headingRefKeyFromLabel(label: string): string {
  return normalizeHeadingRefLabel(derivedRefLabel(label))
}

/**
 * The DERIVED label of a collapsed reference: the label's own inline content
 * rendered to plain text (PART 12 §3a, markup-carve/carve#962).
 *
 * §3a defines `ref` as "the label the reference resolves by", with the authored
 * spelling kept in `rawRef`. Where the heading index answers on the stripped key
 * - `[`code()` heading][]` reaching `# `code()` heading` - the label it resolved
 * by is `code() heading`, so that is what `ref` publishes. carve-js published
 * the authored spelling in BOTH fields, which left §3a's two fields carrying one
 * string and made `ref` unusable as the resolution key it is defined to be.
 *
 * DERIVED, NOT NORMALIZED. The four normalizations in
 * {@link normalizeHeadingRefLabel} (trim, whitespace collapse, NFC, case fold)
 * belong to MATCHING, not to the label: `[Getting Started][]` under
 * `# getting started` has always published `Getting Started`, and folding the
 * published value would rewrite every plain label to make one markup-bearing one
 * right. Rendering the label's inlines is the whole derivation, which is also
 * why a label with no markup, no escape and no smart-punctuation trigger derives
 * to itself byte for byte.
 *
 * Escapes and smart punctuation ride along for free and correctly:
 * `[\*bold\* heading][]` derives `*bold* heading`, and `[a -- b][]` derives the
 * en-dash spelling, because those are equally "what the label renders as", which
 * is the only string the heading index ever compared.
 */
export function derivedRefLabel(label: string): string {
  return inlineText(parseRefLabelInlines(label))
}

/**
 * Whether a reference link was written in the COLLAPSED `[text][]` spelling.
 *
 * PART 9R R1: the heading-index fallback is scoped to the collapsed form and to
 * nothing else, so an explicit `[text][label]` that no linkDefs entry matches is
 * unresolved and renders as its literal source at ANY spelling, folded or exact
 * (markup-carve/carve#742). The asymmetry is the one R1 already states: a
 * collapsed label is the author quoting prose from elsewhere in the document,
 * which is why its matching is loose; an explicit label is an identifier the
 * author wrote twice and can keep identical, which is why its matching is exact.
 * An identifier that names nothing names nothing; it is not retried as prose.
 *
 * The test reads `rawRef` rather than a flag set at parse time, because it has
 * to hold for a tree that arrived through INGEST too: `ref` and `rawRef` are the
 * two fields PART 12 §3a puts on the wire for a reference, and the collapsed
 * spelling is recoverable from them and from nothing else. `ref` alone cannot
 * tell the two apart - a collapsed `[a][]` and an explicit `[a][a]` both carry
 * `ref: "a"`.
 *
 * A label holds no `]` (the reference tail is `[` up to the first `]`), so
 * `[<ref>][]` is a prefix of the source exactly when the label was empty and the
 * collapsed form reused the text as the label.
 *
 * A node with no `rawRef` is treated as NOT collapsed. It is degenerate either
 * way - the renderers need `rawRef` to write an unresolved reference back out as
 * literal source - and refusing the fallback is the side this clause narrows to.
 */
/**
 * A deep copy of an inline run, for a consumer that DERIVES display text from a
 * heading (PART 9R R4, markup-carve/carve#915 and markup-carve/carve#957).
 *
 * The copy is what makes "clones the same inline NODES" safe to state: the label
 * and the heading become two trees, so a renderer that rewrites one in place -
 * the no-nesting unwrap does exactly that - does not rewrite the other. Named
 * once so the three consumers cannot each pick a different depth of copy.
 */
export function deepCloneInlines(nodes: InlineNode[]): InlineNode[] {
  return JSON.parse(JSON.stringify(nodes)) as InlineNode[]
}

/**
 * "Links never nest": a link or an autolink inside another link is unwrapped to
 * its display text, and an UNRESOLVED reference to its raw source.
 *
 * Module level and exported because it is not the resolver's alone. PART 9R R4
 * has every consumer that DERIVES display text from a heading clone the
 * heading's inline NODES (markup-carve/carve#915, markup-carve/carve#957), and a
 * heading may hold a link - so a numbered cross-reference label, a
 * table-of-contents entry and an index term's display each land those nodes
 * somewhere an anchor may not nest. Each answering that with its own unwrap is
 * how one rule acquires four readings; they all call this one.
 *
 * `insideLink` is the CALLER's context rather than a fact about `nodes`: a
 * derived label rendered inside an `<a>` passes `true`.
 */
export function unwrapNestedAnchors(nodes: InlineNode[], insideLink: boolean): InlineNode[] {
  const out: InlineNode[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'link': {
        // An UNRESOLVED reference is not a link the reader ever sees - it is
        // literal source (PART 12 §3a), and it only reaches here as a node at
        // all so the serialized tree can keep the reference. Unwrapping it to
        // its children would print the LABEL where the author wrote the whole
        // `[x][missing]`, so nested-inside-a-link it becomes its raw source
        // instead (carve#486).
        // UNRESOLVED means no destination: §3a keeps `ref` on a resolved
        // reference too, and a RESOLVED one nested in a link unwraps to its
        // display text like any other nested link (carve#596).
        if (insideLink && isUnresolvedReference(n)) {
          out.push({ type: 'text', value: n.rawRef ?? '' } as Text)
          break
        }
        const children = unwrapNestedAnchors(n.children, true)
        if (insideLink) {
          // Non-spread push: `children` may be unbounded (a large link label),
          // and `push(...children)` would overflow V8's call-stack argument
          // limit (~65k) on adversarial input.
          for (const c of children) out.push(c)
        } else {
          n.children = children
          out.push(n)
        }
        break
      }
      case 'heading_ref':
        // A resolved crossref renders as an anchor, so inside a link it
        // would nest one - but it is NOT unwrapped here, because the node
        // has to reach the serialized tree (PART 12 §3a). Dropping it would
        // publish `[see H](/outer)` for `[see </#H>](/outer)`: the authored
        // crossref gone from the wire, which is the flattening §3a exists to
        // prevent. The renderers suppress the nested anchor instead.
        //
        // Its DISPLAY text is a clone of the target heading, which may itself
        // contain a link - and that one renders inside this crossref's own
        // anchor, so it nests whether or not the crossref is inside a link.
        // The clone is runtime-only, so unwrapping it loses nothing from the
        // wire.
        if (n.resolvedText) n.resolvedText = unwrapNestedAnchors(n.resolvedText, true)
        out.push(n)
        break
      case 'autolink':
        if (insideLink) {
          const value = n.href.startsWith('mailto:')
            ? n.href.slice('mailto:'.length)
            : n.href
          out.push({ type: 'text', value } as Text)
        } else {
          out.push(n)
        }
        break
      case 'inline_footnote':
        if (n.inline) n.inline = unwrapNestedAnchors(n.inline, false)
        out.push(n)
        break
      case 'emphasis':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'superscript':
      case 'subscript':
      case 'highlight':
      case 'span':
      case 'insert':
      case 'delete':
        n.children = unwrapNestedAnchors(n.children, insideLink)
        out.push(n)
        break
      case 'inline_extension':
        n.content = unwrapNestedAnchors(n.content, insideLink)
        out.push(n)
        break
      default:
        out.push(n)
        break
    }
  }
  return out
}

/**
 * The inline run a consumer DERIVES display text from a heading with (PART 9R
 * R4, markup-carve/carve#915 and markup-carve/carve#957): a deep clone, its
 * footnote apparatus removed, its nested anchors unwrapped for the link the
 * label renders inside.
 *
 * One function because the clause binds every such consumer and names three -
 * a numbered cross-reference label, an index term's display, a
 * table-of-contents entry. Each answering the two follow-on questions on its own
 * is how one rule acquires four readings.
 *
 * `insideLink` is the CALLER's context, as it is for `unwrapNestedAnchors`, and
 * it is NOT a property of being derived: a cross-reference label and a
 * table-of-contents entry render inside an `<a>` and pass `true`, while an index
 * list item is not an anchor - only the backrefs after the display are - and
 * passes `false`, keeping an authored link the author put in the term (raised by
 * codex review).
 *
 * THE LABEL IS THE HEADING'S AUTHORED CONTENT, which is what
 * `stripResolutionApparatus` below leaves behind. R4 names one such addition
 * explicitly - a render-stage `section-number` span - and the argument is about
 * the SIDE of the injection the label comes from, not about which transform did
 * the injecting.
 */
export function deriveDisplayNodes(nodes: InlineNode[], insideLink: boolean): InlineNode[] {
  return unwrapNestedAnchors(stripResolutionApparatus(deepCloneInlines(nodes)), insideLink)
}

/**
 * Reduce a cloned run to what the AUTHOR wrote, undoing the two resolution
 * results a heading can carry.
 *
 * A FOOTNOTE REFERENCE IS A POINTER, NOT DISPLAY TEXT. It points into the
 * document's endnotes, and a derived label is not where that pointer lives:
 * rendering one in a second place emits a SECOND anchor carrying the same `fn`
 * id, inside an anchor of its own, and points a backlink at whichever came last.
 * It contributes nothing to a heading's INDEX key either, which is the same rule
 * read from the other side. So it is dropped, exactly as the flatten this
 * replaces dropped it.
 *
 * AN INVISIBLE MARKER CONTRIBUTES NOTHING, for the reason PART 9 §8.1 gives:
 * an `:index[term]` emits no visible text at all, so it is not display text
 * anywhere it is derived.
 *
 * AN ABBREVIATION IS A RESOLUTION RESULT. The author wrote `HT`; PART 9R R3
 * matched it against `abbrDefs` and split the text node into an `abbreviation`
 * node carrying the expansion. Cloning THAT into a label publishes the full
 * `<abbr title="...">` once per derived site, which is an output amplification
 * the body renderer bounds with a budget this path has no access to - it runs in
 * `beforeRender`, before the renderer's budget exists (raised by codex review).
 * Taking the author's `abbr` back out is both the bounded answer and the correct
 * one: an expansion the author did not write at that spot is an injection, and
 * `inlineText` already reduced the node this way.
 */
function stripResolutionApparatus(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const n of nodes) {
    if (n.type === 'footnote_ref' || n.type === 'inline_footnote') continue
    // AN `:index[term]` MARKER IS INVISIBLE (PART 9 §8.1). It emits no visible
    // text, so its term feeds no heading slug and no derived text - `inlineText`
    // above carries that carve-out in as many words, and the node form has to
    // carry it too. Left in, a table-of-contents entry renders the term VISIBLY
    // where the heading renders an empty anchor target (raised by codex review).
    if (n.type === 'inline_extension' && n.name === 'index') continue
    if (n.type === 'abbreviation') {
      out.push({ type: 'text', value: n.abbr } as Text)
      continue
    }
    const record = n as unknown as Record<string, unknown>
    // Generic descent: three byte-identical `CHILD_FIELDS` lists already live in
    // this package and none is exported, so a fourth spelling here is how a run
    // gets missed. Only arrays of nodes are rewritten.
    for (const key of Object.keys(record)) {
      if (key === 'pos') continue
      const value = record[key]
      if (Array.isArray(value)) record[key] = stripResolutionApparatus(value as InlineNode[])
    }
    out.push(n)
  }
  return out
}

export function isCollapsedRef(ref: string, rawRef: string | undefined): boolean {
  return rawRef !== undefined && rawRef.startsWith(`[${ref}][]`)
}

/**
 * Apply the baked Unicode->ASCII map (Latin / IPA / combining marks /
 * Cyrillic / Latin-Extended-Additional / punctuation / super- and
 * sub-script / currency / letterlike, byte-identical with djot-php's
 * deterministic fallback). Greek is *deliberately excluded* — its ICU
 * transliteration is context-sensitive (`αυ`->`au` but `υ`->`y`) so it
 * can't be baked as a context-free map; Greek headings, like CJK and
 * Arabic, pass through unchanged. The downstream regex keeps them as
 * letters; an author can attach an explicit `{#id}` for a share-safe
 * slug if needed.
 */
function transliterate(s: string): string {
  let out = ''
  for (const ch of s) out += TRANSLIT_MAP[ch] ?? ch
  return out
}

/**
 * Reverse smart-typography substitutions to their ASCII source before a slug is
 * computed, so an id never depends on presentational typography. Without this,
 * `# That's all` (parsed with smart quotes) would keep the curly `’` in its id;
 * `# Step 1 -> 2` would keep `→`. The map is the inverse of the parser's
 * SMART_TOKENS plus smart quotes and dashes. Applied before slugRun, so the
 * recovered ASCII punctuation then collapses to hyphens like any other.
 */
const SMART_TO_ASCII: Record<string, string> = {
  // The canonical spellings, not the deprecated ones: `=>` no longer parses
  // as an arrow at all, so recovering it would produce ASCII that does not
  // round-trip (markup-carve/carve#1442).
  '↔': '<-->', '™': '(tm)', '…': '...', '→': '-->', '←': '<--',
  '⇔': '<=>', '⇒': '==>', '⇐': '<==',
  '≤': '<=', '≥': '>=', '≠': '!=', '±': '+-', '©': '(c)', '®': '(r)',
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"',
}
function deTypography(s: string): string {
  let out = ''
  for (const ch of s) out += SMART_TO_ASCII[ch] ?? ch
  return out
}

/**
 * Trojan-Source hardening for generated ids. Two pre-slug transforms make an id
 * deterministic and free of dangerous/invisible Unicode (CVE-2021-42574 class):
 *
 *  - NFC normalization, so a precomposed `é` (U+00E9) and a decomposed
 *    `e`+U+0301 produce the SAME id.
 *  - Stripping bidi-override / isolate controls (U+202A..U+202E, U+2066..U+2069)
 *    and zero-width characters (U+200B, U+200C, U+200D, U+2060, U+FEFF, U+00AD)
 *    so none of these can ever appear inside an `id="..."`.
 *
 * Applied before the slug run so the remaining text slugs as usual.
 */
const ID_STRIP_RE =
  /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200D\u2060\uFEFF\u00AD]/gu
function sanitizeIdSource(s: string): string {
  return s.normalize('NFC').replace(ID_STRIP_RE, '')
}

/**
 * jgm/djot#393 slug step: replace each maximal run of non-alphanumeric ASCII with a
 * single '-' and trim. Non-ASCII characters and letter case are preserved.
 */
function slugRun(s: string): string {
  return s.replace(/[^0-9A-Za-z\u{80}-\u{10FFFF}]+/gu, '-').replace(/^-+|-+$/gu, '')
}

/**
 * Strict variant of slugRun: collapses every run of non-ASCII-alphanumeric -
 * INCLUDING any non-ASCII code point - to a single '-', then trims. Used by the
 * strict ASCII heading-id mode for residue that transliterate() cannot map
 * (Greek, CJK, Arabic, emoji): such code points become separators instead of
 * surviving verbatim, so the slug is guaranteed to match `[0-9A-Za-z-]`.
 */
function slugRunAscii(s: string): string {
  return s.replace(/[^0-9A-Za-z]+/gu, '-').replace(/^-+|-+$/gu, '')
}

/**
 * Public opt-in for ASCII heading ids. `true` / `'fold'` is best-effort
 * transliteration (non-ASCII the map can't handle is kept verbatim); `'strict'`
 * additionally drops that unmappable residue so the id is guaranteed pure ASCII.
 */
export type AsciiHeadingIdMode = boolean | 'fold' | 'strict'

/**
 * Translate the public `asciiHeadingIds` / `lowercaseHeadingIds` options into
 * the `slugify` flags. Shared by `resolve()` and `lintCarve` so the lint id set
 * matches the resolver exactly.
 */
export function headingIdSlugOpts(opts: {
  asciiHeadingIds?: AsciiHeadingIdMode
  lowercaseHeadingIds?: boolean
}): { lowercase: boolean; asciiFold: boolean; asciiStrict: boolean } {
  const v = opts.asciiHeadingIds
  return {
    lowercase: opts.lowercaseHeadingIds ?? false,
    asciiFold: v === true || v === 'fold' || v === 'strict',
    asciiStrict: v === 'strict',
  }
}

/**
 * The automatic-identifier rule. Pure, context-free, no dedup.
 *
 * Default is CASE-PRESERVING with no Unicode normalization or case folding:
 * the jgm/djot#393 run-replacement over the raw code points, keeping non-ASCII
 * verbatim (e.g. a German heading keeps its umlaut). Zero-dependency and
 * byte-identical across implementations, matching djot's "no Unicode tables"
 * identifier model. Cross-reference resolution is case-insensitive (see
 * resolveHeadingIds), so `</#getting-started>` still resolves to the
 * case-preserved `Getting-Started` id. Three opt-in, orthogonal transforms:
 * `lowercase` (GitHub/SSG-style anchors, folded per code point so no
 * context mapping such as Greek final-sigma applies); `asciiFold`
 * (transliterate the slug to ASCII for share-safe URL fragments, best-effort -
 * unmappable scripts are kept); and `asciiStrict` (implies `asciiFold`, also
 * drops the unmappable residue for a guaranteed pure-ASCII slug). Combine with
 * `lowercase` for a fully lowercase ASCII slug.
 */
export function slugify(
  plainText: string,
  opts: { lowercase?: boolean; asciiFold?: boolean; asciiStrict?: boolean } = {},
): string {
  let s = slugRun(deTypography(sanitizeIdSource(plainText)))
  if (opts.asciiFold || opts.asciiStrict) {
    // Transliterate runs in both modes so Latin/Cyrillic become letters rather
    // than separators. Strict then uses slugRunAscii to drop unmappable
    // residue; best-effort fold uses slugRun, which keeps it verbatim.
    s = transliterate(s)
    s = opts.asciiStrict ? slugRunAscii(s) : slugRun(s)
  }
  // Per code point (no whole-string context mappings, e.g. final-sigma)
  // so opt-in lowercasing stays portable across implementations.
  if (opts.lowercase) {
    s = Array.from(s, (c) => c.toLowerCase()).join('')
  }
  // A leading digit is a valid HTML id but an invalid bare CSS selector, so prefix.
  if (/^\p{N}/u.test(s)) s = `s-${s}`
  if (s === '') s = 's'
  return s
}

/**
 * Visible plain text of an inline run (markup stripped).
 *
 * A reference-link placeholder (Link with `ref` still set) contributes
 * its `children` text just like a resolved Link — both for heading-id
 * derivation and for the implicit-heading-ref key. This matches the
 * cross-impl behavior in carve-php's CarveConverter: a heading
 * `# [Title][maybe]` slugs to `title` regardless of whether `maybe`
 * resolves, so an implicit `[Title][]` can target it consistently.
 */
export function inlineText(nodes: InlineNode[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
      // The escape is authoring syntax; the heading still contains the
      // character, and the id has always been slugified from what the reader
      // sees.
      case 'escaped_text':
        out += n.value
        break
      // The visible glyph, not the source run: a heading id has always been
      // slugified from the rendered character (`Don't` -> `Don-t`), and moving
      // the substitution into a node must not change that.
      case 'smart_punctuation':
        out += n.glyph ?? SMART_PUNCTUATION_GLYPHS[n.kind] ?? n.value
        break
      case 'math':
      // An inline literal renders as visible prose (§27), so it contributes
      // its content to the heading text -- otherwise `` # !`Cat` `` would
      // slug to the empty fallback and `</#cat>` could never resolve.
      case 'literal_inline':
        out += n.content
        break
      case 'emphasis':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'superscript':
      case 'subscript':
      case 'highlight':
      case 'link':
      case 'span':
      case 'insert':
      case 'delete':
        out += inlineText(n.children)
        break
      case 'inline_extension':
        // An `:index[term]` marker is invisible (§8.1): it emits no visible
        // text, so its term must not feed a heading slug or any derived text.
        if (n.name === 'index') break
        out += inlineText(n.content)
        break
      case 'substitution':
        out += n.newText
        break
      case 'abbreviation':
        out += n.abbr
        break
      case 'mention':
        out += `@${n.user}`
        break
      case 'tag':
        out += `#${n.name}`
        break
      case 'autolink':
        out += n.text
        break
      case 'image':
        out += n.alt
        break
      case 'soft_break':
      case 'hard_break':
        out += ' '
        break
      case 'caption_number':
        // Contributes its assigned number (nothing while unresolved).
        out += n.n === undefined ? '' : String(n.n)
        break
      // footnote, crossref, critic_comment: no slug text
      default:
        break
    }
  }
  return out
}

/**
 * Assign heading ids (explicit verbatim wins, auto slugified, 1-based
 * dedup in a shared document-order namespace) and resolve </#id>
 * crossrefs (first-occurrence target, link text cloned from the target
 * heading; unresolved -> literal text). Mutates and returns `doc`.
 */
function resolveHeadingIdsImpl(
  doc: Document,
  opts: { lowercase?: boolean; asciiFold?: boolean; asciiStrict?: boolean } = {},
  documentIds?: DocumentIdRegistry,
): Document {
  const used = new Set<string>()
  const nextCounters = new Map<string, number>()
  const targets = new Map<string, InlineNode[]>()
  // Case-insensitive `</#id>` index: case-folded id -> actual (verbatim) id,
  // first occurrence wins. Lets `</#getting-started>` resolve to a
  // case-preserved `Getting-Started` heading (or an explicit `{#MyId}`)
  // without lowercasing the emitted id. Folded per code point to stay
  // portable, mirroring slugify's optional lowercase.
  const foldId = (s: string): string =>
    Array.from(s, (c) => c.toLowerCase()).join('')
  const foldedTargets = new Map<string, string>()
  // Implicit-reference index: normalized visible heading text -> heading id.
  // First-occurrence wins (matches `</#id>` ambiguous-ref behavior). Built
  // from the parsed AST's inlineText so it agrees with the heading slug
  // exactly — no regex pre-pass guesswork.
  const headingRefs = new Map<string, string>()

  // Assign every heading an id in DOCUMENT ORDER, descending into nested
  // containers (list items, blockquotes, divs/admonitions, definition lists,
  // tables, figures) so a heading inside a list item carries its slug id on
  // the <h*> just like a top-level one (Bug A; carve-php parity). The dedup
  // counter and the implicit-reference/crossref target index are shared across
  // top-level and nested headings, matching carve-php's single document-order
  // pass. The <section> wrapper stays a top-level-only concern in render-html;
  // nested headings emit just <h* id> with no section.
  // `inBlockquote`: a heading with ANY blockquote ancestor still gets an id and
  // is a valid `</#id>` crossref target, but is NOT registered as an implicit
  // `[label][]` reference target -- matching carve-php, where a blockquote
  // ancestor (in either nesting order) suppresses the implicit-ref index entry
  // while list/div/deflist nesting does not.
  const assignHeadingId = (
    heading: { attrs?: Attrs; children: InlineNode[] },
    inBlockquote: boolean,
  ): void => {
    let id: string
    if (heading.attrs?.id !== undefined) {
      // An explicit id wins verbatim, INCLUDING an explicit empty `id=""`
      // (`{id=""}` then `# T` -> `<section id="">`): it suppresses the auto
      // slug rather than being treated as absent.
      id = heading.attrs.id
      used.add(id)
      documentIds?.reserve(id)
    } else {
      const base = slugify(inlineText(heading.children), opts)
      if (!used.has(base)) {
        id = base
        nextCounters.set(base, 2)
      } else {
        let n = nextCounters.get(base) ?? 2
        while (used.has(`${base}-${n}`)) n++
        id = `${base}-${n}`
        nextCounters.set(base, n + 1)
      }
      used.add(id)
      documentIds?.reserve(id)
      heading.attrs = { ...heading.attrs, id }
    }
    if (!targets.has(id)) targets.set(id, heading.children)
    const fk = foldId(id)
    if (!foldedTargets.has(fk)) foldedTargets.set(fk, id)
    if (inBlockquote) return
    const plain = inlineText(heading.children)
    const key = normalizeHeadingRefLabel(plain)
    if (key && !headingRefs.has(key)) headingRefs.set(key, id)
  }
  const assignIds = (blocks: BlockNode[], inBlockquote: boolean): void => {
    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          assignHeadingId(b, inBlockquote)
          break
        case 'block_quote':
          assignIds(b.children, true)
          break
        case 'admonition':
        case 'div':
          assignIds(b.children, inBlockquote)
          break
        case 'list':
          for (const it of b.items) assignIds(it.children, inBlockquote)
          break
        case 'definition_list':
          for (const it of b.items)
            for (const d of it.definitions) assignIds(d, inBlockquote)
          break
        case 'figure':
          if (b.target.type === 'block_quote') assignIds(b.target.children, true)
          break
        case 'figure_group':
          assignIds(b.children, inBlockquote)
          break
        default:
          break
      }
    }
  }
  // Reserve every EXPLICIT id in the document (on any node, heading or not)
  // before auto-slugging headings, so a heading's auto id never collides with
  // an explicit `{#id}` elsewhere -- two elements sharing a DOM id is invalid
  // HTML. Matches carve-php, which reserves all explicit ids up front.
  const reserveExplicitIds = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const id = (node as { attrs?: Attrs }).attrs?.id
    if (typeof id === 'string') {
      used.add(id)
      documentIds?.reserve(id)
    }
    for (const key of Object.keys(node as Record<string, unknown>)) {
      if (key === 'pos') continue
      const v = (node as Record<string, unknown>)[key]
      if (Array.isArray(v)) for (const el of v) reserveExplicitIds(el)
      else if (v && typeof v === 'object') reserveExplicitIds(v)
    }
  }
  for (const b of doc.children) reserveExplicitIds(b)
  // A footnote body is part of the same DOCUMENT and renders into the same
  // page, so its ids share one pool with everything else - two elements with
  // the same DOM id is invalid HTML whichever container they sit in. The map
  // was already walked for reference resolution and caption numbering below;
  // id assignment was the one pass that skipped it, so a heading in a note
  // came out with no id at all while the same heading in a quote, a div or a
  // list item got one (carve-js#669).
  for (const body of Object.values(doc.footnoteDefs ?? {}))
    for (const b of body) reserveExplicitIds(b)

  assignIds(doc.children, false)
  // Not `inBlockquote`: a note body is not quoted material, and the flag only
  // exists to keep a quoted heading out of the section-wrapping path.
  for (const body of Object.values(doc.footnoteDefs ?? {})) assignIds(body, false)

  // Two-pass resolution: implicit-heading refs must be finalized
  // BEFORE crossref cloning, otherwise a forward `</#id>` could clone
  // a heading's children while they still hold unresolved Link
  // placeholders, locking those placeholders into the clone where the
  // second pass can't see them. Refs are resolved first; then crossrefs
  // clone the now-finalized heading children.

  /** Pass 1: finalize unresolved reference links in-place. */
  const resolveRefs = (nodes: InlineNode[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      // A link that ALREADY has a destination was resolved by an explicit
      // `[label]: url` definition, and an explicit definition wins over the
      // implicit heading index. It used to be told apart by `ref` being gone;
      // PART 12 §3a keeps `ref` on a resolved reference, so the test is the
      // destination itself (carve#596).
      if (n.type === 'link' && isUnresolvedReference(n)) {
        // No explicit `[label]: url` def matched in applyLinkDefs.
        // Try the implicit-heading index; otherwise fall back to the
        // raw source text. Explicit defs win because applyLinkDefs
        // already resolved those before this pass.
        // The label AS WRITTEN first, then its RENDERED PLAIN TEXT. Both, and
        // in that order, because the two keys differ only when the label
        // carries markup: a label with none produces the same string twice, and
        // one that does must still lose to a heading whose text literally
        // contains the markup characters.
        //
        // ONLY the collapsed spelling reaches the index (PART 9R R1,
        // markup-carve/carve#742). The gate is on the SPELLING, not on
        // "unresolved": an explicit `[text][label]` naming a real linkDefs entry
        // still resolves - it resolved in applyLinkDefs, before this pass ever
        // saw it - and a collapsed one still reaches the heading index.
        //
        // WHICH KEY ANSWERED IS RECORDED, not just that one did. PART 12 §3a
        // defines `ref` as the label the reference RESOLVES BY, so when the
        // second key is the one the index answered on, `ref` publishes that
        // derived label and `rawRef` keeps the authored spelling
        // (markup-carve/carve#962). Taking the first key's answer leaves `ref`
        // authored, which is what §3a already gave `rawRef` - two fields, one
        // string, and no field naming the key a consumer would have to
        // recompute.
        if (isCollapsedRef(n.ref, n.rawRef)) {
          const asWritten = headingRefs.get(normalizeHeadingRefLabel(n.ref))
          if (asWritten !== undefined) {
            // PART 12 §3a - see the note in parse.ts: the authored `ref` and
            // `rawRef` survive beside the resolved destination. The label as
            // written IS the key here, so there is nothing to derive.
            n.href = `#${asWritten}`
          } else {
            const derived = derivedRefLabel(n.ref)
            const id = headingRefs.get(normalizeHeadingRefLabel(derived))
            if (id !== undefined) {
              n.href = `#${id}`
              n.ref = derived
            }
          }
        }
        // An UNRESOLVED reference stays a `link` carrying `ref` and `rawRef`
        // (PART 12 §3a). It used to become a text node here, which lost the
        // fact that the author wrote a reference at all: on the wire
        // `see [a][] here` came out as three adjacent text nodes - breaking
        // §3a, §1a (they are adjacent and unmerged) and §6 (the parsed tree
        // holds a link, so the round trip was not an identity) in one move.
        // The renderers turn a surviving `ref` back into its literal source
        // (carve#486).
      }
      // A reference IMAGE resolves only against explicit `[label]: url` defs
      // (applyLinkDefs); it never matches heading text the way a link ref does,
      // so nothing left to try here. An unresolved one STAYS an image node for
      // the same reason the link above stays a link (PART 12 §3a): reverting it
      // to a text node here discarded the fact that the author wrote a
      // reference, and it did so only on the HTML path - the serialized tree
      // kept the image - so one document had two shapes depending on which
      // entry point produced it. The renderers write it back out as its
      // literal source (carve#486, carve-php#624).
      switch (n.type) {
        case 'emphasis':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'superscript':
        case 'subscript':
        case 'highlight':
        case 'link':
        case 'span':
        case 'insert':
        case 'delete':
          resolveRefs(n.children)
          break
        case 'inline_extension':
          resolveRefs(n.content)
          break
        case 'inline_footnote':
          // An inline footnote's body (`^[…]`) is inline content; resolve refs
          // there too so an implicit/reference link inside a note is finalized.
          // A `footnote_ref` has no body of its own - it points at a definition.
          if (n.inline) resolveRefs(n.inline)
          break
        default:
          break
      }
    }
  }

  const crossrefCloneCache = new Map<string, InlineNode[]>()
  // Pre-resolution snapshot of each target's inline children, taken before any
  // crossref resolution mutates them. Crossref link text is cloned from here
  // (not from the live target) so a reference never picks up a nested link the
  // within-target pass already wrote into another target -- which would
  // double-expand the text (e.g. `A B ` / `Title Bee` instead of one level).
  const pristineTargets = new Map<string, InlineNode[]>()

  // Flatten any `</#…>` crossref nodes inside a target's text to plain text:
  // a NESTED crossref does NOT recursively expand its own target. This makes
  // crossref resolution strictly ONE LEVEL (the target's own text), matching
  // carve-php / carve-rs and making the result bounded regardless of how
  // crossrefs chain or cycle. (A resolved crossref shows nothing for the
  // nested link; an UNresolved `</#x>` would render literally, but at clone
  // time nested crossrefs are still raw `crossref` nodes, so emit empty text
  // to mirror the siblings, which drop the nested reference entirely.)
  const flattenNestedCrossrefs = (nodes: InlineNode[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (n.type === 'heading_ref') {
        nodes[i] = { type: 'text', value: '' } as Text
        continue
      }
      switch (n.type) {
        case 'emphasis':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'superscript':
        case 'subscript':
        case 'highlight':
        case 'link':
        case 'span':
        case 'insert':
        case 'delete':
          flattenNestedCrossrefs(n.children)
          break
        case 'inline_extension':
          flattenNestedCrossrefs(n.content)
          break
        case 'inline_footnote':
          if (n.inline) flattenNestedCrossrefs(n.inline)
          break
        default:
          break
      }
    }
  }

  /**
   * Pass 2: resolve `</#id>` crossrefs into one-level links.
   *
   * Each crossref becomes a link whose text is a clone of the TARGET's own
   * inline children with any nested crossrefs flattened to text -- i.e. the
   * resolution is strictly one level deep and never recurses into a target's
   * own crossrefs. This matches carve-php / carve-rs (`# A </#a>` ->
   * `A <a href="#A">A </a>`; `See </#a>` where A is `# Title </#b>` ->
   * `<a href="#a">Title </a>`), and -- critically -- makes resolution bounded
   * and non-recursive in the crossref graph. Previously a crossref CYCLE
   * (self-ref, mutual A<->B, or any ring) made a target transitively contain
   * itself; the shared clone cache then spliced a link's `children` array into
   * itself, producing an unbounded / cyclic object graph that overflowed the
   * later `unwrapNestedAnchors` walk (`RangeError: Maximum call stack size
   * exceeded`) -- a crash-DoS reachable from every public API on tiny input.
   */
  /**
   * Drop `pos` from a cloned subtree, at every depth.
   *
   * Cloned display text is not a slice of the source where it now sits, so a
   * span on it points somewhere else. Omitting it is what PART 12 §4 permits;
   * keeping it is what the containment rule catches.
   */
  const stripPositions = (nodes: InlineNode[]): void => {
    for (const node of nodes) {
      delete (node as { pos?: unknown }).pos
      const children = (node as { children?: InlineNode[] }).children
      if (Array.isArray(children)) stripPositions(children)
    }
  }

  const resolveCrossrefs = (nodes: InlineNode[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (n.type === 'heading_ref') {
        // Exact match first, then case-insensitive (case-folded) fallback so a
        // lowercase `</#getting-started>` resolves to a case-preserved
        // `Getting-Started` id. The emitted href uses the ACTUAL id.
        const tgtId = targets.has(n.target)
          ? n.target
          : foldedTargets.get(foldId(n.target))
        const tgt = tgtId !== undefined ? targets.get(tgtId) : undefined
        if (tgt && tgtId !== undefined) {
          let children = crossrefCloneCache.get(tgtId)
          if (!children) {
            // Clone each target once per document from its PRISTINE
            // (pre-resolution) text, then flatten its OWN nested crossrefs to
            // text so the link stays one level (no recursion into the crossref
            // graph -> no cycle, no unbounded chain). Cloning from pristine --
            // not the live target -- avoids inheriting a nested link another
            // target's resolution already wrote in. Repeated crossrefs share
            // the cached immutable tree.
            const source = pristineTargets.get(tgtId) ?? tgt
            children = deepCloneInlines(source)
            flattenNestedCrossrefs(children)
            // The clone came from the HEADING, so its spans point at the
            // heading's source, not at the `</#id>` this link was written as -
            // which put a span from one construct inside another's. PART 12 §4
            // lets a node whose content is not a contiguous slice of its own
            // source omit `pos` rather than invent one, and cloned display text
            // is that case exactly (carve#565).
            stripPositions(children)
            crossrefCloneCache.set(tgtId, children)
          }
          // The node STAYS a `heading_ref` (PART 12 §3a, carve#614): the
          // authored construct survives and the resolution is published
          // beside it. Replacing it with a `link` published a later stage -
          // and, because ids resolve case-insensitively, discarded which
          // spelling the author wrote: `</#intro>` and `</#Intro>` both
          // produced `href: "#Intro"`, so a document that had been through
          // the wire format came back respelled.
          n.href = `#${tgtId}`
          // The display text is NOT part of the serialized node (§3a: the
          // heading is in the same document, and copying its inline content
          // into every reference is unbounded where `href` is fixed-size).
          // The renderers need it, so it rides on the runtime node and
          // `toAstJson` strips it.
          n.resolvedText = children
          // `pos` is already the crossref's own span, which is what §4 wants:
          // `</#target>` is the source this node was written as. The children
          // keep the target heading's spans, which is genuinely where their
          // text came from - and `stripPositions` above removes them, because
          // cloned display text is not a contiguous slice of its own source
          // (carve#565).
        }
        // An UNRESOLVED crossref keeps its node too, rather than flattening to
        // a text node holding `</#target>`. §3a forbids that for the same
        // reason it forbids it for `[a][]`: flattening discards the fact that
        // the author wrote a reference at all, and makes the same document
        // have two node counts depending on which engine produced it.
        continue
      }
      switch (n.type) {
        case 'emphasis':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'superscript':
        case 'subscript':
        case 'highlight':
        case 'link':
        case 'span':
        case 'insert':
        case 'delete':
          resolveCrossrefs(n.children)
          break
        case 'inline_extension':
          resolveCrossrefs(n.content)
          break
        case 'inline_footnote':
          if (n.inline) resolveCrossrefs(n.inline)
          break
        default:
          break
      }
    }
  }

  const walkBlock = (b: BlockNode, fn: (xs: InlineNode[]) => void): void => {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      // A bibliography entry's inlines are rendered - in the references list -
      // so a `</#id>` crossref or a `[Heading][]` reference in one resolves
      // like any other. The line reached this walk as a paragraph before PART
      // 12 §18 made it its own node, and skipping it here would leave the
      // reference rendering as its own source text.
      case 'citation_definition':
        fn(b.children)
        break
      case 'block_quote':
        b.children.forEach((c) => walkBlock(c, fn))
        break
      case 'list':
        for (const item of b.items)
          item.children.forEach((c) => walkBlock(c, fn))
        break
      case 'admonition':
        if (b.title) fn(b.title)
        b.children.forEach((c) => walkBlock(c, fn))
        break
      case 'div':
        b.children.forEach((c) => walkBlock(c, fn))
        break
      case 'definition_list':
        for (const it of b.items) {
          for (const t of it.terms) fn(t)
          for (const d of it.definitions) d.forEach((c) => walkBlock(c, fn))
        }
        break
      case 'table':
        if (b.caption) fn(b.caption)
        for (const row of b.rows)
          for (const cell of row.cells) fn(cell.children)
        break
      case 'figure':
        fn(b.caption)
        if (b.target.type === 'block_quote' || b.target.type === 'table')
          walkBlock(b.target, fn)
        break
      case 'figure_group':
        if (b.caption) fn(b.caption)
        b.children.forEach((c) => walkBlock(c, fn))
        break
      default:
        break
    }
  }

  // Footnote definition bodies live on doc.footnoteDefs, not in
  // doc.children, so they need the same two passes — otherwise a
  // `[Heading][]` or `</#id>` inside a note renders literally. All refs
  // finalize before any crossref cloning (same invariant as above).
  // Caption numbering pass (#87): walk captioned elements in document
  // order, assign a per-label number where a caption carries a `#`
  // placeholder, fill the placeholder, and register the element id as a
  // crossref target whose auto-text is "label + number". Runs BEFORE
  // crossref resolution so a `</#id>` (including a forward reference) to a
  // numbered caption resolves.
  const footnoteBodies = doc.footnoteDefs ? Object.values(doc.footnoteDefs) : []
  const counters = new Map<string, number>()

  // The numbering itself is shared with `fromAstJson`, which has to re-derive
  // these on an ingested tree (carve#758). What stays here is the crossref
  // target registration, which only makes sense while resolution is running.
  const numberBlocks = (blocks: BlockNode[]): void => {
    numberCaptionsIn(blocks, counters, (labelNodes, next, attrs, suffix) => {
      const id = attrs?.id
      if (id === undefined || targets.has(id)) return
      // Clean "Label N" auto-text: clone the label inlines, trim trailing
      // whitespace on the final text node, then append " N". Markup in the
      // label is preserved. A composite figure's PANEL arrives with a letter
      // suffix (`Figure 2a`, §4c) on the group's own number.
      const autoNodes = labelNodes.map((n) => ({ ...n })) as InlineNode[]
      const last = autoNodes[autoNodes.length - 1]
      if (last && last.type === 'text') {
        last.value = last.value.replace(RE_TRAILING_LABEL_WS, '')
      }
      autoNodes.push({ type: 'text', value: ` ${next}${suffix ?? ''}` } as Text)
      targets.set(id, autoNodes)
    })
  }

  for (const block of doc.children) walkBlock(block, resolveRefs)
  for (const body of footnoteBodies) for (const b of body) walkBlock(b, resolveRefs)

  // Number captions AFTER ref resolution so a label that contains an
  // implicit heading reference (`^ [Setup][] #: …`) is cloned into the
  // crossref auto-text already resolved (no dangling href=""), and BEFORE
  // crossref resolution so a `</#id>` to a numbered caption resolves.
  numberBlocks(doc.children)
  for (const body of footnoteBodies) numberBlocks(body)

  // Snapshot each target's children BEFORE any crossref resolution mutates
  // them, so the clone cache can build one-level link text from the target's
  // own (pre-resolution) inlines rather than from a copy that another target's
  // resolution has already rewritten with nested links.
  for (const [id, children] of targets)
    pristineTargets.set(id, deepCloneInlines(children))

  // Finalize crossrefs WITHIN target (heading/caption) children so each
  // target's own `</#…>` becomes a one-level link in its rendered text.
  for (const children of targets.values()) resolveCrossrefs(children)

  for (const block of doc.children) walkBlock(block, resolveCrossrefs)
  for (const body of footnoteBodies) for (const b of body) walkBlock(b, resolveCrossrefs)

  // Pass 3 USED TO BE HERE and is gone: "links never nest" is a RENDERING rule.
  //
  // A NESTED LINK AND AN AUTOLINK STAY NODES -- NORMATIVE (PART 12 §3a,
  // markup-carve/carve#817). An anchor may not contain another anchor, and that
  // binds the renderer, not the encoder. A link or an autolink inside a link's
  // label is serialized as the node the author wrote, and every renderer unwraps
  // it at the render seam.
  //
  // Flattening it here was strictly lossier than the case §3a opens with. An
  // unresolved reference at least keeps enough to be written back; a nested
  // link's destination did not survive at all. `[[x](y)](z)` published a link to
  // `z` whose only child was the text `x`, so `y` was gone from the tree - `fmt`
  // on the parsed document wrote `[[x](y)](z)` back and `fmt` on the same
  // document taken through the AST wrote `[x](z)`, which is the §6 round trip
  // failing. An autolink flattened the same way returned as a bare URL, and that
  // is a DIFFERENT document: a bare URL stays literal where an autolink is a
  // link.
  //
  // The precedent was already inside this rule. A `heading_ref` inside a link
  // was exempt for exactly this reason - it reached the serialized tree and the
  // renderers suppressed the nested anchor instead - and an image and a code
  // span inside a label were never flattened at all. A link and an autolink are
  // the same case.
  //
  // `unwrapNestedAnchors` stays, and stays exported: the renderers call it, and
  // so does every consumer that derives runtime-only display text from a
  // heading. What moved is WHERE it runs.

  // Promote paragraphs that are really block images / figures (see
  // promoteBlockImages). Runs at the end of resolve() so reference images are
  // already resolved; also invoked by carveToCarve so `carve fmt` emits an
  // unescaped `^ …` caption line.
  promoteBlockImages(doc.children)
  for (const body of footnoteBodies) promoteBlockImages(body)
  return doc
}

export function resolveHeadingIds(
  doc: Document,
  opts: { lowercase?: boolean; asciiFold?: boolean; asciiStrict?: boolean } = {},
): Document {
  return resolveHeadingIdsImpl(doc, opts)
}

/** Internal conversion fast path: seed the renderer's id namespace while the
 * mandatory resolution walk is already visiting every explicit/generated id. */
export function resolveHeadingIdsWithRegistry(
  doc: Document,
  opts: { lowercase?: boolean; asciiFold?: boolean; asciiStrict?: boolean },
  documentIds: DocumentIdRegistry,
): Document {
  return resolveHeadingIdsImpl(doc, opts, documentIds)
}

// "Content" is any character that is not one of Carve's four whitespace
// characters - U+0020, U+0009, U+000A, U+000D (markup-carve/carve#977, PART 7:
// ONE WHITESPACE DEFINITION, IN EVERY CONSTRUCT). A non-breaking space
// (U+00A0) counts as content, matching RE_CAPTION and the parser's NBSP
// handling elsewhere. (String.trim() is Unicode-aware and would wrongly drop
// NBSP, so test against this class instead.)
//
// THE FORM FEED CAME OUT OF THIS CLASS. It read `[^ \t\n\r\f]`, so U+000C was
// not content here while it was content one line below the marker - the
// per-construct derivation carve#977 names as the source of the divergence.
// U+000B was never in it, which is the asymmetry that gives the game away:
// nothing in the grammar distinguishes the two.
const RE_HAS_CONTENT = /[^ \t\n\r]/

/**
 * The trailing whitespace run stripped from a numbered caption's LABEL.
 *
 * ONE producer, because the label is computed twice - once as the counter's
 * KEY (`numberCaptionsIn`) and once as the auto-text a crossref renders
 * (`numberBlocks`) - and the two must agree or a document numbers under one
 * key and renders under another.
 *
 * It read `/\s+$/`, the host language's full Unicode class, so `^ Figure<FF> #`
 * and `^ Figure #` shared a counter and the second figure came out "Figure 2"
 * with no "Figure 1" beside it. Carve's whitespace is four characters and a
 * form feed is not one of them (carve#977, PART 7).
 */
const RE_TRAILING_LABEL_WS = /[ \t\n\r]+$/

// Whether a `[Image, soft-break, "^ …", …]` paragraph's caption carries any
// content on its FIRST line: text after the `^ ` marker on the marker node, or
// any following inline node before the first soft break (e.g. `^ *b*`, where the
// marker node is just `"^ "` and the content is a Strong sibling). Rejects an
// empty first-line caption (`^ ` with content only on later folded lines).
function captionFirstLineHasContent(children: InlineNode[]): boolean {
  const afterMarker = (children[2] as Text).value.replace(/^\^ +/, '')
  if (RE_HAS_CONTENT.test(afterMarker)) return true
  for (let k = 3; k < children.length; k++) {
    const c = children[k]!
    if (c.type === 'soft_break') break
    if (c.type !== 'text' || RE_HAS_CONTENT.test((c as Text).value)) return true
  }
  return false
}

/**
 * Promote a paragraph whose sole child is a (resolved) image to a block-level
 * image, matching the standalone inline-image rule and carve-php. A reference
 * image resolves AFTER the syntactic block-image check, so it arrives here as a
 * one-image paragraph; an unresolved ref already became a Text node, so its
 * paragraph is left untouched (renders as a literal `<p>`). A one-image
 * paragraph followed by a `^ …` caption becomes a <figure>.
 *
 * Exported so `carve fmt` (carveToCarve) can apply it too: without the figure
 * promotion the caption stays a paragraph `[Image, SoftBreak, "^ …"]` and the
 * serializer escapes the leading `^` to `\^`, which only carve-js's lenient
 * parser reads back as a caption (carve-rs / carve-php read it literally,
 * losing the figure). Emitting the promoted figure yields a portable
 * unescaped `^ …` line, matching carve-php.
 */
export function promoteBlockImages(blocks: BlockNode[], figuresOnly = false): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    // The sole-image -> block-image promotion is skipped in `figuresOnly` mode
    // (the formatter): a paragraph and a bare block image serialize identically,
    // so the only effect there would be dropping a leading block-attribute line
    // (`{#id}`) that the paragraph carries but a bare block image cannot. The
    // formatter keeps it a paragraph so those attrs survive.
    if (
      !figuresOnly &&
      b.type === 'paragraph' &&
      b.children.length === 1 &&
      b.children[0]!.type === 'image' &&
      // Only a REAL image (direct or resolved reference) promotes; an
      // unresolved reference image renders as literal text (in HTML mode it is
      // already a Text node here, so this only matters for the parse-only
      // formatter path, where the unresolved Image survives). UNRESOLVED means
      // no destination: PART 12 §3a keeps `ref` on a resolved reference too
      // (carve#596).
      !isUnresolvedReference(b.children[0] as Image) &&
      // Strict column-0 rule, the same one the figure arm below applies and for
      // the same reason (carve#1660): a top-level block opener must start at
      // column 0, so an image indented above its container's content column is
      // not a block image. `parseParagraph` strips a paragraph's leading
      // indentation, so the AST text cannot tell an indented image from a flush
      // one -- the image's own source column can. A flush image, at top level OR
      // at the dedented content column of any container, has startColumn === 1.
      //
      // THIS ARM RUNS FROM resolve(), so without the check the ruling held on
      // the parse tree and was lost on the PUBLISHED one: the syntactic
      // block-image pass declines an indented image at parse time, and this
      // promoted it again afterwards on "is it a real image" alone. carve-js was
      // the only engine still promoting it (carve-js#1437).
      ((b.children[0] as Image).pos === undefined ||
        (b.children[0] as Image).pos!.startColumn === 1)
    ) {
      const img = b.children[0] as Image
      // A leading block-attribute line (`{#id}`) landed on the paragraph; carry
      // it onto the promoted block image (its own inline attrs win on conflict,
      // §15), matching a direct block image `{#id}\n![…](…)`. Otherwise the id
      // would be lost when the paragraph wrapper is dropped.
      if (b.attrs) img.attrs = mergeAttrs(b.attrs, img.attrs ?? {})
      blocks[i] = img as unknown as BlockNode
      continue
    }
    // A resolved reference image on its own line followed by a `^ ` caption
    // becomes a <figure>. The syntactic block-image/caption pass runs at PARSE
    // time and only knows the inline `![…](…)` form, so a reference image
    // arrives here as a paragraph `[Image, soft-break, "^ caption…"]`. An
    // unresolved ref is a Text node (not an Image), so its paragraph is left
    // literal. The caption inlines are already parsed; strip the `^ ` marker
    // from the leading Text.
    if (
      b.type === 'paragraph' &&
      b.children.length >= 3 &&
      b.children[0]!.type === 'image' &&
      // A REAL image only (see above): an unresolved reference is literal text,
      // not a figure target.
      !isUnresolvedReference(b.children[0] as Image) &&
      // Strict column-0 rule: an image+caption forms a <figure> ONLY when the
      // image begins at its container's content column. parseParagraph strips a
      // paragraph's leading indentation, so the AST text alone can't tell an
      // indented image+caption (which must stay literal) from a flush one; the
      // image's source column does. A flush image (top level OR the dedented
      // content column of any container) has startColumn === 1 -- an image
      // indented ABOVE that column has startColumn > 1 and does not promote. When
      // positions are suppressed (pos undefined) fall back to the prior behavior.
      ((b.children[0] as Image).pos === undefined ||
        (b.children[0] as Image).pos!.startColumn === 1) &&
      b.children[1]!.type === 'soft_break' &&
      // This `text` test is also what keeps an ESCAPED caret literal: `\^`
      // parses to an `escaped_text` node, and coalesceTextRuns never merges one
      // into a text node, so `![a](/u)\n\^ cap` arrives here with an
      // `escaped_text` in this slot and stays a paragraph (carve-rs/-php). It
      // used to be re-checked below through a parser-internal
      // `escapedLeadingCaret` flag, which could not fire and was removed with it
      // (carve-js#1259).
      b.children[2]!.type === 'text' &&
      // Mirror the caption delimiter (§4/§553): `^` + one-or-more spaces (a
      // space, not a tab). The FIRST line must carry content -- either text
      // after the marker on this node, or a following inline node on the same
      // line (before the first soft-break). `^ ` alone, `^\t…`, or content only
      // on a later folded line is not a caption, matching a heading's `#` +
      // space + non-empty rule.
      /^\^ +/.test((b.children[2] as Text).value) &&
      captionFirstLineHasContent(b.children)
    ) {
      const caption = b.children.slice(2)
      const first = caption[0] as Text
      const stripped = first.value.replace(/^\^ +/, '')
      if (stripped === '') caption.shift()
      else {
        // The span has to move with the value. Keeping the paragraph's span
        // while dropping `^ ` from the text leaves a node whose own span does
        // not slice back to it: `value: "cap"` over a range covering "^ cap".
        // The marker is ASCII (`^` plus spaces), so the count is the same in
        // offsets and in codepoint columns; only the START moves.
        // carve-rs has the same defect and is tracked at carve-rs#620; carve-php
        // already advances it.
        const removed = first.value.length - stripped.length
        const pos = first.pos
          ? {
              ...first.pos,
              // Each field is optional on its own, so advance only what is there
              // rather than inventing a zero origin for a missing one.
              ...(first.pos.startOffset !== undefined
                ? { startOffset: first.pos.startOffset + removed }
                : {}),
              ...(first.pos.startColumn !== undefined
                ? { startColumn: first.pos.startColumn + removed }
                : {}),
            }
          : undefined
        caption[0] = pos ? { ...first, value: stripped, pos } : { ...first, value: stripped }
      }
      // Carry a leading block-attribute line (`{#id}` etc.) from the paragraph
      // onto the figure, matching a direct-image figure (which takes the attrs
      // at parse time) and carve-php -- otherwise `carve fmt` would drop it.
      const figure: Figure = { type: 'figure', target: b.children[0] as Image, caption }
      // The PARAGRAPH's span is the figure's: it covered the image line and the
      // caption line, which is exactly what this figure now holds. Without it
      // the node is published with no position at all - the four figure sites in
      // parse.ts get one from the block loop, and this one, which promotes a
      // paragraph after parsing, was left out (PART 12 §4, carve-js#727).
      if (b.pos) figure.pos = b.pos
      if (b.attrs) figure.attrs = b.attrs
      blocks[i] = figure as unknown as BlockNode
      continue
    }
    switch (b.type) {
      case 'block_quote':
      case 'admonition':
      case 'div':
      case 'figure_group':
        promoteBlockImages(b.children, figuresOnly)
        break
      case 'list':
        for (const item of b.items) promoteBlockImages(item.children, figuresOnly)
        break
      case 'definition_list':
        for (const it of b.items) for (const d of it.definitions) promoteBlockImages(d, figuresOnly)
        break
      default:
        break
    }
  }
}


/**
 * Called for each caption as it is numbered, with the label inlines preceding
 * the `#` placeholder, the number assigned, and the captioned element's attrs.
 */
type CaptionNumbered = (
  labelNodes: InlineNode[],
  n: number,
  attrs: Attrs | undefined,
  /**
   * PART 9 §4c: a composite figure's PANEL takes the GROUP's number plus a
   * letter (`a`, `b`, …) derived from its order among the panels. The letter
   * arrives here as a suffix on the registered auto-text (`Figure 2a`); the
   * group's own registration and every non-panel caption pass none.
   */
  suffix?: string,
) => void

/**
 * The §4c panel letter for panel index `k` (0-based): `a`..`z`, then `aa`,
 * `ab`, … - bijective base 26, matching the executable spec's `panelLetter`.
 */
function panelLetter(k: number): string {
  let s = ''
  k++
  while (k > 0) {
    k--
    s = String.fromCharCode(97 + (k % 26)) + s
    k = Math.floor(k / 26)
  }
  return s
}

/** The §4c panels of a group: its `figure` and `table` children, in order. */
export function figureGroupPanels(group: FigureGroup): (Figure | Table)[] {
  return group.children.filter(
    (c): c is Figure | Table => c.type === 'figure' || c.type === 'table',
  )
}

/**
 * Assign `caption_number.n` per label, in document order, over `blocks`.
 *
 * Extracted from `resolveHeadingIds` so `fromAstJson` can re-derive these on an
 * INGESTED tree without also re-registering crossref targets, which only makes
 * sense while resolution is running. A published caption number describes the
 * document it was written from, and an editor that deletes a captioned element
 * leaves the survivors numbered for a document that no longer exists - visibly,
 * since this number is what the renderer prints (carve#758).
 *
 * `counters` is the caller's, so a document and its footnote bodies share one
 * sequence per label.
 */
export function numberCaptionsIn(
  blocks: BlockNode[],
  counters: Map<string, number>,
  onNumbered?: CaptionNumbered,
): void {
  const numberCaption = (caption: InlineNode[], attrs: Attrs | undefined): number | undefined => {
    const idx = caption.findIndex((n) => n.type === 'caption_number')
    if (idx === -1) return undefined
    const labelNodes = caption.slice(0, idx)
    const label = inlineText(labelNodes).replace(RE_TRAILING_LABEL_WS, '')
    const next = (counters.get(label) ?? 0) + 1
    counters.set(label, next)
    ;(caption[idx] as CaptionNumber).n = next
    onNumbered?.(labelNodes, next, attrs)
    return idx
  }

  // PART 9 §4c: a PANEL of a composite figure is not a sequence unit. Its
  // caption's `#` placeholder draws no number and registers nothing - the
  // caption_number node STAYS in the tree, un-numbered, and every renderer
  // emits its authored spelling (the unresolved-reference precedent: keep the
  // typed node, render what the author wrote). Decided here, in the one
  // shared numbering pass, so the parse path and the AST-JSON ingest path
  // (carve#758) publish the same wire shape as carve-php and carve-rs.
  const walk = (bs: BlockNode[], inPanel: boolean): void => {
    for (const b of bs) {
      if (b.type === 'figure') {
        if (!inPanel) numberCaption(b.caption, b.attrs)
      } else if (b.type === 'table' && b.caption) {
        if (!inPanel) numberCaption(b.caption, b.attrs)
      }
      switch (b.type) {
        case 'block_quote':
        case 'admonition':
        case 'div':
          walk(b.children, inPanel)
          break
        case 'list':
          for (const it of b.items) walk(it.children, inPanel)
          break
        case 'definition_list':
          for (const it of b.items) for (const d of it.definitions) walk(d, inPanel)
          break
        case 'figure':
          // A figure wraps an image / blockquote / table; descend into a
          // blockquote or table target so a nested captioned element is
          // numbered too (mirrors walkBlock's figure-target descent).
          if (b.target.type === 'block_quote') walk(b.target.children, inPanel)
          else if (b.target.type === 'table' && b.target.caption && !inPanel) {
            numberCaption(b.target.caption, b.target.attrs)
          }
          break
        case 'figure_group': {
          // The group is ONE numbering unit (§4c): only its own caption draws
          // from the sequence, and its draw also registers the panel ids with
          // letters - so `</#panel-id>` resolves as "Figure 2a". A group with
          // no numbered caption registers nothing for its panels either.
          const panels = figureGroupPanels(b)
          if (!inPanel && b.caption) {
            const labelIdx = numberCaption(b.caption, b.attrs)
            if (labelIdx !== undefined && onNumbered) {
              const labelNodes = b.caption.slice(0, labelIdx)
              const n = (b.caption[labelIdx] as CaptionNumber).n!
              panels.forEach((panel, k) => {
                onNumbered(labelNodes, n, panel.attrs, panelLetter(k))
              })
            }
          }
          // Children walk: panels are not sequence units, and everything a
          // panel CONTAINS is suppressed with it; non-panel stray content
          // numbers normally, exactly as it would outside the group.
          for (const c of b.children) {
            const isPanel = c.type === 'figure' || c.type === 'table'
            walk([c], inPanel || isPanel)
          }
          break
        }
        default:
          break
      }
    }
  }

  walk(blocks, false)
}
