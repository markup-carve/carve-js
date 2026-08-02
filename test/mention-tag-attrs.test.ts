import { describe, it, expect } from 'vitest'
import {
  carveToHtml,
  renderHtml,
  type Attrs,
  type Document,
  type Mention,
  type RenderOptions,
  type Tag,
} from '../src/index.js'

type SocialNode = Mention | Tag

function doc(node: SocialNode): Document {
  return {
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [node],
      },
    ],
  }
}

function html(node: SocialNode, opts: RenderOptions = {}): string {
  return renderHtml(doc(node), opts)
}

function mention(attrs?: Attrs): Mention {
  return { type: 'mention', user: 'alice', attrs }
}

function tag(attrs?: Attrs): Tag {
  return { type: 'tag', name: 'release', attrs }
}

describe('mention/tag HTML attributes', () => {
  it('keeps parsed no-attribute mention and tag bytes unchanged', () => {
    expect(carveToHtml('@alice')).toBe(
      '<p><span class="mention"><strong>@alice</strong></span></p>',
    )
    expect(carveToHtml('#tag')).toBe('<p><span class="tag"><strong>#tag</strong></span></p>')
  })

  it('keeps direct no-attribute mention bytes unchanged', () => {
    expect(html(mention())).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
    expect(html(mention(), { mentionUrl: '/u/{name}' })).toBe(
      '<p><a class="mention" href="/u/alice">@alice</a></p>',
    )
  })

  it('keeps direct no-attribute tag bytes unchanged', () => {
    expect(html(tag())).toBe('<p><span class="tag"><strong>#release</strong></span></p>')
    expect(html(tag(), { tagUrl: '/t/{name}' })).toBe(
      '<p><a class="tag" href="/t/release">#release</a></p>',
    )
  })

  it('renders mention span attrs with merged class first', () => {
    expect(html(mention({ id: 'x', order: ['#id'] }))).toBe(
      '<p><span class="mention" id="x"><strong>@alice</strong></span></p>',
    )
    expect(html(mention({ classes: ['user'], order: ['.class'] }))).toBe(
      '<p><span class="mention user"><strong>@alice</strong></span></p>',
    )
    expect(
      html(
        mention({
          id: 'x',
          classes: ['user'],
          keyValues: { 'data-role': 'lead' },
          order: ['data-role', '#id', '.class'],
        }),
      ),
    ).toBe(
      '<p><span class="mention user" data-role="lead" id="x"><strong>@alice</strong></span></p>',
    )
  })

  it('renders mention link attrs after structural href and strips author href', () => {
    expect(html(mention({ id: 'x', order: ['#id'] }), { mentionUrl: '/u/{name}' })).toBe(
      '<p><a class="mention" href="/u/alice" id="x">@alice</a></p>',
    )
    expect(
      html(mention({ classes: ['user'], order: ['.class'] }), {
        mentionUrl: '/u/{name}',
      }),
    ).toBe('<p><a class="mention user" href="/u/alice">@alice</a></p>')
    expect(
      html(
        mention({
          id: 'x',
          classes: ['user'],
          keyValues: { 'data-role': 'lead', href: '/evil' },
          order: ['data-role', 'href', '.class', '#id'],
        }),
        { mentionUrl: '/u/{name}' },
      ),
    ).toBe('<p><a class="mention user" href="/u/alice" data-role="lead" id="x">@alice</a></p>')
  })

  it('renders tag span attrs with merged class first', () => {
    expect(html(tag({ id: 'x', order: ['#id'] }))).toBe(
      '<p><span class="tag" id="x"><strong>#release</strong></span></p>',
    )
    expect(html(tag({ classes: ['user'], order: ['.class'] }))).toBe(
      '<p><span class="tag user"><strong>#release</strong></span></p>',
    )
    expect(
      html(
        tag({
          id: 'x',
          classes: ['user'],
          keyValues: { 'data-role': 'lead' },
          order: ['data-role', '#id', '.class'],
        }),
      ),
    ).toBe('<p><span class="tag user" data-role="lead" id="x"><strong>#release</strong></span></p>')
  })

  it('renders tag link attrs after structural href and strips author href', () => {
    expect(html(tag({ id: 'x', order: ['#id'] }), { tagUrl: '/t/{name}' })).toBe(
      '<p><a class="tag" href="/t/release" id="x">#release</a></p>',
    )
    expect(
      html(tag({ classes: ['user'], order: ['.class'] }), {
        tagUrl: '/t/{name}',
      }),
    ).toBe('<p><a class="tag user" href="/t/release">#release</a></p>')
    expect(
      html(
        tag({
          id: 'x',
          classes: ['user'],
          keyValues: { 'data-role': 'lead', href: '/evil' },
          order: ['data-role', 'href', '.class', '#id'],
        }),
        { tagUrl: '/t/{name}' },
      ),
    ).toBe('<p><a class="tag user" href="/t/release" data-role="lead" id="x">#release</a></p>')
  })
})
