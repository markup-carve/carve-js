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

it('requires a space or line ending after quote markers at reference boundaries', () => {
  for (const head of ['># heading', '>***', '>{.c}', '>:::']) {
    const source = `${head}\n[r]: /a\`b`
    expect(maskDjotOpaque(source, false)).toBe(source)
  }
  for (const head of ['> # heading', '> ***', '> {.c}', '> :::', '>']) {
    const source = `${head}\n[r]: /a\`b`
    expect(maskDjotOpaque(source, false)).toBe(source.replace('/a`b', '    '))
  }
})

it('keeps empty item boundaries and list-hosted block boundaries opaque', () => {
  for (const head of ['- ', '1. ', ': ', '- [ ] ', '- # H', '- [a]: /x', '- {.c}', '- :::']) {
    const source = head + '\n[r]: /a`b\n[s]: /c`d'
    expect(maskDjotOpaque(source, false)).toBe(source.replace('/a`b', '    ').replace('/c`d', '    ').replace('/x', '  '))
  }
})

it('keeps code delimiters in separate paragraphs after a definition', () => {
  const source = '[r]: /x\n\na `b\n\nc` d'
  expect(maskDjotOpaque(source, false)).toBe(source.replace('/x', '  '))
})
