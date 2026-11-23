import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { compareHtmlExact } from '../src/compare.ts'
import { upgrade } from '../src/index.ts'

describe('U-213: note definitions on the marker lines of list items', () => {
  it.each([
    ['x[^1]\n\n1. [^1]: n\n1. [^1]: m\n', '[^1]: n\n\nx[^1]\n\n1. {% %}\n1. {% %}\n'],
    ['x[^1]\n\n1. [^1]: > q\n1. \n1. [^1]: n\n', '[^1]: > q\n1. \n\nx[^1]\n\n1. {% %}\n1. {% %}\n'],
    ['x[^a]\n\n- [^a]: one\n- [^a]: two\n- [^a]: three\n\nend\n', '[^a]: one\n\nx[^a]\n\n- {% %}\n- {% %}\n- {% %}\n\nend\n'],
    ['x[^1]\n\n[^1]: top\n\n- [^1]: later\n- y\n', 'x[^1]\n\n[^1]: top\n\n- {% %}\n- y\n'],
    ['x[^1] x[^2]\n\n* y\n* [^2]: > q\n* [^1]: text\n\nend\n',
      '[^2]: > q\n\n[^1]: text\n\nx[^1] x[^2]\n\n* y\n* {% %}\n* {% %}\n\nend\n'],
    // The lazy line went with the last dropped definition in 0.1.
    ['x[^a]\n\n[^a]: top\n\n1) [^a]: n\n1) [^a]: m *b*\npara\n', 'x[^a]\n\n[^a]: top\n\n1) {% %}\n1) {% %}\n'],
  ])('moves the kept definition above the document and empties the items of later ones: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(carveToHtml(source), render(result.output)).equal).toBe(true)
  })

  it('ends the list where 0.1 ended it, so a following line is no lazy item text', () => {
    const source = 'x[^1]\n\n1. [^1]: > q\n1. \n1. [^1]: n\n:: t   ```=latex\n   c\n   ```\n\n  after\n'
    const result = upgrade(source)
    expect(result.output).toBe('[^1]: > q\n1. \n\nx[^1]\n\n1. {% %}\n1. {% %}\n\n:: t   ```=latex```\n\nc\n   ```\n\n  after\n')
    expect(result.check).toBe('pass')
    expect(compareHtmlExact(carveToHtml(source), render(result.output)).equal).toBe(true)
  })
})
