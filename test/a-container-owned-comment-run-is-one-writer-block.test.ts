import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P11-079 (b), carve#5206: one boundary around a run owned by one host.
describe('a container-owned comment run is one writer block', () => {
  it.each([
    [':: t\n: a\n\n  %% c\n  %% d\n\n  b\n', ':: t\n: a\n\n  %% c\n  %% d\n\n  b\n'],
    ['- a\n\n  %% y\n  %% z\n- c\n', '- a\n\n  %% y\n  %% z\n\n- c\n'],
    ['- a\n  %% y\n  %% z\n- c\n', '- a\n  %% y\n  %% z\n- c\n'],
    ['- a\n\n  %% y\n\n  %% z\n- c\n', '- a\n\n  %% y\n  %% z\n\n- c\n'],
    ['> a\n>\n> %% c\n> %% d\n', '> a\n>\n> %% c\n> %% d\n'],
  ])('writes the run and reads it back: %j', (source, expected) => {
    const written = carveToCarve(source)
    expect(written).toBe(expected)
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('keeps document-owned comment lines as separate blocks', () => {
    const source = 'a\n\n%% c\n%% d\n\nb\n'
    expect(carveToCarve(source)).toBe('a\n\n%% c\n\n%% d\n\nb\n')
  })
})
