import { render } from './api.ts'
import type { RenderOptions } from './options.ts'

export type StreamOutcome = 'complete' | 'needs-ast'

/** Render fully before publishing output to the sink. */
export function tryRenderHtmlStreaming(
  source: string,
  options: RenderOptions,
  sink: (chunk: string) => void,
): StreamOutcome {
  const html = render(source, options)
  sink(html)
  return 'complete'
}
