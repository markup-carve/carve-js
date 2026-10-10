import { describe, it, expect } from 'vitest'
import { carveToHtml, djotToCarve, markdownToCarve } from '../src/index.js'
import { escapePlainCarveInlineSyntax, HANDLED_DJOT, HANDLED_MARKDOWN } from '../src/carve-escape.js'

/*
 * carve-js#2690. A comment opens on the first two UNESCAPED percent signs, and
 * a third does not close or cancel anything - so a run of ANY length needs the
 * escape, and both importers were writing a run longer than two bare. The rest
 * of the line was then read as comment text and lost: `a %%%c b` re-rendered as
 * `<p>a</p>`.
 *
 * One escape on the first sign is the whole of what the run owes: after `\%`
 * the remaining signs sit inside a word, where no opener rule reaches them.
 * carve-php and carve-rs already write exactly that (carve-rs#2443,
 * carve-php#3049).
 */

const text = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('a longer percent run still opens a comment', () => {
  it('escapes a tripled run on its first sign', () => {
    expect(escapePlainCarveInlineSyntax('a %%%c b')).toBe('a \\%%%c b')
  })

  it('escapes a four-sign run the same way, since one length does not pin a rule', () => {
    expect(escapePlainCarveInlineSyntax('a %%%%c b')).toBe('a \\%%%%c b')
  })

  it('escapes a longer run at the start of a line, where it would open a block comment', () => {
    expect(escapePlainCarveInlineSyntax('%%%c b')).toBe('\\%%%c b')
    expect(escapePlainCarveInlineSyntax('%%%')).toBe('\\%%%')
  })

  it('adds no second escape to a run the source already escaped', () => {
    expect(escapePlainCarveInlineSyntax('a \\%% b')).toBe('a \\%% b')
    expect(escapePlainCarveInlineSyntax('a \\%%% b')).toBe('a \\%%% b')
  })

  it('leaves a lone percent and an intraword run alone, neither being an opener', () => {
    expect(escapePlainCarveInlineSyntax('a % b')).toBe('a % b')
    expect(escapePlainCarveInlineSyntax('100%%x')).toBe('100%%x')
    expect(escapePlainCarveInlineSyntax('100%%%x')).toBe('100%%%x')
  })

  it('renders the author text back, which the bare run did not', () => {
    expect(text(carveToHtml(escapePlainCarveInlineSyntax('a %%%c b')))).toBe('<p>a %%%c b</p>')
    expect(text(carveToHtml('a %%%c b'))).toBe('<p>a</p>')
  })

  it('carries a tripled run through the Markdown importer', () => {
    const carve = markdownToCarve('a %%%c b')

    expect(carve.trim()).toBe('a \\%%%c b')
    expect(text(carveToHtml(carve))).toBe('<p>a %%%c b</p>')
  })

  it('carries a tripled run through the Djot importer', () => {
    const carve = djotToCarve('a %%%c b')

    expect(carve.trim()).toBe('a \\%%%c b')
    expect(text(carveToHtml(carve))).toBe('<p>a %%%c b</p>')
  })

  it('carries a run at line start through the Djot importer', () => {
    const carve = djotToCarve('%%%\n')

    expect(carve.trim()).toBe('\\%%%')
    expect(text(carveToHtml(carve))).toBe('<p>%%%</p>')
  })

  it('still reads an authored comment as a comment, in both profiles', () => {
    // The control: nothing here touches the parser, so authored Carve is
    // unchanged and a real comment still hides its text.
    expect(text(carveToHtml('a %% c'))).toBe('<p>a</p>')
    expect(escapePlainCarveInlineSyntax('a %%%c b', HANDLED_MARKDOWN)).toBe('a \\%%%c b')
    expect(escapePlainCarveInlineSyntax('a %%%c b', HANDLED_DJOT)).toBe('a \\%%%c b')
  })
})
