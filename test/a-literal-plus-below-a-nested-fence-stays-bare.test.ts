import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it.each([
  ['code fence', '- - - ```\n    +\ntail\n', '- - - ```\n      ```\n    +\n\ntail\n'],
  ['raw fence', '- - - ```=html\n      x\n    +\ntail\n', '- - - ```=html\n      x\n      ```\n    +\n\ntail\n'],
  ['four nested lists', '- - - - ```\n        x\n      +\ntail\n', '- - - - ```\n        x\n        ```\n      +\n\ntail\n'],
  ['task fence', '- - [ ] ```js\n        x\n\n  +\ntail\n', '- - [ ] ```js\n        x\n\n    ```\n\n   +\n  tail\n'],
])('writes the literal plus without an idle escape below a nested %s', (_case, source, expected) => {
  const formatted = carveToCarve(source)
  expect(formatted).toBe(expected)
  expect(carveToHtml(formatted)).toBe(carveToHtml(source))
  expect(carveToCarve(formatted)).toBe(formatted)
})
