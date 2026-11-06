import { expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

it.each([
  ['- ::: d\n+\ntail\n', 3],
  ['1. ::: d\n+\ntail\n', 4],
  ['- ::: d\n  z\n+\ntail\n', 3],
])('reports a colon fence left open by plus attachment', (source, column) => {
  expect(lintCarve(source).filter(w => w.rule === 'unclosed-container-fence'))
    .toMatchObject([{ line: 1, column }])
})
