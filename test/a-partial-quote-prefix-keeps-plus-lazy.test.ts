import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a plus behind one missed quote prefix into its open paragraph', () => {
  expect(carveToHtml('> +\n> > q\n> +\n')).toBe('<blockquote>\n  <blockquote>\n    <blockquote><p>q\n+</p></blockquote>\n  </blockquote>\n</blockquote>')
})
