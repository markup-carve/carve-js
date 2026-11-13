// The public interface of the 0.2 engine: `parse` gives the tree of contract 2.0, `render` gives HTML.
import { type AstNode } from './ast.ts'
import { buildDocument } from './ast-blocks.ts'
import { validateTree } from './ast-validate.ts'
import { renderDocument } from './html.ts'
import { scanBlocks } from './blocks.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { CarveOptionError, type ParseOptions, readOptions, type RenderOptions, type Settings } from './options.ts'
import { type Diagnostic, resolve, type Resolution } from './resolve.ts'
import { acquireState, releaseState } from './state.ts'
import { buildTree, readInlines } from './tree.ts'

export interface ParseResult {
  document: AstNode
  /** C2-A-172: the diagnostics record, beside the tree. */
  diagnostics: Diagnostic[]
}

export interface RenderOutput {
  html: string
  diagnostics: Diagnostic[]
}

/** C2-H-130: a render under `strictLosses` that lost something returns no output. */
export class CarveRenderError extends Error {
  diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    super(`the render lost content: ${diagnostics.map((entry) => entry.code).join(', ')}`)
    this.name = 'CarveRenderError'
    this.diagnostics = diagnostics
  }
}

interface Parsed {
  document: AstNode
  resolution: Resolution
}

function parseSource(src: string, settings: Settings, positions: boolean): Parsed {
  const blocks = acquireState()
  const inlines = acquireInlineState()
  try {
    scanBlocks(blocks, src)
    const root = buildTree(blocks.events, blocks.eventLength)
    readInlines(inlines, src, root, 0)
    const built = buildDocument(src, root, positions)
    return { document: built.document, resolution: resolve(built.document, settings.headingIds, built.headingSources) }
  } finally {
    releaseInlineState(inlines)
    releaseState(blocks)
  }
}

/** The resolved tree of `src` with its diagnostics. Positions are on unless `positions` is false (C2-A-138). */
export function parseWithDiagnostics(src: string, options?: ParseOptions): ParseResult {
  const settings = readOptions(options, 'parse')
  const parsed = parseSource(src, settings, options?.positions !== false)
  return { document: parsed.document, diagnostics: parsed.resolution.diagnostics }
}

/** The resolved tree of `src` (spec/0.2/ast.md). */
export function parse(src: string, options?: ParseOptions): AstNode {
  return parseWithDiagnostics(src, options).document
}

function renderSettings(options: RenderOptions | undefined): Settings {
  const settings = readOptions(options, 'render')
  // C2-H-122, C2-H-129: the static mode and the restricted profiles are not built yet, so they are refused (C2-H-137).
  if (settings.mode !== 'interactive') throw new CarveOptionError('mode', 'only interactive is offered by this engine')
  if (settings.profile !== 'full') throw new CarveOptionError('profile', 'only full is offered by this engine')
  return settings
}

/**
 * The HTML of Carve source or of a tree (spec/0.2/html.md), with the diagnostics of the run. A
 * supplied tree is validated and resolved in place before it is written.
 */
export function renderWithDiagnostics(input: string | AstNode, options?: RenderOptions): RenderOutput {
  const settings = renderSettings(options)
  let parsed: Parsed
  if (typeof input === 'string') {
    // C2-H-016: only the source lines need positions.
    parsed = parseSource(input, settings, settings.sourceLines)
  } else {
    validateTree(input)
    parsed = { document: input, resolution: resolve(input, settings.headingIds, null) }
  }
  const result = renderDocument(parsed.document, settings, parsed.resolution)
  const diagnostics = [...parsed.resolution.diagnostics, ...result.losses]
  if (settings.strictLosses && result.losses.length > 0) return { html: '', diagnostics }
  return { html: result.html, diagnostics }
}

/** The HTML fragment of Carve source or of a tree. Under `strictLosses` a render loss throws. */
export function render(input: string | AstNode, options?: RenderOptions): string {
  const output = renderWithDiagnostics(input, options)
  const losses = output.diagnostics.filter((entry) => entry.channel === 'render-loss')
  if (options?.strictLosses === true && losses.length > 0) throw new CarveRenderError(losses)
  return output.html
}
