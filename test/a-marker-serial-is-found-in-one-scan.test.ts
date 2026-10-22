import { describe, expect, it } from 'vitest'
import { freeMarkerSerial } from '../src/parse/list/marker-serial.js'
import { extractReferenceDefinitions } from '../src/import/markdown/markdown-empty-destination.js'
import { djotToCarve, migrateMarkdown } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const serials = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}Z`)

describe('an importer marker serial absent from the input', () => {
  it('skips every serial the input spells, under any prefix', () => {
    expect(freeMarkerSerial('plain', 'P')).toBe(0)
    expect(freeMarkerSerial('P0Z P1Z Q2Z', 'P', 'Q')).toBe(3)
    expect(freeMarkerSerial(['P0Z', 'xP1Zy'], 'P')).toBe(2)
  })

  it('counts only an exact digit run closed by Z', () => {
    expect(freeMarkerSerial('P00Z P1 P2X', 'P')).toBe(0)
    expect(freeMarkerSerial('PP0Z P11Z', 'P')).toBe(1)
  })

  it('keeps authored marker text through Markdown and Djot import', () => {
    const title = serials('CARVEMDTITLEBREAK', 3).join(' ')
    expect(migrateMarkdown(`${title}\n\n[t][r]\n\n[r]: <> "a\nb"\n`).value).toContain(title)
    expect(migrateMarkdown(`${serials('CARVEMDFOOTCHAIN', 3).join(' ')}\n`).value).toContain('CARVEMDFOOTCHAIN2Z')
    expect(djotToCarve(`![${serials('DJOTTRAILSPACE', 3).join(' ')}](x)\n`)).toContain('DJOTTRAILSPACE2Z')
  })

  perfIt('scans a Markdown input spelling many title markers in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void extractReferenceDefinitions(input.split('\n'), (x: string) => x, () => false),
      (n) => serials('CARVEMDTITLEBREAK', n).join('\n'),
      { label: 'consecutive title-marker serials', smallRepeats: 2000 },
    )
  })
})
