import { describe, expect, it } from 'vitest'
import { LiteralCommentClosers } from '../src/literal-comment-closers.js'

describe('literal comment closers', () => {
  it('refuses a closer beyond a sibling departure', () => {
    const index = new LiteralCommentClosers([Infinity, 2, 0, Infinity], [3, undefined, undefined, 3])
    expect(index.hasCloser(3, 0, 2)).toBe(false)
    expect(index.hasCloser(3, 0, 0)).toBe(true)
  })

  it('excludes the opener and closer columns from the interval', () => {
    const index = new LiteralCommentClosers([0, Infinity, 4, 0], [3, undefined, undefined, 3])
    expect(index.hasCloser(3, 0, 4)).toBe(true)
    expect(index.hasCloser(3, 0, 5)).toBe(false)
    expect(new LiteralCommentClosers([0, 0], [3, 3]).hasCloser(3, 0, 20)).toBe(true)
  })

  it('does not treat quote-prefixed text supplied without a run as a closer', () => {
    const index = new LiteralCommentClosers([Infinity, 0, Infinity], [3, undefined, 3])
    expect(index.hasCloser(3, 0, 2)).toBe(false)
    expect(new LiteralCommentClosers([Infinity, 0], [3, undefined]).hasCloser(3, 0, 0)).toBe(false)
  })

  it('uses the next exact-width run rather than a longer or later run', () => {
    const index = new LiteralCommentClosers([Infinity, Infinity, 0, Infinity, 4, Infinity], [3, 4, undefined, 3, undefined, 3])
    expect(index.hasCloser(3, 0, 2)).toBe(false)
    expect(index.hasCloser(3, 3, 2)).toBe(true)
    expect(index.hasCloser(4, 1, 0)).toBe(false)
    expect(index.hasCloser(3, 5, 0)).toBe(false)
  })

  it('handles empty inputs and invalid opener boundaries', () => {
    expect(new LiteralCommentClosers([], []).hasCloser(3, 0, 0)).toBe(false)
    const index = new LiteralCommentClosers([Infinity, Infinity], [3, 3])
    for (const at of [-1, 2, 0.5, Infinity, NaN]) expect(index.hasCloser(3, at, 0)).toBe(false)
    expect(() => new LiteralCommentClosers([0], [])).toThrow(RangeError)
  })

  it('matches a direct interval check across widths and floors', () => {
    const columns = [Infinity, 4, Infinity, 2, 0, Infinity, 6, Infinity]
    const runs = [3, undefined, 4, undefined, undefined, 3, undefined, 4]
    const index = new LiteralCommentClosers(columns, runs)
    for (let opener = 0; opener < columns.length; opener++) {
      for (const width of [3, 4, 5]) {
        const closer = runs.findIndex((run, at) => at > opener && run === width)
        for (const floor of [0, 2, 4, 8]) {
          const expected = closer !== -1 && columns.slice(opener + 1, closer).every(column => column >= floor)
          expect(index.hasCloser(width, opener, floor)).toBe(expected)
        }
      }
    }
  })

  it('indexes many unique unclosed widths without suffix reads', () => {
    let reads = 0
    const columns = Array.from({ length: 20000 }, () => Infinity)
    const runs = Array.from({ length: columns.length }, (_, at) => at + 3)
    const measured = new Proxy(columns, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      },
    })
    const index = new LiteralCommentClosers(measured, runs)
    expect(reads).toBe(columns.length)
    for (let at = 0; at < runs.length; at++) expect(index.hasCloser(runs[at]!, at, 2)).toBe(false)
    expect(reads).toBe(columns.length)
  })
})
