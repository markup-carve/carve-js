import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const EMPTY = `:::
:::
`

const COMMENT_ONLY = `:::
%% hidden
:::
`

describe('an empty bare div keeps its HTML body line', () => {
  it.each([EMPTY, COMMENT_ONLY])('renders the body slot for %j', (source) => {
    expect(carveToHtml(source)).toBe('<div>\n\n</div>')
  })
})

describe('every empty special container keeps its HTML body line', () => {
  it.each([
    ['::: |\n:::\n', '<div class="line-block">\n\n</div>'],
    ['::: \\\n:::\n', '<div class="hardbreaks">\n\n</div>'],
    ['::: figure\n:::\n', '<figure class="carve-figure-group">\n\n</figure>'],
    ['::: \\\n%% hidden\n:::\n', '<div class="hardbreaks">\n\n</div>'],
    ['::: figure\n%% hidden\n:::\n', '<figure class="carve-figure-group">\n\n</figure>'],
  ])('renders the body slot for %j', (source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
