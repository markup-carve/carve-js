import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToCarve, carveToHtml } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/raised-colon-markers.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string }[]

describe('raised colon containers own their paragraph markers (carve#2474)', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      expect(carveToHtml(row.source)).toBe(row.html)
      expect(carveToHtml(carveToCarve(row.source))).toBe(row.html)
    })
  }
  const atColumnOne: Record<string, string> = {
    '- second': '<ul>\n  <li>head\n    <div>\n      <p>a</p>\n    </div>\n  </li>\n  <li>second</li>\n</ul>',
    '- [x] second': '<ul>\n  <li>head\n    <div>\n      <p>a</p>\n    </div>\n  </li>\n</ul>\n<ul class="task-list">\n  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="second"> second</li>\n</ul>',
  }
  for (const marker of ['- second', '1. second', '- [x] second']) {
    for (const column of [1, 2, 4, 6, 8]) {
      const opens = column === 1 ? atColumnOne[marker] : undefined
      it(`${marker} ${opens ? 'opens an item' : 'folds'} at column ${column}`, () => {
        const source = `- head\n\n      :::\n      a\n${' '.repeat(column)}${marker}\n`
        if (opens) expect(carveToHtml(source)).toBe(opens)
        else expect(carveToHtml(source)).toContain(`<p>a\n${marker}</p>`)
      })
    }
  }
})
