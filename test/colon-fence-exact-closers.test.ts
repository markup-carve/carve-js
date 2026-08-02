import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

const withoutSourceMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSourceMetadata)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'pos' || key === 'srcByteLength') continue
      out[key] = withoutSourceMetadata(child)
    }
    return out
  }
  return value
}

const sameDocument = (a: string, b: string) => {
  expect(withoutSourceMetadata(parse(b))).toEqual(withoutSourceMetadata(parse(a)))
}

const assertRoundTrip = (source: string, expected: string) => {
  const formatted = carveToCarve(source)
  expect(formatted).toBe(expected)
  sameDocument(source, formatted)
  expect(carveToCarve(formatted)).toBe(formatted)
}

describe('colon fences with exact-length closers', () => {
  it('equal-length fences nest', () => {
    expect(h('::: note\nOuter.\n\n::: tip\nNested.\n:::\n:::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p>Outer.</p>',
        '  <aside class="admonition tip">',
        '    <p>Nested.</p>',
        '  </aside>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('a wider inner fence nests', () => {
    expect(h('::: note\nOuter.\n\n:::: tip\nNested.\n::::\n:::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p>Outer.</p>',
        '  <aside class="admonition tip">',
        '    <p>Nested.</p>',
        '  </aside>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('an unclosed opener produces a container, closed at EOF', () => {
    expect(h(':::\ncontent')).toBe('<div>\n  <p>content</p>\n</div>')
    expect(h(':::')).toBe('<div>\n</div>')
  })

  it('does not parse an admonition type glued to the fence', () => {
    expect(h(':::note\ncontent\n:::')).toBe('<p>:::note\ncontent\n:::</p>')
    expect(h(':::note\ncontent')).toBe('<p>:::note\ncontent</p>')
  })

  it('one bare closer closes one container; outer ones still close at EOF', () => {
    expect(h('::::\n:::\n:::\ntext')).toBe('<div>\n  <div>\n  </div>\n  <p>text</p>\n</div>')
  })

  it('a bare fence that matches neither opens a nested container', () => {
    expect(h(':::::\n:::\ntext\n:::\n:::::')).toBe(
      '<div>\n  <div>\n    <p>text</p>\n  </div>\n</div>',
    )
  })

  it('a longer closer does not close a shorter opener; it opens', () => {
    expect(h(':::\n::::\ntext\n::::')).toBe(
      '<div>\n  <div>\n    <p>text</p>\n  </div>\n</div>',
    )
  })

  it('existing well-formed longer-outer documents still nest exactly as before', () => {
    expect(h(':::: note\nOuter.\n\n::: warning\nNested.\n:::\n::::')).toBe(
      [
        '<aside class="admonition note">',
        '  <p>Outer.</p>',
        '  <aside class="admonition warning">',
        '    <p>Nested.</p>',
        '  </aside>',
        '</aside>',
      ].join('\n'),
    )
  })

  it('ignores a non-bare colon-fence opener inside a code fence', () => {
    expect(h('::: note\n```text\n::: tip\n```\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '  <pre><code class="language-text">::: tip',
        '</code></pre>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('ignores a bare colon-fence closer inside a code fence', () => {
    expect(h('::: note\n```text\n:::\n```\nbody\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '  <pre><code class="language-text">:::',
        '</code></pre>',
        '  <p>body</p>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('ignores a bare colon-fence closer inside an indented code fence in a container', () => {
    expect(h('- item\n\n  ::: note\n  ```text\n  :::\n  ```\n  body\n  :::\nafter')).toBe(
      [
        '<ul>',
        '  <li>item',
        '    <aside class="admonition note">',
        '      <pre><code class="language-text">:::',
        '</code></pre>',
        '      <p>body</p>',
        '    </aside>',
        '  </li>',
        '</ul>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('ignores a colon fence inside a tilde code fence', () => {
    expect(h('::: note\n~~~text\n::: tip\n~~~\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '  <pre><code class="language-text">::: tip',
        '</code></pre>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('ignores a colon-fence-shaped line inside a comment block', () => {
    expect(h('::: note\n%%%\n::: tip\n%%%\nbody\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '',
        '  <p>body</p>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('ignores a code-fence colon opener inside a one-level-deeper container', () => {
    expect(h('::: note\n::: tip\n```text\n::: warning\n```\n:::\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '  <aside class="admonition tip">',
        '    <pre><code class="language-text">::: warning',
        '</code></pre>',
        '  </aside>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('does not treat an unterminated paragraph-interrupting code-fence shape as opaque', () => {
    expect(h('::: note\npara\n```text\n:::\nafter')).toBe(
      [
        '<aside class="admonition note">',
        '  <p>para',
        '<code>text</code></p>',
        '</aside>',
        '<p>after</p>',
      ].join('\n'),
    )
  })

  it('keeps line-block body lines literal instead of nesting colon fences', () => {
    expect(h('::: |\n::: note\n:::\nafter')).toBe(
      [
        '<div class="line-block">',
        '  <p>::: note</p>',
        '</div>',
        '<p>after</p>',
      ].join('\n'),
    )
  })
})

describe('canonical colon-fence rendering', () => {
  it('emits three colons for the outermost container and widens by one per level', () => {
    assertRoundTrip(
      '::: note\n::: tip\nx\n:::\n:::',
      '::: note\n:::: tip\nx\n::::\n:::\n',
    )
  })

  it('re-parses to the same document and is idempotent across mixed containers', () => {
    assertRoundTrip(
      ':::\n::: note\n::: |\na\nb\n:::\n:::\n:::',
      ':::\n:::: note\n::::: |\na\nb\n:::::\n::::\n:::\n',
    )
  })
})
