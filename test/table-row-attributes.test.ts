import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string, o = {}) => carveToHtml(s, o)

describe('table row attributes ({...} glued to the closing pipe)', () => {
  it('applies a class to the <tr>', () => {
    expect(h('| a | b |{.x}')).toBe(
      '<table>\n  <tbody>\n    <tr class="x"><td>a</td><td>b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('applies id and key=value', () => {
    expect(h('| a |{#r1 data-k=v}')).toBe(
      '<table>\n  <tbody>\n    <tr id="r1" data-k="v"><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('applies to a header row and composes with the GFM separator', () => {
    expect(h('| H |{.hd}\n|---|\n| c |{.bd}')).toBe(
      '<table>\n  <thead><tr class="hd"><th>H</th></tr></thead>\n  <tbody>\n    <tr class="bd"><td>c</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('composes with a cell attribute block (opening vs closing pipe)', () => {
    expect(h('|{.c} a |{.r}')).toBe(
      '<table>\n  <tbody>\n    <tr class="r"><td class="c">a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('requires the brace glued to the closing pipe (a space before it is content)', () => {
    expect(h('| a | {.x}')).toBe('<p>| a | {.x}</p>')
  })

  it('an empty or invalid payload is not a row attribute (so the line is not a table)', () => {
    // The trailing brace must be a valid attribute block to open the table;
    // otherwise the line stays paragraph text (it does not end with a pipe).
    expect(h('| a |{}')).toBe('<p>| a |{}</p>')
    expect(h('| a |{1bad}')).toBe('<p>| a |{1bad}</p>')
  })
})
