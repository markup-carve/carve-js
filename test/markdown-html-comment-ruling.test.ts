import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve, markdownToCarve, migrateMarkdown } from '../src/index.js'

describe('carve#4812 HTML comment ruling', () => {
  it('imports a standalone Markdown HTML comment as a line comment', () => {
    const markdown = 'Before.\n\n<!-- TODO secret -->\n\nAfter.\n'
    const imported = markdownToCarve(markdown)
    expect(imported).toBe('Before.\n\n%% TODO secret\n\nAfter.\n')
    expect(carveToHtml(imported)).toBe('<p>Before.</p>\n<p>After.</p>')
    expect(migrateMarkdown(markdown).report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'markdown-html-comment', fidelity: 'normalized', path: 'line:3',
    }))
  })

  it('imports a multiline comment as a comment fence and widens past a body fence', () => {
    const markdown = '<!--\nline\n%%%\nmore\n-->\n'
    expect(markdownToCarve(markdown)).toBe('%%%%\nline\n%%%\nmore\n%%%%\n')
    expect(carveToHtml(markdownToCarve(markdown))).toBe('')
  })

  it('keeps comments in paragraphs and mixed HTML blocks on the raw HTML path', () => {
    expect(markdownToCarve('a <!-- x --> b\n')).toContain('{=html}')
    expect(markdownToCarve('<!-- one --> <p>x</p>\n')).toContain('```=html')
  })

  it('keeps the comment in a quote or list and reports its source line', () => {
    expect(markdownToCarve('> <!-- q -->\n')).toBe('> %% q\n')
    expect(markdownToCarve('- x\n\n  <!-- y -->\n')).toContain('  %% y\n')
    expect(migrateMarkdown('- x\n\n  <!-- y -->\n').report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'markdown-html-comment', path: 'line:3',
    }))
  })

  it('warns only for complete visible comments in Carve paragraphs', () => {
    expect(lintCarve('<!-- TODO secret -->\n').map(w => w.rule)).toContain('html-comment-renders-as-text')
    const across = lintCarve('a <!-- x\ny --> b\n').filter(w => w.rule === 'html-comment-renders-as-text')
    expect(across).toMatchObject([{ line: 1, column: 3 }])
    for (const source of ['`<!-- x -->`\n', 'a <!-- x\n', '%% TODO secret\n', '```text\n<!-- x -->\n```\n']) {
      expect(lintCarve(source).map(w => w.rule), source).not.toContain('html-comment-renders-as-text')
    }
  })

  it('widens the fence past an indented or tailed comment fence line in the body', () => {
    const markdown = '  <!--\n  line\n  %%%\n  more\n  -->\n'
    expect(markdownToCarve(markdown)).toBe('%%%%\nline\n  %%%\n  more\n%%%%\n')
    expect(carveToHtml(markdownToCarve(markdown))).toBe('')
    const tailed = '<!--\nline\n%%% end\n\t%%%% x\nmore\n-->\n'
    expect(markdownToCarve(tailed)).toBe('%%%%%\nline\n%%% end\n\t%%%% x\nmore\n%%%%%\n')
    expect(carveToHtml(markdownToCarve(tailed))).toBe('')
  })

  it('reads the visible text before a trailing line comment on a closer line', () => {
    const rule = (source: string) => lintCarve(source).filter(w => w.rule === 'html-comment-renders-as-text')
    expect(rule('> <!-- a\n> b --> %% c\n')).toMatchObject([{ line: 1, column: 3 }])
    expect(rule('text\n: <!-- a\n  b --> %% c\n')).toMatchObject([{ line: 2, column: 3 }])
    expect(rule('x <!-- a --> %% c\n')).toMatchObject([{ line: 1, column: 3 }])
    for (const source of ['a <!-- x\nb %% --> c\n', 'a <!-- x %% y -->\n', 'a\n%% <!-- x -->\n']) {
      expect(rule(source), source).toEqual([])
    }
    expect(lintCarve('a {% hidden\n| x\n%} b\n').map(w => w.rule)).not.toContain('table-shaped-paragraph')
  })
})
