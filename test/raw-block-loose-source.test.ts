import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it('uses existing blank lines to preserve a loose item around a raw block', () => {
  const source = '- a\n\n  ```=latex\n  \\x\n  ```\n\n  c\n'
  const formatted = carveToCarve(source)
  expect(formatted).toBe(source)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})

it('preserves the same blank-line spelling inside a quote', () => {
  const source = '> - a\n>\n>   ```=latex\n>   \\x\n>   ```\n>\n>   c\n'
  const formatted = carveToCarve(source)
  expect(formatted).not.toContain('{loose}')
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})

it('retains explicit looseness when blank lines belong only to the raw payload', () => {
  const source = '{loose}\n- ```=latex\n  a\n\n  b\n  ```\n'
  const formatted = carveToCarve(source)
  expect(formatted).toContain('{loose}')
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})

it('restores fences when authored text occupies the private-use marker range', () => {
  const occupied = Array.from({ length: 0x1900 }, (_, index) => String.fromCharCode(0xe000 + index)).join('')
  const source = `- a\n\n  \`\`\`=latex\n  \\x\n  \`\`\`\n\n  c\n\n${occupied}\n`
  const formatted = carveToCarve(source)
  expect(formatted).not.toContain('{loose}')
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
