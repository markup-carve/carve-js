import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#1938, PART 9 §17 L1: a blank line the item's sub-list
// consumes is the sub-list's, also when that sub-list is the item's lead
// (`- 1. ...`), so it cannot loosen the outer list.
describe('a blank line inside a lead sub-list does not loosen the outer list', () => {
  it('a blank inside a fence in a nested ordered item', () => {
    expect(carveToHtml('- a\n- 1. ```\n\n     code\n     ```\n')).toBe(
      '<ul>\n  <li>a</li>\n  <li>\n    <ol>\n      <li>\n        <pre><code>\ncode\n</code></pre>\n      </li>\n    </ol>\n  </li>\n</ul>',
    )
  })

  it.each([
    ['a tilde fence', '- a\n- 1. ~~~\n\n     code\n     ~~~\n'],
    ['a bullet lead', '- a\n- - ```\n\n    code\n    ```\n'],
    ['a task lead', '- a\n- - [ ] ```\n\n    code\n    ```\n'],
    ['three levels', '- a\n- - - ```\n\n      code\n      ```\n'],
    ['a fence after the lead text', '- a\n- 1. x\n     ```\n     c\n\n     d\n     ```\n'],
    ['an unclosed fence', '- a\n- 1. ```\n\n     code\n'],
    ['a fence in a quote', '- a\n- 1. > ```\n     >\n     > code\n     > ```\n'],
    ['a second paragraph of the inner item', '- a\n- - b\n\n    c\n'],
  ])('%s keeps the outer item tight', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li>a<\/li>\n/)
  })

  it('the inner item still reads its own second paragraph loose', () => {
    expect(carveToHtml('- a\n- - b\n\n    c\n')).toContain('<li><p>b</p>\n        <p>c</p>')
  })

  it("the outer item's own second paragraph still loosens it (L1a)", () => {
    expect(carveToHtml('- a\n- - b\n\n  text\n')).toMatch(/^<ul>\n {2}<li><p>a<\/p><\/li>\n/)
  })

  it('a blank between the outer items still loosens the list', () => {
    expect(carveToHtml('- a\n\n- 1. ```\n     code\n     ```\n')).toMatch(/^<ul>\n {2}<li><p>a<\/p><\/li>\n/)
  })

  it('a fence directly in the item was already tight', () => {
    expect(carveToHtml('- a\n- ```\n\n  code\n  ```\n')).toMatch(/^<ul>\n {2}<li>a<\/li>\n/)
  })
})
