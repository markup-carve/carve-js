import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarve } from '../src/markdown-migrate.js'

// carve-js#3173: an escaped bracket inside an angle destination does not close it.
describe('a Markdown definition whose angle destination holds an escaped bracket', () => {
  it.each([
    ['quoted, titled', '> [r]: <a\\>b> "x"\n>\n> [t][r]\n', '<a href="a%3Eb" title="x">t</a>'],
    ['quoted, untitled', '> [r]: <a\\>b>\n>\n> [t][r]\n', '<a href="a%3Eb">t</a>'],
    ['quoted, title wraps', '> [r]: <a\\>b> "x\n> y"\n>\n> [t][r]\n', '<a href="a%3Eb" title="x\ny">t</a>'],
    ['quoted, escaped opener', '> [r]: <a\\<b> "x"\n>\n> [t][r]\n', '<a href="a%3Cb" title="x">t</a>'],
    ['unquoted, titled', '[r]: <a\\>b> "x"\n\n[t][r]\n', '<a href="a%3Eb" title="x">t</a>'],
    ['unquoted, untitled', '[r]: <a\\>b>\n\n[t][r]\n', '<a href="a%3Eb">t</a>'],
    ['unquoted, title wraps', '[r]: <a\\>b> "x\ny"\n\n[t][r]\n', '<a href="a%3Eb" title="x\ny">t</a>'],
    ['unquoted, escaped opener', '[r]: <a\\<b>\n\n[t][r]\n', '<a href="a%3Cb">t</a>'],
    ['escaped backslash closes', '[r]: <a\\\\>\n\n[t][r]\n', '<a href="a%5C">t</a>'],
  ])('becomes a link: %s', (_name, source, link) => {
    const carve = markdownToCarve(source)
    expect(carve).not.toContain('\\[r]')
    expect(carveToHtml(carve)).toContain(link)
  })
})
