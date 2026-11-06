import { expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

it('reads a note closer after an unclosed item comment span (carve#5298)', () => {
  const source = '::: note\n- i\n  %%%\n  x\n:::\n'
  expect(carveToHtml(source)).toBe(
    '<aside class="admonition note" aria-label="Note">\n  <ul>\n    <li>i</li>\n  </ul>\n</aside>',
  )
  expect(lintCarve(source, {}).map((finding) => finding.rule)).toEqual(['unclosed-comment-fence'])
})

it('keeps an exact item span closer in its host before the note closer', () => {
  const source = '::: note\n- a\n  1. %%%\n     n\n %%%\n:::\n'
  expect(carveToHtml(source)).toBe(
    '<aside class="admonition note" aria-label="Note">\n  <ul>\n    <li>a\n      <ol>\n        <li></li>\n      </ol>\n    </li>\n  </ul>\n</aside>',
  )
})
