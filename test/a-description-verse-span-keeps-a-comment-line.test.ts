import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a comment-shaped line in the verse span and folds the later lazy line (carve-js#4551)', () => {
  expect(carveToHtml(':: t\n: ::: |\n  x\n  %%%\n%% c\nmore\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <div class="line-block">\n      <p>x<br>\nmore</p>\n    </div>\n  </dd>\n</dl>',
  )
})

