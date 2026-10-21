import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (html: string): string => html.split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it('an authored table after a note closes the item paragraph', () => {
  expect(normalized(carveToHtml('- a\n    [^n]: e\n\n     ||\ntail\n'))).toBe(normalized(
    '<ul>\n<li>a\n<table>\n<tbody>\n<tr><td></td></tr>\n</tbody>\n</table>\n</li>\n</ul>\n<p>tail</p>',
  ))
})
