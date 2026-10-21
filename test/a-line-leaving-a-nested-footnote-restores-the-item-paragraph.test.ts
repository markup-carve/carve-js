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

it('keeps a below-column follower in the nested item after its note ends', () => {
  const source = '- a\n   [^n]: note\n    - a\n      [^n]: note\n     q  \n* [x] done\n'
  expect(carveToHtml(source)).toContain('<ul>\n      <li>a\n        q\n      </li>\n    </ul>')
})

it('returns that follower to the parent when its earlier note missed the parent content column', () => {
  const source = '- a\n [^n]: note\n    - a\n      [^n]: note\n     q  \n* [x] done\n'
  expect(carveToHtml(source)).toContain('<ul>\n      <li>a</li>\n    </ul>\n    q')
})

it('ends the item before a plus below a top-level note', () => {
  const source = '- a\n  [^n]: note\n +\ntext\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>+\ntext</p>')
})
