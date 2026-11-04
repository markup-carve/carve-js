import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it.each([
  ['code fence', '- - - ```\n    +\ntail\n', '- - - ```\n      ```\n\ntail\n'],
  ['raw fence', '- - - ```=html\n      x\n    +\ntail\n', '- - - ```=html\n      x\n      ```\n\ntail\n'],
  ['four nested lists', '- - - - ```\n        x\n      +\ntail\n', '- - - - ```\n        x\n        ```\n\ntail\n'],
  ['task fence', '- - [ ] ```js\n        x\n\n  +\ntail\n', '- - [ ] ```js\n        x\n\n    ```\n\ntail\n'],
])('writes the fence closed and no + for a refused + below a nested %s (carve#5157)', (_case, source, expected) => {
  const formatted = carveToCarve(source)
  expect(formatted).toBe(expected)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
