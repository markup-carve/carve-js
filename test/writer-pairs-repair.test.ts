// C2-W-146 through the repair (C2-W-089): a group the plan does not decide keeps its pair escapes in linear time.
import { describe, expect, it } from 'vitest'
import { type Inline, type ParagraphNode } from '../src/ast.ts'
import { writeWithDiagnostics } from '../src/index.ts'
import { growthRatio } from './support/growth.ts'
import { documentOf } from './support/tree.ts'

const EMPHASIS: Inline = { type: 'emphasis', children: [{ type: 'text', value: 'x' }] }

/** `count` copies of an emphasis and ` **b** `; the last space ends the line and is dropped without a report (C2-W-151). */
function copies(count: number): Inline[] {
  return Array.from({ length: count }, (): Inline[] => [EMPHASIS, { type: 'text', value: ' **b** ' }]).flat()
}

/** The copies behind a strong whose star follows a soft break, a backslash the repair may prune (C2-W-088). */
function behindBrokenStrong(count: number): Inline[] {
  return [{ type: 'strong', children: [{ type: 'text', value: 'a' }, { type: 'soft_break' }, { type: 'text', value: '*b' }] },
    ...copies(count)]
}

describe('C2-W-146: pair escapes in a group the repair writes', () => {
  it('writes the reproduction of the issue with its escapes and no report', () => {
    const output = writeWithDiagnostics(documentOf({ type: 'paragraph', children: copies(3) }))
    expect(output.source).toBe('/x/ \\*\\*b** /x/ \\*\\*b** /x/ \\*\\*b**\n')
    expect(output.diagnostics).toEqual([])
  })

  const shapes: [string, (count: number) => Inline[]][] = [
    ['pair escapes beside emphasis', copies],
    ['pair escapes behind a star after a break', behindBrokenStrong],
  ]
  it.each(shapes)('takes time linear in the copies: %s', (_, shape) => {
    const small = documentOf({ type: 'paragraph', children: shape(400) })
    const large = documentOf({ type: 'paragraph', children: shape(6400) })
    const { ratio, times } = growthRatio(() => writeWithDiagnostics(small), () => writeWithDiagnostics(large))
    expect(ratio, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(48)
  })
})

describe('C2-W-146: early pair escapes that leave no opener', () => {
  const paragraph = (value: string): ParagraphNode => ({ type: 'paragraph', children: [{ type: 'text', value }] })
  const cases: [string, string][] = [
    ['alpha ~~s~~ beta _u_ gamma =h= delta **b** epsilon', 'alpha \\~\\~s~~ beta \\_u_ gamma \\=h= delta \\*\\*b** epsilon\n'],
    // Escaping the first `_` exposes the second as an opener, so the test after the write still runs.
    ['_b _c_', '\\_b \\_c_\n'],
    ['a _b _c_ d', 'a \\_b \\_c_ d\n'],
    ['~~a ~~b~~', '\\~\\~a \\~\\~b~~\n'],
  ]
  it.each(cases)('writes %j', (value, expected) => {
    const output = writeWithDiagnostics(documentOf(paragraph(value)))
    expect(output.source).toBe(expected)
    expect(output.diagnostics).toEqual([])
  })
})
