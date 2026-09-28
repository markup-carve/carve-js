import { tryFastHtmlStreaming } from './fast-html.js'
import type { RenderOptions } from './render-html.js'

export type StreamOutcome = 'complete' | 'needs-ast'

/**
 * Try the borrowed HTML path without silently falling back.
 * The sink is called only after the complete source has been accepted.
 * Validation discards output; a second pass emits chunks of at most 4096 characters.
 */
export function tryRenderHtmlStreaming(
  source: string,
  options: RenderOptions,
  sink: (chunk: string) => void,
): StreamOutcome {
  return tryFastHtmlStreaming(source, options, sink) ? 'complete' : 'needs-ast'
}
