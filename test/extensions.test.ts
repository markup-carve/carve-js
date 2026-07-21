import { describe, expect, it } from 'vitest'

import { carveToHtml, type CarveExtension, type Document } from '../src/index.js'

describe('extension transforms', () => {
  it('runs afterParse for every extension before any beforeRender', () => {
    const order: string[] = []
    const extA: CarveExtension = {
      name: 'a',
      afterParse(doc) {
        order.push('after-a')
        return doc
      },
      beforeRender(doc) {
        order.push('before-a')
        return doc
      },
    }
    const extB: CarveExtension = {
      name: 'b',
      afterParse(doc) {
        order.push('after-b')
        return doc
      },
      beforeRender(doc) {
        order.push('before-b')
        return doc
      },
    }
    carveToHtml('hi', { extensions: [extA, extB] })
    expect(order).toEqual(['after-a', 'after-b', 'before-a', 'before-b'])
  })

  it('lets beforeRender mutate the tree', () => {
    const ext: CarveExtension = {
      name: 'upper',
      beforeRender(doc) {
        const walk = (n: unknown) => {
          if (!n || typeof n !== 'object') return
          const node = n as {
            type?: string
            value?: string
            children?: unknown[]
            content?: unknown[]
          }
          if (node.type === 'text' && typeof node.value === 'string') {
            node.value = node.value.toUpperCase()
          }
          if (Array.isArray(node.children)) node.children.forEach(walk)
          if (Array.isArray(node.content)) node.content.forEach(walk)
        }
        doc.children.forEach(walk)
        return doc
      },
    }
    expect(carveToHtml('hi', { extensions: [ext] }).trim()).toBe('<p>HI</p>')
  })
})

describe('extension renderers', () => {
  it('uses a registered renderer for its extension name', () => {
    const yt: CarveExtension = {
      name: 'youtube',
      renderers: {
        youtube: (node, ctx) =>
          `<iframe data-id="${ctx.escapeAttr(ctx.renderInlines(node.content))}"></iframe>`,
      },
    }
    expect(carveToHtml(':youtube[abc123]', { extensions: [yt] }).trim()).toBe(
      '<p><iframe data-id="abc123"></iframe></p>',
    )
  })

  it('falls back to the built-in extension rendering when no renderer matches', () => {
    expect(carveToHtml(':kbd[x]').trim()).toBe('<p><kbd>x</kbd></p>')
  })
})

describe('block renderers', () => {
  it('lets an extension take over a core block node type', () => {
    const wrap: CarveExtension = {
      name: 'wrap',
      blockRenderers: {
        block_quote: (_node, ctx) => `${ctx.indent(ctx.level)}<aside>!</aside>`,
      },
    }
    expect(carveToHtml('> hi', { extensions: [wrap] }).trim()).toBe('<aside>!</aside>')
  })

  it('renders children through the core renderer at the right level', () => {
    const box: CarveExtension = {
      name: 'box',
      blockRenderers: {
        div: (node, ctx) => {
          const kids = ctx.renderChildren(
            (node as { children: never[] }).children,
            ctx.level + 1,
          )
          return `${ctx.indent(ctx.level)}<box>\n${kids}\n${ctx.indent(ctx.level)}</box>`
        },
      },
    }
    expect(carveToHtml(':::\nhi\n:::', { extensions: [box] }).trim()).toBe(
      ['<box>', '  <p>hi</p>', '</box>'].join('\n'),
    )
  })

  it('falls through to the core renderer when the block renderer returns undefined', () => {
    const onlyEmpty: CarveExtension = {
      name: 'only-empty',
      blockRenderers: {
        paragraph: (node) =>
          (node as { children: unknown[] }).children.length === 0 ? '<empty>' : undefined,
      },
    }
    expect(carveToHtml('hi', { extensions: [onlyEmpty] }).trim()).toBe('<p>hi</p>')
  })
})

describe('extension worked example: heading collector', () => {
  it('collects heading text via afterParse and injects a paragraph via beforeRender', () => {
    const titles: string[] = []
    const toc: CarveExtension = {
      name: 'toc',
      afterParse(doc) {
        for (const b of doc.children) {
          if (b.type === 'heading') {
            titles.push(
              b.children
                .map((n) => ('value' in n && typeof n.value === 'string' ? n.value : ''))
                .join(''),
            )
          }
        }
        return doc
      },
      beforeRender(doc) {
        ;(doc.children as Document['children']).unshift({
          type: 'paragraph',
          children: [{ type: 'text', value: `TOC: ${titles.join(', ')}` }],
        })
        return doc
      },
    }
    const html = carveToHtml('# Alpha\n\n# Beta', { extensions: [toc] })
    expect(html).toContain('<p>TOC: Alpha, Beta</p>')
  })

  it('replaces every placeholder occurrence in renderer-configured URL templates', () => {
    expect(
      carveToHtml('Hey @john.doe, see #release-1.0.', {
        mentionUrl: '/users/{name}?q={name}',
        tagUrl: '/topics/{name}?tag={name}',
      }).trim(),
    ).toBe(
      '<p>Hey <a class="mention" href="/users/john.doe?q=john.doe">@john.doe</a>, see <a class="tag" href="/topics/release-1.0?tag=release-1.0">#release-1.0</a>.</p>',
    )
  })
})
