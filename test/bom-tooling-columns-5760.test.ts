import { expect, it } from 'vitest'
import { parse, positionOf } from '../src/index.ts'

it('C2-B-165, C2-T-041: only a leading BOM has bytes but no column', () => {
  const source = '\uFEFF# é'
  const heading = parse(source).children[0]
  expect(heading?.pos).toMatchObject({ startLine: 1, startColumn: 1, startOffset: 3 })
  expect(positionOf(source, 0)).toEqual({ line: 1, column: 1 })
  expect(positionOf(source, 3)).toEqual({ line: 1, column: 1 })
  expect(positionOf(source, 5)).toEqual({ line: 1, column: 3 })
  expect(positionOf(Buffer.from(source), 5)).toEqual({ line: 1, column: 3 })
  expect(positionOf('\uFEFF\uFEFFx', 6)).toEqual({ line: 1, column: 2 })
  expect(positionOf('x\n\uFEFFy', 5)).toEqual({ line: 2, column: 2 })
})
