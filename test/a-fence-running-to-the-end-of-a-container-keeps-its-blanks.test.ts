import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const code = (source: string): string =>
  /<code[^>]*>([\s\S]*?)<\/code>/.exec(carveToHtml(source))?.[1] ?? '(no code block)'

/**
 * A blank line inside an open verbatim fence is that fence's content. When the
 * fence has no closer and runs to the end of its CONTAINER, the trailing blanks
 * were dropped: the item collector buffers blanks and only flushes them when a
 * later line reaches the content column, and the sub-lexer then popped a
 * trailing blank a second time as if it were a terminal-newline artifact
 * (carve-js#988).
 *
 * Both halves are load-bearing and neither shows on its own: flushing alone is
 * cancelled by the pop, and not popping alone has nothing to preserve.
 *
 * The oracle and carve-php keep the blank; carve-js and carve-rs dropped it, so
 * a 2-of-3 vote would have adopted the defect. carve-rs is tracked separately
 * (markup-carve/carve-rs#908).
 */
describe('a fence running to the end of a container keeps its blank lines', () => {
  it.each([
    ['a bullet item', '- ```\n  x\n\n', 'x\n\n'],
    ['an ordered item', '1. ```\n   x\n\n', 'x\n\n'],
    // The task marker's content column is 2, so the extra indent is content.
    // Verified byte-identical to carve-php.
    ['a task item', '- [ ] ```\n      x\n\n', '    x\n\n'],
    ['a bullet item, two blanks', '- ```\n  x\n\n\n', 'x\n\n\n'],
    ['a block quote', '> ```\n> x\n>\n', 'x\n\n'],
  ])('%s', (_name, source, expected) => {
    expect(code(source)).toBe(expected)
  })

  /**
   * BOUNDS. None of these move under either half of the fix, so they do not
   * prove it - they pin what it must not change.
   */
  describe('unchanged', () => {
    it('a terminated fence in an item', () => {
      expect(code('- ```\n  x\n\n  ```\n')).toBe('x\n\n')
    })

    it('a blank with content after it', () => {
      expect(code('- ```\n  x\n\n  y\n')).toBe('x\n\ny\n')
    })

    it('a fence at the top level', () => {
      expect(code('```\nx\n\n')).toBe('x\n\n')
    })

    it('an item with no fence stays tight', () => {
      expect(carveToHtml('- x\n\n')).toBe('<ul>\n  <li>x</li>\n</ul>')
    })

    /**
     * The regression the first attempt caused: the blank is BOTH the fence's
     * content and the separator that loosens the list, so consuming it into the
     * body must not consume the loose signal with it.
     */
    it('a blank before the next sibling still loosens the list', () => {
      const html = carveToHtml('- a\n  %%% x\n b\n\n- c\n')
      expect(html).toContain('<p>a</p>')
      expect(html).toContain('<p>c</p>')
    })
  })
})
