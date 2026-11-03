/*
 * The decision trace (carve docs/decision-trace.md, format version 1): one
 * JSON record per ownership decision, read from the same walk `parse` runs.
 */
import { replaceLoneSurrogates } from '../well-formed.js'
import { ownLines, type TraceRecord } from './block/block-ownership.js'
import { Lexer } from './parse-lexer.js'
import { transparentLineStream } from './block/transparent-lines.js'

export type { TraceRecord }

export const TRACE_FORMAT = 'carve-decision-trace'
export const TRACE_VERSION = 1

/** The block records for `source`, after the input normalization `parse` applies. */
export function decisionTrace(source: string): TraceRecord[] {
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1)
  if (source.includes('\0')) source = source.replace(/\0/g, '�')
  source = replaceLoneSurrogates(source)
  const stream = transparentLineStream(source)
  const lexer = new Lexer(stream?.lines ?? source)
  if (!stream || stream.sourceLines[0] === 0) lexer.consumeFrontmatter()
  const trace: TraceRecord[] = []
  ownLines(lexer.lines as string[], lexer.pos, trace)
  if (stream) {
    const sourceLine = (line: number): number => (stream.sourceLines[line - 1] ?? line - 1) + 1
    const path = (value: string): string => value.replace(/:(\d+)/g, (_whole, line: string) => `:${sourceLine(Number(line))}`)
    const erased = new Set(stream.erased)
    for (const record of trace) {
      record.line = sourceLine(record.line)
      record.owner = path(record.owner)
      if (record.reached) record.reached = path(record.reached)
      if (record.plus) record.plus = sourceLine(record.plus)
      if (erased.has(record.line - 1)) {
        record.step = 'S1'
        record.rule = 'CARVE-P0-005'
        record.form = /^%%/.test(stream.original[record.line - 1]!.replace(/^(?:[ \t]*>[ ]?)*[ \t]*/, '')) ? 'comment' : 'leaf'
      }
    }
    const retained = new Set(trace.map((record) => record.line))
    for (const index of stream.erased) {
      if (retained.has(index + 1)) continue
      const authored = stream.authoredTrace.find((record) => record.line === index + 1)
      trace.push({ line: index + 1, step: 'S1', owner: authored?.owner ?? 'doc',
        rule: 'CARVE-P0-005', form: /^%%/.test(stream.original[index]!.replace(/^(?:[ \t]*>[ ]?)*[ \t]*/, '')) ? 'comment' : 'leaf' })
    }
    trace.sort((a, b) => a.line - b.line)
  }
  return trace
}

/** The trace as JSON lines: the header, then one record per line. */
export function decisionTraceJsonLines(source: string, engine = 'carve-js'): string {
  const header = { trace: TRACE_FORMAT, version: TRACE_VERSION, engine }
  return [header, ...decisionTrace(source)].map((record) => JSON.stringify(record)).join('\n') + '\n'
}
