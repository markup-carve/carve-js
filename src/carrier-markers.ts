import type { BlockNode, Document } from './ast.js'
import { renderCarve } from './render-carve.js'

/**
 * The carrier marker PART 11 §10s defines: an HTML comment holding the Carve
 * opener or closer of a container the Markdown target writes as its children
 * alone.
 *
 * The payload is Carve source, so Carve's own escape is the one the reader
 * already has and only the comment's own terminator is rewritten.
 */
export const CARRIER_PREFIX = '<!-- carve: '
export const CARRIER_SUFFIX = ' -->'

/**
 * A `-->` the payload carries becomes `--\>`; a backslash run already sitting
 * where that escape would put one grows by one, so the transform reverses
 * exactly.
 */
export function escapeCarrierPayload(payload: string): string {
  return payload.replace(/--(\\*)>/g, (_m, slashes: string) => `--${slashes}\\>`)
}

export function unescapeCarrierPayload(payload: string): string {
  return payload.replace(/--(\\*)\\>/g, (_m, slashes: string) => `--${slashes}>`)
}

/** Write a payload into a marker line. */
export function carrierLine(payload: string): string {
  return `${CARRIER_PREFIX}${escapeCarrierPayload(payload)}${CARRIER_SUFFIX}`
}

/** The payload a marker line carries, or undefined when the line is not one. */
export function carrierPayload(line: string): string | undefined {
  if (!line.startsWith(CARRIER_PREFIX) || !line.endsWith(CARRIER_SUFFIX)) return undefined
  const inner = line.slice(CARRIER_PREFIX.length, line.length - CARRIER_SUFFIX.length)
  // An unescaped `-->` inside would have ended the comment at that point, so
  // the line this engine is reading is not one this engine wrote.
  return inner.includes('-->') ? undefined : unescapeCarrierPayload(inner)
}

/**
 * The colon-fence width a payload opens or closes with, or 0 when the payload
 * is neither (an attribute line travelling with its opener).
 */
export function carrierFenceWidth(payload: string): number {
  return /^(:{3,})/.exec(payload)?.[1]?.length ?? 0
}

/** Whether a colon-fence payload is a bare closer. */
export function carrierIsCloser(payload: string): boolean {
  return /^:{3,}$/.test(payload)
}

/**
 * The Carve lines a container's carrier markers carry, or undefined when the
 * node has no colon-fence spelling.
 *
 * The payload is spelled by the CANONICAL WRITER rather than composed a second
 * time here: it is Carve source, and a second spelling would drift from the one
 * `carve fmt` writes. The body is dropped before the render, so a nested
 * container costs one fence line instead of a second render of its subtree, and
 * the fence runs are then widened to the depth the Markdown writer is at -
 * which is what `colonFenceFor` would have produced for the same node.
 */
export function spellCarrierMarkers(
  node: BlockNode,
  depth: number,
): { prelude: string[]; opener: string; closer: string } | undefined {
  const bodyless = { ...node, children: [] } as BlockNode
  const document: Document = { type: 'document', children: [bodyless] }
  let lines: string[]
  try {
    lines = renderCarve(document).split('\n')
  } catch {
    return undefined
  }
  let open: number | undefined
  let close: number | undefined
  for (const [at, line] of lines.entries()) {
    if (!/^:{3,}/.test(line)) continue
    open ??= at
    if (/^:{3,}$/.test(line)) close = at
  }
  if (open === undefined || close === undefined || close === open) return undefined
  const widen = (line: string): string => line.replace(/^:{3,}/, ':'.repeat(3 + depth))

  return {
    prelude: lines.slice(0, open),
    opener: widen(lines[open]!),
    closer: widen(lines[close]!),
  }
}
