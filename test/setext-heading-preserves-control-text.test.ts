import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each(['\f', '\v', '\u00a0'])('preserves %j in setext heading text', character => {
  for (const underline of ['===', '---']) {
    for (const prefix of ['', '> ', '- ']) {
      const source = `${prefix}a${character}\n${prefix === '- ' ? '  ' : prefix}${underline}\n`
      const converted = markdownToCarve(source)
      expect(converted).toContain(`a${character}`)
      expect(carveToHtml(converted)).toContain(`a${character === '\u00a0' ? '&nbsp;' : character}</h`)
    }
    expect(carveToHtml(markdownToCarve(`a${character}\nb${character}\n${underline}\n`)))
      .toContain(`a${character === '\u00a0' ? '&nbsp;' : character} b${character === '\u00a0' ? '&nbsp;' : character}</h`)
    for (const source of [
      `> a\nb${character}\n> ${underline}\n`,
      `> a${character}\n> b${character}\n> ${underline}\n`,
      `- a\nb${character}\n  ${underline}\n`,
      `a${character}\\\nb\n${underline}\n`,
    ]) {
      expect(markdownToCarve(source)).toContain(character)
    }
  }
})

it('still strips spaces and tabs around setext text', () => {
  expect(markdownToCarve(' a \t\n===\n')).toBe('# a\n')
})
