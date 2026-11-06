import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const folded = (open: string, close: string, indent: string) =>
  `${open}<div class="line-block">\n${indent}  <p>x</p>\n${indent}  <p>y<br>\nb</p>\n${indent}</div>\n${close}`

it('folds a lazy line after a span into the second stanza of a quoted description (carve#5272)', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>\n>   y\n>   %%%\nb\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>\n' +
      folded('      ', '    </dd>\n  </dl>\n</blockquote>', '      '),
  )
})

it('folds it after a closed span too', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>\n>   y\n>   %%%\n>   h\n>   %%%\nb\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>\n' +
      folded('      ', '    </dd>\n  </dl>\n</blockquote>', '      '),
  )
})

it('folds it in a quoted list item', () => {
  expect(carveToHtml('> - ::: |\n>   x\n>\n>   y\n>   %%%\nb\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>\n' + folded('      ', '    </li>\n  </ul>\n</blockquote>', '      '),
  )
})

it('still ends the line block at a nonblank line below its column after the break', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>\n> z\n')).toContain('</dl>\n  <p>z</p>\n</blockquote>')
})
