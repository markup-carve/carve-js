import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * Configured mention/tag URL templates. The canonical placeholder is
 * `{name}` for both mentions and tags (matching the carve-php reference);
 * `{user}` remains a legacy alias for mentions. The substituted value is
 * URL-encoded.
 */
describe('mention/tag URL templates', () => {
  it('renders a non-link span by default', () => {
    expect(carveToHtml('@alice').trim()).toBe(
      '<p><span class="mention"><strong>@alice</strong></span></p>',
    )
  })

  it('substitutes {name} in the mention template', () => {
    expect(carveToHtml('@alice', { mentionUrl: '/u/{name}' }).trim()).toBe(
      '<p><a class="mention" href="/u/alice">@alice</a></p>',
    )
  })

  it('sanitizes the final templated mention href', () => {
    expect(carveToHtml('@alice', { mentionUrl: 'javascript:alert({name})' }).trim()).toBe(
      '<p><span class="mention"><strong>@alice</strong></span></p>',
    )
  })

  it('uses an authoritative resolver without falling back to a template', () => {
    const calls: unknown[] = []
    const context = { tenant: 42 }
    expect(carveToHtml('@alice @missing #release @unsafe', {
      mentionUrl: '/fallback/{name}',
      socialContext: context,
      resolveMention(input) {
        calls.push(input)
        if (input.name === 'alice') return '/people/42'
        if (input.name === 'unsafe') return 'javascript:alert(1)'
        return null
      },
      resolveTag: ({ name }) => name === 'release' ? '/collections/stable' : null,
    }).trim()).toBe(
      '<p><a class="mention" href="/people/42">@alice</a> <span class="mention"><strong>@missing</strong></span> <a class="tag" href="/collections/stable">#release</a> <span class="mention"><strong>@unsafe</strong></span></p>',
    )
    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({ kind: 'mention', name: 'alice', context })
  })

  it('treats resolver errors as unresolved', () => {
    expect(carveToHtml('@alice', {
      resolveMention() { throw new Error('lookup failed') },
    }).trim()).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
  })

  it('keeps the social denylist on when general URL sanitization is disabled', () => {
    expect(carveToHtml('@alice', {
      sanitizeUrls: false,
      resolveMention: () => 'javascript:alert(1)',
    }).trim()).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
  })

  it('does not let a custom denylist remove the social baseline', () => {
    expect(carveToHtml('@alice', {
      deniedUrlSchemes: [],
      resolveMention: () => 'javascript:alert(1)',
    }).trim()).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
  })

  it('still accepts the legacy {user} placeholder for mentions', () => {
    expect(carveToHtml('@alice', { mentionUrl: '/u/{user}' }).trim()).toBe(
      '<p><a class="mention" href="/u/alice">@alice</a></p>',
    )
  })

  it('substitutes {name} in the tag template', () => {
    expect(carveToHtml('#news', { tagUrl: '/t/{name}' }).trim()).toBe(
      '<p><a class="tag" href="/t/news">#news</a></p>',
    )
  })

  it('accepts {tag} as an explicit tag placeholder alias', () => {
    expect(carveToHtml('#news', { tagUrl: '/t/{tag}' }).trim()).toBe(
      '<p><a class="tag" href="/t/news">#news</a></p>',
    )
  })
})
