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
  expect(html).not.toContain('<dd>a</dd>')
  expect(html).toMatch(/<\/dl>\n<\/li>\n<\/ol>\n: a|<\/dl>\n<\/li>\n<\/ul>\n: a/)
  expect(html).toContain('<li>b</li>')
})

// A term is one line (carve#4861), so such a separator is text after it.
it('reads separators between the marker and content columns as text after the term', () => {
  expect(compact('1. 1. :: t\n    : a\n')).toContain('<dt>t</dt>')
  expect(compact('- - 1. :: t\n     : a\n')).toContain('<dt>t</dt>')
  expect(compact('1. 1. :: t\n    : a\n')).not.toContain('<dd>')
})
