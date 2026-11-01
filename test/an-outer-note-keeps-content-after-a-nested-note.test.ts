import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S2: leaving a nested note's column does not leave a parent note
// whose own content column the line still reaches.
it.each([
  ['a nested definition before a fence', '- [^a]: text\n    [^b]: inner\n    ~~~\n    one\n    ~~~'],
  ['a nested-definition spelling inside a fence', '- [^a]: text\n    ~~~\n    [^b]: inner\n    one\n    ~~~'],
])('keeps a second fence in the outer note after a blank: %s', (_label, prefix) => {
  const source = `${prefix}\n\n    ~~~\n    two\n    ~~~\n\nsee[^a]\n`
  const html = carveToHtml(source)
  expect(html).toContain('      <pre><code>two\n</code></pre>')
  expect(html).not.toContain('<li><p>~~~')
})

it('keeps the outer note body after an inner note and a blank run in an item', () => {
  const source = '1. [^outer]: intro\n\n     [^inner]: note\n \n     see[^inner]\n\n- see[^outer]\n'
  const html = carveToHtml(source)
  expect(html).toContain('<p>intro</p>\n      <p>see<a id="fnref2"')
  expect(html).toContain('<li id="fn2">\n      <p>note<a href="#fnref2"')
})
