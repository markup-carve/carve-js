import { parse as parseDjot, renderHTML as renderDjot } from '@djot/djot'
import { describe, expect, it } from 'vitest'
import { format, render } from '../../src/index.ts'
import { lint } from '../../lint/lint.ts'
import { writerHasLoss } from '../../src/write.ts'
import { BBCODE_MAX_INPUT_LENGTH, BbcodeInputTooLargeError, importDocument, ImportInputError, type Format } from '../src/index.ts'
import { commonmarkCases, djotCases, gfmCases } from '../scripts/suites.ts'

const source = (input: string, from: Format): string => importDocument(input, { from }).source

describe('Markdown and Djot through the HTML hub', () => {
  it('keeps a raw HTML block and inline HTML raw, as the 0.1 importer did', () => {
    expect(source('<div>\n*a*\n</div>\n\nx <b>y</b>\n', 'markdown'))
      .toBe('```=html\n<div>\n*a*\n</div>\n```\n\nx `<b>`{=html}y`</b>`{=html}\n')
  })

  it('keeps a script block of GFM raw instead of tag-filtered text', () => {
    expect(source('<script>a()</script>\n', 'gfm')).toBe('```=html\n<script>a()</script>\n```\n')
  })

  it('keeps a raw HTML block that follows text in a tight list item (C2-M-065)', () => {
    for (const from of ['markdown', 'gfm'] as const) {
      expect(source('- a\n  <!--x-->\n- b\n', from)).toBe('- a\n  `<!--x-->`{=html}\n- b\n')
      expect(source('- a\n  <div>\n  x\n- b\n', from)).toBe('- a\n  `<div>\n  x`{=html}\n- b\n')
    }
  })

  it('reads container directives only, so prose with a colon keeps its text', () => {
    for (const from of ['markdown', 'gfm'] as const) {
      expect(source('Ratio 1:2, see:here and time 10:30, <m:abc>\n', from))
        .toBe('Ratio 1:2, see:here and time 10:30, \\<m:abc>\n')
      expect(source('::name\n', from)).toBe('::name\n')
    }
  })

  it('keeps a tight list tight when an item holds a second block (C2-M-033)', () => {
    expect(source('* a\n  > b\n* c\n', 'markdown')).toBe('- a\n\n  > b\n- c\n')
  })

  it('writes frontmatter, math and an admonition directive', () => {
    expect(source('---\ntitle: a\n---\n\n$x$ and\n\n$$\n\\sum\n$$\n\n:::note[Head]\nbody\n:::\n', 'markdown'))
      .toBe('---\ntitle: a\n---\n\n$`x` and\n\n$$`\\sum`\n\n::: note "Head"\nbody\n:::\n')
  })

  it('reads a GFM footnote without the pointer at the notes label', () => {
    expect(source('x[^1]\n\n[^1]: note\n', 'gfm')).toBe('x[^1]\n\n[^1]: note\n')
  })

  it('keeps a zero start and raw content of Djot', () => {
    expect(source('0. a\n1. b\n', 'djot')).toBe('{start=0}\n. a\n. b\n')
    expect(source('`<a>`{=html} and\n\n``` =latex\n\\x\n```\n', 'djot')).toBe('`<a>`{=html} and\n\n```=latex\n\\x\n```\n')
  })

  it('links a Djot autolink where djot.js 0.3.2 does, `mailto:` before any address with an at sign (carve-js#5438)', () => {
    expect(source('a <mailto:a@b> b\n', 'djot')).toBe('a [mailto:a@b](mailto:mailto:a@b) b\n')
    const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1] ?? '').filter(h => !h.startsWith('#'))
    const contexts = [(s: string) => `a ${s} b\n`, (s: string) => `[x ${s} y](https://z.example)\n`, (s: string) => `| ${s} |\n`, (s: string) => `t[^n]\n\n[^n]: ${s}\n`]
    for (const scheme of ['mailto:', 'MAILTO:', 'tel:', 'https://', 'foo:', ''])
      for (const rest of ['a@b', 'a@b.c', 'u:p@h', 'a.b/c'])
        for (const context of contexts) {
          const input = context(`<${scheme}${rest}>`)
          expect(hrefs(render(source(input, 'djot'))), input).toEqual(hrefs(renderDjot(parseDjot(input))))
        }
  })

  it('keeps the Djot text before an image on its line', () => {
    expect(source('[link](https://a.b) and ![img](i.png)', 'djot')).toBe('[link](https://a.b) and ![img](i.png)\n')
    expect(source('x ![c](d) y ![e][r]\n\n[r]: u\n', 'djot')).toBe('x ![c](d) y ![e](u)\n')
    expect(source('> q ![c](d)\n> !![e](f)\n', 'djot')).toBe('> q ![c](d)\n> !![e](f)\n')
  })

  it('reports no whitespace normalization for the libraries\' own line breaks', () => {
    const result = importDocument('- a\n- b\n', { from: 'djot' })
    expect(result.diagnostics).toEqual([])
  })

  it.each([['markdown', commonmarkCases()], ['gfm', gfmCases()], ['djot', djotCases()]] as const)(
    'writes %s suite imports that fmt leaves alone and lint finds no error in', (from, cases) => {
      const unstable: string[] = []
      for (const entry of cases) {
        const result = importDocument(entry.input, { from })
        if (writerHasLoss(result.diagnostics)) continue
        if (format(result.source) !== result.source) unstable.push(entry.id)
        if (lint(result.source).some(item => item.severity === 'error')) unstable.push(`${entry.id} (lint)`)
      }
      expect(unstable).toEqual([])
    })
})

describe('BBCode', () => {
  it('maps the tag set of the 0.1 importer', () => {
    expect(source('[b]b[/b] [i]i[/i] [u]u[/u] [s]s[/s] [sup]2[/sup] [sub]x[/sub] [color=red]r[/color] [c]c[/c]', 'bbcode'))
      .toBe('*b* /i/ {_u_} {-s-} {^2^} {,x,} r `c`\n')
    expect(source('[url=https://a.b]link[/url] [email]a@b.c[/email] [img]https://i/p.png[/img]', 'bbcode'))
      .toBe('[link](https://a.b) [a@b.c](mailto:a@b.c) ![](https://i/p.png)\n')
    expect(source('[list][*]a[*]b[/list]\n\n[list=1][*]a[*]b[/list]', 'bbcode')).toBe('- a\n- b\n\n. a\n. b\n')
    expect(source('[table][tr][th]h[/th][/tr][tr][td]d[/td][/tr][/table]', 'bbcode')).toBe('|= h |\n| d |\n')
  })

  it('reads a quote attribution as name, date and post id', () => {
    expect(source('[quote="alice" post_id=12 time=1700000000 user_id=3]q[/quote]', 'bbcode'))
      .toBe('> q\n^ alice (2023-11-14) #12\n')
    expect(source('[QUOTE=bob;123]q[/QUOTE]', 'bbcode')).toBe('> q\n^ bob #123\n')
  })

  it('never makes a raw block of a code language', () => {
    expect(source('[code= =html]\n<b>x</b>\n[/code]', 'bbcode')).toBe('```html\n<b>x</b>\n```\n')
  })

  it('keeps Carve delimiters, unclosed tags and stray closers as text', () => {
    const result = importDocument('*stars* /it/ [b]open [/i] [noparse][b]x[/b][/noparse]', { from: 'bbcode' })
    // C2-W-088 (carve-js#5283, option B): the reported slash kind escapes each slash that can open.
    expect(result.source).toBe('\\*stars* \\/it/ [b]open [\\/i] [b]x[\\/b]\n')
  })

  it('keeps text a list or table holds outside its items and cells', () => {
    expect(source('[list]intro[*]a[/list]', 'bbcode')).toBe('intro\n\n- a\n')
    expect(source('[list]only text[/list]', 'bbcode')).toBe('only text\n')
    expect(source('[table]t[tr]r[td]d[/td][/tr][/table]', 'bbcode')).toBe('t\n\nr\n\n| d |\n')
  })

  it('reports an unknown tag once and keeps its content', () => {
    const result = importDocument('[foo]x[/foo]', { from: 'bbcode' })
    expect([result.source, result.diagnostics.map(entry => entry.code)]).toEqual(['x\n', ['import-unsupported']])
  })

  it('refuses an input past the limit in UTF-8 bytes', () => {
    const atLimit = 'é'.repeat(BBCODE_MAX_INPUT_LENGTH / 2)
    expect(source(atLimit, 'bbcode')).toBe(`${atLimit}\n`)
    expect(() => importDocument(`${atLimit}x`, { from: 'bbcode' })).toThrow(BbcodeInputTooLargeError)
    expect(() => importDocument(`${atLimit}x`, { from: 'bbcode' })).toThrow(ImportInputError)
  })
})

describe('a denied block image', () => {
  it('leaves its alt text where it stood alone in a list item, instead of an image paragraph without an image', () => {
    expect(source('- ![a](data:x)\n', 'gfm')).toBe('- a\n')
    expect(source('<ul><li><img src="data:x" alt="a"></li></ul>', 'html')).toBe('- a\n')
    expect(source('<img src="javascript:x" alt="a">', 'html')).toBe('a\n')
    expect(source('[list]\n[*][img=a]javascript:x[/img]\n[/list]\n', 'bbcode')).toBe('- a\n')
    for (const [input, from] of [['- ![](data:x)\n', 'gfm'], ['[list][*][img]javascript:x[/img][/list]', 'bbcode']] as const) {
      expect(importDocument(input, { from }).diagnostics.some(entry => entry.code === 'import-destination-denied')).toBe(true)
    }
  })

  it('leaves a Markdown, Djot or BBCode item it empties holding a comment, the parsed empty item (carve#6428)', () => {
    for (const from of ['markdown', 'gfm', 'djot'] as const) {
      expect(source('- ![](data:x)\n', from)).toBe('- %%\n')
      expect(source('> - ![](javascript:x)\n', from)).toBe('> - %%\n')
      expect(source('p\n\n1. ![](data:x)\n', from)).toBe('p\n\n. %%\n')
      const result = importDocument('- a\n- ![](data:x)\n', { from })
      expect(result.source).toBe('- a\n- %%\n')
      expect(result.diagnostics.map(entry => entry.code)).toEqual(['import-destination-denied'])
    }
    expect(source(': t\n\n  ![](data:x)\n', 'djot')).toBe(':: t\n: %%\n')
    expect(source('-\n', 'gfm')).toBe('- %%\n')
    expect(source('- a\n-\n- b\n', 'djot')).toBe('- a\n- %%\n- b\n')
    expect(source('[list][*][img]javascript:x[/img][/list]', 'bbcode')).toBe('- %%\n')
    expect(source('[list][*]a[*][/list]', 'bbcode')).toBe('- a\n- %%\n')
    expect(source('[quote][list][*][/list][/quote]', 'bbcode')).toBe('> - %%\n')
    expect(source('[list][*]a\0[*][/list]', 'bbcode')).toBe('- a\n- %%\n')
  })
})

describe('micromark 4.0.3 workarounds', () => {
  it('keeps the line endings of code after a definition or a tight paragraph (carve-js#5402)', () => {
    expect(source('[r]: /u\n\n    a\n    b\n', 'gfm')).toBe('```\na\nb\n```\n')
    expect(source('[r]: /u\n```\n\na\nb\n```\n', 'markdown')).toBe('```\n\na\nb\n```\n')
    expect(source('- a\n  ```\n  b\n  c\n  ```\n', 'gfm')).toBe('- a\n\n  ```\n  b\n  c\n  ```\n')
    expect(source('- a\n  $$\n  b\n  c\n  $$\n', 'gfm')).toBe('- a\n\n  $$`b\n  c`\n')
  })

  it('starts a list at any number below indented code, which it does not interrupt (carve-js#5403)', () => {
    expect(source('    x\n10) y\n', 'gfm')).toBe('```\nx\n```\n\n{start=10}\n. y\n')
    expect(source('- a\n\n      x\n  10) y\n', 'markdown')).toBe('- a\n\n  ```\n  x\n  ```\n\n  {start=10}\n  . y\n')
    expect(source('    x\n> 10) y\n', 'gfm')).toBe('```\nx\n```\n\n> {start=10}\n> . y\n')
    expect(source('a\n10) y\n', 'gfm')).toBe('a\n10) y\n')
  })

  it('gives an unclosed fence in a container each of its lines once', () => {
    expect(source('- ```\n  a\n  b\n', 'gfm')).toBe('- ```\n  a\n  b\n  ```\n')
    expect(source('- ```\n  a\n- c\n', 'gfm')).toBe('- ```\n  a\n  ```\n- c\n')
    expect(source('> ```\n> a\n- c\n', 'gfm')).toBe('> ```\n> a\n> ```\n\n- c\n')
    expect(source('- ```\n  a\n\nc\n', 'gfm')).toBe('- ```\n  a\n\n  ```\n\nc\n')
    expect(source('> ```\n> a\n>', 'gfm')).toBe('> ```\n> a\n>\n> ```\n')
    expect(source('> ```\n>\n', 'gfm')).toBe('> ```\n>\n> ```\n')
  })

  it('reads lists and quotes after an unclosed frontmatter fence', () => {
    expect(source('---\n\n- y\n', 'gfm')).toBe('***\n\n- y\n')
    expect(source('---\n\n12. y\n', 'markdown')).toBe('***\n\n{start=12}\n. y\n')
    expect(source('+++\n\n> q\n', 'gfm')).toBe('+++\n\n> q\n')
    expect(source('---\na: 1\n---\n\n- y\n', 'gfm')).toBe('---\na: 1\n---\n\n- y\n')
  })
})
