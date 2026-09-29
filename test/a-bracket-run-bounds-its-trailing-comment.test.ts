import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('a bracket run bounds its trailing comment (#2359)', () => {
  it.each([
    ['[a %% hidden]', '<p>[a]</p>'],
    ['[a\t%% hidden] tail', '<p>[a] tail</p>'],
    ['[a %% h1] and [b %% h2]', '<p>[a] and [b]</p>'],
    ['[see [t] %% hidden]', '<p>[see [t]]</p>'],
    ['[see [t %% hidden] x]', '<p>[see [t] x]</p>'],
    ['[%% hidden]', '<p>[]</p>'],
    ['[%%hidden]', '<p>[]</p>'],
    ['[ %% hidden]', '<p>[]</p>'],
    ['[a%% hidden]', '<p>[a%% hidden]</p>'],
    ['[a %% hidden', '<p>[a</p>'],
    ['[a %% hidden\nb]', '<p>[a\nb]</p>'],
    ['[a `%% no` %% yes]', '<p>[a <code>%% no</code>]</p>'],
    ['[a \\] b %% hidden]', '<p>[a ] b]</p>'],
    ['[a `]` %% hidden] tail', '<p>[a <code>]</code>] tail</p>'],
    ['*[a %% hidden]* tail', '<p><strong>[a]</strong> tail</p>'],
    ['_[a %% hidden]_', '<p><u>[a]</u></p>'],
    ['*a %% hidden*', '<p>*a</p>'],
    ['::: {.box} [a\t%% hidden]', '<p>::: {.box} [a]</p>'],
    ['[a %% hidden](u)', '<p><a href="u">a</a></p>'],
    ['[a %% hidden]{.c}', '<p><span class="c">a</span></p>'],
    ['[see [t](u) %% hidden]', '<p>[see <a href="u">t</a>]</p>'],
    ['![a %% hidden](u)', '<img src="u" alt="a %% hidden">'],
    ['[^a %% hidden]', '<p>[^a %% hidden]</p>'],
    ['[a %% hidden][r]', '<p>[a %% hidden][r]</p>'],
    ['\\[a %% hidden] tail', '<p>[a</p>'],
    ['`[a` %% hidden] tail', '<p><code>[a</code></p>'],
  ])('%s', (source, expected) => {
    expect(carveToHtml(source).trim()).toBe(expected)
  })

  it('ends the comment source span before the closing bracket', () => {
    const doc = carveToAstJson('[a %% hidden] tail')
    expect(doc.children[0]).toMatchObject({
      type: 'paragraph',
      children: [
        { type: 'text', value: '[a' },
        { type: 'comment', content: 'hidden', pos: { startOffset: 3, endOffset: 12 } },
        { type: 'text', value: '] tail', pos: { startOffset: 12, endOffset: 18 } },
      ],
    })
  })

  it('keeps every closer in a long line of sibling runs', () => {
    expect(carveToHtml('[a %% hidden] '.repeat(4000)).trim()).toBe(
      `<p>${'[a] '.repeat(4000).trim()}</p>`,
    )
  })

  it('keeps a valid container and its children', () => {
    expect(carveToHtml('::: note [a\t%% hidden]\nx\n:::')).toBe(
      '<aside class="admonition note" aria-label="Note">\n  <p class="div-label">a</p>\n  <p>x</p>\n</aside>',
    )
  })

  it.each([
    ['# [a %% hidden]', '<h1>[a]</h1>'],
    ['> [a %% hidden]', '<p>[a]</p>'],
    ['- [a %% hidden]', '<li>[a]</li>'],
    ['| h | i |\n|---|---|\n| [x %% hidden] | y |', '<td>[x]</td>'],
  ])('bounds comments in %s', (source, expected) => {
    expect(carveToHtml(source)).toContain(expected)
  })
})
