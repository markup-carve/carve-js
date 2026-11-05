import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { parse, renderHTML } from '@djot/djot'

// carve#5197: djot.js charges a blank read inside a nested list to that list,
// so the outer item stays tight and the import must not loosen it.
it('drops the blank before a block that ends the nested item', () => {
  expect(djotToCarve('- one\n\n  - two\n\n  > q\n')).toBe('- one\n  - two\n  > q\n')
  expect(djotToCarve('- one\n\n  - two\n\n  ```\n  c\n  ```\n')).toBe('- one\n  - two\n  ```\n  c\n  ```\n')
  expect(djotToCarve('- one\n\n  - two\n\n  # h\n')).toBe('- one\n  - two\n  # h\n')
})

it('attaches a paragraph after the nested list with a +', () => {
  expect(djotToCarve('- one\n\n  - two\n\n  para\n')).toBe('- one\n  - two\n+\npara\n')
  expect(djotToCarve('> - one\n>\n>   - two\n>\n>   para\n')).toBe('> - one\n>   - two\n> +\n> para\n')
  expect(djotToCarve('- a\n- one\n\n  - two\n\n  para\n  more\n')).toBe('- a\n- one\n  - two\n+\npara\n  more\n')
})

it('reads a pipe-led or brace-led paragraph as a paragraph', () => {
  for (const line of ['| not a table', '{not attributes']) {
    const djot = `- one\n\n  - two\n\n  ${line}\n`
    expect(carveToHtml(djotToCarve(djot)).replace(/\s+/g, '')).toMatch(/<\/ul><p>|<\/ul>[^<]/)
  }
})

it('keeps a blank the item owns', () => {
  expect(djotToCarve('- one\n\n  > q\n')).toBe('- one\n\n  > q\n')
  expect(djotToCarve('- one\n\n  - two\n\n  para\n\n  more\n')).toBe('- one\n  - two\n\n  para\n\n  more\n')
  expect(djotToCarve('- one\n\n- b\n\n  - two\n\n  para\n')).toBe('- one\n\n- b\n  - two\n\n  para\n')
})

it('renders the tightness djot.js renders', () => {
  const shapes = ['  > q', '  para', '  ```\n  c\n  ```', '  # h', '  ***', '  para\n  more']
  for (const prefix of ['', '> ']) {
    for (const after of shapes) {
      for (const sub of ['  - two', '  - two\n  - three', '  - two\n    - deep', '  - two\n\n    more']) {
        let djot = `- one\n\n${sub}\n\n${after}\n`
        if (prefix) djot = djot.split('\n').map((line) => line === '' ? '>' : prefix + line).join('\n').replace(/>$/, '')
        const leads = (html: string) => [...html.replace(/\s+/g, '').matchAll(/<li>(<p>)?/g)].map((m) => m[1] ? 'p' : '-').join('')
        expect(leads(carveToHtml(djotToCarve(djot))), djot).toBe(leads(renderHTML(parse(djot))))
      }
    }
  }
})
