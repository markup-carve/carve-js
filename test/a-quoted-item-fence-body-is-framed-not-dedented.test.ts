import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A FENCE BODY INSIDE A QUOTED LIST ITEM IS FRAMED, NOT DEDENTED BY THE CONTENT
 * COLUMN (markup-carve/carve-js#1645).
 *
 * In a `> - ` host the fence body lines carry no `>`: they reached the item as
 * the quote's lazy continuation, so their leading whitespace is alignment under
 * the quoted item, not indentation the author put inside the code. carve-js
 * dedented them by the item's content column only and left the rest, so a body
 * aligned under `> - ` kept two columns on every line, at every closer offset.
 * The lines are now framed instead - stripped whole, and the frame keeps a
 * closing run among them from closing the fence, exactly as the folded-body case
 * (#1630) already was. A MARKED body (`>  code`) is not quote-lazy and keeps the
 * content-column dedent that preserves its authored indentation.
 *
 * Every output below is byte-for-byte the answer of the executable spec
 * (scripts/spec/{layout,html}.mjs) and of carve-php.
 */

const html = (s: string) => carveToHtml(s)
const li = (inner: string) =>
  `<blockquote>\n  <ul>\n    <li>\n${inner}\n    </li>\n  </ul>\n</blockquote>`
const pre = (body: string) => `      <pre><code class="language-x">${body}</code></pre>`

describe('a quoted-item fence body strips the quote alignment whole', () => {
  it('dedents a single-line body and keeps an offset-0 closer as body', () => {
    expect(html('> - ``` x\n    code\n    ```\n')).toBe(li(pre('code\n```\n')))
  })

  it('strips each line whole, losing no closer to an over-indented run', () => {
    expect(html('> - ``` x\n      code\n    tail\n    ```\n')).toBe(li(pre('code\ntail\n```\n')))
  })

  it('keeps the closer as body at a positive offset too', () => {
    expect(html('> - ``` x\n    code\n      ```\n')).toBe(li(pre('code\n```\n')))
  })

  it('frames a raw-fence body the same way', () => {
    expect(html('> - ```=html\n    <b>hi</b>\n    ```\n')).toBe(li('      <b>hi</b>\n```'))
  })

  it('frames the body one level deeper', () => {
    expect(html('> - - ``` x\n      code\n      ```\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n' +
        '          <pre><code class="language-x">code\n```\n</code></pre>\n' +
        '        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('leaves a MARKED body dedented by the content column (control)', () => {
    // `>     code` carries its own marker, so it is the quote's content, not a
    // lazy line, and keeps its authored indentation relative to the item.
    expect(html('> - ``` x\n>     code\n>     ```\n')).toBe(li(pre('  code\n  ```\n')))
  })
})
