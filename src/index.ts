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
import { resolveHeadingIds } from './heading-ids.js'
import { renderHtml as renderHtmlImpl, type RenderOptions } from './render-html.js'

export * from './ast.js'
export type { ParseOptions } from './parse.js'
export type { RenderOptions } from './render-html.js'
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
export { wikilinks, type WikilinksOptions } from './wikilinks.js'

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

/**
 * Post-parse semantic resolution: heading ids, `</#id>` crossrefs,
 * implicit heading references (`[Foo][]` -> `#foo`), and finalization
 * of any reference-link placeholder the parse phase left unresolved
 * (no explicit `[label]: url` def and no matching heading) to its
 * literal source text.
 */
export function resolve(doc: Document, opts: { asciiHeadingIds?: boolean } = {}): Document {
  return resolveHeadingIds(doc, opts.asciiHeadingIds ?? false)
}

/** Convenience: parse + resolve + render in one call. */
export function carveToHtml(
  source: string,
  opts: ParseOptions & RenderOptions = {},
): string {
  const exts: CarveExtension[] = opts.extensions ?? []
  // `sourceLine` rendering needs block positions, so enable parsing them.
  // Extensions are forwarded to the parse so their matchers add syntax.
  const parseOpts: ParseOptions = {
    ...opts,
    extensions: exts,
    ...(opts.sourceLine ? { positions: true } : {}),
  }
  let doc = resolve(parse(source, parseOpts), { asciiHeadingIds: opts.asciiHeadingIds ?? false })
  for (const ext of exts) if (ext.afterParse) doc = ext.afterParse(doc)
  for (const ext of exts) if (ext.beforeRender) doc = ext.beforeRender(doc)
  return renderHtml(doc, opts)
}
