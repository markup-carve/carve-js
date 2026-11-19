import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const reports = (source) => lint(source).filter((entry) => entry.code === 'block-marker-as-text')

describe('C2-B-090: a braced inline form at the start of a line is no failed attribute line', () => {
  const hosts = ['', '> ', '- ', '1. ', 'a\n', '> a\n> ', ':: t\n: ']

  it('reports nothing where the leading brace opens a span', () => {
    for (const host of hosts) {
      for (const span of ['{_underline_}', '{_a b_}', '{_{*a*}_}', '{_x_}{.c}', '{~x~}', '{=x=}', '{+x+}']) {
        for (const rest of ['', ' text', ' {_y_}']) {
          const source = `${host}${span}${rest}\n`
          expect(reports(source), source).toEqual([])
        }
      }
    }
  })

  it('still reports an attribute line shape that did not open', () => {
    for (const host of hosts) {
      for (const shape of ['{#id', '{.x', '{_x', '{key=v', '{_x_ y']) {
        const source = `${host}${shape} {_y_}\n`
        expect(reports(source), source).toHaveLength(1)
      }
    }
  })
})
