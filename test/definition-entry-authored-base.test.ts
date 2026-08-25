import { describe, expect, it } from 'vitest'
import { carveToCarve } from '../src/index.js'

const definition = ':: t\n:  d\n\n   > q'
const indent = (source: string, width: number) =>
  source.split('\n').map((line) => `${' '.repeat(width)}${line}`).join('\n')

describe('a definition entry at an authored block base', () => {
  const containers = [
    ['list', 2, (body: string, width: number) => `- intro\n\n${indent(body, width)}\n`],
    [
      'footnote',
      2,
      (body: string, width: number) => `[^n]: intro\n\n${indent(body, width)}\n\nsee[^n]\n`,
    ],
    ['definition', 3, (body: string, width: number) => `:: term\n:  intro\n\n${indent(body, width)}\n`],
  ] as const

  for (const [name, minimum, wrap] of containers) {
    it(`keeps the following sibling outside the entry in a ${name}`, () => {
      const expected = carveToCarve(wrap(definition, minimum))
      for (const over of [minimum + 1, minimum + 2, minimum + 5]) {
        const written = carveToCarve(wrap(definition, over))
        expect(written).toBe(expected)
        expect(carveToCarve(written)).toBe(written)
      }
    })
  }

  it('treats tabs and their visual-column space spellings alike', () => {
    const shapes = [
      ['footnote', (body: string, prefix: string) => `[^n]: intro\n\n${body.split('\n').map((line) => prefix + line).join('\n')}\n\nsee[^n]\n`],
      ['definition', (body: string, prefix: string) => `:: term\n:  intro\n\n${body.split('\n').map((line) => prefix + line).join('\n')}\n`],
    ] as const
    for (const [, wrap] of shapes) {
      for (const [spaces, tabs] of [['    ', '\t'], ['     ', '\t '], ['        ', '\t\t']]) {
        const expected = carveToCarve(wrap(definition, spaces))
        const written = carveToCarve(wrap(definition, tabs))
        expect(written).toBe(expected)
        expect(carveToCarve(written)).toBe(written)
      }
    }
  })
})
