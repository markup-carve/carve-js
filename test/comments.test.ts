import { describe, it, expect } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

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

  it('does not rescan the document per fence opener', () => {
    // Every line is an opener of a DISTINCT width, so no line can close any
    // other and each one has to answer "is there a closer ahead?". Scanning to
    // end of input per opener made this superlinear: ~1.9 MiB of it took 8.5s,
    // growing ~7x per 4x of input. The width -> last-index map answers each in
    // O(1) after one pass.
    //
    // Note the input's own size grows quadratically with n (the widths get
    // longer), so this asserts against ELAPSED TIME PER BYTE, which stays flat
    // for a linear parse. A ratio of raw times would look superlinear even for
    // a correct implementation.
    const build = (n: number) => {
      const out: string[] = []
      for (let i = 0; i < n; i++) out.push('%'.repeat(3 + i) + '\n')
      return out.join('\n')
    }
    const timeMin = (fn: () => void, runs = 3) => {
      let best = Infinity
      for (let r = 0; r < runs; r++) {
        const t = performance.now()
        fn()
        best = Math.min(best, performance.now() - t)
      }
      return best
    }
    const small = build(300)
    const large = build(600)
    const perByteSmall = timeMin(() => carveToHtml(small)) / small.length
    const perByteLarge = timeMin(() => carveToHtml(large)) / large.length
    // Measured on this input: ~1.42 with the per-opener scan, ~0.40 with the
    // map. The 1.1 bound sits between them with margin on both sides, and the
    // sizes stay small enough not to starve tests in sibling files.
    expect(perByteLarge / Math.max(perByteSmall, 1e-9)).toBeLessThan(1.1)
  })
})

describe('an indented comment fence', () => {
  // The line form has always been column-free, and carve#624 pinned that a
  // comment is recognized at ANY column. The fence form was anchored at column
  // 0, so an indented `%%%` fell to the line-comment rule: the opener and the
  // closer were each consumed as their own one-line comment and everything
  // between them rendered - a comment that hid its delimiters and showed its
  // contents (carve-js#630).
  it('hides its body inside a list item, below the content column', () => {
    const html = carveToHtml('- a\n %%% n\n x\n %%%\n tail\n')

    expect(html).not.toContain('x')
    expect(html).not.toContain('%')
    // The comment does not end the item either: `tail` is still item content,
    // the same shape carve-rs#572 settled for a column-0 comment.
    expect(html).toBe('<ul>\n  <li>a\n    tail\n  </li>\n</ul>')
  })

  it('hides its body under a top-level paragraph', () => {
    expect(carveToHtml('a\n  %%% x\n  b\n  %%%\n')).toBe('<p>a</p>')
  })

  it('is still a line comment when nothing closes it', () => {
    // An unclosed fence opens no block (PART 9 §28), indented or not, so the
    // opener renders nothing and the item survives it.
    expect(carveToHtml('- a\n %%% n\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('closes on a delimiter run of its own width at any indent', () => {
    // Opener indented one column, closer three: the width matches, the indent
    // is not part of the delimiter.
    expect(carveToHtml('- a\n %%%% n\n x\n   %%%%\n tail\n')).toBe(
      '<ul>\n  <li>a\n    tail\n  </li>\n</ul>',
    )
  })
})

describe('a comment body is indented relative to its fence', () => {
  // A code fence's body is measured from its opener, and a comment fence is no
  // different: an opener at column 1 makes a body line at column 1 flush. This
  // engine kept the absolute text, so the same document parsed to a different
  // comment content here than in carve-rs and carve-php, and `carve fmt` wrote
  // the body one column further in each time it ran (carve#653).
  it('drops the fence indent from a below-column body in a list item', () => {
    const ast = parse('- a\n %%% n\n x\n %%%\n tail\n')
    const comments: string[] = []
    const walk = (n: any): void => {
      if (n.type === 'comment') comments.push(n.content)
      for (const c of [...(n.children ?? []), ...(n.items ?? [])]) walk(c)
    }
    walk(ast)

    expect(comments).toEqual(['n\nx'])
  })

  it('keeps indentation the body has BEYOND the fence', () => {
    const ast = parse('%%%\n  x\n%%%\n')

    expect((ast.children[0] as any).content).toBe('  x')
  })

  it('round-trips a below-column body without moving it', () => {
    const src = '- a\n %%% n\n x\n %%%\n tail\n'
    const once = renderCarve(parse(src))

    expect(once).toBe('- a\n  %%%\n  n\n  x\n  %%%\n  tail\n')
    expect(renderCarve(parse(once))).toBe(once)
  })
})
