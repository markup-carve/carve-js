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
})
