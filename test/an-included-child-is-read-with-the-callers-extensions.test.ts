import { describe, expect, it } from 'vitest'
import {
  citations,
  expandIncludes,
  parse,
  renderHtml,
  wikilinks,
  type CarveExtension,
} from '../src/index.js'

/*
 * An include is textual composition of one document, so the same text has to
 * mean the same thing whichever file it sits in. `expandIncludes` parsed every
 * child with a fixed option set, so an extension that adds SYNTAX applied to
 * the parent and silently not to the child (carve-js#1693).
 *
 * The child is read through the same two structural passes the entry point runs
 * as well, which is the second half of the same divergence: a reference image
 * plus its caption is a `figure` in the parent and was a paragraph in a child.
 */

const CHILD = 'c.crv'

function expanded(parent: string, child: string, extensions?: CarveExtension[]) {
  const doc = parse(parent, extensions ? { extensions } : {})
  return expandIncludes(doc, parent, {
    resolve: (path) => (path === CHILD ? { source: child, id: CHILD } : null),
    ...(extensions ? { extensions } : {}),
  }).doc
}

function nodeTypes(value: unknown): string[] {
  return JSON.stringify(value).match(/"type":"[a-z_]+"/g) ?? []
}

describe('an included child', () => {
  it('is read with an inline matcher the caller passed', () => {
    const doc = expanded('Root [[P]].\n\n{{ c.crv }}\n', 'Child [[P]].\n', [wikilinks()])

    expect(renderHtml(doc, { extensions: [wikilinks()] })).toContain(
      '<p>Child <a href="p" class="wikilink" data-wikilink="P">P</a>.</p>',
    )
  })

  it('is read with a block matcher the caller passed', () => {
    // No shipped extension declares `matchBlock`, and a host's own matcher is
    // the case the ticket names, so the matcher is written here.
    const shout: CarveExtension = {
      name: 'shout',
      matchBlock(lines, start) {
        const line = lines[start]
        if (!line?.startsWith('^^^ ')) return null

        return {
          node: { type: 'paragraph', children: [{ type: 'text', value: line.slice(4) }] },
          linesConsumed: 1,
        }
      },
    }
    const doc = expanded('Root\n\n{{ c.crv }}\n', '^^^ shouted\n', [shout])

    expect(renderHtml(doc, { extensions: [shout] })).toContain('<p>shouted</p>')
  })

  it('renders what the same lines render as one file', () => {
    const parent = 'Root [[P]].\n\n{{ c.crv }}\n'
    const child = 'Child [[P]].\n'
    const one = 'Root [[P]].\n\nChild [[P]].\n'

    expect(renderHtml(expanded(parent, child, [wikilinks()]), { extensions: [wikilinks()] })).toBe(
      renderHtml(parse(one, { extensions: [wikilinks()] }), { extensions: [wikilinks()] }),
    )
  })

  it('reaches a grandchild', () => {
    const doc = expandIncludes(
      parse('Root\n\n{{ a.crv }}\n', { extensions: [wikilinks()] }),
      'Root\n\n{{ a.crv }}\n',
      {
        resolve: (path) =>
          path === 'a.crv'
            ? { source: '{{ b.crv }}\n', id: 'a.crv' }
            : { source: 'Deep [[P]].\n', id: 'b.crv' },
        extensions: [wikilinks()],
      },
    ).doc

    expect(renderHtml(doc, { extensions: [wikilinks()] })).toContain('data-wikilink="P"')
  })

  it('carries the citation groups the extension produces', () => {
    const doc = expanded('Root cites [@a].\n\n{{ c.crv }}\n', 'Child cites [@b].\n', [citations()])

    expect(nodeTypes(doc).filter((t) => t.includes('citation_group'))).toHaveLength(2)
  })

  it('is left without extensions when the caller passes none', () => {
    const doc = expanded('Root [[P]].\n\n{{ c.crv }}\n', 'Child [[P]].\n')

    expect(renderHtml(doc)).toContain('<p>Child [[P]].</p>')
  })

  it('promotes a citation definition the extension made visible', () => {
    const doc = expanded('Root cites [@k].\n\n{{ c.crv }}\n', '[@k]: Knuth, D. TAOCP.\n', [
      citations(),
    ])

    expect(doc.children.map((block) => block.type)).toContain('citation_definition')
  })

  it('promotes a reference image with a caption to a figure', () => {
    const doc = expanded('Root\n\n{{ c.crv }}\n', '![alt][ref]\n^ Cap\n\n[ref]: a.png\n')

    expect(renderHtml(doc)).toContain('<figcaption>Cap</figcaption>')
  })
})
