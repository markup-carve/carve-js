import { expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

it('reads escaped quotes in a block image title and keeps them through formatting', () => {
  const source = '![a](/u "x\\\"y")'
  expect(carveToHtml(source)).toContain('title="x&quot;y"')
  expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
})

it('does not treat an escaped closing title quote as the end of a block image', () => {
  const source = '![a](/u "x\\")'
  expect(carveToHtml(source)).not.toContain('<img')
  expect(carveToHtml('before ' + source)).not.toContain('<img')
})
