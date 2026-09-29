import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { LEADING_WHITESPACE_UNSPELLABLE } from '../src/import-report-messages.js'

/*
 * Whitespace a decoded character reference puts at the start of a line has no
 * Carve spelling, and the importer DROPS it and records the loss rather than
 * substituting a character (markup-carve/carve#2595, ruled 2026-09-29).
 *
 * This used to emit `\ `, which Carve reads as U+00A0. A non-breaking space is
 * not the tab or space the author wrote: it changes line breaking and copies out
 * of a browser as a different byte, so the substitution travels further than the
 * document. The precedent is this project's HTML round-trip ruling that an empty
 * half beats a wrong one.
 *
 * CommonMark row 40 is the named fixture. carve-php and carve-rs already drop.
 */

const convert = (markdown: string) => markdownToCarveWithLosses(markdown)

describe('the character goes, and the loss is recorded', () => {
  it('drops a decoded tab at a paragraph start (CommonMark row 40)', () => {
    const { value, losses } = convert('&#9;foo\n')
    expect(value).toBe('foo\n')
    expect(carveToHtml(value)).toBe('<p>foo</p>')
    expect(losses).toEqual([{ code: 'structure-unspellable', message: LEADING_WHITESPACE_UNSPELLABLE }])
  })

  it('drops a decoded space the same way', () => {
    expect(convert('&#32;foo\n').value).toBe('foo\n')
  })

  it('drops a whole run of them', () => {
    expect(convert('&#9;&#9;foo\n').value).toBe('foo\n')
  })

  it('reports nothing when the decode leaves no leading whitespace', () => {
    expect(convert('a &amp; b\n').losses).toEqual([])
  })

  it('leaves whitespace the author wrote as indentation alone', () => {
    const { value, losses } = convert('  a &amp; b\n')
    expect(value).toBe('  a & b\n')
    expect(losses).toEqual([])
  })

  it('keeps a real non-breaking space, which the author did write', () => {
    expect(convert('&#160;foo\n').value).toBe(' foo\n')
  })
})

describe('dropping it does not open a block', () => {
  // The whitespace was indentation to every block rule after the decode, so the
  // marker it leaves at column 0 is escaped. The line stays the paragraph cmark
  // reads, which is what the old substitution was protecting.
  it.each([
    ['&#32;- item\n', '\\- item\n', '<p>- item</p>'],
    ['&#32;* item\n', '\\* item\n', '<p>* item</p>'],
    ['&#32;# h\n', '\\# h\n', '<p># h</p>'],
    ['&#32;> q\n', '\\> q\n', '<p>&gt; q</p>'],
    ['&#32;1. x\n', '1\\. x\n', '<p>1. x</p>'],
    ['&#32;| a | b |\n', '\\| a | b |\n', '<p>| a | b |</p>'],
    ['&#32;%% c\n', '\\%% c\n', '<p>%% c</p>'],
  ])('%j', (markdown, carve, html) => {
    expect(convert(markdown).value).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })

  it('keeps a container opener from opening a container', () => {
    const { value } = convert('&#32;::: note\nx\n:::\n')
    expect(carveToHtml(value)).toBe('<p>::: note\nx\n:::</p>')
  })

  // A definition is not merely a different block: it reaches no output, so the
  // paragraph disappeared entirely rather than losing its leading space. Raised
  // by codex review.
  it.each([
    ['&#32;[foo]: /url\n', '\\[foo]: /url\n', '<p>[foo]: /url</p>'],
    ['&#32;[^a]: b\n', '\\[^a]: b\n', '<p>[^a]: b</p>'],
    ['&#32;*[x]: y\n', '\\*[x]: y\n', '<p>*[x]: y</p>'],
  ])('keeps the paragraph for %j', (markdown, carve, html) => {
    expect(convert(markdown).value).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })

  it('leaves a bracket run that is not a definition alone', () => {
    expect(convert('&#32;[a] b\n').value).toBe('[a] b\n')
  })
})
