import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareHtml } from '../src/compare.ts'
import { applyEdits, type Edit, offsetBefore, selectEdits } from '../src/edits.ts'
import { ENTRIES, upgrade } from '../src/index.ts'
import { lineEnd, lineOf, lineStart, lineText, readLines } from '../src/source.ts'

function edit(start: number, end: number, text: string, entry: string, sequence = 0): Edit {
  return { start, end, text, entry, sequence }
}

describe('the edit list', () => {
  it('applies from the end backward, so offsets of the input stay valid', () => {
    const edits = selectEdits([edit(6, 6, '{', 'U-065'), edit(0, 1, 'X', 'U-044'), edit(9, 9, '}', 'U-065', 1)])
    expect(applyEdits('a b c _u_ d', edits)).toBe('X b c {_u_} d')
  })

  it('keeps the lower entry id of two edits that share a character', () => {
    const edits = selectEdits([edit(2, 6, '', 'U-038'), edit(4, 5, 'x', 'U-065'), edit(8, 9, 'y', 'U-066')])
    expect(edits.map((kept) => kept.entry)).toEqual(['U-038', 'U-066'])
  })

  it('drops an insertion inside a replaced span and keeps one at its edge', () => {
    const edits = selectEdits([edit(2, 6, '', 'U-038'), edit(4, 4, '{', 'U-065'), edit(6, 6, '}', 'U-065', 1), edit(2, 2, '>', 'U-016')])
    expect(edits.map((kept) => [kept.start, kept.entry])).toEqual([[2, 'U-016'], [2, 'U-038'], [6, 'U-065']])
  })

  it('orders two insertions at one offset by entry id, then by collection', () => {
    const edits = selectEdits([edit(3, 3, 'b', 'U-065', 0), edit(3, 3, 'a', 'U-001', 1), edit(3, 3, 'c', 'U-065', 2)])
    expect(applyEdits('012345', edits)).toBe('012abc345')
  })

  it('maps an offset of the output back to the input', () => {
    const edits = selectEdits([edit(2, 2, 'XX', 'U-001'), edit(5, 7, '', 'U-002')])
    expect(applyEdits('0123456789', edits)).toBe('01XX234789')
    expect([0, 2, 3, 4, 6, 7, 9].map((offset) => offsetBefore(edits, offset))).toEqual([0, 2, 2, 2, 4, 7, 9])
  })
})

describe('the line table', () => {
  it('counts lines from 1 and leaves the line ending out of the text', () => {
    const lines = readLines('ab\r\n\ncd')
    expect(lines.count).toBe(3)
    expect([1, 2, 3].map((line) => lineText(lines, line))).toEqual(['ab', '', 'cd'])
    expect([lineStart(lines, 3), lineEnd(lines, 3), lineStart(lines, 4), lineOf(lines, 4), lineOf(lines, 6)]).toEqual([5, 7, 7, 2, 3])
  })

  it('has no line after a final line ending, and none in an empty text', () => {
    expect(readLines('a\n').count).toBe(1)
    expect(readLines('').count).toBe(0)
  })
})

describe('the comparison of section 1', () => {
  it('sorts attributes and drops whitespace between tags', () => {
    expect(compareHtml('<p class="a" id="b">x</p>\n<hr>', '<p id="b" class="a">x</p><hr>').equal).toBe(true)
  })

  it('compares text as it is', () => {
    const compared = compareHtml('<p>a  b</p>', '<p>a b</p>')
    expect(compared.equal).toBe(false)
    expect(compared.difference).toEqual({ line: 0, expected: '<p>a  b</p>', actual: '<p>a b</p>' })
  })

  it('compares the inside of pre as it is', () => {
    expect(compareHtml('<pre><code>a\n  b\n</code></pre>', '<pre><code>a\n b\n</code></pre>').equal).toBe(false)
    expect(compareHtml('<pre><code> a\n</code></pre>', '<pre><code> a\n</code></pre>').equal).toBe(true)
  })

  it('keeps a space next to a tag on one line', () => {
    expect(compareHtml('<p>a <em>b</em></p>', '<p>a<em>b</em></p>').equal).toBe(false)
  })

  it('reads over a quoted `>` in an attribute value', () => {
    expect(compareHtml('<a title="a>b" href="x">t</a>', '<a href="x" title="a>b">t</a>').equal).toBe(true)
  })

  it('takes a later paragraph of an item with or without its element, and counts the gain (ruling on U-019)', () => {
    const old = '<ul>\n  <li>a\n    second\n  </li>\n</ul>'
    const next = '<ul>\n  <li data-source-line="1">a\n    <p data-source-line="3">second</p>\n  </li>\n</ul>'
    expect(compareHtml(old, next)).toEqual({ equal: true, difference: null, gainedParagraphs: 1 })
    expect(compareHtml('<ul><li><p>a</p></li></ul>', '<ul><li>a</li></ul>').equal).toBe(false)
  })

  it('names the source line of the 0.2 element at the difference', () => {
    const compared = compareHtml('<p>a</p><p>b</p>', '<p data-source-line="1">a</p><p data-source-line="3">c</p>')
    expect(compared.difference?.line).toBe(3)
  })
})

describe('the report', () => {
  it('holds the 93 entries of the contract with their classes', () => {
    const count = (name: string): number => ENTRIES.filter((entry) => entry.class === name).length
    // U-048 is `none` by the ruling of 2026-11-13, so one rewrite less and one none more than the summary table.
    expect([ENTRIES.length, count('rewrite'), count('escape'), count('report'), count('none')]).toEqual([93, 49, 13, 12, 19])
  })

  it('gives every record the entry id, the class, the line of the input and the lint rule', () => {
    const result = upgrade('one\n\ntwo _u_ and ~s~\n\nSome text\n# Heading\n')
    expect(result.records).toEqual([
      { entry: 'U-001', class: 'rewrite', line: 6, message: 'blank line put above a block that 0.2 reads as a lazy line directly under text', lint: 'block-opener-without-blank-line' },
      { entry: 'U-065', class: 'rewrite', line: 3, message: 'bare underline put in braces', lint: 'deprecated-bare-underline' },
      { entry: 'U-065', class: 'rewrite', line: 3, message: 'bare underline put in braces', lint: 'deprecated-bare-underline' },
      { entry: 'U-066', class: 'rewrite', line: 3, message: 'bare strike put in braces', lint: 'deprecated-bare-strike' },
      { entry: 'U-066', class: 'rewrite', line: 3, message: 'bare strike put in braces', lint: 'deprecated-bare-strike' },
    ])
    expect([result.output, result.check, result.changed]).toEqual(['one\n\ntwo {_u_} and {~s~}\n\nSome text\n\n# Heading\n', 'pass', true])
  })

  it('reports a difference no entry explains with the line of the input', () => {
    const result = upgrade('ok\n\n```=html "T"\n<b>x</b>\n```\n')
    expect(result.check).toBe('mismatch')
    const record = result.records.find((entry) => entry.entry === 'upgrade-mismatch')
    expect([record?.class, record?.line]).toEqual(['mismatch', 3])
  })

  it('prints one summary line for the later paragraphs of tight items', () => {
    const result = upgrade('- a\n+\nsecond\n- b\n+\nthird\n')
    expect(result.records.filter((record) => record.class === 'summary')).toEqual([
      { entry: 'U-019', class: 'summary', line: 0, message: '2 later paragraph(s) of list items gain a paragraph element in 0.2' },
    ])
    expect(result.check).toBe('pass')
  })
})

describe('the command line', () => {
  const cli = join(import.meta.dirname, '../src/cli.ts')
  const run = (args: string[]): { status: number | null, stdout: string, stderr: string } => {
    const done = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    return { status: done.status, stdout: done.stdout, stderr: done.stderr }
  }

  it('prints the rewritten source, writes on request, and says by its status whether a person is needed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-'))
    try {
      const file = join(dir, 'a.crv')
      const report = join(dir, 'b.crv')
      writeFileSync(file, 'an _underlined_ word\n')
      writeFileSync(report, 'a `<b>x</b>`{=html} b\n')
      const printed = run([file])
      expect([printed.status, printed.stdout]).toEqual([0, 'an {_underlined_} word\n'])
      expect(printed.stderr).toContain(`${file}:1: U-065 rewrite: bare underline put in braces [deprecated-bare-underline]`)
      expect(printed.stderr).toContain('U-079 report')
      expect(run(['--check', file]).status).toBe(1)
      expect(readFileSync(file, 'utf8')).toBe('an _underlined_ word\n')
      expect(run(['--write', file]).status).toBe(0)
      expect(readFileSync(file, 'utf8')).toBe('an {_underlined_} word\n')
      expect(run(['--check', file]).status).toBe(0)
      expect(run([report]).status).toBe(1)
      const json = JSON.parse(execFileSync(process.execPath, [cli, '--json', file], { encoding: 'utf8' })) as { files: { check: string, records: unknown[] }[] }
      expect(json.files).toEqual([{ file, changed: false, check: 'pass', records: [] }])
      expect(run(['--nope', file]).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})
