import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a definition-shaped lazy follower in a nested verse (carve#5299)', () => {
  expect(carveToHtml('- a\n  - b\n    :: t\n    : ::: |\n      v\n      %%%\n : d\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n          <dt>t</dt>\n          <dd>\n            <div class="line-block">\n              <p>v<br>\n: d</p>\n            </div>\n          </dd>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('does not grant verse ownership to a termless description-shaped line (#4558)', () => {
  expect(carveToHtml('- a\n  - b\n    : ::: |\n      v\n      %%%\n x\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n: ::: |\nv</li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
  )
})

it('does not let a termless description span swallow the next document line', () => {
  expect(carveToHtml('- b\n  : ::: |\n    v\n    %%%\nx\n')).toBe(
    '<ul>\n  <li>b\n: ::: |\nv</li>\n</ul>\n<p>x</p>',
  )
})

it('does not retain an outside line in an ancestor after hidden payload (#4559)', () => {
  expect(carveToHtml('- a\n  - b\n    : ::: |\n      v\n      %%%\n      hidden\nx\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n: ::: |\nv</li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
  )
})

it('keeps a plain follower at the outer marker inside the nested verse', () => {
  expect(carveToHtml('- a\n  - b\n    :: t\n    : ::: |\n      v\n      %%%\n    %% c\nx\n')).toContain('<p>v<br>\nx</p>')
  expect(carveToHtml('- a\n  - b\n    ::: |\n      v\n      %%%\n    %% c\nx\n')).toContain('<p>&nbsp;&nbsp;v<br>\nx</p>')
})

it('keeps a valid bare verse owner in a nested item', () => {
  expect(carveToHtml('- a\n  - b\n    ::: |\n      v\n      %%%\n x\n')).toContain('<p>&nbsp;&nbsp;v<br>\nx</p>')
})

it('lets an ancestor item read a definition-shaped line at its content column', () => {
  expect(carveToHtml('- a\n  - b\n    :: t\n    : ::: |\n      v\n      %%%\n  : d\n')).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n          <dt>t</dt>\n          <dd>\n            <div class="line-block">\n              <p>v</p>\n            </div>\n          </dd>\n        </dl>\n      </li>\n    </ul>\n    : d\n  </li>\n</ul>',
  )
})
