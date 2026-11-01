import { describe, it, expect } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { spellEmptyItemPlaceholders } from '../src/import/empty-item-placeholder.js'

// carve#4639 ruling B, carve#4724: a lead that renders nothing separates no visible blocks (§17 L1a, L1b).
describe('a blank after an invisible item lead', () => {
  it.each([
    ['a comment lead', '- %% c\n\n  Body.\n- x\n', '<ul>\n  <li>Body.</li>\n  <li>x</li>\n</ul>'],
    ['a reference definition lead', '- [r]: /u\n\n  Body.\n- x\n', '<ul>\n  <li>Body.</li>\n  <li>x</li>\n</ul>'],
    ['an empty reference definition lead', '- [1]:\n\n  q\n', '<ul>\n  <li>q</li>\n</ul>'],
    ['a one-line note lead', '- [^n]: note\n\n  Body.\n- x\n', '<ul>\n  <li>Body.</li>\n  <li>x</li>\n</ul>'],
    ['a task comment lead', '- [ ] %% c\n\n  Body.\n- [ ] x\n',
      '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="Body."> Body.</li>\n  <li><input type="checkbox" disabled aria-label="x"> x</li>\n</ul>'],
    ['a comment span lead', '1. %%% x %%%\n\n   Body.\n2. x\n', '<ol>\n  <li>Body.</li>\n  <li>x</li>\n</ol>'],
  ])('keeps the list tight: %s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['a plus lead', '- +\n\n  Body.\n- x\n'],
    ['a visible lead', '- a\n\n  Body.\n- x\n'],
  ])('still loosens: %s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<p>Body.</p>')
  })

  it('a djot empty task item over a blank keeps its loose list through {loose}', () => {
    const carve = djotToCarve('- [ ] {.c}\n\n  para')
    expect(carve).toBe('{loose}\n- [ ] %%\n\n  para')
    expect(carveToHtml(carve)).toContain('<p>para</p>')
  })

  it.each([
    ['the same list', '- a\n- +\n\n  para', '{loose}\n- a\n- %%\n\n  para'],
    ['another bullet', '- a\n* +\n\n  para', '- a\n\n{loose}\n* %%\n\n  para'],
    ['another numbering', '1. a\na. +\n\n   para', '1. a\n\n{loose}\na. %%\n\n   para'],
    ['a nested list', '- o\n\n  - a\n  - +\n\n    para', '- o\n\n  {loose}\n  - a\n  - %%\n\n    para'],
  ])('the empty-item speller puts {loose} on its own list: %s', (_name, source, carve) => {
    expect(spellEmptyItemPlaceholders(source)).toBe(carve)
  })
})
