import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it.each([
  ['combining sequence beside a wide glyph', '| e\u0301 | 漢 |\n| a | b |\n', '| e\u0301 | 漢 |\n| a | b  |\n'],
  ['wide glyph opposite a combining sequence', '| 漢 | e\u0301 |\n| x | yy |\n', '| 漢 | e\u0301  |\n| x  | yy |\n'],
  ['emoji cluster beside a combining sequence', '| 👩‍💻 | x |\n| a | e\u0301 |\n', '| 👩‍💻 | x |\n| a  | e\u0301 |\n'],
])('aligns a table with %s by display width', (_name, source, aligned) => {
  expect(carveToCarve(source, { alignTables: true })).toBe(aligned)
  expect(carveToCarve(aligned, { alignTables: true })).toBe(aligned)
  expect(carveToHtml(aligned)).toBe(carveToHtml(source))
})
