import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a reference definition', () => {
  const defines = (run: string) =>
    carveToHtml(`[link][r]\n\n[r]:${run}https://e.com/\n`).includes('href="https://e.com/"')

  it('rejects a no-break space after the separator spaces', () => {
    expect(defines('  ')).toBe(false)
  })

  it('rejects no-break spaces mixed with ASCII spaces', () => {
    expect(defines('    ')).toBe(false)
    expect(defines('     ')).toBe(false)
    expect(defines('     ')).toBe(false)
    expect(defines('     ')).toBe(false)
  })

  it('rejects other Unicode whitespace after the separator spaces', () => {
    for (const ch of [' ', ' ', '　', ' ', ' ', '']) {
      expect({ ch, defines: defines(` ${ch}`) }).toEqual({ ch, defines: false })
    }
  })

  it('keeps a zero-width character in the destination instead of skipping it', () => {
    expect(carveToHtml('[link][r]\n\n[r]: ﻿https://e.com/\n')).toContain(
      'href="﻿https://e.com/"',
    )
    expect(carveToHtml('[link][r]\n\n[r]: ​https://e.com/\n')).toContain(
      'href="​https://e.com/"',
    )
  })

  it('is still not a definition when the run is all there is', () => {
    expect(carveToHtml('[link][r]\n\n[r]:  \n')).not.toContain('href')
    expect(carveToHtml('[link][r]\n\n[r]:  \n')).not.toContain('href')
  })

  it('still requires the mandatory separator space before the run', () => {
    expect(carveToHtml('[link][r]\n\n[r]: https://e.com/\n')).not.toContain('href')
    expect(carveToHtml('[link][r]\n\n[r]:\thttps://e.com/\n')).not.toContain('href')
  })

  it('still treats a leading no-break space as content, not indentation', () => {
    expect(carveToHtml('[link][r]\n\n [r]: https://e.com/\n')).not.toContain('href')
  })

  it('leaves a plain definition and an ASCII run alone', () => {
    expect(defines(' ')).toBe(true)
    expect(defines('   ')).toBe(true)
  })

  it('rejects a no-break space before a destination with a title', () => {
    expect(carveToHtml('[link][r]\n\n[r]:  https://e.com/ "T"\n')).not.toContain('title="T"')
  })
})
