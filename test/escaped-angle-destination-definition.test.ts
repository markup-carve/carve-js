import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarve } from '../src/markdown-migrate.js'

// carve-js#3173: an escaped bracket inside an angle destination does not close it.
describe('a Markdown definition whose angle destination holds an escaped bracket', () => {
  it.each([
    ['quoted, titled', '> [r]: <a\\>b> "x"\n>\n> [t][r]\n', '<a href="a&gt;b" title="x">t</a>'],
    ['quoted, untitled', '> [r]: <a\\>b>\n>\n> [t][r]\n', '<a href="a&gt;b">t</a>'],
    ['quoted, title wraps', '> [r]: <a\\>b> "x\n> y"\n>\n> [t][r]\n', '<a href="a&gt;b" title="x\ny">t</a>'],
    ['quoted, escaped opener', '> [r]: <a\\<b> "x"\n>\n> [t][r]\n', '<a href="a&lt;b" title="x">t</a>'],
    ['unquoted, titled', '[r]: <a\\>b> "x"\n\n[t][r]\n', '<a href="a&gt;b" title="x">t</a>'],
    ['unquoted, untitled', '[r]: <a\\>b>\n\n[t][r]\n', '<a href="a&gt;b">t</a>'],
    ['unquoted, title wraps', '[r]: <a\\>b> "x\ny"\n\n[t][r]\n', '<a href="a&gt;b" title="x\ny">t</a>'],
    ['unquoted, escaped opener', '[r]: <a\\<b>\n\n[t][r]\n', '<a href="a&lt;b">t</a>'],
    ['escaped backslash closes', '[r]: <a\\\\>\n\n[t][r]\n', '<a href="a\\">t</a>'],
  ])('becomes a link: %s', (_name, source, link) => {
    const carve = markdownToCarve(source)
    expect(carve).not.toContain('\\[r]')
    expect(carveToHtml(carve)).toContain(link)
  })
})
