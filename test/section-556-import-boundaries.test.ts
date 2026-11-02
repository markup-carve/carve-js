import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, htmlToAst, markdownToCarve, parse } from '../src/index.js'

it.each(['-4', '-5'])('unwraps the empty bare div in section 556%s', suffix => {
  const source = readFileSync(new URL(`../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below${suffix}.crv`, import.meta.url), 'utf8')
  expect(carveToHtml(source)).toMatch(/<div>\s*<\/div>/)
  expect(JSON.stringify(htmlToAst(carveToHtml(source)).value)).not.toContain('"type":"div"')
})

// The child marker opens a list in the note body (PART 0 S3, carve#4860).
it('keeps the child marker a list in the note through the Markdown round trip in section 556-12', () => {
  const source = readFileSync(new URL('../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below-12.crv', import.meta.url), 'utf8')
  expect(parse(source).footnoteDefs?.a).toMatchObject([
    { type: 'paragraph', children: [{ type: 'text', value: 'text' }] },
    { type: 'list', items: [{ children: [{ type: 'paragraph', children: [{ type: 'text', value: 'child' }] }] }] },
  ])
  const imported = parse(markdownToCarve(carveToMarkdown(source)))
  expect(imported.footnoteDefs?.a).toMatchObject([{ type: 'paragraph' }, { type: 'list' }])
  expect(carveToHtml(markdownToCarve(carveToMarkdown(source)))).toBe(carveToHtml(source))
})
