import type { CarveExtension } from './extension.js'

/** Opening/closing double quotes followed by opening/closing single quotes. */
export type QuoteCharacters = readonly [string, string, string, string]

/** Locale quote sets shared with carve-php and carve-rs. */
export const SMART_QUOTE_LOCALES: Readonly<Record<string, QuoteCharacters>> = Object.freeze({
  en: ['“', '”', '‘', '’'],
  de: ['„', '“', '‚', '‘'],
  'de-CH': ['«', '»', '‹', '›'],
  fr: ['«\u00a0', '\u00a0»', '‹\u00a0', '\u00a0›'],
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
  /** Exact locale, then language fallback; an unknown locale falls back to English. */
  locale?: string
  openDoubleQuote?: string
  closeDoubleQuote?: string
  openSingleQuote?: string
  closeSingleQuote?: string
}

export function smartQuoteLocales(): string[] {
  return Object.keys(SMART_QUOTE_LOCALES)
}

export function isSmartQuoteLocaleSupported(locale: string): boolean {
  return localeKeys(locale).some((key) => key in SMART_QUOTE_LOCALES)
}

/** Configure locale-specific quote glyphs without changing parsing or source output. */
export function smartQuotes(options: SmartQuotesOptions = {}): CarveExtension {
  const resolved = resolveLocale(options.locale ?? 'en')
  const quotes: QuoteCharacters = [
    options.openDoubleQuote ?? resolved[0],
    options.closeDoubleQuote ?? resolved[1],
    options.openSingleQuote ?? resolved[2],
    options.closeSingleQuote ?? resolved[3],
  ]
  return {
    name: 'smartQuotes',
    quoteCharacters: quotes,
  }
}

function resolveLocale(locale: string): QuoteCharacters {
  const [exact, language] = localeKeys(locale)
  return SMART_QUOTE_LOCALES[exact!]
    ?? SMART_QUOTE_LOCALES[language!]
    ?? SMART_QUOTE_LOCALES.en!
}

function localeKeys(locale: string): [string, string] {
  const normalized = locale.replaceAll('_', '-').toLowerCase()
  const exact = Object.keys(SMART_QUOTE_LOCALES)
    .find((key) => key.toLowerCase() === normalized) ?? normalized
  return [exact, normalized.split('-')[0]!]
}
