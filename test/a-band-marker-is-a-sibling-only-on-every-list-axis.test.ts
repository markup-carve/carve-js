import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S4 with PART 9 §11 N1 (markup-carve/carve#4545): between an item's marker and
// content columns a marker is a sibling only when it matches the list on every axis.
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a band marker is a sibling only on every list axis', () => {
  it.each([
    ['- a\n - [ ] b\n', '<ul><li>a\n- [ ] b</li></ul>'],
    ['- [ ] a\n - b\n', '<ul class="task-list"><li><input type="checkbox" disabled aria-label="a - b"> a\n- b</li></ul>'],
    ['1. a\n a. b\n', '<ol><li>a\na. b</li></ol>'],
    ['1. a\n i. b\n', '<ol><li>a\ni. b</li></ol>'],
    ['a.  a\n 1. b\n', '<ol type="a"><li>a\n1. b</li></ol>'],
    ['a.  a\n A. b\n', '<ol type="a"><li>a\nA. b</li></ol>'],
    ['> - a\n>  - [ ] b\n', '<blockquote><ul><li>a\n- [ ] b</li></ul></blockquote>'],
  ])('%j folds', (source, html) => {
    expect(flat(carveToHtml(source))).toBe(html)
  })

  it.each([
    ['- a\n - b\n', '<ul><li>a</li><li>b</li></ul>'],
    ['1. a\n 2. b\n', '<ol><li>a</li><li>b</li></ol>'],
    ['i.  a\n ii.  b\n', '<ol type="i"><li>a</li><li>b</li></ol>'],
    ['- [ ] a\n - [x] b\n', '<ul class="task-list"><li><input type="checkbox" disabled aria-label="a"> a</li><li data-task-state="x"><input type="checkbox" checked disabled aria-label="b"> b</li></ul>'],
  ])('%j stays a sibling', (source, html) => {
    expect(flat(carveToHtml(source))).toBe(html)
  })

  it('opens a new list at the marker column', () => {
    expect(flat(carveToHtml('- a\n- [ ] b\n'))).toBe('<ul><li>a</li></ul><ul class="task-list"><li><input type="checkbox" disabled aria-label="b"> b</li></ul>')
  })
})
