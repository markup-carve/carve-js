import { expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

it('derives backlink names separately for each index entry', () => {
  const source = '<ul class="index"><li>first <a class="index-backref" href="#idx-first-1" aria-label="Back to first 1">x</a> <a class="index-backref" href="#idx-first-2" aria-label="authored">y</a></li><li>second <a class="index-backref" href="#idx-second-1" aria-label="Back to second">z</a></li></ul>'
  const output = htmlToCarve(source).value
  expect(output).toContain('aria-label=authored')
  expect(output).not.toContain('Back to first')
  expect(output).not.toContain('Back to second')
})

perfIt('derives short backlink labels beside a long term near linearly', () => {
  expectBuiltInputScansLinearly(source => { htmlToAst(source) },
    n => '<ul class="index"><li>' + 't'.repeat(n) + ' '
      + Array.from({ length: n }, (_, i) => `<a class="index-backref" href="#idx-term-${i + 1}" aria-label="x">x</a> `).join('')
      + '</li></ul>',
    { smallRepeats: 1024, label: 'index backlink names' })
})
