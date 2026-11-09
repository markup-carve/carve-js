import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a paragraph whose only visible content is a hard break', () => {
  for (const source of ['{%%}\\\n', '{% x %}\\\n', '{%%}{% x %}\\\n']) {
    expect(carveToHtml(source)).toBe('<p><br>\n</p>')
  }
})

it('still drops a paragraph containing only comments', () => {
  expect(carveToHtml('{%%}{% x %}\n')).toBe('')
})
