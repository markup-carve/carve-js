import type { ExtensionBundle } from '../../src/extensions/standard/bundle.ts'

export type QuoteCharacters = readonly [string, string, string, string]

export const SMART_QUOTE_LOCALES: Readonly<Record<string, QuoteCharacters>> = Object.freeze({
  en: ['“', '”', '‘', '’'],
  de: ['„', '“', '‚', '‘'],
  'de-CH': ['«', '»', '‹', '›'],
  fr: ['« ', ' »', '‹ ', ' ›'],
  pl: ['„', '”', '‚', '’'],
  ru: ['«', '»', '„', '“'],
  ja: ['「', '」', '『', '』'],
  zh: ['「', '」', '『', '』'],
  sv: ['”', '”', '’', '’'],
  da: ['„', '“', '‚', '‘'],
  fi: ['”', '”', '’', '’'],
  cs: ['„', '“', '‚', '‘'],
  hu: ['„', '”', '‚', '’'],
  it: ['«', '»', '“', '”'],
  es: ['«', '»', '“', '”'],
  pt: ['«', '»', '“', '”'],
  nl: ['“', '”', '‘', '’'],
  nb: ['«', '»', '‘', '’'],
  nn: ['«', '»', '‘', '’'],
  uk: ['«', '»', '„', '“'],
})

export interface SmartQuotesOptions {
  /** Exact locale, then its language; an unknown locale uses English. */
  locale?: string
  openDoubleQuote?: string
  closeDoubleQuote?: string
  openSingleQuote?: string
  closeSingleQuote?: string
}

function localeKeys(locale: string): [string, string] {
  const normalized = locale.replaceAll('_', '-').toLowerCase()
  const exact = Object.keys(SMART_QUOTE_LOCALES).find((key) => key.toLowerCase() === normalized) ?? normalized
  return [exact, normalized.split('-')[0] ?? normalized]
}

export function smartQuoteLocales(): string[] {
  return Object.keys(SMART_QUOTE_LOCALES)
}

export function isSmartQuoteLocaleSupported(locale: string): boolean {
  return localeKeys(locale).some((key) => key in SMART_QUOTE_LOCALES)
}

/** Locale quote glyphs for smart typography; the `smartTypography` option still turns it on. */
export function smartQuotes(options: SmartQuotesOptions = {}): ExtensionBundle {
  const [exact, language] = localeKeys(options.locale ?? 'en')
  const quotes = SMART_QUOTE_LOCALES[exact] ?? SMART_QUOTE_LOCALES[language] ?? SMART_QUOTE_LOCALES['en']!
  return { extensions: [{ name: 'carve.smartQuotes', version: '1', props: {}, slots: {}, quotes: [
    options.openDoubleQuote ?? quotes[0], options.closeDoubleQuote ?? quotes[1],
    options.openSingleQuote ?? quotes[2], options.closeSingleQuote ?? quotes[3],
  ] }], renderers: {} }
}
