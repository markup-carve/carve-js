import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  '10. a. :: t\n   : a\n   :: sibling\n   tail\n',
  '100. a. :: t\n    : a\n    :: sibling\n    tail\n',
  '> 10. a. :: t\n>    : a\n>    :: sibling\n>    tail\n',
])('keeps a lazily admitted marker in its open term: %j', (source) => {
  const html = carveToHtml(source)
  expect(html.match(/<dt>/g)).toHaveLength(1)
  expect(html).toContain('<dt>t\n: a\n:: sibling\ntail</dt>')
})
