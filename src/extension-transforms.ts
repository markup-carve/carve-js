import type { Document } from './ast.js'
import type { BeforeRenderContext, CarveExtension } from './extension.js'
import type { RenderOptions } from './render-html.js'

/**
 * Run the renderer-agnostic extension transforms (`afterParse`,
 * `beforeRender`) over a resolved document. Renderer-specific output (block
 * renderers, inline renderers) is consulted by the HTML renderer only, but the
 * transform hooks mutate the AST itself, so they apply to every renderer -
 * matching carve-php, where a `beforeRender` extension (heading level shift,
 * default attributes, …) affects Markdown/PlainText/ANSI output too.
 */
export function applyTransforms(
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
