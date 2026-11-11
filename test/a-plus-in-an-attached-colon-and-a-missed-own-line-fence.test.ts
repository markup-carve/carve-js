import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (...lines: string[]): string => carveToHtml(lines.join('\n') + '\n')

describe('a `+` inside a `+`-attached colon block is its text (carve#5923, #5658 ruling A)', () => {
  const body = (indent: string): string =>
    `${indent}<aside class="admonition note" aria-label="Note">\n${indent}  <p>x\n+\nzq</p>\n${indent}</aside>`

  it('in an item host', () => {
    expect(html('- +', '::: note', 'x', '+', 'zq')).toBe(`<ul>\n  <li>\n${body('    ')}\n  </li>\n</ul>`)
  })

  it('in a quote host', () => {
    expect(html('> +', '::: note', 'x', '+', 'zq')).toBe(`<blockquote>\n${body('  ')}\n</blockquote>`)
  })

  it('in an own-line attachment', () => {
    expect(html('- a', '+', '::: note', 'x', '+', 'zq')).toBe(
      `<ul>\n  <li>a\n${body('    ')}\n  </li>\n</ul>`,
    )
  })

  it('until its closer, after which the host takes the next `+`', () => {
    expect(html('- +', '::: note', 'x', ':::', '+', 'w')).toBe(
      '<ul>\n  <li>\n    <aside class="admonition note" aria-label="Note">\n      <p>x</p>\n    </aside>\n    w\n  </li>\n</ul>',
    )
  })
})

describe('an own-line `+` fence ends at a line that misses its host (carve#5924, #5658 F06)', () => {
  const missed = '<pre><code>a\n\n</code></pre>'

  it('in an item', () => {
    expect(html('- x', '+', '```', 'a', '', 'b', '```', '', 'z')).toBe(
      `<ul>\n  <li>x\n    ${missed}\n  </li>\n</ul>\n<p>b</p>\n<pre><code>\nz\n</code></pre>`,
    )
  })

  it('in a description', () => {
    expect(html(':: t', ':  d', '+', '```', 'a', '', 'b', '```')).toBe(
      `<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    ${missed}\n  </dd>\n</dl>\n<p>b</p>\n<pre><code></code></pre>`,
    )
  })

  it('in a note, also when the missing line is a quote', () => {
    expect(html('[^f]: n', '+', '```', 'a', '', '> b', '```', '', 'z')).toBe(
      '<blockquote><p>b</p></blockquote>\n<pre><code>\nz\n</code></pre>',
    )
  })

  it('keeps a marker-column `+` as payload while a closer follows', () => {
    expect(html('- x', '+', '```', 'a', '', '+', '```')).toBe(
      '<ul>\n  <li>x\n    <pre><code>a\n\n+\n</code></pre>\n  </li>\n</ul>',
    )
  })
})
