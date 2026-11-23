import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { compareHtmlExact } from '../src/compare.ts'
import { withUpgradeSession } from '../src/engines.ts'
import { upgrade } from '../src/index.ts'
import { rescueSite } from '../src/rescue-site.ts'

const unit = 'x[^1]\n\n1. [^1]: > q\n1. [^1]: n\n\npara\n\n'

function units(count: number): string {
  let doc = ''
  for (let n = 0; n < count; n++) doc += unit.replaceAll('[^1]', `[^k${n}]`)
  return doc
}

const site = (source: string) => withUpgradeSession(() => rescueSite(source, source, []))

describe('carve-js#5491: rescue candidates are rendered only near the first difference', () => {
  it('keeps the upgrade of a document with many mismatching units', () => {
    const source = units(3)
    const result = upgrade(source)
    expect(result.output).toBe('[^k0]: > q\n\n[^k1]: > q\n\n[^k2]: > q\n\n'
      + 'x[^k0]\n\n1. {% %}\n1. {% %}\n\npara\n\n'
      + 'x[^k1]\n\n1. {% %}\n1. {% %}\n\npara\n\n'
      + 'x[^k2]\n\n1. {% %}\n1. {% %}\n\npara\n\n')
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(carveToHtml(source), render(result.output)).equal).toBe(true)
  })

  it('upgrades a 16 KB document of such units in a few seconds', () => {
    const source = units(Math.ceil(16 * 1024 / unit.length))
    const started = performance.now()
    expect(upgrade(source).check).toBe('pass')
    // The quadratic rescues took over a minute here; the bound leaves room for slow runners.
    expect(performance.now() - started).toBeLessThan(40_000)
  }, 60_000)

  it('opens the block of the difference and its neighbours, not a far unit', () => {
    const gate = site(units(6)).input
    expect(gate.lines(3)).toBe(true)
    expect(gate.lines(4)).toBe(true)
    expect(gate.lines(10)).toBe(false)
    expect(gate.lines(24)).toBe(false)
    expect(gate.lines(38)).toBe(false)
  })

  it('opens a far definition whose label the site names', () => {
    const source = units(6) + 'y[^far]\n\n' + 'z\n\n'.repeat(10) + '- [^far]: v\n'
    const gate = site(source).input
    expect(gate.lines(source.split('\n').length - 1)).toBe(false)
    const named = 'x[^far]\n\n1. [^far]: > q\n1. [^k9]: n\n\npara\n\n' + units(5) + '- [^far]: v\n'
    expect(site(named).input.lines(named.split('\n').length - 1)).toBe(true)
  })

  it('opens every definition when notes are rendered inside the document', () => {
    const source = '::: footnotes "Notes" [End]\na\n:::\n\n' + units(5) + '[^z]: zz\n'
    const gate = site(source).input
    expect(gate.lines(source.split('\n').length - 1)).toBe(true)
  })

  it('opens a far heading whose text an implicit reference at the site names', () => {
    const source = 'see [Far Title][]\n\n1. [^k0]: > q\n1. [^k0]: n\n\n' + 'p\n\n'.repeat(12) + '# Far Title\n'
    const lines = source.split('\n')
    expect(site(source).input.lines(lines.indexOf('# Far Title') + 1)).toBe(true)
    expect(site(source).input.lines(lines.length - 3)).toBe(false)
  })

  it('opens every candidate when the HTML does not differ', () => {
    const gate = site('para\n\nmore\n').output
    expect(gate.lines(1)).toBe(true)
    expect(gate.at(9)).toBe(true)
  })
})
