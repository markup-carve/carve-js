import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

for (const marker of ['- x', '* x', '1. x', '1) x', 'a. x', 'I. x', '. .']) {
  for (const prefix of ['', 'a ']) {
    it(`writes ${marker} bare inside a continued code span after ${JSON.stringify(prefix)}`, () => {
      const source = `${prefix}\`b\n${marker}\`\n`
      expect(carveToCarve(source)).toBe(source)
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })
  }
}

it('closes an unclosed span without padding its list continuation', () => {
  expect(carveToCarve('`\n1. x\n')).toBe('`\n1. x`\n')
})

it('keeps a quote guard that the reader needs', () => {
  const source = '`a\n > x`\n'
  expect(carveToCarve(source)).toBe(source)
  expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
})

it('leaves a list marker bare in ordinary paragraph continuation', () => {
  expect(carveToCarve('a\n1. x\n')).toBe('a\n1. x\n')
})

for (const marker of ['- x', '* x', '1. x', 'a) x', 'I. x', '- [ ] x']) {
  for (const quote of ['', '> ']) for (const blank of ['', '\n']) {
    it(`keeps the guard needed by an item code span: ${JSON.stringify({ marker, quote, blank })}`, () => {
      const source = `${quote}- lead${blank}\n${quote}  a \`b\n${quote} ${marker}\`\n`
      const written = carveToCarve(source)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(carveToCarve(written)).toBe(written)
    })
  }
}

it('does not pad a list continuation in a quote paragraph inside an item', () => {
  const source = '- > a `b\n  > 1. x`\n'
  expect(carveToCarve(source)).toBe(source)
})
