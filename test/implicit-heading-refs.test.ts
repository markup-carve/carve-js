import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Implicit heading references: every heading in the document becomes
 * a collapsed-reference target, so `[Heading Text][]` auto-resolves
 * to the heading without an explicit `[Heading Text]: …` definition
 * (Djot-spec implicit references, README "Wiki-style links").
 */
describe('implicit heading references ([Heading][])', () => {
  it('resolves a collapsed reference to a matching heading', () => {
    expect(h('# Getting Started\n\nSee [Getting Started][].')).toContain(
      '<a href="#getting-started">Getting Started</a>',
    )
  })

  it('resolves a forward reference (heading appears later)', () => {
    expect(h('See [Conclusion][] below.\n\n# Conclusion')).toContain(
      '<a href="#conclusion">Conclusion</a>',
    )
  })

  it('label match is case-insensitive and whitespace-collapsed', () => {
    expect(h('# Getting Started\n\n[ getting   STARTED  ][]')).toContain(
      '<a href="#getting-started">',
    )
  })

  it('honors an explicit `{#id}` on the heading', () => {
    expect(h('# API {#api-v2}\n\nSee [API][].')).toContain(
      '<a href="#api-v2">API</a>',
    )
  })

  it('picks the first occurrence when the same heading text repeats', () => {
    // First `# Setup` gets id "setup"; second gets "setup-2". The
    // implicit-ref label maps to the first.
    expect(h('# Setup\n\n# Setup\n\nGo to [Setup][].')).toContain(
      'href="#setup">Setup</a>',
    )
  })

  it('explicit `[label]: url` overrides the implicit heading ref', () => {
    // The explicit def is registered first; the implicit-heading
    // pass does not overwrite an existing key.
    const html = h('# Site\n\n[Site]: https://elsewhere.example\n\n[Site][]')
    expect(html).toContain('href="https://elsewhere.example"')
    expect(html).not.toContain('href="#site"')
  })

  it('leaves an unresolved label as literal text', () => {
    expect(h('[never defined][] here.')).toBe(
      '<p>[never defined][] here.</p>',
    )
  })

  it('strips simple inline emphasis when matching heading text', () => {
    // Heading `# Why /Carve/?` has plain text "Why Carve?"
    // matched by `[Why Carve?][]`.
    expect(h('# Why /Carve/?\n\nSee [Why Carve?][].')).toContain(
      '<a href="#why-carve">',
    )
  })

  it('does NOT resolve to a heading nested in a container', () => {
    // `resolveHeadingIds()` only assigns `id`s to top-level headings, so
    // an implicit ref to a nested heading would point at a missing
    // target. The ref stays literal; use an explicit `{#id}` if you
    // need to link into a nested heading.
    expect(h('> # Sub\n\nSee [Sub][].')).not.toContain('<a href="#sub"')
  })

  it('extracts inline link text in a heading for the implicit-ref key', () => {
    // `# [Carve](url)` -> plain text "Carve" -> key matches `[Carve][]`.
    expect(h('# [Carve](https://x)\n\n[Carve][]')).toContain('href="#carve"')
  })

  it('extracts backslash-escaped chars in a heading', () => {
    // `# What\'s new` -> plain text "What's new".
    expect(h("# What\\'s new\n\n[What's new][]")).toContain(
      'href="#whats-new"',
    )
  })

  it('does not invent a ref for an image-only heading', () => {
    // `# ![alt](src)` -> inlineText is "", heading id is "section";
    // there is nothing to match `[alt][]` against.
    expect(h('# ![Logo](logo.png)\n\n[Logo][]')).not.toContain(
      '<a href="#logo"',
    )
    expect(h('# ![Logo](logo.png)\n\n[Logo][]')).toContain('[Logo][]')
  })

  it('agrees with heading-id dedup when slugs collide', () => {
    // First heading reserves `#api` via explicit id. The second `# API`
    // auto-slugs to `api` -> dedup -> `api-2`. The implicit ref `[API][]`
    // (text "API") should point at the SECOND heading (`#api-2`).
    expect(h('# Intro {#api}\n\n# API\n\n[API][]')).toContain(
      'href="#api-2">API</a>',
    )
  })

  it('extracts the text from a reference-style link in a heading', () => {
    // `# [API][site]` -> plain text "API" -> matches `[API][]`.
    expect(h('# [API][site]\n\n[site]: /s\n\n[API][]')).toContain(
      'href="#api">API</a>',
    )
  })

  it('reserves the `section` slot for empty-text headings', () => {
    // `# ![Logo]()` -> id "section" (resolveHeadingIds). A later
    // `# Section` heading should then become `section-2`. The implicit
    // ref `[Section][]` must follow that dedup.
    expect(h('# ![Logo](logo.png)\n\n# Section\n\n[Section][]')).toContain(
      'href="#section-2"',
    )
  })

  it('strips mention and tag sigils from the heading key', () => {
    // `# @alice` -> inlineText "alice"; `[alice][]` should resolve.
    expect(h('# @alice\n\n[alice][]')).toContain('href="#alice">alice</a>')
    // `# Release #v1` -> inlineText "Release v1".
    expect(h('# Release #v1\n\n[Release v1][]')).toContain(
      'href="#release-v1"',
    )
  })

  it('strips inline attribute blocks when deriving the key', () => {
    // `# [API](/x){.nav}` -> visible text "API" -> heading id "api".
    expect(h('# [API](/x){.nav}\n\n[API][]')).toContain('href="#api">API</a>')
  })

  it('does not treat `user@example.com` as a mention in heading text', () => {
    // `@` only opens a mention at a word boundary; `user@example.com`
    // stays literal in the heading id, and the implicit ref agrees.
    const html = h('# user@example.com\n\n[user@example.com][]')
    expect(html).toContain('id="user-example-com"')
    expect(html).toContain('href="#user-example-com"')
  })

  it('does not invent a ref for an autolink-only heading', () => {
    // Same reason: inlineText ignores autolinks, heading id is "section".
    expect(h('# <https://example.com>\n\n[https://example.com][]')).not.toContain(
      '<a href="#https',
    )
  })

  it('derives heading id from link children when a ref is unresolved', () => {
    // `# [Install][missing]`: heading slug uses the Link's children
    // ("Install"), not the literal source. Cross-impl: matches
    // carve-php's CarveConverter, which slugs to "install" regardless
    // of whether `missing` resolves. A collapsed `[Install][]` ref can
    // therefore target this heading.
    const html = h('# [Install][missing]\n\n[Install][]')
    expect(html).toContain('id="install"')
    expect(html).toContain('href="#install"')
  })

  it('resolves a forward crossref whose target heading has a deferred ref-link', () => {
    // Two-pass resolution: the implicit-heading-ref pass MUST finalize
    // the `[Install][]` placeholder inside heading 1 BEFORE the
    // crossref-cloning pass clones heading 1's children for the
    // forward `</#install>` in the leading paragraph. Otherwise the
    // clone would carry an unresolved Link placeholder and the output
    // would be nested broken anchors.
    const html = h('See </#install>.\n\n# [Install][]\n\n# Install')
    // Forward crossref points at the first occurrence and contains
    // the finalized link, not a nested placeholder.
    expect(html).toContain(
      '<p>See <a href="#install"><a href="#install">Install</a></a>.</p>',
    )
  })

  it('resolves a self-referencing heading via implicit ref', () => {
    // `# [API][]` followed by `# API`: heading 1's link children give it
    // slug "api"; heading 2 collides -> "api-2". The body `[API][]` ref
    // resolves to first-occurrence -> heading 1 (`#api`). The link inside
    // heading 1 self-resolves to "#api". Matches carve-php.
    const html = h('# [API][]\n\n# API\n\n[API][]')
    // ids live on <section>, headings carry no id (PART 9 §13).
    expect(html).toContain('<section id="api">')
    expect(html).toContain('<h1><a href="#api">API</a></h1>')
    expect(html).toContain('<section id="api-2">')
    expect(html).toContain('<h1>API</h1>')
    expect(html).toContain('<p><a href="#api">API</a></p>')
  })
})
