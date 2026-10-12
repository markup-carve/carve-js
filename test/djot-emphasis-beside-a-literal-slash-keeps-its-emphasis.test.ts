import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()

it.each([
  ['/_e_', '/{/e/}'],
  ['a/_e_/b', 'a/{/e/}/b'],
  ['/_e_/', '\\/{/e/}/'],
  ['x /_e_ y', 'x /{/e/} y'],
  ['_e_/x/', '{/e/}\\/x/'],
  ['/x/_e_', '\\/x/{/e/}'],
  ['\\/_e_', '\\/{/e/}'],
  ['/_e_ f/', '\\/{/e/} f/'],
])('imports %j as %j and keeps what Djot renders', (source, carve) => {
  expect(djotToCarve(source + '\n')).toBe(carve + '\n')
  expect(flat(carveToHtml(carve))).toBe(flat(renderHTML(parse(source))))
})

it.each([
  ['_e_ /', '/e/ /'],
  ['_e_.', '/e/.'],
  ['(_e_)', '(/e/)'],
])('leaves emphasis away from a slash unbraced: %j', (source, carve) => {
  expect(djotToCarve(source + '\n')).toBe(carve + '\n')
  expect(flat(carveToHtml(carve))).toBe(flat(renderHTML(parse(source))))
})
