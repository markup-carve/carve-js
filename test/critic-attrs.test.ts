import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('editorial markup trailing attributes', () => {
  it('attaches a trailing {...} to insert/delete (like any inline node)', () => {
    expect(carveToHtml('{++a++}{.a}').trim()).toBe('<p><ins class="a">+a+</ins></p>')
    expect(carveToHtml('{--d--}{#i}').trim()).toBe('<p><del id="i">-d-</del></p>')
    expect(carveToHtml('{++x++}{k=v}').trim()).toBe('<p><ins k="v">+x+</ins></p>')
  })
  it('renders editorial markup without a trailing block unchanged', () => {
    expect(carveToHtml('{++plain++}').trim()).toBe('<p><ins>+plain+</ins></p>')
  })
})
