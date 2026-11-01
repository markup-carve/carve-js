import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

describe('Unicode bare emphasis boundaries (carve#4806)', () => {
  it('keeps bare delimiters inside words literal', () => {
    expect(html('Москва/Питер/Киев\n日本/中国/韩国\nснейк_кейс_тут\nä/ö/ü\n'))
      .toBe('<p>Москва/Питер/Киев\n日本/中国/韩国\nснейк_кейс_тут\nä/ö/ü</p>')
  })

  it('allows a braced span inside a word', () => {
    expect(html('日本{/中国/}韩国\n')).toBe('<p>日本<em>中国</em>韩国</p>')
  })

  it.each(['é*x*', 'y *x*é', '𐐀*x*', 'y *x*𐐀', '𝟘/x/'])
    ('keeps an astral or accented flank literal: %s', source => {
      expect(html(source + '\n')).toBe(`<p>${source}</p>`)
    })
})
