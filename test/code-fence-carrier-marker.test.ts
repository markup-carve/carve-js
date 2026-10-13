import { describe, expect, it } from 'vitest'
import { carveToMarkdown, carveToMarkdownWithReport, parse } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

// CARVE-P11-067: under roundtrip export a fence's title and label travel in a
// marker holding the canonical opener, directly above the fence.
const codeBlock = (carve: string) => parse(carve).children.find(node => node.type === 'code_block')

describe('a code fence title and label under roundtrip Markdown export', () => {
  const source = '```js "app.js" [Example]\nlet x = 1\n```\n'

  it('writes one fence marker above the fence as without the mode', () => {
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown).toBe(`<!-- carve: \`\`\`js "app.js" [Example] -->\n${carveToMarkdown(source)}`)
    expect(markdown).not.toContain('title=')
  })

  it('restores the title and the label on import', () => {
    const imported = markdownToCarveWithLosses(carveToMarkdown(source, { roundtrip: true }))
    expect(imported.losses).toEqual([])
    expect(imported.value).toBe(source)
    expect(codeBlock(imported.value)).toMatchObject({ lang: 'js', header: 'app.js', label: 'Example' })
  })

  it('takes the title and label from the marker after the fence info is edited', () => {
    const markdown = '<!-- carve: ```js "app.js" [Example] -->\n```js "edited.js"\nx\n```\n'
    const imported = markdownToCarveWithLosses(markdown)
    expect(codeBlock(imported.value)).toMatchObject({ header: 'app.js', label: 'Example' })
    const unmarked = codeBlock(markdownToCarveWithLosses('```js "edited.js"\nx\n```\n').value)
    expect(unmarked).toMatchObject({ lang: 'js' })
    expect(unmarked).not.toHaveProperty('header')
  })

  const roundtrips = [
    '```js [L]\nx\n```\n',
    '```"t.txt"\nx\n```\n',
    '{.c}\n```js "a.js"\nx\n```\n',
    '{title=b}\n```js "a.js" [L]\nx\n```\n',
    '> ```js "q.js"\n> x\n> ```\n',
    '- item\n\n  ````js "f" [g]\n  ```\n  ````\n',
    '::: note\n```js "n.js"\nx\n```\n:::\n',
  ]
  for (const carve of roundtrips) {
    it(`round-trips ${JSON.stringify(carve)}`, () => {
      const imported = markdownToCarveWithLosses(carveToMarkdown(carve, { roundtrip: true }))
      expect(imported.losses).toEqual([])
      expect(imported.value).toBe(carve)
    })
  }

  it('keeps the block attribute marker directly above the fence marker', () => {
    expect(carveToMarkdown('{.c}\n```js "a.js"\nx\n```\n', { roundtrip: true }))
      .toBe('<!-- carve: {.c} -->\n<!-- carve: ```js "a.js" -->\n```js "a.js"\nx\n```\n')
  })

  it('writes no marker for a fence with neither title nor label', () => {
    expect(carveToMarkdown('```js\nx\n```\n', { roundtrip: true })).toBe('```js\nx\n```\n')
  })

  it('writes and reports nothing without roundtrip export', () => {
    const result = carveToMarkdownWithReport(source)
    expect(result.value).not.toContain('<!--')
    expect(result.losses).toEqual([])
  })

  for (const markdown of [
    '<!-- carve: ```js "a.js" -->\npara\n',
    '<!-- carve: ```js "a.js" -->\n\n```js\nx\n```\n',
    '<!-- carve: ```js "a.js" -->\n    code\n',
    '<!-- carve: ```js "a.js" -->\n<!-- carve: {.c} -->\n```js\nx\n```\n',
  ]) {
    it(`reads a fence marker not directly above a fence as damaged: ${JSON.stringify(markdown)}`, () => {
      const imported = markdownToCarveWithLosses(markdown)
      expect(imported.losses.map(loss => loss.code)).toEqual(['carrier-markers-damaged'])
      expect(codeBlock(imported.value)?.header).toBeUndefined()
    })
  }
})
