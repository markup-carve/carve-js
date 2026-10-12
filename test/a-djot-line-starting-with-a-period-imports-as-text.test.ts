import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

// The two renderers pad a list item differently.
const flat = (html: string): string => html.replace(/\s+/g, ' ').replace(/> | </g, (m) => m.trim()).trim()

it.each([
  ['. a', '\\. a'],
  ['.  a', '\\.  a'],
  ['. a\n. b', '\\. a\n\\. b'],
  ['  . a', '  \\. a'],
  ['> . a', '> \\. a'],
  ['- . a', '- \\. a'],
  ['1. . a', '1. \\. a'],
  ['- a\n\n  . b', '- a\n\n  \\. b'],
  ['a\n. b', 'a\n\\. b'],
])('imports %j as %j and keeps what Djot renders', (source, carve) => {
  expect(djotToCarve(source + '\n')).toBe(carve + '\n')
  expect(flat(carveToHtml(carve))).toBe(flat(renderHTML(parse(source))))
})

it.each(['.a', 'a . b', '... a', '`. a`', '```\n. a\n```'])('leaves %j alone', (source) => {
  expect(djotToCarve(source + '\n')).toBe(source + '\n')
})
