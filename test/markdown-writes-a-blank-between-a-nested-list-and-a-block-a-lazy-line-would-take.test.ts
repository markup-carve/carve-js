import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

// CARVE-P11-047: a block below a nested list that opens with plain text would be
// read as lazy text of the last sublist item, so the writer keeps the blank line
// that holds it as a block (carve-js#3314).

const cases: Array<[string, string, string]> = [
  ['captioned figure group (618-18)', '- - text\n  ::: figure\n  ![a](b.png)\n  :::\n\n  ^ cap\n- c\n', '- - text\n\n  ![a](b.png)\n\n  **cap**\n- c\n'],
  ['captioned image after a blank (618-32)', '- - text\n\n  ![i](x.png)\n\n  ^ cap\n- c\n', '- - text\n\n  ![i](x.png)\n  cap\n\n- c\n'],
  ['captioned image (618-33)', '- - text\n\n  ![i](x.png)\n  ^ cap\n- c\n', '- - text\n\n  ![i](x.png)\n  cap\n\n- c\n'],
  ['image at depth 2', '- - text\n\n  ![i](x.png)\n- c\n', '- - text\n\n  ![i](x.png)\n\n- c\n'],
  ['image at depth 3', '- - - text\n\n    ![i](x.png)\n  - mid\n- c\n', '- - - text\n\n    ![i](x.png)\n\n  - mid\n- c\n'],
  ['paragraph at depth 2', '- - text\n\n  after\n- c\n', '- - text\n\n  after\n\n- c\n'],
  ['paragraph at depth 3', '- - - text\n\n    after\n- c\n', '- - - text\n\n    after\n- c\n'],
  ['table', '- - text\n\n  | a |\n  | - |\n  | b |\n- c\n', '- - text\n\n  | a |\n  | --- |\n  | b |\n- c\n'],
]

describe('the Markdown target below a nested list', () => {
  it.each(cases)('keeps the block outside the sublist item: %s', (_name, source, expected) => {
    expect(carveToMarkdown(source)).toBe(expected)
  })

  it('stays glued where the block below interrupts a paragraph on its own', () => {
    expect(carveToMarkdown('- - text\n\n  # h\n- c\n')).toBe('- - text\n  # h\n- c\n')
  })
})
