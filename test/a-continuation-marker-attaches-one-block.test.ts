import { describe, it, expect } from 'vitest'
import { carveToHtml, type CarveExtension } from '../src/index.js'

/*
 * PART 9 §17 L3 says it in capitals: a `+` attaches "the FOLLOWING flush-left
 * block to that container - ONE block of ANY kind". The trailing "up to the next
 * blank line, sibling marker, or a further `+`" is the EXTENT of that one block,
 * not a second thing the attachment is (markup-carve/carve#1290, corpus category
 * 327).
 *
 * The collector read the trailing clause as the WHOLE rule: it took every line
 * up to a boundary, so one marker attached a paragraph AND the quote below it,
 * and a second block cost nothing. Now the boundary scan finds the outer limit
 * and the block's own extent decides inside it - which is measured by re-parsing
 * one block, so there is one definition of where a block ends rather than a copy
 * of the block grammar that could drift from it.
 *
 * carve-rs `b6ff319c` produces every expectation below.
 */
describe('a continuation marker attaches one block', () => {
  it('takes the paragraph and leaves the quote below it outside', () => {
    expect(carveToHtml('- a\n+\npara\n> q\n')).toBe(
      '<ul>\n  <li>a\n    para\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('a second attached block takes a second marker', () => {
    // The control for the row above. One block costs a marker line and no
    // expressiveness.
    expect(carveToHtml('- a\n+\npara\n+\n> q\n')).toBe(
      '<ul>\n  <li>a\n    para\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('a WRAPPED paragraph is still one block', () => {
    // The extent is the block's, not a line count: two lazily continued lines
    // are one paragraph and both come with the marker.
    expect(carveToHtml('- a\n+\np1\np2\n> q\n')).toBe(
      '<ul>\n  <li>a\n    p1\np2\n  </li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('a multi-line quote is one block and comes whole', () => {
    // The other direction: a reader that stopped at the first line of every
    // block would split this quote in half.
    expect(carveToHtml('- a\n+\n> x\n> y\n- next\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote><p>x\ny</p></blockquote>\n  </li>\n  <li>next</li>\n</ul>',
    )
  })

  it('a sibling marker attaches nothing and opens a sibling', () => {
    expect(carveToHtml('- a\n+\n- x\n- y\n')).toBe(
      '<ul>\n  <li>a\n+</li>\n  <li>x</li>\n  <li>y</li>\n</ul>',
    )
  })

  it('the first-block form answers the same way', () => {
    expect(carveToHtml('- +\npara\n> q\n')).toBe(
      '<ul>\n  <li>para</li>\n</ul>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('and the first-block form takes a second marker too', () => {
    // It published the item as soon as it had ONE block, so the second marker
    // was left at the top level and rendered as `<p>+</p>` with the block it was
    // written for outside the item.
    expect(carveToHtml('- +\npara\n+\n> q\n')).toBe(
      '<ul>\n  <li>para\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('a quote answers it the same way, both ways', () => {
    expect(carveToHtml('> quoted\n+\npara\n# H\n')).toBe(
      '<blockquote>\n  <p>quoted</p>\n  <p>para</p>\n</blockquote>\n<section id="H">\n  <h1>H</h1>\n</section>',
    )
    expect(carveToHtml('> quoted\n+\npara\n+\n# H\n')).toBe(
      '<blockquote>\n  <p>quoted</p>\n  <p>para</p>\n  <h1 id="H">H</h1>\n</blockquote>',
    )
  })

  it('a fenced block is one block and many lines', () => {
    // A self-delimiting block never reaches the probe: its extent is read from
    // its closer. A change that measured it by parsing would still pass, but a
    // change that let the boundary scan reach inside it would not.
    expect(carveToHtml('- a\n+\n```\nb\n\nc\n```\n')).toContain('<pre><code>b\n\nc\n</code></pre>')
  })

  it('a nested marker is measured, not spliced', () => {
    // The probe measures the definition list, whose body's own `+` is refused,
    // so the list ends after `q` and the heading is the document's. A shortcut that let a marker reached INSIDE the probe splice its whole
    // extent instead restored the old behavior one level down and enlarged the
    // outer block with it, putting the heading inside the item.
    expect(carveToHtml('- a\n+\n:: t\n:  +\n   p\n   q\n# H\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>+\np\nq</dd>\n    </dl>\n  </li>\n</ul>\n' +
        '<section id="H">\n  <h1>H</h1>\n</section>',
    )
  })

  it('an INVISIBLE block between the run and its block is part of it', () => {
    // §15 A2a keeps the pending slot across a comment or a reference, footnote
    // or abbreviation definition, so a probe that stopped at the first node
    // stopped in front of the block the attributes were written for - leaving it
    // outside the container with `.x` dropped.
    expect(carveToHtml('> q\n+\n{.x}\n%% hidden\n# h\n')).toBe(
      '<blockquote>\n  <p>q</p>\n  <h1 class="x" id="h">h</h1>\n</blockquote>',
    )
  })

  it('no extension matcher runs for a measurement', () => {
    // R1a now REQUIRES a matcher to be pure, so a probe calling it would be
    // permitted (markup-carve/carve#1432). This probe still does not need to:
    // the count says so, and it says it deliberately rather than because calling
    // would be illegal. A matcher numbering its own authored blocks would see 2
    // rather than 1 if that ever changes, which is the point of asserting it.
    let calls = 0
    const counting: CarveExtension = {
      name: 'counting',
      matchBlock(lines, start) {
        const line = lines[start]
        if (!line || !line.startsWith('^^^ ')) return null
        calls++

        return {
          node: { type: 'paragraph', children: [{ type: 'text', value: 'N' + calls }] },
          linesConsumed: 1,
        }
      },
    }
    const html = carveToHtml('- a\n+\n^^^ x\n> q\n', { extensions: [counting] })
    expect(calls).toBe(1)
    expect(html).toContain('N1')
  })

  it('an attribute run comes with the block it floats onto', () => {
    // Only `parseBlocks` owns a pending-attribute slot and the probe is a
    // `parseBlock` call, so a run left to it reads as a paragraph and the
    // measurement stops in front of the block the attributes were written for.
    expect(carveToHtml('> q\n+\n{.x}\n# h\n')).toBe(
      '<blockquote>\n  <p>q</p>\n  <h1 class="x" id="h">h</h1>\n</blockquote>',
    )
  })
})

describe('an attribute line between the marker and a fence', () => {
  // The attribute run belongs to the fence, so the fence body stays opaque:
  // a body line shaped like the host's marker is code, as it is with no
  // attribute line (carve#1238).
  it('keeps a list-marker body line inside the fence', () => {
    expect(carveToHtml('- a\n+\n{.x}\n```\n- x\ncode\n```\n')).toBe(
      '<ul>\n  <li>a\n    <pre class="x"><code>- x\ncode\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('a wrapped attribute run does the same', () => {
    expect(carveToHtml('- a\n+\n{.x\n .z}\n```\n- x\n```\n')).toBe(
      '<ul>\n  <li>a\n    <pre class="x z"><code>- x\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('a definition body keeps `: x` and `:: x` inside the fence', () => {
    expect(carveToHtml(':: t\n: d\n+\n{.x}\n```\n: x\n:: y\n```\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <pre class="x"><code>: x\n:: y\n</code></pre>\n  </dd>\n</dl>',
    )
  })

  const hosts: Record<string, string[]> = {
    bullet: ['- a'], ordered: ['1. a'], auto: ['. a'], task: ['- [ ] a'], nested: ['- a', '  - b'],
  }
  const attrs: Record<string, string[]> = { class: ['{.x}'], wrapped: ['{.x', ' .x}'] }
  const cases: [string, string[], string, string[], string][] = []
  for (const [host, opener] of Object.entries(hosts)) {
    for (const body of ['- x', '* x', '1. x', '. x']) {
      for (const [form, attr] of Object.entries(attrs)) {
        for (const prefix of ['', '> ']) cases.push([host, opener, body, attr, prefix === '' ? form : `${form}, quoted`])
      }
    }
  }
  cases.push(['definition', [':: t', ': d'], ': x', ['{.x}'], 'class'])
  cases.push(['definition', [':: t', ': d'], ':: x', ['{.x}'], 'class'])
  cases.push(['unclosed bullet', ['- a'], '- x', ['{.x}'], 'class'])

  it.each(cases)('%s host, %s body line: %s reads like the bare fence', (host, opener, body, attr, form) => {
    const prefix = form.endsWith('quoted') ? '> ' : ''
    const closer = host.startsWith('unclosed') ? [] : ['```']
    const doc = (marker: string[]) => [...opener, ...marker, '```', body, 'code', ...closer]
      .map(line => (prefix + line).trimEnd()).join('\n') + '\n'
    const bare = carveToHtml(doc(['+']))
    expect(bare).toContain(body.replace(/^>/, '&gt;'))
    expect(carveToHtml(doc(['+', ...attr]))).toBe(bare.replace('<pre>', '<pre class="x">'))
  })
})
