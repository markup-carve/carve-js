import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A FENCE CLOSER INDENTED PAST ITS OPENER IS BODY TEXT, INSIDE A LIST ITEM TOO
 * (markup-carve/carve-js#1636).
 *
 * `fenceCloseRe` is anchored at column 0, so at document level a closer with any
 * leading indent is already kept as body. Inside a list item the body is
 * collected dedented by the item's content column and then re-based: the
 * over-indented closer - whose real opener is the item's LEAD line and so is not
 * in the collected block - was mistaken for a fresh opener, dedented to column 0
 * and closed there, losing the rest of the fence. carve-rs kept it as body all
 * along.
 */

const html = (s: string) => carveToHtml(s)
const bodyOf = (s: string): string => {
  const m = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html(s))
  return m ? m[1]! : '<<no code block>>'
}

describe('a fence closer past its opener is body in a list item', () => {
  it('keeps a closer one column past the opener as body [the reported doc]', () => {
    // The fence is unterminated and owns both lines; the closer prints as body.
    expect(bodyOf('- ``` x\n  code\n   ```\n')).toBe('code\n ```\n')
  })

  for (const [host, opener, pre] of [
    ['item1', 2, '- '],
    ['item2', 4, '- - '],
  ] as const) {
    const pad = (n: number) => ' '.repeat(n)
    describe(host, () => {
      for (const [name, fence, close] of [
        ['backtick', '``` x', '```'],
        ['tilde', '~~~ x', '~~~'],
        ['info-less', '```', '```'],
      ] as const) {
        for (const off of [1, 2, 3]) {
          it(`${name}: a closer +${off} past the opener stays body`, () => {
            const src = `${pre}${fence}\n${pad(opener)}code\n${pad(opener + off)}${close}\n`
            // The closer survives in the body, dedented by the opener column only.
            expect(bodyOf(src), html(src)).toContain(`${pad(off)}${close}`)
          })
        }

        it(`${name}: a closer AT the opener column still closes (control)`, () => {
          const src = `${pre}${fence}\n${pad(opener)}code\n${pad(opener)}${close}\n`
          expect(bodyOf(src), html(src)).toBe('code\n')
        })
      }
    })
  }

  it('does not disturb the document-level rule', () => {
    // Already correct; a closer past the opener at top level is body.
    expect(bodyOf('``` x\ncode\n ```\n')).toBe('code\n ```\n')
    // And a closer at the opener column closes.
    expect(bodyOf('``` x\ncode\n```\n')).toBe('code\n')
  })
})
