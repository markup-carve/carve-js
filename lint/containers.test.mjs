import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { LINE_RULES } from './spelling.ts'

// A line rule reads the text behind the container prefixes, so a shape it reports at the top level
// is reported inside a quote, a list item and a description too.
const CASES = [
  { id: 'deprecated-continuation-marker', trigger: '- a\n+\nb', near: '- a\n\nb' },
  { id: 'thematic-break-spelling', trigger: '___', near: '***' },
  { id: 'setext-heading-underline', trigger: 'A\n---', near: 'A' },
  { id: 'deprecated-spaced-thematic-break', trigger: '* * *', near: '***' },
  { id: 'block-marker-as-text', trigger: 'a\n~~~js', near: 'a\n```js' },
  { id: 'html-comment-renders-as-text', trigger: '<!-- x -->', near: '%% x' },
  { id: 'bare-html-tag', trigger: '<b>x</b>', near: '[x](/b)' },
  { id: 'empty-reference-definition', trigger: '[a]:', near: '[a]: /u' },
  { id: 'table-shaped-paragraph', trigger: 'a\n| a | b', near: 'a\n| a | b |' },
  { id: 'block-opener-without-blank-line', trigger: 'a\n# H', near: 'a\n\n# H' },
  // C2-B-015: in an item a `1.` would open a nested list; `2.` stays text there too.
  { id: 'list-marker-without-blank-line', trigger: 'a\n2. b', near: 'a\n\n2. b' },
  { id: 'unattached-caption', trigger: 'a\n\n^ cap', near: '| a |\n^ cap' },
  { id: 'unattached-block-attribute', trigger: 'a\n\n{.x}', near: '{.x}\ntext' },
  { id: 'markdown-definition-paragraph', trigger: 'a\n: b', near: ':: a\n: b' },
  { id: 'empty-include-path', trigger: 'a {{ }}', near: 'a {{ file.crv }}' },
  { id: 'link-gap-before-destination', trigger: '[x] (/u)', near: '[x](/u)' },
  { id: 'djot-plus-bullet', trigger: '+ a', near: '- a' },
  { id: 'definition-term-block-folded', trigger: ':: - a\n: d', near: ':: a\n: d' },
  { id: 'djot-heading-continuation', trigger: '# h\ntext', near: '# h\n\ntext' },
  { id: 'caption-looking-paragraph', trigger: '| a |\n\nTable: cap', near: '| a |\n^ cap' },
  { id: 'colon-fence-length-mismatch', trigger: '::: note\na\n::::', near: '::: note\na\n:::' },
]

// The catalog scopes these rules to a shape that a container prefix changes.
const SCOPED = {
  'table-row-without-closing-pipe': 'void in the 0.2 catalog',
  'blockquote-marker-without-space': 'C2-B-031: column 1, no indent and no container prefix',
  'indented-code-block': 'a top-level indent, which a container prefix replaces',
  'definition-in-container': 'reports inside containers only',
  'github-alert-marker': 'C2-I-072: the first non-space character is a quote mark; covered on quotes below',
  'region-marker-renders-as-text': 'C2-B-217: the marker after spaces and tabs only',
  'quote-fence-ends-the-quote-above': 'a quote line directly above the fence',
  'description-separator-below-content-column': 'a description separator inside a list item by definition',
}

const WRAPS = {
  quote: (source) => source.split('\n').map((line) => line === '' ? '>' : `> ${line}`).join('\n'),
  'list item': (source) => source.split('\n').map((line, at) => at === 0 ? `- ${line}` : line === '' ? '' : `  ${line}`).join('\n'),
  description: (source) => `:: t\n${source.split('\n').map((line, at) => at === 0 ? `: ${line}` : line === '' ? '' : `  ${line}`).join('\n')}`,
}

const count = (source, id) => lint(`${source}\n`, { rules: { [id]: 'on' } }).filter((entry) => entry.code === id).length

describe('line rules inside containers', () => {
  it('cover every line rule or name why the catalog scopes it', () => {
    const covered = new Set([...CASES.map((entry) => entry.id), ...Object.keys(SCOPED)])
    expect(LINE_RULES.map((rule) => rule.id).filter((id) => !covered.has(id))).toEqual([])
  })

  for (const { id, trigger, near } of CASES) {
    it(`${id} reports its shape at the top level and in every container, and not its near miss`, () => {
      expect(count(trigger, id)).toBeGreaterThan(0)
      expect(count(near, id)).toBe(0)
      for (const [name, wrap] of Object.entries(WRAPS)) {
        expect(count(wrap(trigger), id), `${name}: ${JSON.stringify(wrap(trigger))}`).toBeGreaterThan(0)
        expect(count(wrap(near), id), `${name}: ${JSON.stringify(wrap(near))}`).toBe(0)
      }
    })
  }

  it('C2-I-072: github-alert-marker reports an alert in a nested quote', () => {
    expect(count('> > [!NOTE]\n> > a', 'github-alert-marker')).toBe(1)
    expect(count('> > [NOTE]\n> > a', 'github-alert-marker')).toBe(0)
  })
})
