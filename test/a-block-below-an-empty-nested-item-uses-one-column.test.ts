import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it.each([
  ['quote', '- foo\n  1. +\n    > b\n', '- foo\n  1. > b\n'],
  ['code fence', '- foo\n  1. +\n    ```\n    x\n    ```\n', '- foo\n  1. ```\n     x\n     ```\n'],
])('writes a %s below an empty nested item on its marker line', (_case, source, expected) => {
  const formatted = carveToCarve(source)
  expect(formatted).toBe(expected)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
