import { expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

it.each([
  ['> ```raw html\n> x\n> ```\n', 'raw-block-syntax'],
  ['> # T {#id}\n', 'heading-trailing-attribute'],
])('checks nested source markers: %j', (source, rule) => {
  expect(lintCarve(source!).map((w) => w.rule)).toContain(rule)
})
