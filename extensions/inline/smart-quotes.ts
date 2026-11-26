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

/** The locale and its language, matched ignoring ASCII case with `_` read as `-` (C2-X-075). */
function localeKeys(locale: string): [string, string] {
  const normalized = locale.replaceAll('_', '-').replace(/[A-Z]+/g, (letters) => letters.toLowerCase())
  const exact = Object.keys(SMART_QUOTE_LOCALES).find((key) => key.toLowerCase() === normalized) ?? normalized
  return [exact, normalized.split('-')[0] ?? normalized]
}

export function smartQuoteLocales(): string[] {
  return Object.keys(SMART_QUOTE_LOCALES)
}

export function isSmartQuoteLocaleSupported(locale: string): boolean {
  return localeKeys(locale).some((key) => Object.hasOwn(SMART_QUOTE_LOCALES, key))
}

/** Locale quote glyphs for smart typography; the `smartTypography` option still turns it on. */
export function smartQuotes(options: SmartQuotesOptions = {}): ExtensionBundle {
  const [exact, language] = localeKeys(options.locale ?? 'en')
  const own = (key: string) => Object.hasOwn(SMART_QUOTE_LOCALES, key) ? SMART_QUOTE_LOCALES[key] : undefined
  const quotes = own(exact) ?? own(language) ?? SMART_QUOTE_LOCALES['en']!
  return { extensions: [{ name: 'carve.smartQuotes', version: '1', props: {}, slots: {}, quotes: [
    options.openDoubleQuote ?? quotes[0], options.closeDoubleQuote ?? quotes[1],
    options.openSingleQuote ?? quotes[2], options.closeSingleQuote ?? quotes[3],
  ] }], renderers: {} }
}
