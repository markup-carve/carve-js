import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('a line leaving a nested footnote restores the item paragraph', () => {
  const source = '* k\n  . d\n     [^n]: e\n      q\ne\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>k\n    <ol>\n      <li>d\n        q\ne\n      </li>\n    </ol>\n  </li>\n</ul>')
})

it('a line leaving a nested footnote retains an inline code follower', () => {
  const source = '* [ ] task\n  1. ordered\n    - a\n      [^n]: note\n       q  \n```\ncode\n       ```\n'
  expect(carveToHtml(source)).toBe('<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="task"> task\n    <ol>\n      <li>ordered\n- a\n        q\n<code>\ncode\n</code>\n      </li>\n    </ol>\n  </li>\n</ul>')
})
