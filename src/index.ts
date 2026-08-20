/*
 * Public API for @markup-carve/carve.
 *
 * Implementation status:
 *   ✓ Headings (M1, step 1)
 *   - Paragraphs, lists, blockquotes, fences, tables, frontmatter, hr,
 *     admonitions, captions — to come in M1
 *   - All inline constructs — to come in M2
 *
 * Processing pipeline: parse -> resolve -> renderHtml.
 * Callers using parse() + renderHtml() directly must call resolve() in
 * between to enable:
 *   - heading id assignment (`# Foo` -> id `foo`)
 *   - `</#id>` cross-reference resolution
 *   - implicit heading references (`[Foo][]` -> `#foo`)
 *   - finalization of any unresolved reference link (a Link node with
 *     `ref` still set, e.g. `[never defined][]`) to its literal source
 *     text — parse() leaves it as a placeholder so the implicit-heading
 *     pass can see it.
 */

import type { Document } from './ast.js'
import type { BeforeRenderContext, CarveExtension } from './extension.js'
import { parse as parseImpl, type ParseOptions } from './parse.js'
import {
  resolveHeadingIds,
  resolveHeadingIdsWithRegistry,
  headingIdSlugOpts,
  promoteBlockImages,
  type AsciiHeadingIdMode,
} from './heading-ids.js'
import { promoteCitationDefinitions } from './citations.js'
import { numberFootnotes } from './footnote-numbering.js'
import { Profile } from './profile.js'
import { applyProfile as applyProfileImpl } from './profile-filter.js'
import { renderHtml as renderHtmlImpl, type RenderOptions } from './render-html.js'
import {
  renderMarkdown as renderMarkdownImpl,
  type MarkdownRenderOptions,
} from './render-markdown.js'
import {
  renderCarve as renderCarveImpl,
  type CarveRenderOptions,
} from './render-carve.js'
import {
  renderPlainText as renderPlainTextImpl,
  type PlainTextRenderOptions,
} from './render-plain.js'
import { renderAnsi as renderAnsiImpl, type AnsiRenderOptions } from './render-ansi.js'
import { adoptBlockFootnoteDefs } from './legacy-nodes.js'
import { toAstJson as toAstJsonImpl, type AstJsonDocument } from './ast-json.js'
import { coalesceTextRuns } from './coalesce-text-runs.js'
import { DocumentIdRegistry } from './document-ids.js'
import { toSourceLayout, type SourceLayout } from './source-layout.js'

export * from './ast.js'
export {
  htmlToAst,
  htmlToCarve,
  HtmlImportLimitError,
  type HtmlImportAdapter,
  type HtmlImportDiagnostic,
  type HtmlImportDiagnosticCode,
  type HtmlImportMode,
  type HtmlImportOptions,
  type HtmlImportResult,
} from './html-import.js'
export type { ParseOptions } from './parse.js'
export { toSourceLayout, type SourceLayout, type SourceLayoutNode } from './source-layout.js'
export { diffAst, formatChanges, type Change, type ChangeKind } from './diff.js'
export {
  applyAstPatch,
  createAstPatch,
  AstPatchError,
  type AstPatchOperation,
} from './ast-patch.js'
export {
  mergeAst,
  type MergeConflict,
  type MergeOptions,
  type MergeResolution,
  type MergeResult,
} from './merge.js'
export {
  checkPortability,
  normalizeHtml,
  type DjotEngine,
  type Divergence,
  type NormalizedHtml,
  type PortabilityReport,
} from './portability.js'
export {
  toAstJson,
  fromAstJson,
  AstJsonDepthError,
  AstJsonRootError,
  // PART 12 §9(b) and §12 both ask for a TYPED, DOCUMENTED refusal. A class a
  // consumer cannot import is neither, so every ingest error the decoder raises
  // is exported - `AstJsonUnknownFieldError` included, which §11 added without
  // a way to catch it by type.
  AstJsonRootFieldError,
  AstJsonUnknownFieldError,
  AstJsonUnknownNodeTypeError,
  AstJsonNodeTypeError,
  AstJsonPartitionError,
  AstJsonSchemaError,
  MAX_AST_JSON_DEPTH,
  type AstJsonDocument,
  type AstJsonBlock,
  type FrontmatterNode,
  type FootnoteDefNode,
} from './ast-json.js'
export { RenderDepthError, MAX_RENDER_DEPTH } from './render-depth.js'
export { SourceUnspellableError } from './source-unspellable-error.js'
export type { RenderOptions } from './render-html.js'
export type { MarkdownRenderOptions } from './render-markdown.js'
export type { CarveRenderOptions } from './render-carve.js'
export type { PlainTextRenderOptions } from './render-plain.js'
export type { AnsiRenderOptions } from './render-ansi.js'
export type {
  CarveExtension,
  BeforeRenderContext,
  ExtensionRenderer,
  ExtensionRenderContext,
  BlockExtensionRenderer,
  BlockExtensionRenderContext,
  InlineMatch,
  BlockMatch,
  MatcherContext,
  InlineMatcher,
  BlockMatcher,
} from './extension.js'
export {
  djotMigrationWarnings,
  formatMigrationWarnings,
  applyMigrationFixes,
  type MigrationWarning,
  type MigrationCategory,
  type MigrationFixResult,
} from './djot-migrate.js'
export {
  bbcodeToCarve,
  BbcodeInputTooLargeError,
  BBCODE_MAX_INPUT_LENGTH,
} from './bbcode-migrate.js'
export { markdownToCarve, type MarkdownDialect } from './markdown-migrate.js'
export {
  lintCarve,
  formatLintWarnings,
  type LintWarning,
  type LintPlatform,
  KNOWN_LINT_PLATFORMS,
} from './lint.js'
export { tabNormalize } from './tab-normalize.js'
export { details } from './details.js'
export { semanticSpan } from './semantic-span.js'
export { listTable } from './list-table.js'
export { glossary } from './glossary.js'
export { headingNumbers, type HeadingNumbersOptions } from './heading-numbers.js'
export { codeCallouts } from './code-callouts.js'
export {
  smartQuotes,
  smartQuoteLocales,
  isSmartQuoteLocaleSupported,
  SMART_QUOTE_LOCALES,
  type QuoteCharacters,
  type SmartQuotesOptions,
} from './smart-quotes.js'
export { index } from './index-terms.js'
export {
  citations,
  type CitationsOptions,
  type CslEntry,
  type CslName,
} from './citations.js'
export {
  fencedRender,
  mermaid,
  d2,
  graphviz,
  wavedrom,
  abc,
  plantuml,
  vegaLite,
  chart,
  presets,
  type FencedRenderOptions,
  type FencedRenderContentMode,
} from './fenced-render.js'
export { imgFence, type ImgFenceOptions } from './svg-fence.js'
export { sanitizeSvg, type SanitizeSvgOptions, type SanitizeResult } from './svg-sanitize.js'
export { mathBlock, type MathBlockOptions } from './math-block.js'
export { spoiler } from './spoiler.js'
export {
  colorSwatch,
  type ColorSwatchOptions,
  type SwatchPosition,
  type SwatchShape,
} from './color-swatch.js'
export { wikilinks, type WikilinksOptions } from './wikilinks.js'
export { autolink, type AutolinkOptions } from './autolink.js'
export { externalLinks, type ExternalLinksOptions } from './external-links.js'
export { tableOfContents, tocPlacement, type TableOfContentsOptions } from './table-of-contents.js'
export { headingPermalinks, type HeadingPermalinksOptions } from './heading-permalinks.js'
export { codeGroup, type CodeGroupOptions } from './code-group.js'
export { tabs, type TabsOptions, type TabsMode } from './tabs.js'
export { headingLevelShift, type HeadingLevelShiftOptions } from './heading-level-shift.js'
export { headingReference, type HeadingReferenceOptions } from './heading-reference.js'
export {
  defaultAttributes,
  type DefaultAttributesOptions,
  type DefaultAttributesMap,
} from './default-attributes.js'
export {
  Profile,
  LinkPolicy,
  ProfileViolationError,
  formatProfileViolation,
  canonicalType,
  CANONICAL_BLOCK_TYPES,
  CANONICAL_INLINE_TYPES,
  type DisallowedAction,
  type ProfileViolation,
} from './profile.js'
export { applyProfile, type ProfileFilterResult } from './profile-filter.js'
export {
  stampCarve,
  buildMarker,
  stripTrailingMarker,
  readStamp,
  needsReview,
  compareSpecVersions,
  type StampForm,
  type Stamp,
} from './stamp.js'
export { SPEC_VERSION, LIB_VERSION } from './version.js'

/**
 * Options shared by every `carveTo*` entry point for profile-based feature
 * restriction. A profile runs as an AST transform after resolve() and before
 * the renderer, so it applies identically to HTML/Markdown/plain/ANSI output.
 */
export interface ProfileOptions {
  /**
   * Feature-restriction profile. When set, disallowed nodes are converted to
   * text / stripped / error'd per the profile's action, link/image URLs are
   * gated by its link policy, and maxNesting / maxLength are enforced. Omit
   * for no restriction (all features pass through).
   */
  profile?: Profile
  /**
   * Current document host, used by the profile's link policy to tell internal
   * from external links (e.g. `internalOnly`). Optional.
   */
  profileBaseHost?: string
}

/**
 * Enforce the profile's maximum input length BEFORE parsing, so an oversize
 * untrusted input is rejected without the parser doing any work (a giant input
 * is otherwise linear parse work even after the O(n) inline fixes). No-op when
 * no profile is set or its maxLength is 0 (unlimited). Length is measured in
 * UTF-8 bytes, matching carve-php's pre-parse strlen() check.
 */
function enforceProfileMaxLength(source: string, opts: ProfileOptions): void {
  const profile = opts.profile
  if (!profile) return
  const maxLength = profile.getMaxLength()
  if (maxLength > 0 && byteLength(source) > maxLength) {
    throw new RangeError(
      `Input exceeds the profile's maximum length of ${maxLength} bytes ` +
        `(got ${byteLength(source)} bytes).`,
    )
  }
}

/**
 * Apply a profile's feature / link / nesting restrictions to a resolved
 * document (after resolve, before render). Mutates and returns `doc`.
 *
 * Input-length enforcement is NOT done here - it runs pre-parse via
 * {@link enforceProfileMaxLength} in the `carveToX` entry points, so an oversize
 * input is rejected before the parser runs.
 */
function runProfile(doc: Document, opts: ProfileOptions): Document {
  const profile = opts.profile
  if (!profile) return doc
  return applyProfileImpl(doc, profile, opts.profileBaseHost ?? null).doc
}

/** UTF-8 byte length, matching PHP's strlen() on the source string. */
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * Parse Carve source into a typed AST.
 *
 * This is the syntactic pass only. Semantic resolution (heading ids,
 * crossrefs, implicit heading refs, unresolved-ref fallback to literal
 * text) happens in `resolve()`. Most callers want `carveToHtml()` or
 * `renderHtml(resolve(parse(src)))`.
 */
export function parse(source: string, opts: ParseOptions = {}): Document {
  const doc = parseImpl(source, opts)
  // A reference image with a caption is a FIGURE in the published tree, not a
  // paragraph holding `[Image, SoftBreak, "^ cap"]`. The syntactic
  // block-image/caption pass runs during parsing and only knows the inline
  // `![…](…)` form, so the reference form arrives here unpromoted - and the
  // reference itself was already resolved during parsing (`src` is filled in),
  // which is what made the leftover paragraph inconsistent: a resolved image
  // whose caption was still sitting in a text node as `^ cap` (carve-js#680).
  //
  // `figuresOnly` deliberately: the sole-image -> block-image promotion stays
  // out of `parse`, because a one-image PARAGRAPH can carry a leading
  // block-attribute line (`{#id}`) that a bare block image would have to move
  // inline, which the formatter relies on. That leaves `![a][ok]` alone still a
  // paragraph here where carve-rs gives an image - reported separately rather
  // than traded for a formatter change.
  //
  // This is representation, not resolution: no ids, numbering or default attrs
  // are applied, and `carveToHtml` / `carveToCarve` produce byte-identical
  // output before and after, since both already ran this pass themselves.
  promoteBlockImages(doc.children, true)
  if (doc.footnoteDefs) {
    for (const body of Object.values(doc.footnoteDefs)) promoteBlockImages(body, true)
  }
  // A `[@key]: entry` line is a `citation_definition`, not a paragraph holding
  // its own unrecognized source (PART 12 §18). Here rather than in the
  // citations extension's `afterParse` hook because THIS is the stage that
  // matters: `parse` is what `toAstJson` serializes and what §3a makes
  // pre-resolve, and `parse` does not call that hook - so a fix living there
  // would look right through the extension and leave the published tree
  // carrying the paragraph (carve#1276). Representation, not resolution, the
  // same standing as `promoteBlockImages` above: no rendered output moves on
  // any target.
  doc.children = promoteCitationDefinitions(doc.children)
  return doc
}

/** Parse once and return canonical AST JSON plus the opt-in source-layout sidecar. */
export function parseWithSourceLayout(source: string, opts: ParseOptions = {}): {
  ast: AstJsonDocument
  layout: SourceLayout
} {
  const ast = toAstJsonImpl(parse(source, opts))
  return { ast, layout: toSourceLayout(source, ast) }
}

/** Render a Carve AST to HTML matching the spec corpus. */
export function renderHtml(ast: Document, opts: RenderOptions = {}): string {
  return renderHtmlImpl(adoptBlockFootnoteDefs(ast), opts)
}

/** Render a resolved Carve AST to Markdown. */
export function renderMarkdown(ast: Document, opts: MarkdownRenderOptions = {}): string {
  return renderMarkdownImpl(adoptBlockFootnoteDefs(ast), opts)
}

/** Render a resolved Carve AST to canonical Carve source. */
export function renderCarve(ast: Document, opts: CarveRenderOptions = {}): string {
  return renderCarveImpl(adoptBlockFootnoteDefs(ast), opts)
}

/** Render a resolved Carve AST to plain text. */
export function renderPlainText(ast: Document, opts: PlainTextRenderOptions = {}): string {
  return renderPlainTextImpl(adoptBlockFootnoteDefs(ast), opts)
}

/** Render a resolved Carve AST to ANSI terminal text. */
export function renderAnsi(ast: Document, opts: AnsiRenderOptions = {}): string {
  return renderAnsiImpl(adoptBlockFootnoteDefs(ast), opts)
}

/**
 * Post-parse semantic resolution: heading ids, `</#id>` crossrefs,
 * implicit heading references (`[Foo][]` -> `#foo`), footnote numbering
 * (`footnote_ref` / `inline_footnote` `.number`, by document reference
 * order), and finalization of any reference-link placeholder the parse
 * phase left unresolved (no explicit `[label]: url` def and no matching
 * heading) to its literal source text.
 */
export function resolve(
  doc: Document,
  opts: { asciiHeadingIds?: AsciiHeadingIdMode; lowercaseHeadingIds?: boolean } = {},
): Document {
  return resolveDocument(doc, opts)
}

function resolveDocument(
  doc: Document,
  opts: { asciiHeadingIds?: AsciiHeadingIdMode; lowercaseHeadingIds?: boolean },
  documentIds?: DocumentIdRegistry,
): Document {
  const slugOpts = headingIdSlugOpts(opts)
  const resolved = documentIds
    ? resolveHeadingIdsWithRegistry(doc, slugOpts, documentIds)
    : resolveHeadingIds(doc, slugOpts)
  // Footnote `number` (PART 12 §5): document reference order, so it is a
  // resolution result rather than a rendering one. `renderHtml()` numbers
  // the same way standalone (carve-js#479) via the same shared pass.
  numberFootnotes(resolved)
  // §1a again, because this stage breaks it: `parse()` returns a coalesced tree
  // and the passes above re-split runs when a reference degrades to text or a
  // nested autolink is unwrapped. The resolved tree is what the CLI and every
  // `carveToAstJson` caller publish, so it has to hold (carve-js#549).
  return coalesceTextRuns(resolved)
}

/** Convenience: parse + resolve + render in one call. */
export function carveToHtml(
  source: string,
  opts: ParseOptions & RenderOptions & ProfileOptions = {},
): string {
  enforceProfileMaxLength(source, opts)
  const exts: CarveExtension[] = opts.extensions ?? []
  // `sourceLine` rendering needs block positions, so enable parsing them.
  // Extensions are forwarded to the parse so their matchers add syntax.
  const parseOpts: ParseOptions = {
    ...opts,
    extensions: exts,
    ...(opts.sourceLine ? { positions: true } : {}),
  }
  // With no transform/profile capable of inserting new ids, resolution can
  // seed the renderer namespace during its existing mandatory AST walk. Public
  // parse/resolve/render composition and mutable extension paths keep the
  // conservative render-time collection.
  const documentIds = exts.length === 0 && opts.profile === undefined
    ? new DocumentIdRegistry()
    : undefined
  let doc = applyTransforms(
    resolveDocument(parse(source, parseOpts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }, documentIds),
    exts,
    opts,
    true,
  )
  doc = runProfile(doc, opts)
  return renderHtmlImpl(adoptBlockFootnoteDefs(doc), opts, documentIds)
}

/**
 * Run the renderer-agnostic extension transforms (`afterParse`,
 * `beforeRender`) over a resolved document. Renderer-specific output (block
 * renderers, inline renderers) is consulted by the HTML renderer only, but the
 * transform hooks mutate the AST itself, so they apply to every renderer -
 * matching carve-php, where a `beforeRender` extension (heading level shift,
 * default attributes, …) affects Markdown/PlainText/ANSI output too.
 */
function applyTransforms(
  doc: Document,
  exts: CarveExtension[] | undefined,
  opts: Readonly<RenderOptions>,
  // Whether the FINAL render target is HTML. Not derivable from the options -
  // one options object is reused across `carveToHtml` and `carveToMarkdown` -
  // so each entry point states it, and it is what lets a hook emitting HTML
  // skip its transform on a non-HTML target (spec §2.2, carve#1007).
  targetIsHtml: boolean,
): Document {
  if (!exts) return doc
  let out = doc
  for (const ext of exts) if (ext.afterParse) out = ext.afterParse(out)
  // A frozen SHALLOW COPY, not the caller's object. A hook that renders
  // something needs to read `symbols` / `allowRawHtml` / `sanitizeUrls`
  // (carve-js#871), and it must not be able to write them: the renderer is
  // handed the caller's options a few lines later, so handing the same object
  // to arbitrary extension code would let a hook clear the very setting a guard
  // downstream of it reads. carve-rs hit that exact shape from the other side -
  // its length cap sat BEHIND the hooks, so a hook could empty the field the cap
  // measured.
  //
  // Shallow is the honest bound: the nested `symbols`, `renderers` and
  // `extensions` values are the caller's own objects and are shared by
  // reference, because deep-freezing them would freeze objects this package does
  // not own. Read-only is the contract, and the copy makes the flat options -
  // where every guard lives - enforce it.
  const options = Object.freeze({ ...opts })
  // The EFFECTIVE mode, which is the caller's only on the HTML path. Static
  // rendering is an HTML-only concern (spec §2.5): the Markdown, plain-text and
  // ANSI renderers reach the same end by flattening and never consult the mode,
  // so reporting the caller's `mode: "static"` to a hook on those targets would
  // invite it to degrade output that is not degraded, and one options object
  // reused across formats would stop producing the same non-HTML bytes.
  const mode = targetIsHtml ? (opts.mode ?? 'interactive') : 'interactive'
  const ctx: BeforeRenderContext = Object.freeze({
    options,
    mode,
    isStatic: mode === 'static',
    targetIsHtml,
  })
  for (const ext of exts) if (ext.beforeRender) out = ext.beforeRender(out, ctx)
  return out
}

/**
 * Convenience: parse + resolve to the PART 12 exchange shape in one call.
 *
 * Positions are forced on. PART 12 §4 lets an implementation gate position
 * TRACKING behind a parse option - recording a span per node is not free - but
 * not serialization: "JSON it is handed carries positions". A serializer that
 * honored `positions: false` would publish a tree an editor or language server
 * cannot navigate, which is the one thing the format exists to prevent.
 *
 * Resolution runs first, because §5 keeps resolution RESULTS (footnote numbers,
 * caption numbers) in the serialized form: recomputing them means reimplementing
 * PART 9R, which is exactly the work a consumer is reading an AST to avoid.
 */
export function carveToAstJson(
  source: string,
  opts: ParseOptions & ProfileOptions = {},
): AstJsonDocument {
  enforceProfileMaxLength(source, opts)
  const exts: CarveExtension[] = opts.extensions ?? []
  let doc = applyTransforms(
    resolve(parse(source, { ...opts, extensions: exts, positions: true }), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    exts,
    opts,
    // The exchange shape is not HTML. A hook that emits HTML must leave the
    // source node alone here, exactly as it does for Markdown/plain/ANSI.
    false,
  )
  doc = runProfile(doc, opts)
  return toAstJsonImpl(doc)
}

/** Convenience: parse + resolve + render Markdown in one call. */
export function carveToMarkdown(
  source: string,
  opts: ParseOptions & MarkdownRenderOptions & ProfileOptions = {},
): string {
  enforceProfileMaxLength(source, opts)
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
    opts,
    false,
  )
  doc = runProfile(doc, opts)
  return renderMarkdown(doc, opts)
}

/**
 * Convenience: parse + render canonical Carve source in one call.
 *
 * Unlike the other `carveToX` helpers, the formatter deliberately does NOT run
 * `resolve()` / extension transforms / profiles. Those are render-time
 * enrichments (auto heading ids, footnote/crossref numbering, default
 * attributes) and baking them back into the source would make the formatter
 * non-conservative - it must format what the author wrote, not the resolved
 * output. The semantic invariant still holds because `carveToHtml` re-applies
 * resolution on the formatted source.
 *
 * The one structural pass it DOES run is `promoteBlockImages`: a reference
 * image with a caption parses as a paragraph `[Image, SoftBreak, "^ …"]`, and
 * without promoting it to a <figure> the serializer would escape the caption's
 * leading `^` to `\^` (only carve-js's lenient parser reads that back as a
 * caption; carve-rs / carve-php lose the figure). Promoting first yields a
 * portable, unescaped `^ …` caption line, matching carve-php and carve-rs. This
 * is representation, not enrichment - it changes no author-visible content.
 */
export function carveToCarve(
  source: string,
  opts: ParseOptions & CarveRenderOptions = {},
): string {
  const doc = parse(source, opts)
  promoteBlockImages(doc.children, true)
  if (doc.footnoteDefs) {
    for (const body of Object.values(doc.footnoteDefs)) promoteBlockImages(body, true)
  }
  return renderCarve(doc, opts)
}

/** Convenience: parse + resolve + render plain text in one call. */
export function carveToPlainText(
  source: string,
  opts: ParseOptions & PlainTextRenderOptions & ProfileOptions = {},
): string {
  enforceProfileMaxLength(source, opts)
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
    opts,
    false,
  )
  doc = runProfile(doc, opts)
  return renderPlainText(doc, opts)
}

/** Convenience: parse + resolve + render ANSI terminal text in one call. */
export function carveToAnsi(
  source: string,
  opts: ParseOptions & AnsiRenderOptions & ProfileOptions = {},
): string {
  enforceProfileMaxLength(source, opts)
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
    opts,
    false,
  )
  doc = runProfile(doc, opts)
  return renderAnsi(doc, opts)
}
