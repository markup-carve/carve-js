import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const prefix of ['', '> ', '> > ']) for (const fence of ['```', '~~~']) {
  it(`keeps a closed ${fence} fence at the marker-note body column in the note at quote depth ${prefix.length / 2}`, () => {
    const source = ['- [^n]: text', `    ${fence}`, '    code', `    ${fence}`, 'after [^n]']
      .map(line => prefix + line).join('\n')
    const html = carveToHtml(source)
    expect(html).toMatch(/<li id="fn1">\s*<p>text<\/p>\s*<pre><code>code\n<\/code><\/pre>/)
    expect(html).toMatch(/<ul>\s*<li><\/li>\s*<\/ul>/)
    expect(html).toContain('<p>after <a id="fnref1"')
  })

  it(`opens a closed ${fence} fence below the note child in the note at quote depth ${prefix.length / 2}`, () => {
    const source = ['- [^n]: %% c', '    - child', `     ${fence}`, '     code', `     ${fence}`, 'after [^n]']
      .map(line => prefix + line).join('\n')
    const html = carveToHtml(source)
    expect(html).toMatch(/<li id="fn1">[\s\S]*<ul>[\s\S]*<li>child<\/li>[\s\S]*<\/ul>\s*<pre><code>code\n<\/code><\/pre>/)
    expect(html).toMatch(/<ul>\s*<li><\/li>\s*<\/ul>/)
  })
}

it('does not close a note fence with a deeper delimiter', () => {
  const html = carveToHtml('- [^n]: text\n    ```\n    code\n        ```\n    more\nafter [^n]')
  // The run past the opener is payload, so `after` folds into the open paragraph (CARVE-P2-006).
  expect(html).toBe('<ul>\n  <li></li>\n</ul>')
})

it('measures the note body from an ordered item content column', () => {
  const html = carveToHtml('1. [^n]: text\n     ~~~\n     x\n     ~~~\nafter [^n]')
  expect(html).toMatch(/<ol>\s*<li><\/li>\s*<\/ol>/)
  expect(html).toMatch(/<li id="fn1">\s*<p>text<\/p>\s*<pre><code>x\n<\/code><\/pre>/)
})

it('folds a line below a closed note fence into the note', () => {
  const html = carveToHtml('- [^n]: text\n     ```\n     code\n     ```\n     more\nafter [^n]')
  expect(html).toBe('<ul>\n  <li></li>\n</ul>')
  expect(html).not.toContain('<li>after')
})

for (const prefix of ['', '> ']) for (const opener of [['> q'], [':: t', ': d']]) {
  it(`opens ${opener[0]} at the marker-note body column and folds the next line at quote depth ${prefix.length / 2}`, () => {
    const source = ['- [^n]: text', ...opener.map(line => `    ${line}`), 'after']
      .map(line => prefix + line).join('\n') + '\n\nr[^n]\n'
    const html = carveToHtml(source)
    expect(html).toMatch(/<li id="fn1">\s*<p>text<\/p>\s*<(blockquote|dl)>/)
    expect(html).toMatch(/<ul>\s*<li><\/li>\s*<\/ul>/)
    // The opened block's paragraph takes the line lazily (carve#3885).
    expect(html).toMatch(/(q|d)\nafter/)
  })
}

it('keeps a quote below the marker-note body column in the item', () => {
  const html = carveToHtml('- [^n]: text\n   > q\nafter [^n]')
  expect(html).toMatch(/<ul>\s*<li>\s*<blockquote><p>q\nafter <a id="fnref1"/)
  expect(html).toMatch(/<li id="fn1">\s*<p>text<a href="#fnref1"/)
})

it('ignores comment-looking text inside a closed note fence', () => {
  const html = carveToHtml('- [^n]: text\n     ~~~\n     %% c\n     ```\n     ~~~\nafter [^n]')
  expect(html).toContain('<p>after <a id="fnref1"')
  expect(html).not.toContain('<li>after')
})

it('keeps a fence below the note body column in the item after a note comment', () => {
  const html = carveToHtml('- [^n]: text\n    %% c\n  ```\n  code\n  ```\nafter [^n]')
  expect(html).toContain('<li>\n    <pre><code>code\n</code></pre>\n  </li>')
  expect(html).toContain('<p>after <a id="fnref1"')
})

for (const tail of ['> q']) it(`folds the following paragraph into the note after a note fence and ${tail}`, () => {
  const html = carveToHtml(`- [^n]: text\n    \`\`\`\n    code\n    \`\`\`\n    ${tail}\nafter [^n]`)
  expect(html).toBe('<ul>\n  <li></li>\n</ul>')
  expect(html).not.toContain('<li>after')
})

it('folds the following paragraph into the note after a note fence and - li', () => {
  const html = carveToHtml('- [^n]: text\n    ```\n    code\n    ```\n    - li\nafter [^n]')
  expect(html).toBe('<ul>\n  <li></li>\n</ul>')
  expect(html).not.toContain('<li>after')
})
