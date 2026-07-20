import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A fenced-code OPENER must sit exactly at its container's content column
// (PART 2). Carve has no indented-code-block construct, so leading spaces have
// no second meaning to disambiguate against -- and every other block opener
// (heading, thematic break, block quote) is already strict at column 0.
// The CLOSER stays lenient: requiring it at the exact column would turn one
// stray space into a fence that swallows the rest of the document.
describe('fenced code: strict opener, lenient closer', () => {
  it('opens at column 0 at document level', () => {
    expect(carveToHtml('```\nc\n```\n')).toContain('<pre><code>c\n</code></pre>')
  })

  for (const indent of [1, 2, 3, 4]) {
    it(`does NOT open at document level indented ${indent}`, () => {
      const pad = ' '.repeat(indent)
      const out = carveToHtml(`${pad}\`\`\`\n${pad}c\n${pad}\`\`\`\n`)
      expect(out).not.toContain('<pre>')
    })
  }

  it('opens at a list item content column', () => {
    expect(carveToHtml('- one\n  ```\n  c\n  ```\n')).toContain('<pre><code>c\n</code></pre>')
  })

  it('does NOT open one column past a list item content column', () => {
    expect(carveToHtml('- one\n   ```\n   c\n   ```\n')).not.toContain('<pre>')
  })

  it('opens at a block quote content column', () => {
    expect(carveToHtml('> ```\n> c\n> ```\n')).toContain('<pre><code>c\n</code></pre>')
  })

  it('does NOT accept a closer indented past the opener -- it is content', () => {
    // Symmetry: a fence DELIMITER, opener or closer, sits at its container's
    // content column. The payoff is that an indented ``` line can appear as
    // sample text inside a fence, which Carve's own docs need.
    expect(carveToHtml('```\nc\n   ```\n')).toContain('```')
  })

  it('lets an indented fence line be sample text inside a fence', () => {
    const out = carveToHtml('```\n  ```\nsample\n  ```\n```\n')
    expect(out).toContain('<pre><code>  ```\nsample\n  ```\n</code></pre>')
  })

  it('treats an unclosed fence as running to the end, not as prose', () => {
    expect(carveToHtml('```\nc\n')).toContain('<pre><code>c\n</code></pre>')
  })
})

// The reference-definition prepass tracks fences so a definition shown inside
// a code block stays a literal sample. It must use the SAME column rule as the
// block parser: when an indented fence-looking line does not open a fence,
// later definitions must still be collected (regression -- they were silently
// swallowed to the end of the document).
describe('fenced code: definition prepass uses the same column rule', () => {
  it('collects a definition after an indented fence-looking line', () => {
    expect(carveToHtml(' ```\n[r]: /u\n\n[r][]\n')).toContain('<a href="/u">')
  })

  it('still treats a definition inside a real fence as a literal sample', () => {
    const out = carveToHtml('```\n[r]: /u\n```\n\n[r][]\n')
    expect(out).toContain('<pre><code>[r]: /u\n</code></pre>')
    expect(out).not.toContain('<a href="/u">')
  })

  it('still treats a definition inside a quoted fence as a literal sample', () => {
    const out = carveToHtml('> ```\n> [r]: /u\n> ```\n\n[r][]\n')
    expect(out).toContain('<pre><code>[r]: /u\n</code></pre>')
    expect(out).not.toContain('<a href="/u">')
  })

  // KNOWN LIMITATION, pinned so it is visible rather than folklore.
  // The prepass is line-based and has no container-column context, so a
  // definition inside a fence nested at a LIST ITEM's content column is still
  // collected and a later reference resolves. This errs deliberately: the
  // opposite error (opening a fence the block parser never opened) swallows
  // every later definition, which is content loss. The sound fix is to collect
  // definitions during block parsing.
  it('over-resolves a definition inside a fence nested in a list item', () => {
    const out = carveToHtml('- one\n  ```\n  [r]: /u\n  ```\n\n[r][]\n')
    expect(out).toContain('<pre><code>[r]: /u\n</code></pre>') // still literal in the block
    expect(out).toContain('<a href="/u">') // but the reference resolves -- the limitation
  })
})

// migration re-bases a Markdown fence to its container's content column: a
// document-level fence dedents to column 0, a list-nested fence stays at the
// item's content column. Either way the migrated fence opens under strict Carve.
describe('markdownToCarve re-bases a fence to its container content column', () => {
  it('dedents a document-level indented fence to column 0', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    const out = markdownToCarve('  ```js\n  x\n  ```\n')
    expect(out.startsWith('```js')).toBe(true)
    expect(carveToHtml(out)).toContain('<pre><code class="language-js">x\n</code></pre>')
  })

  it('keeps a list-nested fence at the item content column', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    const out = markdownToCarve('- item\n  ```\n  code\n  ```\n')
    expect(carveToHtml(out)).toContain('<li>item\n    <pre><code>code\n</code></pre>')
  })

  it('strips only the slack above the content column on an over-indented list fence', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // item content column is 2, fence indented 3 -> one space of slack removed
    const out = markdownToCarve('- item\n   ```\n   code\n   ```\n')
    expect(carveToHtml(out)).toContain('<li>item\n    <pre><code>code\n</code></pre>')
  })

  it('measures a task item column by marker width, not the checkbox', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // content column is 2 (the `- `), not 6 (past `[ ] `); the col-2 fence stays in
    const out = markdownToCarve('- [ ] task\n  ```\n  code\n  ```\n')
    expect(carveToHtml(out)).toContain('<pre><code>code\n</code></pre>')
    expect(carveToHtml(out)).not.toContain('</ul>\n<pre>') // not lifted to top level
  })

  it('re-bases a fence to the parent column after a nested child list', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // fence sits at the OUTER item content column (2) after an inner list
    const out = markdownToCarve('- outer\n  - inner\n  ```\n  code\n  ```\n')
    expect(carveToHtml(out)).toContain('<pre><code>code\n</code></pre>')
    expect(carveToHtml(out)).not.toContain('</ul>\n<pre>') // not lifted to top level
  })

  it('keeps the item column across a lazy paragraph continuation', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // `continued` at column 0 with NO blank is lazy continuation: the item
    // stays open, so the col-2 fence is still inside it.
    const out = markdownToCarve('- item\ncontinued\n  ```\n  code\n  ```\n')
    expect(carveToHtml(out)).toContain('<pre><code>code\n</code></pre>')
    expect(carveToHtml(out)).not.toContain('</ul>\n<pre>')
  })

  it('dedents a fence to column 0 once a blank ends the list', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // blank + column-0 text + blank ends the list, so the fence is document-level
    const out = markdownToCarve('- item\n\ntext\n\n  ```\n  code\n  ```\n')
    expect(carveToHtml(out)).toMatch(/(^|\n)<pre>/) // top-level pre: the list ended
  })

  it('dedents a fence after a block starter ends the list without a blank', async () => {
    const { markdownToCarve } = await import('../src/index.js')
    // a heading interrupts the item (no blank needed), so the later fence is
    // document-level and dedents to column 0
    const out = markdownToCarve('- item\n# heading\n\n  ```\n  code\n  ```\n')
    // fence re-based to column 0 (the heading ended the list)
    expect(out).toContain('\n```\ncode\n```')
    expect(out).not.toContain('  ```')
  })
})
