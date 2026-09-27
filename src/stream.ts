import { tryFastHtml } from './fast-html.js'
import type { RenderOptions } from './render-html.js'

export type StreamOutcome = 'complete' | 'needs-ast'

/**
 * Try the borrowed HTML path without silently falling back.
 * The sink is called only after the complete source has been accepted.
 * HTML is buffered before delivery in newline-terminated chunks.
 */
export function tryRenderHtmlStreaming(
  source: string,
  options: RenderOptions,
  sink: (chunk: string) => void,
): StreamOutcome {
  const html = tryFastHtml(source, options)
  if (html === undefined) return 'needs-ast'
  let start = 0
  while (start < html.length) {
    const newline = html.indexOf('\n', start)
    const end = newline < 0 ? html.length : newline + 1
    sink(html.slice(start, end))
    start = end
  }
  if (html.length === 0) sink('')
  return 'complete'
}
