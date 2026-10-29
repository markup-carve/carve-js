/*
 * The decision trace (carve docs/decision-trace.md, format version 1): one
 * JSON record per ownership decision, read from the same walk `parse` runs.
 */
import { replaceLoneSurrogates } from '../well-formed.js'
import { ownLines, type TraceRecord } from './block/block-ownership.js'
import { Lexer } from './parse-lexer.js'

export type { TraceRecord }

export const TRACE_FORMAT = 'carve-decision-trace'
export const TRACE_VERSION = 1

/** The block records for `source`, after the input normalization `parse` applies. */
export function decisionTrace(source: string): TraceRecord[] {
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  const lexer = new Lexer(replaceLoneSurrogates(source))
  lexer.consumeFrontmatter()
  const trace: TraceRecord[] = []
  ownLines(lexer.lines as string[], lexer.pos, trace)
  return trace
}

/** The trace as JSON lines: the header, then one record per line. */
export function decisionTraceJsonLines(source: string, engine = 'carve-js'): string {
  const header = { trace: TRACE_FORMAT, version: TRACE_VERSION, engine }
  return [header, ...decisionTrace(source)].map((record) => JSON.stringify(record)).join('\n') + '\n'
}
