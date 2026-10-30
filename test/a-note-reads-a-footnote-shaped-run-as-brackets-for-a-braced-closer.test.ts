import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index'

const noteBody = (source: string): string => /<li id="fn1">\s*<p>(.*?)<a href="#fnref1"/s.exec(carveToHtml(source))?.[1] ?? ''

describe('a braced closer inside a note, behind a footnote-shaped run', () => {
  it.each([
    ['^[{+[^[g]+}] b+}]', '<ins>[^[g]+}] b</ins>'],
    ['^[{-[^[g]-}] b-}]', '<del>[^[g]-}] b</del>'],
    ['^[{*[^[g]*}] b*}]', '<strong>[^[g]*}] b</strong>'],
  ])('%s', (source, body) => {
    expect(noteBody(source)).toBe(body)
  })

  it('holds in a nested note', () => {
    expect(carveToHtml('^[o ^[{+[^[g]+}] b+}]]')).toContain('<ins>[^[g]+}] b</ins>')
  })

  it('still reads the run as a reference outside a note', () => {
    expect(carveToHtml('{+[^[g]+}] b+}')).toBe('<p><ins>[^[g]</ins>] b+}</p>')
  })
})
