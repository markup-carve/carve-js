import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToCarve } from '../src/index.js'

describe('a comment opening on a line break takes no pad', () => {
  it.each(['a {%\nA b\n %} c\n', 'a {%\nA b %} c\n'])('leaves %j unchanged', (input) => {
    const output = carveToCarve(input)
    expect(output).toBe(input)
    expect(output).not.toContain('{% \n')
  })

  it.each([
    ['a {%A b%} c\n', 'a {% A b %} c\n'],
    ['a {% A b %} c\n', 'a {% A b %} c\n'],
    ['a {% A b\n %} c\n', 'a {% A b\n %} c\n'],
  ])('pads or preserves %j', (input, expected) => {
    expect(carveToCarve(input)).toBe(expected)
  })

  it('imports and formats an HTML comment starting with a line break', () => {
    const imported = htmlToCarve('<p>a <!--\nA b\n--> c</p>').value
    expect(imported).toBe('a {%\nA b\n %} c\n')
    const output = carveToCarve(imported)
    expect(output).toBe('a {%\nA b\n %} c\n')
    expect(output).not.toContain('{% \n')
  })
})
