// Characters 0.1 took out of its output and the 0.2 specification has no clause for. The tool
// keeps what 0.1 rendered by taking them out of the source.
import { change, type Context } from '../context.ts'

const NUL = 0x00
const REPLACEMENT = '\ufffd'

/** The bidirectional embedding, override and isolate controls: U+202A to U+202E and U+2066 to U+2069. */
function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

/**
 * The nodes whose source is written as text or code. A destination or an attribute value is left
 * alone: there the character changes what the value tests as (C2-H-159), and 0.1 kept it.
 */
const TEXTUAL = new Set(['text', 'code', 'code_block', 'math'])

function scan(ctx: Context, start: number, end: number): void {
  for (let at = start; at < end; at++) {
    const code = ctx.src.charCodeAt(at)
    if (code === NUL) {
      change(ctx, 'X-002', at, at + 1, REPLACEMENT, 'U+0000 written as U+FFFD, which is what 0.1 rendered')
    } else if (code >= 0x202a && isBidiControl(code)) {
      change(ctx, 'X-001', at, at + 1, '', 'bidirectional control removed, 0.1 did not write it to its output')
    }
  }
}

export function controls(ctx: Context): void {
  for (const visit of ctx.visits) {
    const pos = visit.node.pos
    if (pos !== undefined && TEXTUAL.has(visit.node.type)) scan(ctx, pos.startOffset, pos.endOffset)
  }
}
