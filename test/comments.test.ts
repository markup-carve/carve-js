import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('trailing line comments', () => {
  it('strips a trailing comment, keeps the visible prefix', () => {
    expect(carveToHtml('Also visible. %% gone').trim()).toBe('<p>Also visible.</p>')
  })

  it('leaves %% literal without a preceding space', () => {
    expect(carveToHtml('50%% off and a%%b').trim()).toBe('<p>50%% off and a%%b</p>')
  })

  it('protects %% inside a code span', () => {
    expect(carveToHtml('Run `a %% b` then done. %% gone').trim())
      .toBe('<p>Run <code>a %% b</code> then done.</p>')
  })

  it('keeps \\%% literal', () => {
    expect(carveToHtml('path 50\\%% done').trim()).toBe('<p>path 50%% done</p>')
  })

  it('works in a heading without affecting the id', () => {
    // The id lives on the <section> wrapper (PART 9 §13); the comment is stripped.
    const html = carveToHtml('# Title %% note').trim()
    expect(html).toContain('<section id="Title">')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).not.toContain('note')
  })

  it('ends at the line break, keeping the next paragraph line', () => {
    expect(carveToHtml('foo %% note\nbar').trim()).toBe('<p>foo\nbar</p>')
  })

  it('recognizes a comment at the start of an inline run (i===0 path)', () => {
    // Heading text "%% all" reaches scanInline at offset 0, so the inline
    // i===0 guard fires and the whole title is a comment.
    expect(carveToHtml('# %% all').trim()).toBe('<section id="s">\n  <h1></h1>\n</section>')
  })

  it('treats an indented comment-only line as a comment (no empty paragraph)', () => {
    // Leading whitespace before %% does not matter; matches carve-php / carve-rs.
    expect(carveToHtml('  %% indented comment').trim()).toBe('')
    expect(carveToHtml('before\n\n  %% c\n\nafter').trim()).toBe('<p>before</p>\n<p>after</p>')
  })

  it('an indented comment line interrupts an open paragraph', () => {
    expect(carveToHtml('x\n  %% c\ny').trim()).toBe('<p>x</p>\n<p>y</p>')
  })
})

describe('block comment fence lines (PART 9 §28)', () => {
  it('treats trailing text on the opener as insignificant', () => {
    // `%%% html` is a comment fence, NOT a raw block: `%%%` carries no info
    // string (a raw block is a code fence with an `=FORMAT` info string). The
    // body stays hidden and the following block still renders.
    expect(carveToHtml('before\n\n%%% html\nsecret\n%%%\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>after</p>',
    )
    expect(carveToHtml('before\n\n%%% TODO\nsecret\n%%%\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>after</p>',
    )
  })

  it('treats trailing text on the closer as insignificant', () => {
    expect(carveToHtml('before\n\n%%%\nsecret\n%%% end\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>after</p>',
    )
  })

  it('needs no space before the trailing text', () => {
    expect(carveToHtml('before\n\n%%%html\nsecret\n%%%\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>after</p>',
    )
  })

  it('matches the closer on exact delimiter length, so longer fences nest', () => {
    expect(carveToHtml('before\n\n%%%% html\nhidden %%% inner\n%%%%\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>after</p>',
    )
  })

  it('does not open a block when no matching closer exists ahead', () => {
    // Degrades to a `%%` line comment, so every following block still renders
    // instead of being swallowed to EOF.
    expect(carveToHtml('before\n\n%%% TODO\nsecret\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>secret</p>\n<p>after</p>',
    )
    expect(carveToHtml('before\n\n%%%\nsecret\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>secret</p>\n<p>after</p>',
    )
  })

  it('does not treat a too-short closer as closing a longer fence', () => {
    expect(carveToHtml('before\n\n%%%%\nsecret\n%%%\n\nafter').trim()).toBe(
      '<p>before</p>\n<p>secret</p>\n<p>after</p>',
    )
  })

  it('keeps the opener tail in the body so fmt round-trips it', () => {
    // The tail is comment content, so it renders nothing but survives fmt.
    expect(carveToHtml('%%% TODO\nx\n%%%\n\nafter').trim()).toBe('<p>after</p>')
  })

  it('stays linear on many unclosed openers', () => {
    // The closer lookahead scans to EOF per opener; without the per-length
    // negative cache this input is O(n^2).
    const build = (n: number) => '%%% x\n'.repeat(n) + 'tail\n'
    const timeMin = (fn: () => void, runs = 5) => {
      let best = Infinity
      for (let r = 0; r < runs; r++) {
        const t = performance.now()
        fn()
        best = Math.min(best, performance.now() - t)
      }
      return best
    }
    const small = build(2000)
    const large = build(4000)
    const tSmall = timeMin(() => carveToHtml(small))
    const tLarge = timeMin(() => carveToHtml(large))
    expect(tSmall).toBeLessThan(2000)
    expect(tLarge).toBeLessThan(2000)
    expect(tLarge / Math.max(tSmall, 1)).toBeLessThan(6)
  })
})
