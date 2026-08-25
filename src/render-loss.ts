import type { Position } from './ast.js'

export type RenderTarget = 'html' | 'markdown' | 'plain' | 'ansi' | 'carve'
export type RenderLossCode = 'raw-format-dropped'

export interface RenderLoss {
  code: RenderLossCode
  format: string
  target: RenderTarget
  nodeType: 'inline' | 'block'
  message: string
  pos?: Position
}

export interface RenderResult<T = string> {
  value: T
  losses: RenderLoss[]
  totalLosses: number
  truncated: boolean
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
    super(`render would drop ${result.totalLosses} raw format node${result.totalLosses === 1 ? '' : 's'}`)
    this.name = 'RenderLossError'
    this.losses = result.losses
    this.totalLosses = result.totalLosses
    this.truncated = result.truncated
  }
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
  let totalLosses = 0
  const value = render((loss) => {
    totalLosses++
    if (losses.length < maximum) losses.push(loss)
  })
  const result: RenderResult = {
    value,
    losses,
    totalLosses,
    truncated: totalLosses > losses.length,
  }
  if (opts.strictLosses && totalLosses > 0) throw new RenderLossError(result)
  return result
}
