import type { Position } from '../ast.js'

export type RenderTarget = 'html' | 'markdown' | 'plain' | 'ansi' | 'carve'
export type RenderLossCode =
  | 'raw-format-dropped'
  | 'ruby-flattened'
  | 'destination-denied'
  | 'editorial-comment-flattened'
  | 'carrier-attribute-dropped'
  | 'list-style-dropped'
  | 'list-delimiter-changed'
  | 'table-span-flattened'
  | 'table-header-row-demoted'
  | 'table-header-row-hoisted'
  | 'table-header-cell-demoted'
  | 'list-tightness-lost'
  | 'markdown-container-flattened'
  | 'markdown-caption-flattened'
  | 'fence-title-dropped'
  | 'markdown-attributes-dropped'
  | 'raw-html-escaped'

export type ListStyle = 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'

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
  | (RenderLossBase & { code: 'editorial-comment-flattened'; nodeType: 'inline' })
  | (RenderLossBase & { code: 'carrier-attribute-dropped'; attribute: string })
  | (RenderLossBase & { code: 'list-style-dropped'; target: 'markdown'; nodeType: 'block'; style: ListStyle })
  | (RenderLossBase & { code: 'list-delimiter-changed'; target: 'markdown'; nodeType: 'block'; delim: '.' | ')'; emittedDelim: '.' | ')' })
  | (RenderLossBase & { code: 'table-span-flattened'; target: 'markdown' | 'plain' | 'ansi'; nodeType: 'block'; colspan?: number; rowspan?: number })
  | (RenderLossBase & { code: 'table-header-row-demoted'; target: 'markdown'; nodeType: 'block' })
  | (RenderLossBase & { code: 'table-header-row-hoisted'; target: 'markdown'; nodeType: 'block' })
  | (RenderLossBase & { code: 'table-header-cell-demoted'; target: 'markdown'; nodeType: 'block' })
  | (RenderLossBase & { code: 'list-tightness-lost'; target: 'carve'; nodeType: 'block' })
  | (RenderLossBase & { code: 'fence-title-dropped'; target: 'markdown'; nodeType: 'block' })
  | (RenderLossBase & { code: 'markdown-container-flattened' | 'markdown-caption-flattened' | 'markdown-attributes-dropped' | 'raw-html-escaped'; target: 'markdown'; nodeType: 'block' | 'inline' })

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

/** The message is normative (markup-carve/carve#2791) and carries no target. */
export function editorialCommentFlattened(
  opts: RenderLossSinkOptions,
  node: { type: 'critic_comment'; pos?: Position },
  target: 'plain' | 'ansi',
): void {
  opts.onRenderLoss?.({
    code: 'editorial-comment-flattened',
    target,
    nodeType: 'inline',
    message: 'Flattened an editorial comment into the surrounding text',
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

/**
 * The clickable URL sinks PART 9 §25 blanks, and the message each one reports.
 *
 * The text is normative (PART 11 §1d, carve#2686) and is emitted verbatim: no
 * target is appended, because `target` is already a field on the row. Only the
 * destination/image split survives in the message, since `nodeType` is `inline`
 * for every sink and cannot carry the sink kind.
 */
const DENIED_SINK_MESSAGE = {
  link: 'Blanked a denied destination scheme',
  autolink: 'Blanked a denied destination scheme',
  image: 'Blanked a denied image source',
  crossref: 'Blanked a denied destination scheme',
} as const

export type DeniedDestinationSink = keyof typeof DENIED_SINK_MESSAGE

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
    message: DENIED_SINK_MESSAGE[sink],
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

export function markdownLoss(
  opts: RenderLossSinkOptions,
  node: { pos?: Position; type: string },
  code: 'markdown-container-flattened' | 'markdown-caption-flattened' | 'fence-title-dropped' | 'markdown-attributes-dropped' | 'raw-html-escaped',
): void {
  if (code === 'fence-title-dropped') {
    opts.onRenderLoss?.({
      code,
      target: 'markdown',
      nodeType: 'block',
      message: 'Dropped a code fence title without a language in Markdown',
      ...(node.pos ? { pos: node.pos } : {}),
    })
    return
  }
  const messages = {
    'markdown-container-flattened': 'Flattened a container into Markdown blocks',
    'markdown-caption-flattened': 'Wrote a caption as ordinary Markdown text',
    'markdown-attributes-dropped': 'Dropped block attributes while rendering Markdown',
    'raw-html-escaped': 'Escaped raw HTML while rendering Markdown',
  }
  opts.onRenderLoss?.({
    code,
    target: 'markdown',
    nodeType: node.type === 'raw_inline' ? 'inline' : 'block',
    message: messages[code],
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

const LIST_STYLES: Record<'a' | 'A' | 'i' | 'I', ListStyle> = {
  a: 'lower-alpha',
  A: 'upper-alpha',
  i: 'lower-roman',
  I: 'upper-roman',
}

/** Markdown numbers in decimal only, so an alpha or roman list keeps its start and delimiter and loses its style. */
export function listStyleDropped(
  opts: RenderLossSinkOptions,
  node: { olType?: 'a' | 'A' | 'i' | 'I'; pos?: Position },
): void {
  if (node.olType === undefined) return
  const style = LIST_STYLES[node.olType]
  opts.onRenderLoss?.({
    code: 'list-style-dropped',
    target: 'markdown',
    nodeType: 'block',
    style,
    message: `Wrote a ${style} ordered list as decimal while rendering markdown`,
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

export function listDelimiterChanged(
  opts: RenderLossSinkOptions,
  node: { pos?: Position },
  authored: '.' | ')',
  emitted: '.' | ')',
): void {
  if (authored === emitted) return
  opts.onRenderLoss?.({
    code: 'list-delimiter-changed',
    target: 'markdown',
    nodeType: 'block',
    delim: authored,
    emittedDelim: emitted,
    message: `Changed an ordered list delimiter from ${authored} to ${emitted} while rendering markdown`,
    ...(node.pos ? { pos: node.pos } : {}),
  })
}

export function tableSpanFlattened(
  opts: RenderLossSinkOptions,
  cell: { colspan: number; rowspan: number; pos?: Position | undefined },
  target: 'markdown' | 'plain' | 'ansi',
): void {
  if (cell.colspan <= 1 && cell.rowspan <= 1) return
  opts.onRenderLoss?.({
    code: 'table-span-flattened',
    target,
    nodeType: 'block',
    message: 'Flattened a spanning table cell into separate cells',
    ...(cell.colspan > 1 ? { colspan: cell.colspan } : {}),
    ...(cell.rowspan > 1 ? { rowspan: cell.rowspan } : {}),
    ...(cell.pos ? { pos: cell.pos } : {}),
  })
}

export function tableHeaderRowDemoted(opts: RenderLossSinkOptions, row: { pos?: Position }): void {
  opts.onRenderLoss?.({
    code: 'table-header-row-demoted',
    target: 'markdown',
    nodeType: 'block',
    message: 'Wrote a later header row as a body row',
    ...(row.pos ? { pos: row.pos } : {}),
  })
}

export function tableHeaderRowHoisted(opts: RenderLossSinkOptions, row: { pos?: Position }): void {
  opts.onRenderLoss?.({
    code: 'table-header-row-hoisted',
    target: 'markdown',
    nodeType: 'block',
    message: 'Moved a header row above earlier body rows',
    ...(row.pos ? { pos: row.pos } : {}),
  })
}

export function tableHeaderCellDemoted(opts: RenderLossSinkOptions, cell: { pos?: Position }): void {
  opts.onRenderLoss?.({
    code: 'table-header-cell-demoted',
    target: 'markdown',
    nodeType: 'block',
    message: 'Wrote a header cell as a body cell',
    ...(cell.pos ? { pos: cell.pos } : {}),
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
