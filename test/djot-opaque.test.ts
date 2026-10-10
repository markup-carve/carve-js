import { expect, it } from 'vitest'
import { maskDjotOpaque } from '../src/djot-opaque.js'
import { carveToHtml, djotToCarve } from '../src/index.js'

it('keeps repeated unfinished comments literal', () => {
  const source = '{% '.repeat(8192)
  expect(maskDjotOpaque(source, true)).toBe(source)
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(`<p>${source.trimEnd()}</p>`)
})

it('observes only accepted destinations', () => {
  const source = '[a](u) [b](unfinished'
  const ranges: number[][] = []
  maskDjotOpaque(source, true, { onDestination: (start, end) => { ranges.push([start, end]) } })
  expect(ranges).toEqual([[3, 6]])
})


it('keeps repeated inline pseudo-definitions literal', () => {
  const source = '[] [a]: '.repeat(8192)
  expect(maskDjotOpaque(source, true)).toBe(source)
  expect(maskDjotOpaque('[a]: u\n[b]: v', true)).toBe('[a]:  \n[b]:  ')
})


it('bounds raw-format suffixes at the next newline or closer', () => {
  const source = '`a`{='.repeat(8192)
  expect(maskDjotOpaque(source, true)).toBe('   {='.repeat(8192))
  expect(maskDjotOpaque(source + '\n}', true)).toBe('   {='.repeat(8192) + '\n}')
  expect(maskDjotOpaque('`a`{=html}', true, { code: false })).toBe('   {=html}')
})
