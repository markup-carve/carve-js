/** Expand a JavaScript number's exponent spelling without changing its significant digits. */
export function plainDecimal(value: number): string {
  const text = String(value)
  const exponentAt = text.indexOf('e')
  if (exponentAt < 0) return text
  const negative = text[0] === '-'
  const mantissa = text.slice(negative ? 1 : 0, exponentAt)
  const exponent = Number(text.slice(exponentAt + 1))
  const point = mantissa.indexOf('.')
  const digits = mantissa.replace('.', '')
  const shifted = (point < 0 ? mantissa.length : point) + exponent
  const sign = negative ? '-' : ''
  if (shifted <= 0) return `${sign}0.${'0'.repeat(-shifted)}${digits}`
  if (shifted >= digits.length) return `${sign}${digits}${'0'.repeat(shifted - digits.length)}`
  return `${sign}${digits.slice(0, shifted)}.${digits.slice(shifted)}`
}
