import { tryFastHtml } from './fast-html.js'
import type { RenderOptions } from './render-html.js'

export type StreamOutcome = 'complete' | 'needs-ast'

/**
 * Try the borrowed HTML path without silently falling back.
 * The sink is called only after the complete source has been accepted.
 */
export function tryRenderHtmlStreaming(
  source: string,
  options: RenderOptions,
  sink: (chunk: string) => void,
): StreamOutcome {
  const html = tryFastHtml(source, options)
  if (html === undefined) return 'needs-ast'
  sink(html)
  return 'complete'
}
