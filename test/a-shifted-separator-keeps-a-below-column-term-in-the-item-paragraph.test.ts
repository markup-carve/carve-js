import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  '- * :: t\n  : a\n :: sibling\n tail\n',
  '- 1. :: t\n  : a\n :: sibling\n tail\n',
  '10. * :: t\n    : a\n   :: sibling\n   tail\n',
])('opens a below-column term at the top level after a shifted separator: %j', (source) => {
  const html = carveToHtml(source)
  expect(html.match(/<dl>/g)).toHaveLength(2)
  expect(html).toMatch(/<\/[ou]l>\n<dl>\n  <dt>sibling\ntail<\/dt>/)
})

it.each([
  '- * :: t\n  : a\n   - sibling\n   tail\n',
  '- 1. :: t\n  : a\n    1. sibling\n    tail\n',
])('opens a list marker at the surviving item after a shifted separator: %j', (source) => {
  const html = carveToHtml(source)
  expect(html).toContain('<li>sibling\ntail</li>')
  expect(html).toContain(': a\n')
})

it('leaves the term open when another nested item still owns the separator', () => {
  const html = carveToHtml('- * a.  :: t\n  : a\n   - sibling\n   tail\n')
  expect(html).toContain('<dt>t\n: a</dt>')
  expect(html).toContain('<li>sibling\ntail</li>')
})

it('ends a deeper item at a below-column term marker', () => {
  const html = carveToHtml('- * a.  :: t\n  : a\n :: sibling\n tail\n')
  expect(html).toContain('<dt>t\n: a</dt>')
  expect(html.match(/<dl>/g)).toHaveLength(2)
})

it('opens a later term at the surviving nested item column', () => {
  const html = carveToHtml('- * a.  :: t\n  : a\n    :: sibling\n    tail\n')
  expect(html).toContain('<dt>t\n: a</dt>')
  expect(html).toContain('<dt>sibling\ntail</dt>')
  expect(html.match(/<dl>/g)).toHaveLength(2)
})
