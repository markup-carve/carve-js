import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

// carve#5841: a `: ` line with no `::` term above is paragraph text (PART 0 S3), so a later
// `: %%%` is text too and the column-0 `%%%` opens a block comment that hides the rest.
const hidden = '<ul><li><p>a :</p><p>:</p></li></ul>'

it('reads a column-0 comment fence after a term-less empty colon line', () => {
  expect(normalize(carveToHtml('- a\n  : \n\n  : %%%\n%%%\nc\n'))).toBe(normalize(hidden))
})

it('reads it the same without the trailing space', () => {
  expect(normalize(carveToHtml('- a\n  :\n\n  : %%%\n%%%\nc\n'))).toBe(normalize(hidden))
})

it('reads a column-0 comment fence after a term-less colon line with text', () => {
  expect(normalize(carveToHtml('- a\n  : x\n\n  : %%%\n%%%\nc\n'))).toBe(normalize(
    '<ul><li><p>a : x</p><p>:</p></li></ul>',
  ))
})

it('reads it in a tight item too', () => {
  expect(normalize(carveToHtml('- a\n  : \n  : %%%\n%%%\nc\n'))).toBe(normalize('<ul><li>a : :</li></ul>'))
})

it('keeps a description span under a term', () => {
  expect(normalize(carveToHtml('- a\n  :: t\n  : x\n\n  : %%%\n%%%\nc\n'))).toBe(normalize(
    '<ul><li>a<dl><dt>t</dt><dd>x</dd><dd></dd></dl></li></ul><p>c</p>',
  ))
})
