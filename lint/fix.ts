// The fix pass of `carve lint --fix`, `carve fix` and the `fix` call: each lint finding whose catalog message documents
// one replacement is rewritten to that replacement. Engine behavior, outside the specification (C2-T-003).
import { type Node } from '../src/ast.ts'
import { type Diagnostic } from '../src/diagnostics.ts'
import { parse } from '../src/index.ts'
import { lint } from './lint.ts'
import { type RuleId } from './catalog.ts'
import { type LintOptions } from './types.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const replacements = new Map<string, Uint8Array>()

function replacement(text: string): Uint8Array {
  let bytes = replacements.get(text)
  if (bytes === undefined) {
    bytes = encoder.encode(text)
    replacements.set(text, bytes)
  }
  return bytes
}

interface Edit {
  start: number
  end: number
  text: string
}

/** What a fix of one finding changes, and the node it must leave where the finding started. */
interface Plan {
  edits: Edit[]
  /** The offset, in the source before the fix, that the node must cover after it. */
  at: number
  node: Node['type']
  /** The node starts at `at`, rather than only covering it. */
  starts: boolean
}

type Fixer = (bytes: Uint8Array, start: number, end: number) => Plan | null

function pair(open: string, close: string, replaceOpen: string, replaceClose: string, node: Node['type']): Fixer {
  return (bytes, start, end) => {
    const text = decoder.decode(bytes.subarray(start, end))
    if (end - start < open.length + close.length + 1 || !text.startsWith(open) || !text.endsWith(close)) return null
    return { edits: [{ start, end: start + open.length, text: replaceOpen }, { start: end - close.length, end, text: replaceClose }],
      at: start, node, starts: true }
  }
}

function isBlank(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09
}

/** The run with the spaces and tabs before it and after it on its line. */
const closingHashes: Fixer = (bytes, start, end) => {
  let from = start
  while (isBlank(bytes[from - 1])) from--
  let to = end
  while (isBlank(bytes[to])) to++
  if (from === start) return null
  return { edits: [{ start: from, end: to, text: '' }], at: from, node: 'heading', starts: false }
}

const plusBullet: Fixer = (bytes, start) => (bytes[start] === 0x2b
  ? { edits: [{ start, end: start + 1, text: '-' }], at: start, node: 'list_item', starts: true }
  : null)

const thematicBreak: Fixer = (_bytes, start, end) => ({ edits: [{ start, end, text: '***' }], at: start, node: 'thematic_break', starts: true })

/** Each rule whose message names one replacement, and how a finding of it is rewritten. */
export const FIXES: ReadonlyMap<RuleId, Fixer> = new Map<RuleId, Fixer>([
  ['markdown-strong-double-star', pair('**', '**', '*', '*', 'strong')],
  ['markdown-strikethrough-double-tilde', pair('~~', '~~', '{~', '~}', 'strike')],
  ['djot-emphasis-underscore', pair('_', '_', '/', '/', 'emphasis')],
  ['djot-intraword-underscore', pair('_', '_', '{/', '/}', 'emphasis')],
  ['djot-subscript-tilde', pair('~', '~', '{,', ',}', 'subscript')],
  ['djot-superscript-caret', pair('^', '^', '{^', '^}', 'superscript')],
  ['deprecated-bare-strike', pair('~', '~', '{~', '~}', 'strike')],
  ['deprecated-bare-highlight', pair('=', '=', '{=', '=}', 'highlight')],
  ['djot-plus-bullet', plusBullet],
  ['heading-closing-hashes', closingHashes],
  ['thematic-break-spelling', thematicBreak],
])

export interface FixResult {
  output: string
  /** The fixes applied, by rule. */
  applied: Map<string, number>
}

interface Candidate {
  rule: string
  plan: Plan
  line: number
  column: number
  key: string
}

function lineStarts(bytes: Uint8Array): number[] {
  const starts = [0]
  for (let at = 0; at < bytes.length; at++) if (bytes[at] === 0x0a) starts.push(at + 1)
  return starts
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (starts[middle]! <= offset) low = middle
    else high = middle
  }
  return low + 1
}

function sameEdits(left: Plan, right: Plan): boolean {
  return left.edits.length === right.edits.length &&
    left.edits.every((edit, index) => edit.start === right.edits[index]?.start && edit.end === right.edits[index]?.end &&
      edit.text === right.edits[index]?.text)
}

/** Two rules that report one range with different replacements leave it to the author. */
function candidates(bytes: Uint8Array, entries: readonly Diagnostic[]): Candidate[] {
  const byRange = new Map<string, Candidate[]>()
  const starts = lineStarts(bytes)
  const ordinals = new Map<string, number>()
  for (const entry of entries) {
    const fixer = FIXES.get(entry.code as RuleId)
    if (fixer === undefined || entry.channel !== 'lint' || entry.file !== undefined || entry.range === undefined) continue
    const plan = fixer(bytes, entry.range.startOffset, entry.range.endOffset)
    if (plan === null) continue
    const key = `${entry.range.startOffset}:${entry.range.endOffset}`
    const line = lineAt(starts, entry.range.startOffset)
    const group = `${entry.code}:${line}`
    const ordinal = ordinals.get(group) ?? 0
    ordinals.set(group, ordinal + 1)
    byRange.set(key, [...(byRange.get(key) ?? []), {
      rule: entry.code, plan, line, column: entry.range.startOffset - starts[line - 1]!, key: `${group}:${ordinal}`,
    }])
  }
  const result: Candidate[] = []
  for (const group of byRange.values()) {
    if (group.every((candidate) => sameEdits(candidate.plan, group[0]!.plan))) result.push(group[0]!)
  }
  return result
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (sorted[middle]! < value) low = middle + 1
    else high = middle
  }
  return low
}

function select(found: readonly Candidate[]): Candidate[] {
  const starts = [...new Set(found.flatMap((candidate) => candidate.plan.edits.map((edit) => edit.start)))].sort((a, b) => a - b)
  const greatestEnd = new Array<number>(starts.length + 1).fill(0)
  const prefixEnd = (before: number): number => {
    let at = lowerBound(starts, before)
    let end = 0
    while (at > 0) {
      end = Math.max(end, greatestEnd[at]!)
      at -= at & -at
    }
    return end
  }
  const take = (edit: Edit): void => {
    let at = lowerBound(starts, edit.start) + 1
    while (at < greatestEnd.length) {
      greatestEnd[at] = Math.max(greatestEnd[at]!, edit.end)
      at += at & -at
    }
  }
  const chosen: Candidate[] = []
  for (const candidate of [...found].sort((a, b) => a.plan.at - b.plan.at)) {
    if (candidate.plan.edits.some((edit) => prefixEnd(edit.end) > edit.start)) continue
    for (const edit of candidate.plan.edits) take(edit)
    chosen.push(candidate)
  }
  return chosen
}

function apply(bytes: Uint8Array, chosen: readonly Candidate[]): Uint8Array {
  const edits = chosen.flatMap((candidate) => candidate.plan.edits).sort((a, b) => a.start - b.start)
  const parts: Uint8Array[] = []
  let at = 0
  for (const edit of edits) {
    parts.push(bytes.subarray(at, edit.start), replacement(edit.text))
    at = edit.end
  }
  parts.push(bytes.subarray(at))
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function offsetMap(chosen: readonly Candidate[]): (offset: number) => number {
  const edits = chosen.flatMap((candidate) => candidate.plan.edits).sort((a, b) => a.end - b.end)
  const shifts: number[] = []
  let shift = 0
  for (const edit of edits) {
    shift += replacement(edit.text).length - (edit.end - edit.start)
    shifts.push(shift)
  }
  return (offset) => {
    let low = 0
    let high = edits.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (edits[middle]!.end <= offset && edits[middle]!.start < offset) low = middle + 1
      else high = middle
    }
    return offset + (shifts[low - 1] ?? 0)
  }
}

interface Span { type: string, start: number, end: number }

function spans(bytes: Uint8Array): Span[] {
  const result: Span[] = []
  const pending: unknown[] = [parse(bytes, { positions: true })]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node !== 'object' || node === null) continue
    const record = node as Record<string, unknown>
    const pos = record['pos'] as { startOffset: number, endOffset: number } | undefined
    if (typeof record['type'] === 'string' && pos !== undefined) result.push({ type: record['type'], start: pos.startOffset, end: pos.endOffset })
    for (const value of Object.values(record)) if (Array.isArray(value)) pending.push(...(value as unknown[]))
  }
  return result
}

/** A fix holds only where its node stands in the fixed source; the others are left for the author. */
function verified(bytes: Uint8Array, chosen: readonly Candidate[]): Candidate[] {
  let kept = [...chosen]
  for (let round = 0; round < 4 && kept.length > 0; round++) {
    const found = spans(apply(bytes, kept))
    const byType = new Map<string, { spans: Span[], maxEnds: number[] }>()
    for (const span of found) {
      let group = byType.get(span.type)
      if (group === undefined) {
        group = { spans: [], maxEnds: [] }
        byType.set(span.type, group)
      }
      group.spans.push(span)
    }
    for (const group of byType.values()) {
      group.spans.sort((a, b) => a.start - b.start)
      let maxEnd = -1
      for (const span of group.spans) {
        maxEnd = Math.max(maxEnd, span.end)
        group.maxEnds.push(maxEnd)
      }
    }
    const map = offsetMap(kept)
    const holding = kept.filter((candidate) => {
      const at = map(candidate.plan.at)
      const group = byType.get(candidate.plan.node)
      if (group === undefined) return false
      let low = 0
      let high = group.spans.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (group.spans[middle]!.start <= at) low = middle + 1
        else high = middle
      }
      return candidate.plan.starts ? group.spans[low - 1]?.start === at : (group.maxEnds[low - 1] ?? -1) >= at
    })
    if (holding.length === kept.length) return kept
    kept = holding
  }
  return []
}

/** A bare span can be forced without changing its meaning when another fix meets it at a delimiter. */
function braced(candidate: Candidate): Candidate | null {
  const { edits, node } = candidate.plan
  if ((node !== 'emphasis' && node !== 'strong') || edits.length !== 2) return null
  const marker = node === 'emphasis' ? '/' : '*'
  if (edits[0]?.text !== marker || edits[1]?.text !== marker) return null
  return { ...candidate, plan: { ...candidate.plan, edits: [
    { ...edits[0], text: `{${marker}` }, { ...edits[1], text: `${marker}}` },
  ] } }
}

function counts(entries: readonly Diagnostic[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const entry of entries) result.set(entry.code, (result.get(entry.code) ?? 0) + 1)
  return result
}

function evaluated(bytes: Uint8Array, plans: readonly Candidate[], before: Map<string, number>, settings: LintOptions):
  { excess: number, commentShaped: boolean, findings: Diagnostic[] } {
  const findings = lint(decoder.decode(apply(bytes, plans)), settings)
  let excess = 0
  let commentShaped = false
  for (const [code, count] of counts(findings)) {
    const increase = count - (before.get(code) ?? 0)
    if (increase > 0) {
      excess += increase
      if (code === 'comment-shaped-emphasis') commentShaped = true
    }
  }
  return { excess, commentShaped, findings }
}

/** Keep the fix pass from introducing a lint finding at a meeting of independent edits. */
function quiet(
  bytes: Uint8Array, chosen: Candidate[], original: readonly Diagnostic[], settings: LintOptions,
): { chosen: Candidate[], findings: Diagnostic[] } | null {
  if (chosen.length === 0) return null
  const before = counts(original)
  let current = chosen
  let result = evaluated(bytes, current, before, settings)
  if (result.excess === 0) return { chosen: current, findings: result.findings }
  // Bracing an inline delimiter can resolve a comment-shaped span, not a block or line finding.
  if (!result.commentShaped) return { chosen: current, findings: result.findings }
  // Try the inner delimiter class first. One batch covers many repeated collisions without a lint and parse per span.
  for (const node of ['emphasis', 'strong'] as const) {
    const trial = current.map((candidate) => candidate.plan.node === node ? braced(candidate) ?? candidate : candidate)
    if (trial.every((candidate, index) => candidate === current[index])) continue
    if (verified(bytes, trial).length !== trial.length) continue
    const next = evaluated(bytes, trial, before, settings)
    if (next.excess < result.excess) {
      current = trial
      result = next
    }
    if (result.excess === 0) return { chosen: current, findings: result.findings }
    if (!result.commentShaped) break
  }
  // A later pass can resolve a warning exposed by an earlier replacement.
  return { chosen: current, findings: result.findings }
}

/** The options of the lint run that finds what to fix: every fixable rule is on unless `rules` turns it off. */
export function fixOptions(options: LintOptions): LintOptions {
  const rules: Record<string, 'on' | 'off'> = {}
  for (const id of FIXES.keys()) rules[id] = 'on'
  return { ...options, rules: { ...rules, ...options.rules } }
}

const MAX_PASSES = 10

function sites(entries: readonly Diagnostic[], bytes: Uint8Array): Map<string, number> {
  const result = new Map<string, number>()
  const starts = lineStarts(bytes)
  for (const entry of entries) {
    if (entry.range === undefined) continue
    const key = `${entry.code}:${lineAt(starts, entry.range.startOffset)}`
    result.set(key, (result.get(key) ?? 0) + 1)
  }
  return result
}

interface RunResult extends FixResult { chosen: Candidate[], findings: readonly Diagnostic[] }

function runPasses(source: string, settings: LintOptions, excluded: ReadonlySet<string>, original: readonly Diagnostic[]): RunResult {
  const applied = new Map<string, number>()
  const selected: Candidate[] = []
  let bytes: Uint8Array = encoder.encode(source)
  let findings: readonly Diagnostic[] = original
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const found = candidates(bytes, findings).filter((candidate) => !excluded.has(candidate.key))
    if (found.length === 0) break
    const batch = quiet(bytes, verified(bytes, select(found)), findings, settings)
    if (batch === null) break
    bytes = apply(bytes, batch.chosen)
    findings = batch.findings
    selected.push(...batch.chosen)
    for (const candidate of batch.chosen) applied.set(candidate.rule, (applied.get(candidate.rule) ?? 0) + 1)
  }
  return { output: decoder.decode(bytes), applied, chosen: selected, findings }
}

interface Site { line: number, column: number }

function addedSites(
  after: readonly Diagnostic[], output: string, baseline: Map<string, number>, originalSites: Map<string, number>,
): Site[] | null {
  const badCodes = new Set([...counts(after)].filter(([code, count]) => count > (baseline.get(code) ?? 0)).map(([code]) => code))
  if (badCodes.size === 0) return null
  const bytes = encoder.encode(output)
  const afterSites = sites(after, bytes)
  const starts = lineStarts(bytes)
  const found: Site[] = []
  for (const entry of after) {
    if (!badCodes.has(entry.code) || entry.range === undefined) continue
    const line = lineAt(starts, entry.range.startOffset)
    const key = `${entry.code}:${line}`
    if ((afterSites.get(key) ?? 0) > (originalSites.get(key) ?? 0)) {
      found.push({ line, column: entry.range.startOffset - starts[line - 1]! })
    }
  }
  return found
}

function excludeCause(sites: readonly Site[], excluded: Set<string>, chosen: readonly Candidate[]): boolean {
  let grew = false
  const visited = new Set<string>()
  for (const site of sites) {
    const key = `${site.line}:${site.column}`
    if (visited.has(key)) continue
    visited.add(key)
    const eligible = chosen.filter((candidate) => !excluded.has(candidate.key) &&
      (candidate.line < site.line || (candidate.line === site.line && candidate.column <= site.column)))
    const cause = eligible.sort((a, b) => b.line - a.line || b.column - a.column)[0]
    if (cause === undefined) continue
    excluded.add(cause.key)
    grew = true
  }
  return grew
}

interface ClosedPassResult extends FixResult { settled: boolean, findings: readonly Diagnostic[] }

function fixClosedPass(source: string, options: LintOptions, previous?: readonly Diagnostic[]): ClosedPassResult {
  const settings: LintOptions = { ...fixOptions(options) }
  delete settings.includes
  const original = previous ?? lint(source, settings)
  const sourceBytes = encoder.encode(source)
  const baseline = counts(original)
  const originalSites = sites(original, sourceBytes)
  const excluded = new Set<string>()
  for (let attempt = 0; attempt <= sourceBytes.length; attempt++) {
    const result = runPasses(source, settings, excluded, original)
    if (result.applied.size === 0) return { output: source, applied: new Map(), settled: true, findings: original }
    const bad = addedSites(result.findings, result.output, baseline, originalSites)
    if (bad === null) return { output: result.output, applied: result.applied,
      settled: candidates(encoder.encode(result.output), result.findings).length === 0, findings: result.findings }
    if (!excludeCause(bad, excluded, result.chosen)) break
  }
  return { output: source, applied: new Map(), settled: true, findings: original }
}

/** The source with every fix applied that verifies, pass after pass until a pass changes nothing. */
export function fixSource(source: string, options: LintOptions): FixResult {
  const applied = new Map<string, number>()
  let output = source
  let findings: readonly Diagnostic[] | undefined
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const result = fixClosedPass(output, options, findings)
    if (result.output === output) break
    output = result.output
    findings = result.findings
    for (const [rule, count] of result.applied) applied.set(rule, (applied.get(rule) ?? 0) + count)
    if (result.settled) break
  }
  return { output, applied }
}

/** The rules a fix rewrites. */
export const FIXABLE_RULES: readonly RuleId[] = Object.freeze([...FIXES.keys()])

/** One replacement in the source: the UTF-8 byte range it replaces, as the ranges of diagnostics count. */
export interface FixEdit {
  startOffset: number
  endOffset: number
  text: string
}

/** The edits that fix one lint finding of `source`, or null where the rule has no fix or the fix would not hold. */
export function fixEditsFor(source: string, diagnostic: Diagnostic): FixEdit[] | null {
  const bytes = encoder.encode(source)
  if (diagnostic.range === undefined || diagnostic.range.endOffset > bytes.length) return null
  const found = candidates(bytes, [diagnostic])
  if (found.length === 0 || verified(bytes, found).length === 0) return null
  return found[0]!.plan.edits.map((edit) => ({ startOffset: edit.start, endOffset: edit.end, text: edit.text }))
}
