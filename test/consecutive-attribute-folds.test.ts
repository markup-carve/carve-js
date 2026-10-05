import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { mergeAttrs } from '../src/attribute-merge.js'
import { buildBracketMap } from '../src/parse.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

function attributes(n: number): string {
  return Array.from({ length: n }, (_, i) => `{k${i}=x}`).join('')
}

it('keeps first slot order, last values and empty IDs across consecutive blocks', () => {
  const html = carveToHtml('[x]{a=old #first .a}{b=new a=last .a}{id=""}')
  expect(html).toContain('a="last" id="" class="a" b="new"')
})

it('does not mutate either input of the public merge function', () => {
  const a = { id: 'old', classes: ['a'], keyValues: { k: 'old' }, order: ['#id', '.class', 'k'] }
  const b = { id: '', classes: ['b'], keyValues: { k: 'new' } }
  const before = structuredClone([a, b])
  expect(mergeAttrs(a, b).classes).toEqual(['a', 'b'])
  expect([a, b]).toEqual(before)
})

it('folds a large run without losing keys or source positions', () => {
  const source = `[x]${attributes(2000)}`
  const doc = parse(source, { positions: true })
  const html = carveToHtml(source)
  expect(html).toContain('k1999="x"')
  expect(html.match(/k\d+="x"/g)).toHaveLength(2000)
  expect(doc).toMatchObject({
    children: [{ children: [{ pos: { startOffset: 0, endOffset: source.length } }] }],
  })
})

perfIt('folds distinct inline and block attributes with bounded per-byte cost', () => {
  for (const block of [false, true]) {
    expectScansLinearly((input) => {
      const attrs = attributes(input.length)
      void carveToHtml(block ? attrs.replaceAll('}{', '}\n{') + '\n\ntext' : `[x]${attrs}`)
    }, 'x', { label: block ? 'block attribute keys' : 'inline attribute keys', smallRepeats: 1024 })
  }
})

it('keeps closed comments opaque and unclosed comment openers literal in bracket maps', () => {
  for (const marker of ['%', '#']) {
    const source = `[a{${marker}]${marker}}b]`
    expect(buildBracketMap(source)(0)).toBe(source.length - 1)
    expect(buildBracketMap(`[a{${marker} b]`)(0)).toBe(6)
  }
})

perfIt('bounds missing comment closers during bracket indexing', () => {
  for (const marker of ['%', '#']) {
    expectScansLinearly((input) => void buildBracketMap(input), `[{${marker} a] `, {
      label: 'unclosed comments in bracket map', smallRepeats: 4096,
    })
  }
})

perfIt('bounds missing comment closers in the complete HTML pipeline', () => {
  expectScansLinearly((input) => void carveToHtml(input), '[{% a] ', {
    label: 'unclosed delimited comments', smallRepeats: 4096,
  })
})
