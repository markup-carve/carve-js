import { describe, expect, it } from 'vitest'
import { BbcodeSentinelSpaceExhaustedError, bbcodeToCarve, carveToHtml, parse } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

const html = (bbcode: string) => carveToHtml(bbcodeToCarve(bbcode)).trim()

describe('text beside a converted formatting tag stays text', () => {
  it.each([
    ['q ~}[s]_ a}[/s] q', '<p>q ~}<s>_ a}</s> q</p>'],
    ['q #[u]x[/u] q', '<p>q #<u>x</u> q</p>'],
    ['q #[/i]x q', '<p>q #x q</p>'],
    ['q @[/b]x q', '<p>q @x q</p>'],
    ['q [B]{} q', '<p>q [B]{} q</p>'],
    ['q =x== q', '<p>q =x== q</p>'],
    ['q a &#8212; b q', '<p>q a &amp;#8212; b q</p>'],
    ['q [u][*x*[u]*** q', '<p>q [u][*x*[u]*** q</p>'],
    ['q [i][/u][/i] q', '<p>q  q</p>'],
    ['q <[/b]/#h> q', '<p>q &lt;/#h&gt; q</p>'],
    // A literal brace run right after a written pair's closer attaches as an
    // attribute block, which this pass never writes (markup-carve/carve-js#1898).
    ['q [b]x[/b]{a} q', '<p>q <strong>x</strong>{a} q</p>'],
    ['q [i]x[/i]{.c} q', '<p>q <em>x</em>{.c} q</p>'],
    ['q [u]x[/u]{#i} q', '<p>q <u>x</u>{#i} q</p>'],
    ['q [s]x[/s]{a b} q', '<p>q <s>x</s>{a b} q</p>'],
    ['q [b]x[/b]{a}b q', '<p>q <strong>x</strong>{a}b q</p>'],
    // The attrs attach to the innermost pair, not an outer one.
    ['q a{[b]x[/b]{a}} b q', '<p>q a{<strong>x</strong>{a}} b q</p>'],
    ['q [b][i]x[/i]{a}[/b] q', '<p>q <strong><em>x</em>{a}</strong> q</p>'],
    // A space before the brace, or an empty pair, is not an attribute block
    // and needs no escape.
    ['q [b]x[/b] {a} q', '<p>q <strong>x</strong> {a} q</p>'],
    ['q [b]x[/b]{} q', '<p>q <strong>x</strong>{} q</p>'],
  ])('%j', (bbcode, expected) => {
    expect(html(bbcode)).toBe(expected)
  })
})

/**
 * An independent reading of the four formatting tags, straight to HTML: the
 * innermost close must match, an unclosed tag is literal, a stray close tag
 * goes (as cleanup() takes it), a tag inside its own kind adds nothing, and an
 * empty one goes. Every generated post must render to exactly this.
 */
function reference(post: string): string {
  const tags: Record<string, string> = { b: 'strong', i: 'em', u: 'u', s: 's' }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  type Node = { kind: string; open: string; kids: Array<string | Node>; unclosed?: boolean }
  const root: Node = { kind: '', open: '', kids: [] }
  const stack = [root]
  let from = 0
  for (const m of post.matchAll(/\[(\/?)(b|i|u|s)\]/gi)) {
    const top = stack.at(-1)!
    top.kids.push(post.slice(from, m.index))
    from = m.index! + m[0].length
    const kind = m[2]!.toLowerCase()
    if (!m[1]) {
      const node: Node = { kind, open: m[0], kids: [] }
      top.kids.push(node)
      stack.push(node)
    } else if (top.kind === kind) stack.pop()
  }
  stack.at(-1)!.kids.push(post.slice(from))
  for (const node of stack.slice(1)) node.unclosed = true
  const out = (kids: Array<string | Node>, open: Set<string>): string =>
    kids
      .map((k) => {
        if (typeof k === 'string') return esc(k)
        if (k.unclosed) return esc(k.open) + out(k.kids, open)
        if (open.has(k.kind)) return out(k.kids, open)
        const inner = out(k.kids, new Set([...open, k.kind]))
        return inner === '' ? '' : `<${tags[k.kind]}>${inner}</${tags[k.kind]}>`
      })
      .join('')
  return `<p>${out(root.kids, new Set())}</p>`
}

describe('a generated post renders exactly as its tags say', () => {
  // Punctuation that opens or closes some Carve construct, beside every tag.
  const atoms = ['[b]', '[/b]', '[i]', '[/i]', '[u]', '[/u]', '[s]', '[/s]', 'x', 'ab', ' ', '_', '*', '/', '~', '=',
    '{', '}', '#', '@', ':', '\\', '`', '$', '^', '+', '-', '<', '>', '[', ']', '(', ')', '!', '%', '|']

  // The import's tree, written the way reference() writes its answer. Smart
  // typography (`->`, `!=`) applies to any Carve source and is not the
  // importer's to undo, so it reads as the characters it was written with;
  // any other construct shows up as itself and fails the comparison.
  const imported = (post: string): string => {
    const tags: Record<string, string> = { strong: 'strong', emphasis: 'em', underline: 'u', strike: 's' }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const write = (nodes: Array<Record<string, any>>): string =>
      nodes
        .map((n) => {
          if (n.type === 'text' || n.type === 'escaped_text' || n.type === 'smart_punctuation') return esc(n.value)
          if (tags[n.type]) return `<${tags[n.type]}>${write(n.children)}</${tags[n.type]}>`
          return `<?${n.type}>`
        })
        .join('')
    const blocks = parse(bbcodeToCarve(post)).children as Array<Record<string, any>>
    return blocks.map((b) => (b.type === 'paragraph' ? `<p>${write(b.children)}</p>` : `<?${b.type}>`)).join('')
  }
  let seed = 1
  const rnd = (n: number) => {
    // Math.imul keeps the low bits exact, so carve-php's generator draws the same posts.
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return seed % n
  }

  it('holds for 3,000 posts', () => {
    const wrong: string[] = []
    for (let t = 0; t < 3000; t++) {
      let post = 'q '
      for (let k = 0, n = 1 + rnd(12); k < n; k++) post += atoms[rnd(atoms.length)]
      post += ' q'
      if (imported(post) !== reference(post)) wrong.push(post)
    }
    expect(wrong).toEqual([])
  })
})

describe('the mark on a written link', () => {
  it('keeps an authored copy of the preferred mark', () => {
    expect(bbcodeToCarve('a \ue020 [url=http://x]y[/url] b')).toBe('a \ue020 [y](http://x) b\n')
  })

  it('refuses a post that leaves no private-use code point free for it', () => {
    // Two code points are left free, and the literal-run stash takes them for
    // the code tag, so the earlier allocations succeed and only this one has
    // nowhere to go. Falling back would strip the post's own U+E020.
    let most = ''
    for (let code = 0xe000; code <= 0xf8ff; code++) if (code !== 0xe010 && code !== 0xe011) most += String.fromCharCode(code)
    expect(() => bbcodeToCarve(`${most} [code]x[/code] [url=http://x]y[/url]`)).toThrow(BbcodeSentinelSpaceExhaustedError)
    // A post with no link to mark needs no mark.
    expect(() => bbcodeToCarve(`${most} [code]x[/code]`)).not.toThrow()
  })
})

describe('the repair', () => {
  perfIt('costs the same per byte at any size', () => {
    expectScansLinearly((input) => bbcodeToCarve(input), '#x [b]y[/b] =z= ', { smallRepeats: 3000 })
  })
})
