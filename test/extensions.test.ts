import { describe, expect, it } from 'vitest'

import {
  carveToAnsi,
  carveToAstJson,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  type BeforeRenderContext,
  type CarveExtension,
  type Document,
} from '../src/index.js'

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

  it('hands beforeRender the options the conversion was called with', () => {
    // carve#1007 / carve-js#871. A hook that renders something of its own - the
    // injected table-of-contents nav is the one in this package - had no way to
    // render it the way the caller asked, because the hook took the document and
    // nothing else. It now takes a read-only CONTEXT, whose `options` is that
    // view.
    let seen: Record<string, unknown> | undefined
    const ext: CarveExtension = {
      name: 'peek',
      beforeRender(doc, ctx) {
        seen = ctx.options as Record<string, unknown>
        return doc
      },
    }
    carveToHtml('hi', { extensions: [ext], symbols: { ok: 'OK' }, allowRawHtml: false })
    expect(seen).toBeDefined()
    expect(seen!['symbols']).toEqual({ ok: 'OK' })
    expect(seen!['allowRawHtml']).toBe(false)
  })

  it('the options handed to beforeRender are frozen and are not the caller object', () => {
    // The hook reads the options; it does not get to change them. carve-rs found
    // the shape from the other side: a guard sitting BEHIND the hooks can be
    // talked out of its own input by a hook that clears the field it reads. Here
    // the renderer is handed the CALLER's object a few lines later, so the hook
    // is handed a frozen copy and the two are not the same object.
    let frozen: boolean | undefined
    let threw: boolean | undefined
    let sameObject: boolean | undefined
    let sawTheOption: unknown
    const ext: CarveExtension = {
      name: 'tamper',
      beforeRender(doc, ctx) {
        // Checked BEFORE the freeze assertion, because `Object.isFrozen` says
        // true of `undefined` too - without these two the row would pass against
        // an engine that hands the hook nothing at all.
        sameObject = (ctx.options as unknown) === (caller as unknown)
        sawTheOption = ctx.options.allowRawHtml
        frozen = Object.isFrozen(ctx.options) && Object.isFrozen(ctx)
        try {
          ;(ctx.options as { allowRawHtml?: boolean }).allowRawHtml = true
          threw = false
        } catch {
          threw = true
        }
        return doc
      },
    }
    const caller: { extensions: CarveExtension[]; allowRawHtml: boolean } = {
      extensions: [ext],
      allowRawHtml: false,
    }
    const out = carveToHtml('`<b>x</b>`{=html}\n', caller)
    expect(sawTheOption).toBe(false)
    expect(sameObject).toBe(false)
    expect(frozen).toBe(true)
    expect(threw).toBe(true)
    // The caller's own object is untouched, and the render still escaped.
    expect(caller.allowRawHtml).toBe(false)
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;')
    // CONTROL: with raw HTML allowed the same document passes it through, so the
    // row above is the option doing the work rather than an escape everywhere.
    expect(carveToHtml('`<b>x</b>`{=html}\n', { allowRawHtml: true })).toContain('<b>x</b>')
  })

  it('the effective mode is the caller mode on HTML and interactive on every other target', () => {
    // Static rendering is an HTML-only concern (spec 2.5): the Markdown,
    // plain-text and ANSI renderers reach the same end by flattening and never
    // consult the mode. Reporting a caller's `mode: "static"` to a hook on those
    // targets would invite it to degrade output that is not degraded, and one
    // options object reused across formats would stop producing the same
    // non-HTML bytes.
    const seen: { target: string; mode: string; isStatic: boolean }[] = []
    const ext: CarveExtension = {
      name: 'peek-mode',
      beforeRender(doc, ctx) {
        seen.push({ target: ctx.targetIsHtml ? 'html' : 'other', mode: ctx.mode, isStatic: ctx.isStatic })
        return doc
      },
    }
    const opts = { extensions: [ext], mode: 'static' } as const
    carveToHtml('hi', opts)
    expect(seen.pop()).toEqual({ target: 'html', mode: 'static', isStatic: true })
    carveToMarkdown('hi', opts)
    expect(seen.pop()).toEqual({ target: 'other', mode: 'interactive', isStatic: false })
    carveToPlainText('hi', opts)
    expect(seen.pop()).toEqual({ target: 'other', mode: 'interactive', isStatic: false })
    carveToAnsi('hi', opts)
    expect(seen.pop()).toEqual({ target: 'other', mode: 'interactive', isStatic: false })
    carveToAstJson('hi', opts)
    expect(seen.pop()).toEqual({ target: 'other', mode: 'interactive', isStatic: false })
    // CONTROL: with no mode at all the HTML target reports the default, so the
    // rows above are the caller's value arriving rather than a constant.
    carveToHtml('hi', { extensions: [ext] })
    expect(seen.pop()).toEqual({ target: 'html', mode: 'interactive', isStatic: false })
  })

  it('a hook emitting HTML reads targetIsHtml and leaves the source node for the other targets', () => {
    // This is the accessor a bare options parameter had no answer for, and the
    // reason the contract carries a context rather than the options alone
    // (carve#1007). The transform below is the shape a client-script extension
    // has: it replaces its fence with markup only the HTML target can use, and
    // on Markdown/plain/ANSI it must leave the fence alone so that renderer
    // emits the source the author wrote.
    const ext: CarveExtension = {
      name: 'myuml',
      beforeRender(doc, ctx) {
        if (!ctx.targetIsHtml) return doc
        doc.children = doc.children.map((node) =>
          node.type === 'code_block' && (node as { lang?: string }).lang === 'myuml'
            ? { type: 'raw_block', format: 'html', content: '<div class="myuml">DIAGRAM</div>' }
            : node,
        ) as typeof doc.children
        return doc
      },
    }
    const src = '```myuml\nA -> B\n```\n'
    const html = carveToHtml(src, { extensions: [ext] })
    expect(html).toContain('<div class="myuml">DIAGRAM</div>')
    expect(html).not.toContain('A -&gt; B')
    // The non-HTML targets keep the source. Each asserts the ABSENCE of the
    // HTML as well, because that is what a hook told the target was HTML would
    // write into them.
    const md = carveToMarkdown(src, { extensions: [ext] })
    expect(md).toContain('A -> B')
    expect(md).not.toContain('<div class="myuml">')
    const plain = carveToPlainText(src, { extensions: [ext] })
    expect(plain).toContain('A -> B')
    expect(plain).not.toContain('<div class="myuml">')
  })

  it('CONTROL a beforeRender declared with one parameter still runs', () => {
    // A control, and it passes against the pre-fix engine too - that is what it
    // is for. The parameter is additive: every hook written against the old
    // one-argument shape is called exactly as before, and nothing in this
    // package requires a hook to declare it.
    const ext: CarveExtension = {
      name: 'one-arg',
      beforeRender(doc: Document): Document {
        doc.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'added' }] })
        return doc
      },
    }
    expect(carveToHtml('hi', { extensions: [ext] })).toContain('<p>added</p>')
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
