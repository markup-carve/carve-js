import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { parse } from '../src/parse.js'

/*
 * A term keeps each continuation line's indent, so a fence folded into a term
 * becomes a code span whose lines start with whitespace. The writer spells it
 * in the term instead of refusing it (markup-carve/carve#2411).
 */
describe('a code span folded into a term formats', () => {
  it.each([
    [':: c\n  ```\n  code\n  ```\n', ':: c\n  `\n  code\n  `\n'],
    [':: a\n: b\n  :: c\n    ```\n    code\n    ```\n', ':: a\n: b\n\n  :: c\n    `\n    code\n    `\n'],
    ['- item\n\n  :: c\n    ```\n    code\n    ```\n', '- item\n  :: c\n    `\n    code\n    `\n'],
  ])('%j', (source, formatted) => {
    const once = renderCarve(parse(source))
    expect(once).toBe(formatted)
    expect(carveToHtml(once)).toBe(carveToHtml(source))
    expect(renderCarve(parse(once))).toBe(once)
  })

  it('still refuses the same value in a paragraph', () => {
    const doc = parse('`x`\n')
    const code = (doc.children[0] as { children: { type: string; value: string }[] }).children[0]!
    code.value = '\n  x\n'
    expect(() => renderCarve(doc)).toThrow(/starts with whitespace/)
  })
})
