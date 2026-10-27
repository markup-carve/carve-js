import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

describe('nested autolink display', () => {
  it('keeps the source scheme in an outer link label', () => {
    const source = '[<mailto:a@b.test>](x)'
    expect(carveToHtml(source)).toBe('<p><a href="x">mailto:a@b.test</a></p>')
    expect(carveToMarkdown(source).trim()).toBe('[mailto:a@b.test](x)')
    expect(carveToPlainText(source).trim()).toBe('mailto:a@b.test')
    expect(carveToAnsi(source)).toContain('mailto:a@b.test')
  })

  it('keeps an email autolink without an added scheme', () => {
    expect(carveToHtml('[<a@b.test>](x)')).toBe('<p><a href="x">a@b.test</a></p>')
  })
})
