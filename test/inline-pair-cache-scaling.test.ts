import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('nested inline pair tables', () => {
  it('keeps separate delimiter scopes across sibling spans', () => {
    const html = carveToHtml('{*{_alpha_}*} {*{_beta_}*} {_x_}')
    expect(html).toContain('<strong><u>alpha</u></strong>')
    expect(html).toContain('<strong><u>beta</u></strong>')
    expect(html).toContain('<u>x</u>')
  })

  perfIt('shares substitution suffix scans', () => {
    expectScansLinearly(input => void carveToHtml(`~a ${input}~}`), '{~b ', {
      label: 'substitution openers without an arrow', smallRepeats: 1000,
    })
  })

  perfIt('indexes each suffix of a long backtick run once', () => {
    expectScansLinearly(input => void carveToHtml(`{*${input}*}`), '`', {
      label: 'unclosed backtick run in a forced span', smallRepeats: 4096,
    })
  })

  perfIt('retains the enclosing pair table after each nested scan', () => {
    expectScansLinearly(input => void carveToHtml(input), '{*{_x_}*} ', {
      label: 'nested forced span siblings', smallRepeats: 1000,
    })
  })
})
