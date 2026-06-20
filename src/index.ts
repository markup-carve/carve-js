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
import type { CarveExtension } from './extension.js'
import { parse as parseImpl, type ParseOptions } from './parse.js'
import {
  resolveHeadingIds,
  headingIdSlugOpts,
  type AsciiHeadingIdMode,
} from './heading-ids.js'
import { Profile } from './profile.js'
import { applyProfile as applyProfileImpl } from './profile-filter.js'
import { renderHtml as renderHtmlImpl, type RenderOptions } from './render-html.js'
import {
  renderMarkdown as renderMarkdownImpl,
  type MarkdownRenderOptions,
} from './render-markdown.js'
import {
  renderPlainText as renderPlainTextImpl,
  type PlainTextRenderOptions,
} from './render-plain.js'
import { renderAnsi as renderAnsiImpl, type AnsiRenderOptions } from './render-ansi.js'

export * from './ast.js'
export type { ParseOptions } from './parse.js'
export type { RenderOptions } from './render-html.js'
export type { MarkdownRenderOptions } from './render-markdown.js'
export type { PlainTextRenderOptions } from './render-plain.js'
export type { AnsiRenderOptions } from './render-ansi.js'
export type {
  CarveExtension,
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
  type MigrationFixResult,
} from './djot-migrate.js'
export { markdownToCarve } from './markdown-migrate.js'
export {
  lintCarve,
  formatLintWarnings,
  type LintWarning,
} from './lint.js'
export { tabNormalize } from './tab-normalize.js'
export { details } from './details.js'
export { citations, type CitationsOptions } from './citations.js'
export { mermaid, type MermaidOptions } from './mermaid.js'
export { mathBlock, type MathBlockOptions } from './math-block.js'
export { wikilinks, type WikilinksOptions } from './wikilinks.js'
export { autolink, type AutolinkOptions } from './autolink.js'
export { externalLinks, type ExternalLinksOptions } from './external-links.js'
export { tableOfContents, type TableOfContentsOptions } from './table-of-contents.js'
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
 * Apply a profile to a resolved document in the shared pipeline position
 * (after resolve, before render). Enforces maxLength on the source bytes
 * first (matching carve-php, which checks the input length pre-parse and
 * throws). Mutates and returns `doc`.
 */
function runProfile(doc: Document, source: string, opts: ProfileOptions): Document {
  const profile = opts.profile
  if (!profile) return doc
  const maxLength = profile.getMaxLength()
  if (maxLength > 0 && byteLength(source) > maxLength) {
    throw new RangeError(
      `Input exceeds the profile's maximum length of ${maxLength} bytes ` +
        `(got ${byteLength(source)} bytes).`,
    )
  }
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
  return parseImpl(source, opts)
}

/** Render a Carve AST to HTML matching the spec corpus. */
export function renderHtml(ast: Document, opts: RenderOptions = {}): string {
  return renderHtmlImpl(ast, opts)
}

/** Render a resolved Carve AST to Markdown. */
export function renderMarkdown(ast: Document, opts: MarkdownRenderOptions = {}): string {
  return renderMarkdownImpl(ast, opts)
}

/** Render a resolved Carve AST to plain text. */
export function renderPlainText(ast: Document, opts: PlainTextRenderOptions = {}): string {
  return renderPlainTextImpl(ast, opts)
}

/** Render a resolved Carve AST to ANSI terminal text. */
export function renderAnsi(ast: Document, opts: AnsiRenderOptions = {}): string {
  return renderAnsiImpl(ast, opts)
}

/**
 * Post-parse semantic resolution: heading ids, `</#id>` crossrefs,
 * implicit heading references (`[Foo][]` -> `#foo`), and finalization
 * of any reference-link placeholder the parse phase left unresolved
 * (no explicit `[label]: url` def and no matching heading) to its
 * literal source text.
 */
export function resolve(
  doc: Document,
  opts: { asciiHeadingIds?: AsciiHeadingIdMode; lowercaseHeadingIds?: boolean } = {},
): Document {
  return resolveHeadingIds(doc, headingIdSlugOpts(opts))
}

/** Convenience: parse + resolve + render in one call. */
export function carveToHtml(
  source: string,
  opts: ParseOptions & RenderOptions & ProfileOptions = {},
): string {
  const exts: CarveExtension[] = opts.extensions ?? []
  // `sourceLine` rendering needs block positions, so enable parsing them.
  // Extensions are forwarded to the parse so their matchers add syntax.
  const parseOpts: ParseOptions = {
    ...opts,
    extensions: exts,
    ...(opts.sourceLine ? { positions: true } : {}),
  }
  let doc = applyTransforms(
    resolve(parse(source, parseOpts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    exts,
  )
  doc = runProfile(doc, source, opts)
  return renderHtml(doc, opts)
}

/**
 * Run the renderer-agnostic extension transforms (`afterParse`,
 * `beforeRender`) over a resolved document. Renderer-specific output (block
 * renderers, inline renderers) is consulted by the HTML renderer only, but the
 * transform hooks mutate the AST itself, so they apply to every renderer -
 * matching carve-php, where a `beforeRender` extension (heading level shift,
 * default attributes, …) affects Markdown/PlainText/ANSI output too.
 */
function applyTransforms(doc: Document, exts: CarveExtension[] | undefined): Document {
  if (!exts) return doc
  let out = doc
  for (const ext of exts) if (ext.afterParse) out = ext.afterParse(out)
  for (const ext of exts) if (ext.beforeRender) out = ext.beforeRender(out)
  return out
}

/** Convenience: parse + resolve + render Markdown in one call. */
export function carveToMarkdown(
  source: string,
  opts: ParseOptions & MarkdownRenderOptions & ProfileOptions = {},
): string {
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
  )
  doc = runProfile(doc, source, opts)
  return renderMarkdown(doc, opts)
}

/** Convenience: parse + resolve + render plain text in one call. */
export function carveToPlainText(
  source: string,
  opts: ParseOptions & PlainTextRenderOptions & ProfileOptions = {},
): string {
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
  )
  doc = runProfile(doc, source, opts)
  return renderPlainText(doc, opts)
}

/** Convenience: parse + resolve + render ANSI terminal text in one call. */
export function carveToAnsi(
  source: string,
  opts: ParseOptions & AnsiRenderOptions & ProfileOptions = {},
): string {
  let doc = applyTransforms(
    resolve(parse(source, opts), {
      asciiHeadingIds: opts.asciiHeadingIds ?? false,
      lowercaseHeadingIds: opts.lowercaseHeadingIds ?? false,
    }),
    opts.extensions,
  )
  doc = runProfile(doc, source, opts)
  return renderAnsi(doc, opts)
}
