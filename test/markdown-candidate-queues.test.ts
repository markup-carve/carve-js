import { expect, it } from 'vitest'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'
import { markdownToCarve, carveToHtml, parse, htmlToAst } from '../src/index.js'

it('drops trailing empty quote lines without changing quote order', () => {
  const source = '> alpha\n>\n\n> beta\n>\n\n> gamma\n>\n'
  const converted = markdownToCarve(source)
  expect(converted).toBe('> alpha\n\n> beta\n\n> gamma\n')
})

it('keeps a fence below a child column after a long paragraph', () => {
  const source = '- x\n  - head\n' + '     line\n'.repeat(1024) + '\n   ```\n   body\n   ```\n'
  const document = parse(source)
  const list = document.children[0]
  expect(list?.type).toBe('list')
  if (list?.type !== 'list') throw new Error('Expected an outer list')
  expect(list.items[0]!.children.map(node => node.type)).toEqual(['paragraph', 'list', 'code_block'])
  expect(carveToHtml(source)).toContain('<pre><code>body\n</code></pre>')
})

perfIt('drains parent block candidates in near linear time', () => {
  expectBuiltInputScansLinearly(source => { parse(source) },
    n => '- x\n  - head\n' + '     line\n'.repeat(n) + '\n   ```\n   body\n   ```\n',
    { smallRepeats: 32768, label: 'parent block candidate drain' })
})

it('keeps a quote-shaped code line while dropping other trailing candidates', () => {
  const source = '```\n> sample\n>\n```\n\n> alpha\n>\n\n> beta\n>\n'
  expect(markdownToCarve(source)).toBe('```\n> sample\n>\n```\n\n> alpha\n\n> beta\n')
})

perfIt('scans whitespace around obsolete ruby annotation containers near linearly', () => {
  expectBuiltInputScansLinearly(source => { htmlToAst(source) },
    n => '<ruby>x<rt>a</rt>' + ' <rtc></rtc>'.repeat(n) + '</ruby>',
    { smallRepeats: 2048, label: 'ruby whitespace lookahead' })
})
