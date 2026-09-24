import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown import list and reference boundaries', () => {
  it.each([
    'A. Smith wrote this.',
    '. Smith wrote this.',
    'iv. Smith wrote this.',
    '1234567890. Smith wrote this.',
    '- a\n  . b',
    '- b. c',
    '- [x] iv. c',
    '> A. Smith wrote this.',
  ])('keeps Carve-only list markers as text: %s', (source) => {
    const imported = markdownToCarve(source)
    expect(imported).toMatch(/\\[.)]/)
    expect(carveToHtml(imported)).not.toContain('<ol')
  })

  it('keeps a non-1 marker after a lazy item line as text', () => {
    const imported = markdownToCarve('- d\n  - d\nx\n      3) b')
    expect(imported).toContain('3\\) b')
    expect(carveToHtml(imported)).not.toContain('<ol')
  })

  it('keeps a shortcut reference linked and writes its definition last', () => {
    const imported = markdownToCarve('a [x]\n\n[x]: /u\n\nb')
    expect(imported).toContain('[x][]')
    expect(imported.trimEnd().endsWith('[x]: /u')).toBe(true)
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it('moves a definition on an item line and joins continued destination and title', () => {
    const imported = markdownToCarve('- [x]:\n  /u\n  "Title"\n\n[x]')
    expect(imported).toContain('[x][]')
    expect(imported.trimEnd().endsWith('[x]: /u "Title"')).toBe(true)
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it.each([
    ['[x]: /u\nb [x]', 'b [x][]\n\n[x]: /u'],
    ['[b]: /2\n[a]: /1\n\n[a] [b]', '[a][] [b][]\n\n[b]: /2\n\n[a]: /1'],
    ['[x]: /1\n[X]: /2\n\n[x]', '[x][]\n\n[x]: /1'],
    ['[x]: /u\n"Title"\nb [x]', 'b [x][]\n\n[x]: /u "Title"'],
  ])('moves valid definitions to the end: %s', (source, expected) => {
    const imported = markdownToCarve(source)
    expect(imported).toBe(expected)
    expect(carveToCarve(imported).trimEnd()).toBe(imported.trimEnd())
  })

  it('keeps a quote and a list item when moving their definitions', () => {
    const quote = markdownToCarve('> [x]: /u\n> b [x]')
    expect(quote).toContain('> b [x][]')
    expect(quote.trimEnd().endsWith('[x]: /u')).toBe(true)

    const item = markdownToCarve('- [x]: /u\n- b [x]')
    expect(item).toContain('- %%')
    expect(item).toContain('- b [x][]')
  })

  it('keeps definitions that separate two lists from merging them', () => {
    const imported = markdownToCarve('- a\n\n[x]: /u\n- b [x]')
    expect((carveToHtml(imported).match(/<ul>/g) ?? [])).toHaveLength(2)
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it('keeps a quote that holds only a moved definition', () => {
    const imported = markdownToCarve('a\n\n> [x]: /u\n\nb')
    expect(carveToHtml(imported)).toContain('<blockquote>')
    expect(imported.trimEnd().endsWith('[x]: /u')).toBe(true)
  })

  it('uses the first reference definition even when a later one has a destination', () => {
    const imported = markdownToCarve('[x]\n\n[x]: <>\n[x]: /later')
    expect(carveToHtml(imported)).not.toContain('href="/later"')
  })

  it('does not change code fences, footnotes, or a line without a destination', () => {
    const source = '```\nA. text\n```\n\n- ```\n  1234567890. text\n  ```\n\nSee [^n]\n\n[^n]: Note\n\n[x]:\n\n[x]'
    const imported = markdownToCarve(source)
    expect(imported).toContain('```\nA. text\n```')
    expect(imported).toContain('1234567890. text')
    expect(imported).not.toContain('1234567890\\. text')
    expect(imported).toContain('[^n]: Note')
    expect(imported).toContain('See [^n]')
    expect(imported).not.toContain('[^n][]')
    expect(imported).toContain('[x]:')
    expect(imported).not.toContain('[x][]')
  })

  it('leaves a task box and image alt text alone when their labels have definitions', () => {
    const imported = markdownToCarve('- [x] done\n\n![x](/image)\n\n[x]: /link')
    expect(imported).toContain('- [x] done')
    expect(imported).toContain('![x](/image)')
    expect(imported).not.toContain('- [x][]')
    expect(imported).not.toContain('![x][]')
  })

  it('keeps an authored collapsed reference in a list item', () => {
    const imported = markdownToCarve('- [x][] done\n\n[x]: /u')
    expect(imported).toContain('- [x][] done')
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it('keeps a loose item paragraph inside its list after moving a definition', () => {
    const imported = markdownToCarve('- [x]: /u\n\n  b [x]\n- c')
    const html = carveToHtml(imported)
    expect((html.match(/<ul>/g) ?? [])).toHaveLength(1)
    expect(html).toContain('href="/u"')
  })

  it('converts a parenthesized reference title to a Carve title', () => {
    const imported = markdownToCarve('[x]: /u (t)\n\n[x]')
    expect(imported).toContain('[x]: /u "t"')
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it.each(['  > q [x]', '  - sub'])('keeps a nested block under a definition item: %s', (child) => {
    const imported = markdownToCarve(`- [x]: /u\n\n${child}`)
    const html = carveToHtml(imported)
    expect((html.match(/<ul>/g) ?? [])).toHaveLength(child.includes('- sub') ? 2 : 1)
    expect(html).not.toMatch(/<\/ul>\s*<blockquote>/)
  })

  it('keeps indented code under a definition item', () => {
    const imported = markdownToCarve('- [x]: /u\n\n      code')
    expect(carveToHtml(imported)).toContain('<pre><code>code\n</code></pre>')
  })

  it('keeps a shortcut label with emphasis linked', () => {
    const imported = markdownToCarve('[a *b*]\n\n[a *b*]: /v')
    expect(carveToHtml(imported)).toContain('href="/v"')
  })

  it('keeps an ordered task box when its label is defined', () => {
    const imported = markdownToCarve('1. [x] done\n\n[x]: /u')
    expect(imported).not.toContain('[x][]')
    expect(carveToHtml(imported)).toContain('[x] done')
  })

  it('does not rewrite shortcut labels inside URLs, titles, or HTML attributes', () => {
    const source = '<http://a.b/[x]>\n\n[t](/p[x]q "see [x]")\n\n<span title="[x]">ok</span>\n\n[x]: /u'
    const imported = markdownToCarve(source)
    expect(imported).toContain('<http://a.b/[x]>')
    expect(imported).toContain('/p[x]q')
    expect(imported).toContain('see [x]')
    expect(imported).toContain('title="[x]"')
    expect(imported).not.toContain('[x][]q')
  })

  it('keeps a shortcut linked when its destination has a space', () => {
    const imported = markdownToCarve('[x]: </a b>\n\n[x]')
    expect(imported).toContain('[x]: /a%20b')
    expect(carveToHtml(imported)).toContain('href="/a%20b"')
  })

  it('uses the source definition label for a differently cased shortcut', () => {
    const imported = markdownToCarve('[X]\n\n[x]: /link')
    expect(imported).toContain('[X][x]')
    expect(carveToHtml(imported)).toContain('href="/link"')
  })

  it('does not escape a marker inside a multiline inline code span', () => {
    const imported = markdownToCarve('`first\nA. second`')
    expect(imported).not.toContain('A\\. second')
  })

  it.each(['# heading', '- item'])('does not pull a block opener into a quote after its definition: %s', (next) => {
    const imported = markdownToCarve(`> [x]: /u\n${next}\n\n[x]`)
    expect(imported).toContain(next)
    expect(carveToHtml(imported)).toContain('href="/u"')
  })

  it('extracts consecutive definitions after an item marker', () => {
    const imported = markdownToCarve('- [a]: /1\n  [b]: /2\n\n[a] [b]')
    expect(imported).toContain('[a][] [b][]')
    expect(imported).toContain('[a]: /1')
    expect(imported).toContain('[b]: /2')
    expect(carveToHtml(imported)).toContain('href="/2"')
  })

  it('keeps an indented paragraph after a moved definition as prose', () => {
    const imported = markdownToCarve('[x]: /u\n    paragraph\n\n[x]')
    expect(carveToHtml(imported)).toContain('<p>paragraph</p>')
    expect(carveToHtml(imported)).toContain('href="/u"')
  })
})
