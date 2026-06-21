import { describe, expect, it } from 'vitest'

import { carveToHtml, spoiler } from '../src/index.js'

describe('spoiler extension', () => {
  it('inline :spoiler[...] renders a span.spoiler', () => {
    expect(carveToHtml('Plot: :spoiler[the butler did it].', { extensions: [spoiler()] })).toBe(
      '<p>Plot: <span class="spoiler">the butler did it</span>.</p>',
    )
  })

  it('inline merges author classes and strips event handlers', () => {
    expect(carveToHtml(':spoiler[x]{#s .big onclick="y"}', { extensions: [spoiler()] })).toBe(
      '<p><span id="s" class="spoiler big">x</span></p>',
    )
  })

  it('inline falls back to ext-spoiler span without the extension', () => {
    expect(carveToHtml(':spoiler[x]')).toBe('<p><span class="ext-spoiler">x</span></p>')
  })

  it('block ::: spoiler renders a details.spoiler disclosure', () => {
    expect(carveToHtml('::: spoiler "Ending"\nEveryone lives.\n:::', { extensions: [spoiler()] })).toBe(
      '<details class="spoiler">\n  <summary>Ending</summary>\n  <p>Everyone lives.</p>\n</details>',
    )
  })

  it('block without a title defaults the summary to "Spoiler"', () => {
    expect(carveToHtml('::: spoiler\nHidden.\n:::', { extensions: [spoiler()] })).toBe(
      '<details class="spoiler">\n  <summary>Spoiler</summary>\n  <p>Hidden.</p>\n</details>',
    )
  })

  it('block falls back to div.spoiler without the extension', () => {
    expect(carveToHtml('::: spoiler\nHidden.\n:::')).toBe(
      '<div class="spoiler">\n  <p>Hidden.</p>\n</div>',
    )
  })
})
