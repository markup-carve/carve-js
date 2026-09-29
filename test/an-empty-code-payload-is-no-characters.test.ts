import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown, htmlToCarve, parse } from '../src/index.js'
import type { CodeBlock } from '../src/ast.js'

/*
 * PART 9 section 28's zero-line payload, from both ends.
 *
 * Renderer half, carve-js#2342: a CLOSED fence with no payload line renders no
 * character, so `<pre><code></code></pre>`. Writer half, carve-js#2351: it is
 * written back with no payload line, so the empty payload does not become a
 * one-line one. `content` is what carries the count between them - an all-blank
 * payload is one newline per line, the convention the raw block already uses -
 * which is what keeps a zero-line payload and a one-blank-line one two
 * different values rather than two readings of `""`.
 *
 * Expectations are derived from the executable spec at markup-carve/carve
 * `89157529` (corpus category 524), which the spec pin now carries, so the corpus
 * runner here sees them too. They stay asserted directly for a second reason:
 * the corpus comparison trims both sides, and every divergence here is leading
 * or trailing whitespace.
 */

const codeOf = (source: string): CodeBlock => {
  const block = parse(source).children[0]
  if (block?.type !== 'code_block') throw new Error(`not a code block: ${block?.type}`)

  return block
}

describe('the renderer half (#2342)', () => {
  it('renders a closed zero-line payload as no characters', () => {
    expect(carveToHtml('```\n```\n')).toBe('<pre><code></code></pre>')
    expect(carveToHtml('~~~\n~~~\n')).toBe('<pre><code></code></pre>')
  })

  it('keeps the one-blank-line payload distinguishable from it', () => {
    expect(carveToHtml('```\n\n```\n')).toBe('<pre><code>\n</code></pre>')
    expect(carveToHtml('```\n\n\n```\n')).toBe('<pre><code>\n\n</code></pre>')
  })

  it('reads the same in a quote and in an item', () => {
    expect(carveToHtml('> ```\n> ```\n')).toBe('<blockquote>\n  <pre><code></code></pre>\n</blockquote>')
    expect(carveToHtml('- ```\n  ```\n')).toBe('<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>')
  })

  it('empties an UNTERMINATED zero-line payload too, which corpus 276 pins', () => {
    // `CARVE-P12-064` (markup-carve/carve#2616) reaches the unterminated fence
    // as well: it holds no payload line, so it invents no break. This engine
    // used to give it one and corpus 276 pinned THAT reading, until the ruling
    // rewrote its goldens to the rows below.
    expect(carveToHtml('```\n')).toBe('<pre><code></code></pre>')
    expect(carveToHtml('- ```\nx\n```\n')).toBe(
      '<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>x\n<code></code></p>',
    )
    // Its one-blank-line partner keeps the line whether the fence closes or not,
    // which is what keeps the two shapes two documents.
    expect(carveToHtml('```\n\n')).toBe('<pre><code>\n</code></pre>')
  })
})

describe('the writer half (#2351)', () => {
  it('writes a zero-line payload back with no payload line', () => {
    expect(carveToCarve('```\n```\n')).toBe('```\n```\n')
    expect(carveToCarve('```js\n```\n')).toBe('```js\n```\n')
    expect(carveToMarkdown('```\n```\n')).toBe('```\n```\n')
  })

  it('writes every authored blank payload line back, and no more', () => {
    for (const count of [1, 2, 3]) {
      const source = `\`\`\`\n${'\n'.repeat(count)}\`\`\`\n`
      expect(carveToCarve(source), `${count} blank line(s)`).toBe(source)
    }
  })
})

describe('the AST carries the count', () => {
  it('gives the two payloads two different content values', () => {
    expect(codeOf('```\n```\n').content).toBe('')
    expect(codeOf('```\n\n```\n').content).toBe('\n')
    expect(codeOf('```\n\n\n```\n').content).toBe('\n\n')
  })

  it('reads a non-blank payload back as the literal text it holds', () => {
    expect(codeOf('```\na\n```\n').content).toBe('a\n')
    expect(codeOf('```\na\nb\n```\n').content).toBe('a\nb\n')
    expect(codeOf('```\na\n\n```\n').content).toBe('a\n\n')
  })

  it('gives the code payload a literal encoding the raw one still lacks', () => {
    // CARVE-P12-064: a code payload keeps the break before its closer, which
    // the raw encoding leaves implied. The blank-line payloads still agree.
    const raw = (source: string): string => {
      const block = parse(source).children[0]
      if (block?.type !== 'raw_block') throw new Error(`not a raw block: ${block?.type}`)

      return block.content
    }
    for (const payload of ['', '\n', '\n\n']) {
      expect(codeOf(`\`\`\`\n${payload}\`\`\`\n`).content, JSON.stringify(payload))
        .toBe(raw(`\`\`\`=html\n${payload}\`\`\`\n`))
    }
    for (const payload of ['a\n', 'a\nb\n']) {
      expect(codeOf(`\`\`\`\n${payload}\`\`\`\n`).content, JSON.stringify(payload)).toBe(payload)
      expect(raw(`\`\`\`=html\n${payload}\`\`\`\n`), JSON.stringify(payload)).toBe(payload.slice(0, -1))
    }
  })
})

describe('the HTML round trip keeps the count both ways (#2342)', () => {
  // The newline before `</code>` terminates the last payload line, so an import
  // that drops it unconditionally loses a line on every all-blank payload -
  // including this engine's own output. Raised by codex review on this change.
  it.each([
    '<pre><code></code></pre>',
    '<pre><code>\n</code></pre>',
    '<pre><code>\n\n</code></pre>',
    '<pre><code>a\n</code></pre>',
    '<pre><code>a\n\n</code></pre>',
  ])('%j comes back as itself', (html) => {
    expect(carveToHtml(htmlToCarve(html).value).trim()).toBe(html)
  })
})
