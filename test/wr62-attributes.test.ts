import { expect, test } from 'vitest'
import { format } from '../src/index.ts'

test('an attribute block separates a bare span closer from following word text', () => {
  for (const content of ['a', 'a b', 'abc']) {
    for (const mark of ['*', '/']) {
      for (const following of ['a', mark]) {
        const source = `${mark}${content}${mark}{.c}${following}`
        expect(format(source)).toBe(`${source}\n`)
      }
    }
  }
})
