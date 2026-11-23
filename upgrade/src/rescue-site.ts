// carve-js#5491: a rescue candidate is rendered only near the first difference it must remove.
import { firstDifferenceLine } from './compare.ts'
import { applyEdits, type Edit } from './edits.ts'
import { blocks02, html01, html02 } from './engines.ts'
import { lineEnd, lineOf, lineStart, lineText, readLines, type Lines } from './source.ts'

/** Whether a candidate that edits the given lines or offsets of one text can remove the difference. */
export interface Gate {
  lines(from: number, to?: number): boolean
  at(from: number, to?: number): boolean
}

/** The gates of a rescue call, for candidates built from its input and from its output. */
export interface Site {
  input: Gate
  output: Gate
}

export const OPEN_GATE: Gate = { lines: () => true, at: () => true }
export const OPEN_SITE: Site = { input: OPEN_GATE, output: OPEN_GATE }

const DEFINITION = /\[([^\]\n]+)\]:/gu
const HEADING = /^[ \t]*(?:>[ \t]?)*#{1,6}[ \t]+(.*?)[ \t]*$/u
const fold = (text: string): string => text.toLowerCase().replace(/\s+/gu, ' ')

/**
 * An edit outside the site reaches the difference only through a document-wide reading: a
 * definition whose label the site names, or a heading whose text an implicit reference there names.
 */
function gate(lines: Lines, first: number, last: number, notesPlaced: boolean): Gate {
  let site = ''
  for (let line = first; line <= last; line++) site += fold(lineText(lines, line)) + '\n'
  const reaches = (line: number): boolean => {
    const text = lineText(lines, line)
    const heading = HEADING.exec(text)?.[1]
    if (heading !== undefined && heading !== '' && site.includes(fold(heading))) return true
    for (const match of text.matchAll(DEFINITION)) if (notesPlaced || site.includes(fold(match[1]!))) return true
    return false
  }
  const byLines = (from: number, to = from): boolean => {
    if (to >= first && from <= last) return true
    for (let line = Math.max(1, from); line <= Math.min(to, lines.count); line++) if (reaches(line)) return true
    return false
  }
  return {
    lines: byLines,
    at: (from, to = from) => byLines(lineOf(lines, from), lineOf(lines, to)),
  }
}

/** Notes rendered in a container of the body, not after it, take every definition to that place. */
function placesNotes(html: string): boolean {
  if (/class="[^"]*\bfootnotes\b/u.test(html)) return true
  const section = html.indexOf('doc-endnotes')
  if (section < 0) return false
  const close = html.indexOf('</section>', section)
  return close >= 0 && html.slice(close + '</section>'.length).trim() !== ''
}

/** The input offset where the output offset `offset` ends, past an edit that wrote it. */
function endBefore(edits: readonly Edit[], offset: number): number {
  let shift = 0
  for (const edit of edits) {
    const start = edit.start + shift
    if (offset < start) break
    if (offset <= start + edit.text.length) return edit.end
    shift += edit.text.length - (edit.end - edit.start)
  }
  return offset - shift
}

function startBefore(edits: readonly Edit[], offset: number): number {
  let shift = 0
  for (const edit of edits) {
    const start = edit.start + shift
    if (offset < start) break
    if (offset < start + edit.text.length) return edit.start
    shift += edit.text.length - (edit.end - edit.start)
  }
  return offset - shift
}

/**
 * The lines around the first difference of `output`: its top-level block with one block on each
 * side and the lines between them. Without a placed difference every candidate stays open.
 */
export function rescueSite(input: string, output: string, edits: readonly Edit[]): Site {
  let line: number
  let blocks: [number, number][]
  let notesPlaced: boolean
  try {
    const expected = html01(input)
    const actual = html02(output, false)
    line = firstDifferenceLine(expected, actual)
    if (line < 1) return OPEN_SITE
    notesPlaced = placesNotes(expected) || placesNotes(actual)
    blocks = blocks02(output)
  } catch {
    return OPEN_SITE
  }
  const out = readLines(output)
  let before = -1
  while (before + 1 < blocks.length && blocks[before + 1]![0] <= line) before++
  const after = blocks.findIndex(([, end]) => end >= line)
  const low = Math.min(before < 0 ? 0 : before, after < 0 ? blocks.length : after) - 1
  const high = Math.max(before, after < 0 ? blocks.length : after) + 1
  const first = low >= 1 ? blocks[low - 1]![1] + 1 : 1
  const last = high + 1 < blocks.length ? blocks[high + 1]![0] - 1 : out.count
  const outputGate = gate(out, first, last, notesPlaced)
  if (applyEdits(input, [...edits]) !== output) return { input: OPEN_GATE, output: outputGate }
  const source = readLines(input)
  const from = lineOf(source, startBefore(edits, lineStart(out, first)))
  const to = lineOf(source, endBefore(edits, lineEnd(out, last)))
  return { input: gate(source, from, to, notesPlaced), output: outputGate }
}
