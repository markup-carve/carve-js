import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('an open nested footnote takes the item paragraph follower', () => {
  const source = '* k\n  . d\n     [^n]: e\n      q\ne\n'
  expect(carveToHtml(source)).toBe("<ul>\n  <li>k\n    <ol>\n      <li>d</li>\n    </ol>\n  </li>\n</ul>")
})

it('an open nested footnote takes an inline code follower', () => {
  const source = '* [ ] task\n  1. ordered\n    - a\n      [^n]: note\n       q  \n```\ncode\n       ```\n'
  expect(carveToHtml(source)).toBe("<ul class=\"task-list\">\n  <li><input type=\"checkbox\" disabled aria-label=\"task\"> task\n    <ol>\n      <li>ordered\n- a</li>\n    </ol>\n  </li>\n</ul>")
})

it('does not restore the item paragraph while its nested note stays open', () => {
  const source = '- a\n   [^n]: note\n    - a\n      [^n]: note\n     q  \n* [x] done\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>a\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n<ul class="task-list">\n  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="done"> done</li>\n</ul>')
})

it('returns that follower to the parent when its earlier note missed the parent content column', () => {
  const source = '- a\n [^n]: note\n    - a\n      [^n]: note\n     q  \n* [x] done\n'
  expect(carveToHtml(source)).toContain('<ul>\n      <li>a</li>\n    </ul>\n    q')
})

// The note's open paragraph takes both lines lazily (carve#3885).
it('folds a plus below a note in an item into the note', () => {
  const source = '- a\n  [^n]: note\n +\ntext\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>a</li>\n</ul>')
})
