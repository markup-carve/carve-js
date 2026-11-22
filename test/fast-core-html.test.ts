import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../src/api.ts'
import { fastCoreHtml } from '../src/fast-core-html.ts'
import { readOptions } from '../src/options.ts'

const settings = readOptions(undefined, 'render')

describe('direct core HTML path', () => {
  it('accepts the shared core document and preserves the authoritative HTML', () => {
    const source = readFileSync('test/fixtures/bench-commonmark-core.crv', 'utf8')
    const direct = fastCoreHtml(source, settings)
    expect(direct).toBeDefined()
    expect(direct).toBe(renderWithDiagnostics(source).html)
    expect(render(source)).toBe(direct)
  })

  it('accepts different section counts and nested core blocks', () => {
    const section = (number: number): string => `## Section ${number}\n\n` +
      `Paragraph ${number} has *strong*, /emphasis/, \`code\`, and a [link][site].\n\n` +
      `- first item\n- second item\n\n  - nested item ${number}\n  - another nested item\n\n` +
      `> A quote with /emphasis/.\n\n` +
      `\`\`\`js\nconst value = ${number};\n\`\`\`\n\n---`
    for (const count of [1, 2, 8, 32]) {
      const source = `[site]: https://example.com\n\n# Book\n\n${Array.from({ length: count }, (_, i) => section(i + 1)).join('\n\n')}\n`
      const direct = fastCoreHtml(source, settings)
      expect(direct, `section count ${count}`).toBeDefined()
      expect(direct).toBe(renderWithDiagnostics(source).html)
    }
  })

  it('declines syntax whose ownership needs the full parser', () => {
    for (const source of ['---\nname: value\n---\n', ':: term\n: definition\n', '- first\n+\n> attached\n',
      '```js\ncode\n````\n', ': definition\n', '- `a``b`\n', '#  A\n', '> A \n', '> \n', '> A\n> \n']) {
      expect(fastCoreHtml(source, settings)).toBeUndefined()
      expect(render(source)).toBe(renderWithDiagnostics(source).html)
    }
  })
})
