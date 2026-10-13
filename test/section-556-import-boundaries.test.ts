import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, htmlToAst, markdownToCarve, parse } from '../src/index.js'

it.each(['-4', '-5'])('unwraps the empty bare div in section 556%s', suffix => {
  const source = readFileSync(new URL(`../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below${suffix}.crv`, import.meta.url), 'utf8')
  expect(carveToHtml(source)).toMatch(/<div>\s*<\/div>/)
  expect(JSON.stringify(htmlToAst(carveToHtml(source)).value)).not.toContain('"type":"div"')
})

it('keeps the below-column child marker as paragraph text in section 556-12', () => {
  const source = readFileSync(new URL('../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below-12.crv', import.meta.url), 'utf8')
  expect(parse(source).footnoteDefs?.a).toMatchObject([
    { type: 'paragraph', children: [{ type: 'text', value: 'text' }, { type: 'soft_break' }, { type: 'text', value: '- child' }] },
  ])
  expect(carveToMarkdown(source)).toContain('\\- child')
  const imported = parse(markdownToCarve(carveToMarkdown(source)))
  expect(imported.footnoteDefs?.a).toMatchObject([{ type: 'paragraph' }])
  expect(carveToHtml(markdownToCarve(carveToMarkdown(source)))).toContain('<p>text\n- child')
})
