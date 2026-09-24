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

// markup-carve/carve-js#1951: the same holds for a sub-list that FOLLOWS a
// sibling sub-list in the item; its own content column decides, not the first's.
describe('a blank line inside a sibling sub-list does not loosen the outer list', () => {
  it('a blank inside a fence in the second sub-list', () => {
    expect(carveToHtml('- e\n  1. x\n  * ```\n\n    ```\n')).toBe(
      '<ul>\n  <li>e\n    <ol>\n      <li>x</li>\n    </ol>\n    <ul>\n      <li>\n        <pre><code>\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it.each([
    ['a tilde fence', '- e\n  1. x\n  * ~~~\n\n    ~~~\n'],
    ['a fence with body lines', '- e\n  1. x\n  * ```\n    a\n\n    b\n    ```\n'],
    ['an unclosed fence', '- e\n  1. x\n  * ```\n\n    code\n'],
    ['a fence in a quote', '- e\n  1. x\n  * > ```\n    >\n    > c\n    > ```\n'],
    ['a third sub-list', '- e\n  1. x\n  * y\n  1. ```\n\n     ```\n'],
    ['a second paragraph of the sibling sub-item', '- e\n  1. x\n  * y\n\n    z\n'],
    ['a folded marker below the sub-item column', '- e\n  1. x\n    * y\n\n     z\n'],
  ])('%s keeps the outer item tight', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li>e\n/)
  })

  it('three levels deep keeps the middle item tight', () => {
    expect(carveToHtml('- e\n  - f\n    1. x\n    * ```\n\n      ```\n')).toContain('<li>f\n')
  })

  it('a sibling after a marker lead keeps the next outer item tight', () => {
    expect(carveToHtml('- 1. x\n  * ```\n\n    ```\n- g\n')).toContain('<li>g</li>')
  })

  it('the sibling sub-item still reads its own second paragraph loose', () => {
    expect(carveToHtml('- e\n  1. x\n  * y\n\n    z\n')).toContain('<li><p>y</p>\n        <p>z</p>')
  })

  it("the outer item's own second paragraph still loosens it", () => {
    expect(carveToHtml('- e\n  1. x\n  * y\n\n  text\n')).toMatch(/^<ul>\n {2}<li><p>e<\/p>\n/)
  })

  it('a blank between the outer items still loosens the list', () => {
    expect(carveToHtml('- e\n  1. x\n  * y\n\n- f\n')).toMatch(/^<ul>\n {2}<li><p>e<\/p>\n/)
  })
})
