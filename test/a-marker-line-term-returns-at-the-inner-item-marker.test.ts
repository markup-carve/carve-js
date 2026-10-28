import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (source: string): string =>
  carveToHtml(source).trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it.each([
  ['ordered items', '1. 1. :: t\n   : a\n1. b\n'],
  ['bullet items', '- - :: t\n  : a\n- b\n'],
  ['quoted items', '> - - :: t\n>   : a\n> - b\n'],
])('returns a separator at the inner marker column to the outer item in %s', (_name, source) => {
  const html = compact(source)
  expect(html).toContain('<dt>t</dt>')
  expect(html).not.toContain('<dt>t\n: a</dt>')
  expect(html).not.toContain('<dd>a</dd>')
  expect(html).toMatch(/<\/dl>\n<\/li>\n<\/ol>\n: a|<\/dl>\n<\/li>\n<\/ul>\n: a/)
  expect(html).toContain('<li>b</li>')
})

it('keeps separators between the marker and content columns in the term', () => {
  expect(compact('1. 1. :: t\n    : a\n')).toContain('<dt>t\n: a</dt>')
  expect(compact('- - 1. :: t\n     : a\n')).toContain('<dt>t\n: a</dt>')
})
