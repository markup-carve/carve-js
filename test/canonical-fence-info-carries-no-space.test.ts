import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * The canonical writer emits NO space between a code fence and its info string.
 *
 * `fenced_code_block` (resources/grammar.ebnf) states it for the writer while
 * leaving the reader lenient:
 *
 *   "The space between the fence and the info string is OPTIONAL (lenient:
 *    both ```php and ``` php are accepted; Markdown writes no space, Djot
 *    writes the space). The no-space form (```php) is canonical and is what
 *    the X->Carve converters emit. It is a PADDING SLOT, not a marker
 *    separator (PART 7)"
 *
 * The writer emitted the Djot spelling instead, in every engine. Nothing
 * caught it, and the reason it could not be caught by the existing checks is
 * the first half of that same clause: the reader accepts both, so
 * `parse(fmt(x)) == parse(x)`, `fmt(fmt(x)) == fmt(x)` and
 * `toHtml(fmt(x)) == toHtml(x)` all hold either way. Only a BYTE assertion on
 * the writer's output can tell the canonical form from the accepted one, which
 * is what this file makes.
 *
 * The two slots are different slots and only one of them moves:
 *
 *   - the slot before the info string is `[space]`, optional, and canonically
 *     absent;
 *   - the two slots INSIDE `code_fence_info` are `space+`, mandatory. ```js"t"
 *     is not a fence opener at all, so the separators between language, header
 *     and label stay exactly one space each.
 */

const fmt = (src: string) => carveToCarve(src)

/* [name, authored (Djot spelling), canonical (no space)] */
const shapes: Array<[string, string, string]> = [
  ['a language only', '``` js\nx\n```\n', '```js\nx\n```\n'],
  [
    'a language and a quoted title',
    '``` js "src/app.js"\nx\n```\n',
    '```js "src/app.js"\nx\n```\n',
  ],
  ['a language and a label', '``` js [tab-a]\nx\n```\n', '```js [tab-a]\nx\n```\n'],
  [
    'a language, a title and a label',
    '``` js "src/app.js" [tab-a]\nx\n```\n',
    '```js "src/app.js" [tab-a]\nx\n```\n',
  ],
  ['a title with no language', '``` "src/app.js"\nx\n```\n', '```"src/app.js"\nx\n```\n'],
  ['a label with no language', '``` [tab-a]\nx\n```\n', '```[tab-a]\nx\n```\n'],
  /*
   * `raw_block` spells its otherwise identical slot the same way, so it is
   * checked here rather than assumed: the `=` after the slot SELECTS a raw
   * block over a code block, and the grammar permits leading whitespace before
   * it, so ``` =html reads as a raw block and would have hidden the same
   * defect.
   *
   * THIS ROW WAS ALREADY CORRECT. `raw_block` writes its own opener and never
   * went through `codeFenceInfo`, so it passed before this change and after
   * it. It is kept as a check, not as a fix: it fails when the slot is widened
   * there, which is the way the defect would arrive.
   */
  ['a raw block', '``` =html\n<b>raw</b>\n```\n', '```=html\n<b>raw</b>\n```\n'],
]

/*
 * The controls. Neither may gain or lose a space when the rule above moves.
 *
 * A fence with NO info string has nothing to separate, so it is the case that
 * would expose a fix written as "always drop one character after the run".
 * The two container shapes are the ones where the writer emits a prefix of its
 * own before the fence; the prefix is not the slot and must not absorb it.
 */
const controls: Array<[string, string]> = [['no info string at all', '```\nx\n```\n']]

describe('the canonical writer writes no space after the fence run', () => {
  for (const [name, authored, canonical] of shapes) {
    it(`${name}: normalizes the Djot spelling to the canonical one`, () => {
      expect(fmt(authored)).toBe(canonical)
    })

    it(`${name}: the canonical spelling is a fixed point`, () => {
      expect(fmt(canonical)).toBe(canonical)
    })

    it(`${name}: is idempotent`, () => {
      const once = fmt(authored)
      expect(fmt(once)).toBe(once)
    })

    it(`${name}: preserves what the document says`, () => {
      expect(carveToHtml(fmt(authored))).toBe(carveToHtml(authored))
    })
  }

  for (const [name, src] of controls) {
    it(`${name}: is written back byte for byte`, () => {
      expect(fmt(src)).toBe(src)
    })

    it(`${name}: is idempotent`, () => {
      expect(fmt(fmt(src))).toBe(fmt(src))
    })
  }

  /*
   * A tilde fence reaches the writer as the same node - `code_block` records
   * no fence character (PART 12 §3) - so it comes back as backticks. That
   * normalization is pre-existing and is not what this file is about; it is
   * asserted so the row is not read as the slot rule failing to apply to
   * tildes.
   */
  it('a tilde fence is re-spelled with backticks and still carries no space', () => {
    expect(fmt('~~~ js\nx\n~~~\n')).toBe('```js\nx\n```\n')
  })
})

/*
 * Inside a container the writer emits the container's own prefix and then the
 * fence. The slot sits after the fence run, so the prefix is unaffected and the
 * fence is still tight against its language.
 */
describe('the rule holds under a container prefix', () => {
  const inAList = '- item\n\n  ``` js\n  x\n  ```\n'
  const inAQuote = '> quoted\n>\n> ``` js\n> x\n> ```\n'

  it('a fence inside a list item', () => {
    expect(fmt(inAList)).toContain('```js\n')
    expect(fmt(inAList)).not.toContain('``` js')
    expect(carveToHtml(fmt(inAList))).toBe(carveToHtml(inAList))
  })

  it('a fence inside a block quote', () => {
    expect(fmt(inAQuote)).toContain('> ```js\n')
    expect(fmt(inAQuote)).not.toContain('``` js')
    expect(carveToHtml(fmt(inAQuote))).toBe(carveToHtml(inAQuote))
  })
})

/*
 * The slot the fix must NOT touch. These separators are `space+` inside
 * `code_fence_info`; removing one does not tighten the opener, it stops the
 * line being a fence opener and the run falls back to an inline code span
 * (the INVALID-FENCE FALLBACK). So the reader is checked here too: if a later
 * change were to join the parts without a separator, the writer would emit a
 * document that no longer holds a code block at all.
 */
describe('the separators inside the info string are not the same slot', () => {
  it('a header glued to the language is not a fence opener', () => {
    expect(carveToHtml('```js"t"\nx\n```\n')).not.toContain('<pre')
  })

  it('a label glued to the language is not a fence opener', () => {
    expect(carveToHtml('```js[l]\nx\n```\n')).not.toContain('<pre')
  })

  it('the writer keeps one separator between every part', () => {
    expect(fmt('```js "t" [l]\nx\n```\n')).toBe('```js "t" [l]\nx\n```\n')
  })
})
