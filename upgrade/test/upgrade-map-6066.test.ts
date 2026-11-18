import { describe, expect, it } from 'vitest'
import map from '../../v2/data/upgrade-map.json' with { type: 'json' }
import { canWriteUpgrade, upgrade } from '../src/upgrade.ts'

const rows = map.source.filter((row) => Number(row.id.slice(2)) >= 375)

describe('the pinned replay map rows', () => {
  it.each(rows.filter((row) => row.kind === 'rewrite'))('$id rewrites and preserves the old HTML', (row) => {
    const result = upgrade(row.from)
    expect(result.output).toBe(row.to)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === row.id)).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
  })

  it.each(rows.filter((row) => row.kind === 'report'))('$id reports its parsed source range and blocks writing', (row) => {
    const result = upgrade(row.from)
    const record = result.records.find((item) => item.entry === row.id)
    expect(result.output).toBe(row.from)
    expect(record?.class).toBe('report')
    expect(record?.range).toBeDefined()
    expect(record!.range!.endOffset).toBeGreaterThan(record!.range!.startOffset)
    expect(row.from.slice(record!.range!.startOffset, record!.range!.endOffset)).not.toBe('')
    expect(canWriteUpgrade(result)).toBe(row.id === 'U-396')
  })

  it('compares HTML attribute names without case and preserves their values', () => {
    const source = map.source.find((row) => row.id === 'U-392')!.from
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(false)
  })

  it.each([
    ['U-375', 'he said---"Go" and replied–"Now".\n', 'he said---“Go" and replied–“Now".\n'],
    ['U-376', '*[API]:   Application Programming Interface\n\nAPI\n',
      '*[API]: Application Programming Interface\n\nAPI\n'],
    ['U-390', '{+%% b+}\n', '{+\\%\\% b+}\n'],
  ])('%s rewrites another source of the same cause', (id, source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === id)).toBe(true)
  })

  it('leaves a column default that already renders alike unchanged', () => {
    const source = '{aligns="right,center"}\n| a | b |\n'
    expect(upgrade(source).output).toBe(source)
  })

  it.each(['`$`x`{CLASS=y}`\n', '```\n$`x`{CLASS=y}\n```\n'])(
    'does not report a math class inside literal code', (source) => {
      const result = upgrade(source)
      expect(result.records.some((record) => record.entry === 'U-249')).toBe(false)
    },
  )

  it('keeps an unmapped difference blocked with a machine readable status', () => {
    const result = upgrade('a------- b-------- c---------- d----------- e-------------\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.find((record) => record.entry === 'upgrade-mismatch')?.status).toBe('no mapped row')
    expect(canWriteUpgrade(result)).toBe(false)
  })

  it('reports the source span of a nested definition variant', () => {
    const source = ':: t\n:  [^f]: note\n     - nested\ntail\n'
    const result = upgrade(source)
    const record = result.records.find((item) => item.entry === 'U-378')
    expect(record?.range).toBeDefined()
    expect(source.slice(record!.range!.startOffset, record!.range!.endOffset)).toContain('[^f]: note')
    expect(result.check).toBe('mismatch')
  })

  it('reports the retained line after a comment fence in a nested div', () => {
    const source = '- ::: box\n  %%%%\n%% j\n  x\n'
    const result = upgrade(source)
    const record = result.records.find((item) => item.entry === 'U-382')
    expect(record?.range).toBeDefined()
    expect(source.slice(record!.range!.startOffset, record!.range!.endOffset)).toContain('  x')
    expect(result.check).toBe('mismatch')
  })
})
