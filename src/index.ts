/*
 * Public API for @markup-carve/carve.
 *
 * Implementation status:
 *   ✓ Headings (M1, step 1)
 *   - Paragraphs, lists, blockquotes, fences, tables, frontmatter, hr,
 *     admonitions, captions — to come in M1
 *   - All inline constructs — to come in M2
 */

import type { Document } from './ast.js'
import { parse as parseImpl, type ParseOptions } from './parse.js'
import { renderHtml as renderHtmlImpl, type RenderOptions } from './render-html.js'

export * from './ast.js'
export type { ParseOptions } from './parse.js'
export type { RenderOptions } from './render-html.js'

/** Parse Carve source into a typed AST. */
export function parse(source: string, opts: ParseOptions = {}): Document {
  return parseImpl(source, opts)
}

/** Render a Carve AST to HTML matching the spec corpus. */
export function renderHtml(ast: Document, opts: RenderOptions = {}): string {
  return renderHtmlImpl(ast, opts)
}

/** Convenience: parse + render in one call. */
export function carveToHtml(
  source: string,
  opts: ParseOptions & RenderOptions = {},
): string {
  return renderHtml(parse(source, opts), opts)
}
