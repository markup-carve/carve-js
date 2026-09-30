import type { Position } from './ast.js'

export type RenderTarget = 'html' | 'markdown' | 'plain' | 'ansi' | 'carve'
export type RenderLossCode = 'raw-format-dropped' | 'ruby-flattened' | 'destination-denied'

interface RenderLossBase {
  target: RenderTarget
  nodeType: 'inline' | 'block'
  message: string
  pos?: Position
}

export type RenderLoss =
  | (RenderLossBase & { code: 'raw-format-dropped'; format: string })
  | (RenderLossBase & { code: 'ruby-flattened'; nodeType: 'inline' })
  | (RenderLossBase & { code: 'destination-denied'; nodeType: 'inline' })

export interface RenderResult<T = string> {
  value: T
  losses: RenderLoss[]
  totalLosses: number
  truncated: boolean
  /** Complete counts used when a caller permits one loss code before truncation. */
  lossCounts?: Partial<Record<RenderLossCode, number>>
}

export interface CheckedRenderOptions {
  strictLosses?: boolean
  maxRenderLosses?: number
}

/** Internal renderer hook used by the checked entry points. */
export interface RenderLossSinkOptions {
  onRenderLoss?: (loss: RenderLoss) => void
}

export class RenderLossError extends Error {
  readonly losses: RenderLoss[]
  readonly totalLosses: number
  readonly truncated: boolean

  constructor(result: Pick<RenderResult, 'losses' | 'totalLosses' | 'truncated'>) {
    super(`render would incur ${result.totalLosses} structural loss${result.totalLosses === 1 ? '' : 'es'}`)
    this.name = 'RenderLossError'
    this.losses = result.losses
    this.totalLosses = result.totalLosses
    this.truncated = result.truncated
  }
}

export function rubyFlattened(
  opts: RenderLossSinkOptions,
  node: { type: 'ruby'; pos?: Position },
  target: RenderTarget,
): void {
  opts.onRenderLoss?.({
    code: 'ruby-flattened',
    target,
    nodeType: 'inline',
    message: `Flattened ruby annotations while rendering ${target}`,
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

/** The clickable URL sinks PART 9 §25 blanks, and the noun each one's message uses. */
const DENIED_SINK_NOUN = {
  link: 'link destination',
  autolink: 'autolink destination',
  image: 'image source',
  crossref: 'crossref destination',
} as const

export type DeniedDestinationSink = keyof typeof DENIED_SINK_NOUN

/**
 * Report a destination the URL sink policy blanked (PART 9 §25, CARVE-P2-024).
 *
 * `emitted` empty against a non-empty `authored` is the whole observable: the
 * policy replaces the entire value, so there is nothing else to compare. A
 * target that emits no destination for a sink never calls this, which is what
 * keeps the report to what the renderer ACTUALLY blanked.
 */
export function destinationDenied(
  opts: RenderLossSinkOptions,
  sink: DeniedDestinationSink,
  target: RenderTarget,
  authored: string,
  emitted: string,
  pos?: Position,
): void {
  if (emitted !== '' || authored === '') return
  opts.onRenderLoss?.({
    code: 'destination-denied',
    target,
    nodeType: 'inline',
    message: `Blanked a denied ${DENIED_SINK_NOUN[sink]} while rendering ${target}`,
    ...(pos ? { pos } : {}),
  })
}

export function rawFormatDropped(
  opts: RenderLossSinkOptions,
  node: { type: 'raw_block' | 'raw_inline'; format: string; pos?: Position },
  target: RenderTarget,
): void {
  opts.onRenderLoss?.({
    code: 'raw-format-dropped',
    format: node.format,
    target,
    nodeType: node.type === 'raw_block' ? 'block' : 'inline',
    message: `Dropped ${node.type === 'raw_block' ? 'block' : 'inline'} raw format "${node.format}" while rendering ${target}`,
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

export function checkedRender(
  render: (sink: (loss: RenderLoss) => void) => string,
  opts: CheckedRenderOptions,
): RenderResult {
  const maximum = opts.maxRenderLosses ?? 100
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new RangeError('maxRenderLosses must be a non-negative safe integer')
  }
  const losses: RenderLoss[] = []
  const lossCounts: Partial<Record<RenderLossCode, number>> = {}
  let totalLosses = 0
  const value = render((loss) => {
    totalLosses++
    lossCounts[loss.code] = (lossCounts[loss.code] ?? 0) + 1
    if (losses.length < maximum) losses.push(loss)
  })
  const result: RenderResult = {
    value,
    losses,
    totalLosses,
    truncated: totalLosses > losses.length,
  }
  Object.defineProperty(result, 'lossCounts', { value: lossCounts, enumerable: false })
  if (opts.strictLosses && totalLosses > 0) throw new RenderLossError(result)
  return result
}
