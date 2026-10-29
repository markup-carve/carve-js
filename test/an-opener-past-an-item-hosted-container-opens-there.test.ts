import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim()

describe('openers past an item-hosted container column', () => {
  it.each([
    ['line block', `- ::: box
    ::: |
    x
    :::
  :::
tail
`, '<ul><li><div class="box"><div class="line-block"><p>x</p></div></div></li></ul><p>tail</p>'],
    ['code fence', `- a
  ::: box
     \`\`\`
     code
     \`\`\`
  :::
tail
`, '<ul><li>a<div class="box"><pre><code>code</code></pre></div></li></ul><p>tail</p>'],
    ['ended sublist', `- outer
  - para

  ---
    \`\`\`
`, '<ul><li>outer<ul><li>para</li></ul><hr><pre><code></code></pre></li></ul>'],
    ['ended sublist with an unclosed fence', `- outer
  - para
    \`\`\`
    code

  # h
    \`\`\`
`, '<ul><li>outer<ul><li>para<pre><code>code</code></pre></li></ul><h1 id="h">h</h1><pre><code></code></pre></li></ul>'],
    ['quoted heading', `> - ::: box
>    # h
tail
`, '<blockquote><ul><li><div class="box"><h1 id="h">h</h1></div></li></ul></blockquote><p>tail</p>'],
  ])('%s', (_name, source, expected) => {
    for (const positions of [false, true]) {
      expect(normalize(carveToHtml(source, { positions }))).toBe(expected)
      expect(normalize(renderHtml(parse(source, { positions })))).toBe(expected.replace(/ id="[^"]*"/g, ''))
    }
  })
})
