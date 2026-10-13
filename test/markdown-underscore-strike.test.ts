import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'
import { parseFragment, serialize } from 'parse5'
import fixtures from './fixtures/markdown-underscore-strike.json'

const normalized = (html: string): string => serialize(parseFragment(html.replace(/ id="[^"]*"/g, '').replace(/>\s+</g, '><').trim()))

// Native cmark-gfm 0.29.0.gfm.13, except row 22, where CommonMark's Unicode
// symbol flanking rule applies to the emoji beside the underscore.
it.each(fixtures)('keeps native underscore flanks beside strikes: $id', row => {
  expect(normalized(carveToHtml(markdownToCarve(row.source), { sections: false }))).toBe(normalized(row.html))
})

it('keeps asterisks literal when strike delimiters change their flanks', () => {
  expect(carveToHtml(markdownToCarve('a~~*~~ b*\n'))).toBe('<p>a~~*~~ b*</p>')
})

it('keeps unrelated underscores free of added escapes', () => {
  expect(markdownToCarve('x ~ y foo_bar\n')).toBe('x ~ y foo_bar\n')
})
