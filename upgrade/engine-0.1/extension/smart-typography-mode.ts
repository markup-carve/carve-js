export type SmartTypographyMode = 'glyph' | 'source'

/** Omitted families retain the default glyph output. */
export interface SmartTypographyFamilies {
  quotes?: boolean
}

export type SmartTypographyOption = SmartTypographyMode | boolean | SmartTypographyFamilies

export function smartTypographyUsesSource(
  value: SmartTypographyOption | undefined,
  kind: string,
): boolean {
  return value === false || value === 'source' ||
    (typeof value === 'object' && value !== null && value.quotes === false &&
      (kind === 'left_double_quote' || kind === 'right_double_quote' ||
       kind === 'left_single_quote' || kind === 'right_single_quote'))
}

export function normalizeSmartTypography(value: SmartTypographyOption | undefined): SmartTypographyOption {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'quotes') ||
      (value.quotes !== undefined && typeof value.quotes !== 'boolean')) {
      throw new TypeError('smartTypography accepts only the quotes boolean family')
    }
  }
  return value ?? 'glyph'
}
