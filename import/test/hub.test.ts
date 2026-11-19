import { describe, expect, it } from 'vitest'
import { format } from '../../src/index.ts'
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
    expect(result.source).toBe('\\*stars* \\/it/ [b]open [/i] [b]x[/b]\n')
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
