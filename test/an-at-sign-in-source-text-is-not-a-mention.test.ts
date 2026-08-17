import { describe, it, expect } from 'vitest'
import { escapePlainCarveInlineSyntax } from '../src/carve-escape.js'
import { carveToHtml, markdownToCarve, bbcodeToCarve } from '../src/index.js'

/**
 * An at-sign that opens a Carve mention is escaped when it arrives as text.
 * The sibling of the tag rule, ported from carve-php#1381.
 *
 * A mention is not a pair: it opens on its own and needs no closer, so nothing
 * downstream can neutralize it and prose that quoted a framework directive
 * came back as a mention span.
 */
describe('an at-sign in source text is not a Carve mention', () => {
  const roundTrip = (src: string) => carveToHtml(escapePlainCarveInlineSyntax(src)).replace(/\s+/g, ' ').trim()

  it('escapes a bare mention, which no source language shares', () => {
    expect(escapePlainCarveInlineSyntax('hi @user ok')).toBe('hi \\@user ok')
    expect(roundTrip('hi @user ok')).toBe('<p>hi @user ok</p>')
  })

  it('covers an opener at the start of the line', () => {
    expect(roundTrip('@click toggles it')).toBe('<p>@click toggles it</p>')
  })

  it('covers a dotted name, which the parser reads as one mention', () => {
    expect(roundTrip('use @keydown.window here')).toBe('<p>use @keydown.window here</p>')
  })

  it('covers an opener after a parenthesis', () => {
    expect(roundTrip('see (@can) there')).toBe('<p>see (@can) there</p>')
  })

  it('covers an opener before a dash, which the parser also opens on', () => {
    expect(roundTrip('the @-form')).toBe('<p>the @-form</p>')
  })

  it('leaves an email address alone, since a letter precedes the at-sign', () => {
    expect(escapePlainCarveInlineSyntax('mail me at foo@bar.de')).toBe('mail me at foo@bar.de')
    expect(escapePlainCarveInlineSyntax('a@b')).toBe('a@b')
  })

  it('leaves an at-sign that opens nothing alone', () => {
    expect(escapePlainCarveInlineSyntax('name @ handle')).toBe('name @ handle')
    expect(escapePlainCarveInlineSyntax('ping @, later')).toBe('ping @, later')
    expect(escapePlainCarveInlineSyntax('ends with @')).toBe('ends with @')
  })

  it('does not escape an at-sign the source already escaped', () => {
    expect(escapePlainCarveInlineSyntax('hi \\@user ok')).toBe('hi \\@user ok')
  })

  it('leaves the at-sign to a caller that converts it itself', () => {
    expect(escapePlainCarveInlineSyntax('hi @user ok', { bare: '@' })).toBe('hi @user ok')
  })

  it('reaches the Markdown and BBCode converters', () => {
    expect(markdownToCarve('hi @user ok').trim()).toBe('hi \\@user ok')
    expect(bbcodeToCarve('hi @user ok').trim()).toBe('hi \\@user ok')
  })

  it('BOUND: an authored Carve mention still renders as one', () => {
    expect(carveToHtml('hi @user ok')).toContain('class="mention"')
  })
})
