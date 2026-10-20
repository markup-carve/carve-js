import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parse } from '../src/parse.js'
import type { Document, Position } from '../src/ast.js'

// Source positions stay anchored when a column-zero continuation line is removed.

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
  // The continuation line belongs to the outer list item.
  const continued = '- a\n  - b\n+\nc\n'

  it('names line 4 for the text on line 4', () => {
    const doc = parse(continued)
    expect(show(spanOf(doc, [0, 0, 2, 0]))).toBe('4:1-4:2 12..13')
  })

  it('starts the attached paragraph after the removed line', () => {
    const doc = parse(continued)
    expect(show(spanOf(doc, [0, 0, 2]))).toBe('4:1-4:2 12..13')
  })

  it('ends every container holding that text on line 4', () => {
    const doc = parse(continued)
    for (const path of [[0], [0, 0], [0, 0, 2], [0, 0, 2, 0]]) {
      const pos = spanOf(doc, path)
      expect([path.join('/'), pos.endLine, pos.endColumn, pos.endOffset]).toEqual([
        path.join('/'),
        4,
        2,
        13,
      ])
    }
  })

  it('counts each removed line, so two markers do not drift by one', () => {
    // Two removed marker lines still place the last text on source line 6.
    const doc = parse('- a\n  - b\n+\nc\n+\nd\n')
    expect(show(spanOf(doc, [0, 0, 3, 0]))).toBe('6:1-6:2 16..17')
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
    expect(verse.slice(pos.endOffset, pos.endOffset! + 2)).toBe('%%')
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
