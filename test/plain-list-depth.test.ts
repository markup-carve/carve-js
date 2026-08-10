import { describe, expect, it } from 'vitest'
import { carveToPlainText } from '../src/index.js'

describe('the plain-text target preserves list depth', () => {
  it('indents each list ancestor by two spaces', () => {
    const source = '- a\n  - b\n    - c\n- d\n'
    expect(carveToPlainText(source)).toBe('- a\n  - b\n    - c\n- d\n')
  })
})
