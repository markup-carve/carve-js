// The cases of the three-way check of the 0.2 engines where the clause decides against this engine.
import { describe, expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/index.ts'

const first = (src: string): Record<string, unknown> => {
  const { pos: _pos, ...rest } = parse(src).children[0] as unknown as Record<string, unknown>
  return rest
}
const findings = (src: string): string[] => parseWithDiagnostics(src).diagnostics.map((finding) => finding.code)

describe('C2-B-119/122/196: a sigil starts a sigil div also when further words are glued to it', () => {
  const SIGILS: [string, string][] = [['>', 'block_quote'], ['|', 'line_block'], ['\\', 'div']]
  const TAILS = ['a', '#', '>', '|', '\\', '{.x}', '{', '"t"', '[l]', ')', '*', 'x y', '%% c', '\ta']

  it('C2-B-119: every sigil with every kind of glued tail opens its sigil div', () => {
    for (const [sigil, type] of SIGILS) {
      for (const tail of TAILS) {
        const src = `::: ${sigil}${tail}\nq\n:::\n`
        expect(first(src)).toMatchObject({ type })
        expect(findings(src)).toEqual(['fence-title-syntax'])
      }
    }
    expect(first('::: \\a\nq\n:::\n')).toMatchObject({ type: 'div', attrs: { classes: ['hardbreaks'] } })
  })

  it('C2-B-122: a sigil div takes no title and no label, so both are further words and reported', () => {
    for (const [sigil, type] of SIGILS) {
      for (const rest of [' "T"', ' [l]', ' "T" [l]', ' w', '  w']) {
        const src = `::: ${sigil}${rest}\nq\n:::\n`
        expect(first(src)).toMatchObject({ type })
        expect(first(src)).not.toHaveProperty('title')
        expect(first(src)).not.toHaveProperty('groupLabel')
        expect(findings(src)).toEqual(['fence-title-syntax'])
      }
      expect(findings(`::: ${sigil}\nq\n:::\n`)).toEqual([])
      expect(findings(`::: ${sigil}  \nq\n:::\n`)).toEqual([])
    }
  })

  it('C2-B-119: Example 240, `::: >a` opens a quote fence and `::: *` an anonymous div', () => {
    expect(render('::: >a\nx\n:::\n\n::: *\ny\n:::')).toBe('<blockquote><p>x</p></blockquote>\n<div>\n  <p>y</p>\n</div>')
    expect(render('::: |#')).toBe('<div class="line-block">\n\n</div>')
  })

  it('C2-B-196: a sigil glued to the run is still text, and a line with further words never closes a div', () => {
    expect(first(':::>a\n')).toMatchObject({ type: 'paragraph' })
    expect(render('::: x\n::: |a\n:::\nb\n:::\n')).toBe('<div class="x">\n  <div class="line-block">\n\n  </div>\n  <p>b</p>\n</div>')
  })
})
