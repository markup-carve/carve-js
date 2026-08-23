import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parse } from '../src/parse.js'
import type { Document, Position } from '../src/ast.js'

/**
 * PART 12 §4, on a line the BLOCK LAYER REMOVED (markup-carve/carve-js#1305).
 *
 * A `+` continuation marker's own line is consumed before any inline run: the
 * item's text is `b` then `c`, and the `+` between them is gone. So the joined
 * text the inline scanner walks holds ONE newline where the source holds two,
 * and a line number counted as "the start line plus the newlines before this
 * offset" runs one short for everything after the removal - once per removed
 * line, so it compounds.
 *
 * The offsets were never wrong. `lineAnchors` already gave every line its own
 * document origin, which is why all three engines published the same numbers
 * there; only the LINE was derived from the text instead of from the anchor.
 * That made carve-js inconsistent WITH ITSELF rather than with anyone else: it
 * named line 3 column 3 for offset 16, and line 3 column 3 is offset 12.
 *
 * THE SECOND HALF IS THE OTHER DIRECTION - an offset that reached PAST the end
 * of what the construct owns. A line block whose last body line is an emptied
 * comment appends one synthesized codepoint to the joined text, so an open
 * verbatim run keeps the newline that boundary still ends at. That guard is not
 * source, and a run that swallowed it ended one codepoint INTO the `%%` the
 * block layer removed - the construct owning half a comment marker, and half of
 * one either way. §4 ends a span "immediately after the last source codepoint
 * the construct owns"; the last one owned is the terminator the guard stands
 * for, which §4's break sentence names as column 1 of the following line.
 *
 * THE CONSISTENCY CHECK IS THE LOAD-BEARING ONE and it runs over the WHOLE
 * corpus, not over the two documents the ticket named. A per-document
 * assertion pins the shape that was measured; this one states the invariant
 * that made the bug visible - a published (line, column) resolves, through the
 * source's own line table, to the published offset - and would catch the next
 * construct that removes a line just as well. The pre-fix engine failed it on
 * `384-...-6` and on nothing else in 1341 documents, which is also why the
 * synthetic cases below are here: the corpus exercises this shape once.
 */

const corpusDir = resolve(fileURLToPath(new URL('../spec/tests/corpus', import.meta.url)))

/**
 * Codepoint offset of each line start, over the ORIGINAL source.
 *
 * A BOM is not stripped and CR / CRLF are not folded, because positions are
 * reported against the source as given - `250-line-endings-and-a-byte-order-
 * mark` is the fixture that says so, and a table built over a normalized copy
 * reports every one of its spans as broken.
 */
const lineStarts = (source: string): number[] => {
  const cps = [...source]
  const starts = [0]
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] === '\r') {
      if (cps[i + 1] === '\n') i++
      starts.push(i + 1)
    } else if (cps[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return starts
}

const eachPos = (node: unknown, visit: (pos: Position) => void): void => {
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record.pos && typeof (record.pos as Position).startLine === 'number') {
    visit(record.pos as Position)
  }
  for (const key of Object.keys(record)) {
    if (key === 'pos') continue
    const value = record[key]
    if (Array.isArray(value)) for (const child of value) eachPos(child, visit)
    else if (value && typeof value === 'object') eachPos(value, visit)
  }
}

/** Every place this document's own line table disagrees with its own offsets. */
const inconsistencies = (source: string): { findings: string[]; spans: number } => {
  const starts = lineStarts(source)
  const findings: string[] = []
  let spans = 0
  eachPos(parse(source), (pos) => {
    spans++
    const at = (line: number, column: number | undefined): number | undefined =>
      starts[line - 1] === undefined || column === undefined
        ? undefined
        : starts[line - 1]! + column - 1
    const start = at(pos.startLine, pos.startColumn)
    const end = at(pos.endLine, pos.endColumn)
    if (starts[pos.startLine - 1] === undefined) {
      findings.push(`startLine ${pos.startLine} is past the end of the source`)
    } else if (start !== undefined && start !== pos.startOffset) {
      findings.push(
        `start line ${pos.startLine} column ${pos.startColumn} is offset ${start}, not ${pos.startOffset}`,
      )
    }
    if (starts[pos.endLine - 1] === undefined) {
      findings.push(`endLine ${pos.endLine} is past the end of the source`)
    } else if (end !== undefined && end !== pos.endOffset) {
      findings.push(
        `end line ${pos.endLine} column ${pos.endColumn} is offset ${end}, not ${pos.endOffset}`,
      )
    }
  })
  return { findings, spans }
}

const spanOf = (doc: Document, path: number[]): Position => {
  let node: unknown = doc
  for (const index of path) {
    const record = node as Record<string, unknown>
    const slot = ['children', 'items'].find((name) => Array.isArray(record[name]))
    node = (record[slot!] as unknown[])[index]
  }
  const pos = (node as { pos?: Position }).pos
  if (!pos) throw new Error(`no pos at ${path.join('/')}`)
  return pos
}

const show = (pos: Position): string =>
  `${pos.startLine}:${pos.startColumn}-${pos.endLine}:${pos.endColumn} ${pos.startOffset}..${pos.endOffset}`

describe('an offset past a line the block layer removed names the line it is on', () => {
  // `384-a-continuation-marker-attaches-only-a-flush-left-block-6`.
  const continued = '- a\n  - b\n  +\n  c\n'

  it('names line 4 for the text on line 4', () => {
    const doc = parse(continued)
    // list > item > [paragraph, list] > item > paragraph > [text, break, text]
    expect(show(spanOf(doc, [0, 0, 1, 0, 0, 2]))).toBe('4:3-4:4 16..17')
  })

  it('ends the break that crosses the removed line on line 4', () => {
    const doc = parse(continued)
    expect(show(spanOf(doc, [0, 0, 1, 0, 0, 1]))).toBe('2:6-4:3 9..16')
  })

  it('ends every container holding that text on line 4', () => {
    const doc = parse(continued)
    for (const path of [[0], [0, 0], [0, 0, 1], [0, 0, 1, 0], [0, 0, 1, 0, 0]]) {
      const pos = spanOf(doc, path)
      expect([path.join('/'), pos.endLine, pos.endColumn, pos.endOffset]).toEqual([
        path.join('/'),
        4,
        4,
        17,
      ])
    }
  })

  it('counts each removed line, so two markers do not drift by one', () => {
    // Two `+` lines: the last text is on source line 6, four newlines into a
    // joined text that holds two. A fix that subtracted a constant would pass
    // the single-marker case above and fail here.
    const doc = parse('- a\n  - b\n  +\n  c\n  +\n  d\n')
    expect(show(spanOf(doc, [0, 0, 1, 0, 0, 4]))).toBe('6:3-6:4 24..25')
  })

  // `380-a-terminal-comment-line-still-leaves-an-empty-verse-line`.
  const verse = '::: |\n`\n%%\n:::\n'

  it('ends an open verbatim run before the comment the guard stands for', () => {
    const doc = parse(verse)
    // line block > paragraph > code
    expect(show(spanOf(doc, [0, 0, 0]))).toBe('2:1-3:1 6..8')
    expect(show(spanOf(doc, [0, 0]))).toBe('2:1-3:1 6..8')
  })

  it('leaves the comment marker outside the span it removed the line for', () => {
    const pos = spanOf(parse(verse), [0, 0, 0])
    expect(verse.slice(pos.startOffset, pos.endOffset)).toBe('`\n')
    expect(verse.slice(pos.endOffset, pos.endOffset + 2)).toBe('%%')
  })

  it('holds when the run carries text and when two comment lines end the stanza', () => {
    expect(show(spanOf(parse('::: |\n`a\n%%\n:::\n'), [0, 0, 0]))).toBe('2:1-3:1 6..9')
    expect(show(spanOf(parse('::: |\n`\n%%\n%%\n:::\n'), [0, 0, 0]))).toBe('2:1-4:1 6..11')
  })

  it("agrees with its own line table on every span of every corpus document", () => {
    const names = readdirSync(corpusDir).filter((f) => f.endsWith('.crv')).sort()
    const findings: string[] = []
    let spans = 0
    for (const name of names) {
      const source = readFileSync(resolve(corpusDir, name), 'utf8')
      const run = inconsistencies(source)
      spans += run.spans
      for (const finding of run.findings) findings.push(`${basename(name, '.crv')}: ${finding}`)
    }
    // THE COUNTS ARE ASSERTED BECAUSE THE CHECK CAN GO QUIET. A corpus that
    // failed to load, or a `parse` that stopped publishing positions, reports
    // zero findings over zero spans and reads exactly like a clean run.
    expect(names.length).toBeGreaterThan(1000)
    expect(spans).toBeGreaterThan(5000)
    expect(findings).toEqual([])
  })

  it('agrees with its own line table on the shapes the corpus does not carry', () => {
    const samples = [
      '- a\n  - b\n  +\n  c\n  d\n',
      '- a\n  - b\n  +\n  c\n  +\n  d\n',
      '- - a\n  +\n  b\n',
      '> - a\n>   - b\n>   +\n>   c\n',
      '1. a\n   1. b\n   +\n   c\n',
      ': t\n  - a\n    - b\n    +\n    c\n',
      '- a\n  - b\n  +\n  c *d\n  e* f\n',
      '::: |\n`\n%%\n:::\n',
      '::: |\n`a\n%%\n:::\n',
      '::: |\n`\n%%\n%%\n:::\n',
    ]
    const findings = samples.flatMap((source) =>
      inconsistencies(source).findings.map((f) => `${JSON.stringify(source)}: ${f}`),
    )
    expect(findings).toEqual([])
  })
})
