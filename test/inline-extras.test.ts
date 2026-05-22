import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string, o = {}) => carveToHtml(s, o)

describe('inline extras (nbsp, raw inline, emoji)', () => {
  it('backslash-space is a non-breaking space', () => {
    expect(h('10\\ kg')).toBe('<p>10&nbsp;kg</p>')
  })

  it('raw inline passes through a matching format', () => {
    expect(h('a `<b>x</b>`{=html} z')).toBe('<p>a <b>x</b> z</p>')
  })

  it('raw inline drops a non-matching format', () => {
    expect(h('a `\\foo`{=latex} z')).toBe('<p>a  z</p>')
  })

  it('a verbatim span without a format tag stays code', () => {
    expect(h('`x + y`')).toBe('<p><code>x + y</code></p>')
  })

  it('emoji renders literally when no map is supplied', () => {
    expect(h('hi :rocket: there')).toBe('<p>hi :rocket: there</p>')
  })

  it('emoji resolves against a processor-supplied map', () => {
    expect(h(':rocket: :tada:', { emoji: { rocket: '🚀', tada: '🎉' } })).toBe(
      '<p>🚀 🎉</p>',
    )
  })

  it('an unmapped emoji name stays literal even with a map', () => {
    expect(h(':rocket: :nope:', { emoji: { rocket: '🚀' } })).toBe(
      '<p>🚀 :nope:</p>',
    )
  })

  it('keeps `:type[content]` as an extension, not an emoji', () => {
    expect(h(':kbd[Esc]')).toBe('<p><kbd>Esc</kbd></p>')
  })
})
