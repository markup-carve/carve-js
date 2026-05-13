/*
 * Public API for @markup-carve/carve.
 *
 * Today: stubs that throw. M1 (block parser), M2 (inline parser), and
 * M3 (HTML renderer) will fill them in. The corpus test runner in
 * test/corpus.test.ts already iterates spec/tests/corpus/*.crv and
 * will go green as constructs are implemented.
 */

import type { Document } from './ast.js'

export * from './ast.js'

export interface ParseOptions {
  /** Source-position tracking on every node (off by default for speed) */
  positions?: boolean
}

export interface RenderOptions {
  /**
   * Template for @mention href; `{user}` is replaced with the captured
   * username. Default: undefined = render as plain span, no link.
   */
  mentionUrl?: string
  /**
   * Template for #tag href; `{name}` is replaced with the captured tag.
   * Default: undefined = render as plain span, no link.
   */
  tagUrl?: string
}

/**
 * Parse Carve source into an AST. Not yet implemented.
 */
export function parse(_source: string, _opts: ParseOptions = {}): Document {
  throw new Error('carve-js parser is not yet implemented (M1/M2 in progress)')
}

/**
 * Render a Carve AST to HTML. Not yet implemented.
 */
export function renderHtml(_ast: Document, _opts: RenderOptions = {}): string {
  throw new Error('carve-js HTML renderer is not yet implemented (M3 in progress)')
}

/**
 * Convenience: parse + render in one call.
 */
export function carveToHtml(source: string, opts: ParseOptions & RenderOptions = {}): string {
  return renderHtml(parse(source, opts), opts)
}
