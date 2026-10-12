import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim()
const box = '<div class="box"><aside class="admonition note" aria-label="Note"><p>x</p></aside></div>'
const item = `<ul><li>${box}</li></ul>`
const tail = '<p>tail</p>'

describe('named colon openers past the column in marker-line containers', () => {
  it.each([
    ['A', `- ::: box
   ::: note
   x
   :::
  :::
tail
`, item + tail],
    ['B', `> - ::: box
>    ::: note
>    x
>    :::
>   :::
tail
`, `<blockquote>${item}</blockquote>${tail}`],
    ['no host closer', `- ::: box
   ::: note
   x
   :::
tail
`, item + tail],
    ['quoted without host closer', `> - ::: box
>    ::: note
>    x
>    :::
tail
`, `<blockquote>${item}</blockquote>${tail}`],
    ['blank before child closer', `- ::: box
   ::: note
   x

   :::
  :::
tail
`, item + tail],
    ['quoted blank before child closer', `> - ::: box
>    ::: note
>    x
>
>    :::
>   :::
tail
`, `<blockquote>${item}</blockquote>${tail}`],
    ['C', `- ::: box
    ::: note
    x
    :::
  :::
tail
`, item + tail],
    ['D', `- ::: box
   ::: note
   x
  :::
tail
`, item + tail],
    ['E', `- ::: box
  p
   ::: note
   x
   :::
  :::
tail
`, '<ul><li><div class="box"><p>p ::: note x :::</p></div></li></ul>' + tail],
    ['F', `- a

  ::: box
   ::: note
   x
   :::
  :::
tail
`, '<ul><li>a<div class="box"><p>::: note x :::</p></div></li></ul>' + tail],
    ['G', `::: box
 ::: note
 x
 :::
:::
tail
`, '<div class="box"><p>::: note x :::</p></div>' + tail],
    ['H attributes', `- ::: box
   ::: {.k}
   x
   :::
  :::
tail
`, '<ul><li><div class="box"><p>::: {.k} x :::</p></div></li></ul>' + tail],
    ['H bare', `- ::: box
   :::
   x
   :::
  :::
tail
`, '<ul><li><div class="box"><p>::: x :::</p></div></li></ul>' + tail],
  ])('%s', (_name, source, expected) => {
    expect(normalize(renderHtml(parse(source)))).toBe(expected)
    expect(normalize(renderHtml(parse(source, { positions: true })))).toBe(expected)
  })
})

it('rebases the whole code fence inside a named child', () => {
  const source = '- ::: box\n   ::: note\n   ```\n   x\n   ```\n   :::\n  :::\n'
  for (const positions of [false, true]) {
    const html = renderHtml(parse(source, { positions }))
    expect(html.match(/<code>([\s\S]*?)<\/code>/)?.[1]).toBe('x\n')
    expect(normalize(html)).toBe('<ul><li><div class="box"><aside class="admonition note" aria-label="Note"><pre><code>x</code></pre></aside></div></li></ul>')
  }
})

it('rebases a container opened at the named child column', () => {
  const source = '- ::: box\n   ::: note\n   ::: tip\n   y\n   :::\n   :::\n  :::\ntail\n'
  const expected = '<ul><li><div class="box"><aside class="admonition note" aria-label="Note"><aside class="admonition tip" aria-label="Tip"><p>y</p></aside></aside></div></li></ul><p>tail</p>'
  for (const positions of [false, true]) {
    expect(normalize(renderHtml(parse(source, { positions })))).toBe(expected)
  }
})

it.each(['', '\n'])('resumes rebasing after a nested list ends with %j', blank => {
  const source = `- ::: box\n   ::: note\n   - a\n${blank}   :::\n  :::\ntail\n`
  const expected = '<ul><li><div class="box"><aside class="admonition note" aria-label="Note"><ul><li>a</li></ul></aside></div></li></ul><p>tail</p>'
  for (const positions of [false, true]) {
    expect(normalize(renderHtml(parse(source, { positions })))).toBe(expected)
  }
})
