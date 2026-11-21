import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/api.ts'
import { format } from '../src/format.ts'
import { lint } from '../lint/lint.ts'

// Prototype for typed metadata blocks after line 1 (carve#TBD). Not spec yet.
type Child = { type: string, format?: string, value?: string, attrs?: { id?: string, keyValues?: string[][] } }
const kids = (src: string): Child[] => parse(src).children as Child[]
const types = (src: string): string[] => kids(src).map((child) => child.type)
const codes = (src: string): string[] => lint(src).map((finding) => finding.code)

describe('metadata blocks after line 1', () => {
  it('a typed opener at column 0 after a blank line opens one at the top level', () => {
    expect(kids('a\n\n---yaml\nk: v\n---\n\nb\n')[1]).toEqual(expect.objectContaining({ type: 'frontmatter', format: 'yaml', value: 'k: v\n' }))
    expect(types('a\n\n--- toml\nk = 1\n---\n')).toEqual(['paragraph', 'frontmatter'])
    expect(types('---\nt: 1\n---\n\nbody\n\n---json\n{}\n---\n')).toEqual(['frontmatter', 'paragraph', 'frontmatter'])
  })

  it('a bare opener, an indented one, one without a blank line above or inside a container stays text', () => {
    expect(types('a\n\n---\nk: v\n---\n')).toEqual(['paragraph', 'paragraph'])
    expect(types('a\n\n ---yaml\nk: v\n---\n')).toEqual(['paragraph', 'paragraph'])
    expect(types('a\n---yaml\nk: v\n---\n')).toEqual(['paragraph'])
    expect(types('::: note\n\n---yaml\nk: v\n---\n\n:::\n')).toEqual(['admonition'])
    expect(types('> a\n>\n> ---yaml\n> k: v\n> ---\n')).toEqual(['block_quote'])
    expect(types('- a\n\n  ---yaml\n  k: v\n  ---\n')).toEqual(['list'])
  })

  it('a list closes before it', () => {
    expect(types('- a\n- b\n\n---toml\nk = 1\n---\n\nx\n')).toEqual(['list', 'frontmatter', 'paragraph'])
  })

  it('takes the attribute lines above it, so a block has a key', () => {
    const block = kids('# Ch\n\n{#ch1 scope=section}\n---yaml\nauthor: A\n---\n')[1]!
    expect(block.attrs).toEqual({ id: 'ch1', keyValues: [['scope', 'section']] })
  })

  it('renders nothing and reports nothing', () => {
    expect(render('a\n\n---yaml\nk: v\n---\n\nb\n')).toBe('<p>a</p>\n<p>b</p>')
    expect(codes('a\n\n---yaml\nk: v\n---\n\nb\n')).toEqual([])
  })

  it('an unclosed block runs to the end and is reported', () => {
    expect(kids('a\n\n---yaml\nk: v\n\n# Lost\n')[1]!.value).toBe('k: v\n\n# Lost\n')
    expect(codes('a\n\n---yaml\nk: v\n\n# Lost\n')).toContain('unclosed-frontmatter')
  })

  it('the writer names the format of a later block, keeps its attributes and escapes text that would open one', () => {
    expect(format('a\n\n---yaml\nk: v\n---\n')).toBe('a\n\n---yaml\nk: v\n---\n')
    expect(format('---yaml\nt: 1\n---\n\nbody\n')).toBe('---\nt: 1\n---\n\nbody\n')
    expect(format('# Ch\n\n{#ch1}\n---yaml\nk: v\n---\n')).toBe('= Ch\n\n{#ch1}\n---yaml\nk: v\n---\n')
    const escaped = format('a\n\n\\---yaml\nk: v\n\\---\n')
    expect(types(escaped)).toEqual(['paragraph', 'paragraph'])
  })

  it('every case reads back after the writer', () => {
    for (const src of ['a\n\n---yaml\nk: v\n---\n\nb\n', '---\nt: 1\n---\n\n# Ch\n\n{#c scope=s}\n---yaml\nx: 1\n---\n',
      '- a\n\n---toml\nk = 1\n---\n', '{#only}\n---json\n{}\n---\n\nbody\n']) {
      const strip = (node: unknown): unknown => JSON.parse(JSON.stringify(node, (key, value) => key === 'pos' || key === 'srcByteLength' ? undefined : value))
      expect(strip(parse(format(src)))).toEqual(strip(parse(src)))
    }
  })
})
