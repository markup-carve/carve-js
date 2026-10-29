import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 3 guard note and PART 9 E2/E3: an attribute block behind a pair that
// does not form is text, so a closer inside it stays reachable.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a blocked guard leaves its child attribute block content', () => {
  it('closes an outer bare span inside the block of a guard that closes only there', () => {
    expect(html('=a _*a*{t="_"}')).toBe('<p><mark>a _*a*{t</mark>”_”}</p>')
    expect(html('=a _~a~{t="_"} b=')).toBe('<p><mark>a _~a~{t</mark>”_”} b=</p>')
    expect(html('=a _/a/{t="_"} d*')).toBe('<p><mark>a _/a/{t</mark>”_”} d*</p>')
    expect(html('=*a*{t="q"} _~a~{t="_"}')).toBe('<p><mark><strong t="q">a</strong> _~a~{t</mark>”_”}</p>')
  })

  it('keeps the block attached when the guard closes past it', () => {
    expect(html('=a _*a*{t="q"} c_')).toBe('<p>=a <u><strong t="q">a</strong> c</u></p>')
    expect(html('_*a*{t="_"}')).toBe('<p><u><strong>a</strong>{t=“</u>”}</p>')
  })

  it('closes a braced span inside the block of a bare pair of its own kind', () => {
    expect(html('{_x _a_{t=a_} b_}')).toBe('<p><u>x _a_{t=a</u> b_}</p>')
    expect(html('{*x *a*{t=a*} b*}')).toBe('<p><strong>x *a*{t=a</strong> b*}</p>')
  })

  it('closes a braced span inside the block of a pair whose guard does not open', () => {
    expect(html('{*x /_a_{t=a*} b*}')).toBe('<p><strong>x /_a_{t=a</strong> b*}</p>')
    expect(html('{*x _/a/{t=a*}*}')).toBe('<p><strong>x _/a/{t=a</strong>*}</p>')
    expect(html('{_x _*a*{t=a_} b_}')).toBe('<p><u>x _*a*{t=a</u> b_}</p>')
    expect(html('{=x /_a_{t=a=} b=}')).toBe('<p><mark>x /_a_{t=a</mark> b=}</p>')
  })

  it('reads a guard closer only where the braced span can reach it', () => {
    expect(html('{*x _/a/{t=a*} `_` b*}')).toBe('<p><strong>x _/a/{t=a</strong> <code>_</code> b*}</p>')
    expect(html('{*x _/a/{t=a*} \\_ b*}')).toBe('<p><strong>x _/a/{t=a</strong> _ b*}</p>')
    expect(html('{*x _/a/{t=a*} [a_](u) b*}')).toBe('<p><strong>x _/a/{t=a</strong> <a href="u">a_</a> b*}</p>')
    expect(html('{/x _*a*{t=a/} [a_] /} e_')).toBe('<p><em>x _*a*{t=a</em> [a_] /} e_</p>')
  })

  it('reads the block as text when its closer has no opener of its own in the span', () => {
    expect(html('_a {*x __a_{t="*}"} `_` *}')).toBe('<p>_a <strong>x __a_{t=“</strong>”} <code>_</code> *}</p>')
    expect(html('{*x _*a* ~a~~a~{t=*} c*}')).toBe('<p><strong>x _*a* <s>a</s>~a~{t=</strong> c*}</p>')
  })

  it('still hides the braced closer in the block of a pair that forms', () => {
    expect(html('{*x _a_{t=a*} b*}')).toBe('<p><strong>x <u t="a*">a</u> b</strong></p>')
    expect(html('{_x *a*{t=a_} b_}')).toBe('<p><u>x <strong t="a_">a</strong> b</u></p>')
  })
})
