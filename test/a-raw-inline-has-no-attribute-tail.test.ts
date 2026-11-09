import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a following attribute run as literal text for any raw format', () => {
  expect(carveToHtml('`x`{=html}{k}\n')).toBe('<p>x{k}</p>')
  expect(carveToHtml('`x`{=l}{k}\n')).toBe('<p>{k}</p>')
  expect(carveToHtml('`x`{=html}{.class}\n')).toBe('<p>x{.class}</p>')
})
