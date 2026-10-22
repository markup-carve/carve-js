import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

const quote = (depth: number): string => '> '.repeat(depth)
const marker = (kind: string, width: number): string => kind + ' '.repeat(width)
const indent = (width: number): string => ' '.repeat(width)

const cases: Array<{ name: string; source: string; fragments: string[]; structure?: RegExp }> = [
  ...[1, 2, 3, 4].map(depth => ({
    name: `raw HTML at quote depth ${depth}`,
    source: [quote(depth) + indent(2) + '<div>', quote(depth) + indent(3) + '*hi*', ''].join('\n'),
    fragments: ['<blockquote>', '<div>', '*hi*'],
  })),
  ...[1, 2, 3, 4].map(depth => ({
    name: `raw HTML in a quoted item at quote depth ${depth}`,
    source: [quote(depth) + marker('-', 1) + '<div>', quote(depth) + indent(2) + '*hi*', ''].join('\n'),
    fragments: ['<blockquote>', '<ul>', '<div>', '*hi*'],
    structure: /<li>[\s\S]*<div>[\s\S]*<\/li>/,
  })),
  ...(['-', '*', '1.', '10)'] as const).flatMap(kind => [0, 1, 2, 3].map(slack => {
    const content = marker(kind, 1).length
    return {
      name: `${kind} holds a quoted fence with ${slack} opener spaces`,
      source: [marker(kind, 1) + quote(1) + indent(slack) + '```js', indent(content) + quote(1) + 'x', indent(content) + quote(1) + '```', ''].join('\n'),
      fragments: ['<blockquote>', '<pre><code class="language-js">x\n</code></pre>'],
    }
  })),
  {
    name: 'raw HTML with quote opener slack',
    source: [quote(1) + indent(2) + '<div>', quote(1) + indent(3) + '*hello*', ''].join('\n'),
    fragments: ['<blockquote>', '<div>', '*hello*'],
  },
  {
    name: 'raw emphasis stays raw through an HTML closing tag',
    source: [quote(1) + indent(2) + '<div>', quote(1) + indent(3) + '*hi*', quote(1) + indent(2) + '</div>', ''].join('\n'),
    fragments: ['<div>', '*hi*', '</div>'],
  },
  {
    name: 'item held quote with a backtick fence and escaped info',
    source: [marker('-', 1) + quote(1) + '``` foo\\+bar', indent(2) + quote(1) + 'foo', indent(2) + quote(1) + '```', ''].join('\n'),
    fragments: ['<ul>', '<blockquote>', '<pre><code class="language-foo+bar">foo\n</code></pre>'],
  },
  {
    name: 'item held fence decodes an HTML entity in its info string',
    source: [marker('-', 1) + quote(1) + '``` foo&#43;bar', indent(2) + quote(1) + 'x', indent(2) + quote(1) + '```', ''].join('\n'),
    fragments: ['<pre><code class="language-foo+bar">x\n</code></pre>'],
  },
  {
    name: 'item held quote with raw HTML',
    source: [marker('-', 1) + quote(1) + '<div>', indent(2) + quote(1) + '*hi*', ''].join('\n'),
    fragments: ['<ul>', '<blockquote>', '<div>', '*hi*'],
  },
  {
    // commonmark: one item, one quote holding all three HTML blocks.
    name: 'raw HTML after a blank quote line stays in the item',
    source: [marker('-', 1) + quote(1) + '<table>', indent(2) + quote(1).trimEnd(), indent(2) + quote(1) + '<tr>', indent(2) + quote(1).trimEnd(), indent(2) + quote(1) + '</table>', ''].join('\n'),
    fragments: ['<ul>', '<tr>', '</table>'],
    structure: /^<ul>\s*<li>\s*<blockquote>[\s\S]*<tr>[\s\S]*<\/table>[\s\S]*<\/blockquote>\s*<\/li>\s*<\/ul>\s*$/,
  },
  {
    name: 'lazy quoted paragraph keeps its item for later raw HTML',
    source: [quote(1) + marker('-', 1) + 'a', quote(1) + 'b', quote(1) + indent(2) + '<div>', quote(1) + indent(2) + 'y', ''].join('\n'),
    fragments: ['<li>', 'a\nb', '<div>', 'y'],
  },
  {
    name: 'blank line after a lazy quote keeps later raw HTML in the item',
    source: [quote(1) + marker('-', 1) + 'a', quote(1) + 'b', quote(1).trimEnd(), quote(1) + indent(2) + '<div>', quote(1) + indent(2) + 'y', ''].join('\n'),
    fragments: ['<li><p>a\nb</p>', '<div>', 'y'],
  },
  {
    name: 'ordered item after a blank quote retains later raw HTML',
    source: [quote(1) + 'a', quote(1).trimEnd(), quote(1) + marker('2.', 1) + 'b', quote(1) + indent(3) + '<div>', quote(1) + indent(3) + 'y', ''].join('\n'),
    fragments: ['<ol start="2"', '<div>'],
    structure: /<li>[\s\S]*<div>[\s\S]*<\/li>/,
  },
  {
    name: 'ordered item in a quote holding a tilde fence',
    source: [quote(1) + marker('10)', 1) + quote(1) + '~~~ js', quote(1) + indent(4) + quote(1) + 'x', quote(1) + indent(4) + quote(1) + '~~~', ''].join('\n'),
    fragments: ['<ol start="10"', '<blockquote>', '<pre><code class="language-js">x\n</code></pre>'],
  },
  {
    name: 'unclosed quoted fence ends with its item',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + 'x', ''].join('\n'),
    fragments: ['<ul>', '<blockquote>', '<pre><code>x\n</code></pre>'],
  },
  {
    name: 'unclosed quoted fence leaves a line without a quote marker outside',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + 'x', indent(2) + 'y', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>'],
    structure: /<\/blockquote>\s*y\s*<\/li>/,
  },
  {
    name: 'fence body retains indent past opener slack',
    source: [marker('-', 1) + quote(1) + indent(3) + '```', indent(2) + quote(1) + indent(4) + 'x', indent(2) + quote(1) + indent(3) + '```', ''].join('\n'),
    fragments: ['<pre><code> x\n</code></pre>'],
  },
  {
    name: 'indented fence-like body line stays code',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + indent(4) + '```', indent(2) + quote(1) + '```', ''].join('\n'),
    fragments: ['<pre><code>    ```\n</code></pre>'],
  },
  {
    name: 'quote item quote with a tilde fence',
    source: [quote(1) + marker('-', 1) + quote(1) + '~~~ js', quote(1) + indent(2) + quote(1) + 'x', quote(1) + indent(2) + quote(1) + '~~~', ''].join('\n'),
    fragments: ['<blockquote>', '<ul>', '<pre><code class="language-js">x\n</code></pre>'],
  },
  {
    name: 'list after a quoted tilde fence remains a list',
    source: [marker('-', 1) + quote(1) + '~~~', indent(2) + quote(1) + 'x', indent(2) + quote(1) + '~~~', indent(2) + quote(1) + marker('-', 1) + 'b', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>', '<li>b</li>'],
  },
  {
    name: 'paragraph after a quoted tilde fence remains prose',
    source: [marker('-', 1) + quote(1) + '~~~', indent(2) + quote(1) + 'x', indent(2) + quote(1) + '~~~', indent(2) + quote(1) + '/a/', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>', '<p>/a/</p>'],
  },
  {
    name: 'ordered item stays open after a quoted fence and blank line',
    source: [
      quote(1) + marker('3.', 1) + quote(1) + marker('1.', 1) + '```',
      quote(1) + indent(3) + quote(1) + indent(3) + 'foo',
      quote(1) + indent(3) + quote(1) + indent(3) + '```',
      quote(1) + indent(3) + quote(1).trimEnd(),
      quote(1) + indent(3) + quote(1) + indent(3) + 'bar',
      '',
    ].join('\n'),
    fragments: ['<pre><code>foo\n</code></pre>', '<p>bar</p>'],
    structure: /<li>[\s\S]*<pre>[\s\S]*<p>bar<\/p>[\s\S]*<\/li>/,
  },
  {
    name: 'quoted fence followed by a setext heading',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + 'x', indent(2) + quote(1) + '```', indent(2) + quote(1) + 'Title', indent(2) + quote(1) + '---', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>', '<h2'],
  },
  {
    name: 'lazy quote paragraph after a closed item held fence',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + 'x', indent(2) + quote(1) + '```', indent(2) + quote(1) + 'para', indent(2) + 'lazy', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>', '<p>para\nlazy</p>'],
  },
  {
    name: 'unquoted line exits an open item held fence',
    source: [marker('-', 1) + quote(1) + '```', indent(2) + quote(1) + 'x', 'y', ''].join('\n'),
    fragments: ['<pre><code>x\n</code></pre>', '</ul>\n<p>y</p>'],
  },
  {
    name: 'item marker inside an open nested fence stays code',
    source: [quote(1) + marker('-', 1) + quote(1) + '```', quote(1) + indent(2) + quote(1) + marker('-', 1) + '```', quote(1) + indent(2) + quote(1) + 'x', ''].join('\n'),
    fragments: ['<pre><code>- ```\nx\n</code></pre>'],
  },
  {
    name: 'shorter fence line stays inside an unclosed item held fence',
    source: [marker('-', 1) + quote(1) + '````', indent(2) + quote(1) + '```', indent(2) + quote(1) + 'x', ''].join('\n'),
    fragments: ['<pre><code>```\nx\n</code></pre>'],
  },
  {
    name: 'item held raw comment includes an empty quoted line',
    source: [marker('-', 1) + quote(1) + '<!--', indent(2) + quote(1).trimEnd(), indent(2) + quote(1) + '-->', ''].join('\n'),
    fragments: ['<blockquote>', '<!--\n\n-->'],
    structure: /<blockquote>[\s\S]*<!--[\s\S]*-->[\s\S]*<\/blockquote>/,
  },
  ...(['```', '~~~'] as const).flatMap(fence => [
    {
      name: `plain quote with ${fence}`,
      source: [quote(1) + fence, quote(1) + 'body', quote(1) + fence, ''].join('\n'),
      fragments: ['<blockquote>', '<pre><code>body\n</code></pre>'],
    },
    {
      name: `top-level ${fence}`,
      source: [fence, 'body', fence, ''].join('\n'),
      fragments: ['<pre><code>body\n</code></pre>'],
    },
  ]),
]

describe('Markdown fences inside quoted containers', () => {
  it.each(cases)('$name', ({ source, fragments, structure }) => {
    const imported = markdownToCarve(source)
    const html = carveToHtml(imported)
    for (const fragment of fragments) expect(html).toContain(fragment)
    if (structure) expect(html).toMatch(structure)
    expect(carveToCarve(imported)).toBe(imported)
  })

})
