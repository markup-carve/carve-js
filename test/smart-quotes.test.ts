import { describe, expect, it } from 'vitest'
import {
  carveToAstJson,
  carveToCarve,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  isSmartQuoteLocaleSupported,
  smartQuoteLocales,
  smartQuotes,
} from '../src/index.js'

describe('smartQuotes locale extension', () => {
  it('renders the optional German corpus spelling', () => {
    expect(carveToHtml('"Hello" and \'bye\'', { extensions: [smartQuotes({ locale: 'de' })] }))
      .toBe('<p>„Hello“ and ‚bye‘</p>')
  })

  it('uses exact locale, normalized language fallback, then English', () => {
    const render = (locale: string) => carveToHtml('"Hello"', { extensions: [smartQuotes({ locale })] })
    expect(render('de-CH')).toContain('«Hello»')
    expect(render('DE-ch')).toContain('«Hello»')
    expect(render('de_AT')).toContain('„Hello“')
    expect(render('xx')).toContain('“Hello”')
  })

  it('supports explicit partial overrides', () => {
    const extension = smartQuotes({ locale: 'de', openDoubleQuote: '[[', closeDoubleQuote: ']]' })
    expect(carveToHtml('"Hello" \'bye\'', { extensions: [extension] }))
      .toContain('[[Hello]] ‚bye‘')
  })

  it('keeps apostrophes locale-independent', () => {
    const options = { extensions: [smartQuotes({ locale: 'de' })] }
    expect(carveToHtml("don't and the '70s and 'linked'", options))
      .toContain('don’t and the ’70s and ‚linked‘')
  })

  it('applies to every presentation target and the published AST glyph', () => {
    const options = { extensions: [smartQuotes({ locale: 'de' })] }
    expect(carveToMarkdown('"Hallo"', options)).toBe('„Hallo“\n')
    expect(carveToPlainText('"Hallo"', options)).toBe('„Hallo“\n')
    expect(JSON.stringify(carveToAstJson('"Hallo"', options))).toContain('„')
    expect(carveToHtml('"Hallo"', { ...options, smartTypography: false })).toContain('"Hallo"')
    expect(carveToCarve('"Hallo"', options)).toBe('"Hallo"\n')
  })

  it('reports the same supported locale surface as PHP', () => {
    expect(smartQuoteLocales()).toHaveLength(20)
    expect(isSmartQuoteLocaleSupported('de-AT')).toBe(true)
    expect(isSmartQuoteLocaleSupported('fr_FR')).toBe(true)
    expect(isSmartQuoteLocaleSupported('xx')).toBe(false)
  })
})
