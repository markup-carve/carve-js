import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

it('keeps a bare CommonMark reference head as paragraph text', () => {
  const converted = markdownToCarve('[foo]:\n\n[foo]\n')
  expect(converted).toBe('\\[foo]:\n\n[foo]\n')
  expect(carveToHtml(converted).trim()).toBe('<p>[foo]:</p>\n<p>[foo]</p>')
})

it('lets a later definition resolve the link in a bare reference head', () => {
  const converted = markdownToCarve('[x]:\n\n[x]: /v\n\n[x]\n')
  expect(carveToHtml(converted).trim()).toBe('<p><a href="/v">x</a>:</p>\n<p><a href="/v">x</a></p>')
})

it('does not call a resolved empty reference unresolved', () => {
  for (const source of ['[r]:\n\n[x][r]\n', '[r]:   \n\n[x][r]\n']) {
    expect(lintCarve(source).map(warning => warning.rule)).toEqual(['empty-reference-definition'])
  }
})
