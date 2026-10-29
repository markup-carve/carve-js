import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  '10. a. :: t\n   : a\n   :: sibling\n   tail\n',
  '100. a. :: t\n    : a\n    :: sibling\n    tail\n',
  '> 10. a. :: t\n>    : a\n>    :: sibling\n>    tail\n',
])('closes the open term at a sibling marker: %j', (source) => {
  const html = carveToHtml(source)
  expect(html.match(/<dt>/g)).toHaveLength(2)
  expect(html).toContain('<dt>t\n: a</dt>')
  expect(html).toContain('<dt>sibling\ntail</dt>')
})
