import { describe, expect, it } from 'vitest'
import { carveToHtml, codeGroup, tabs } from '../src/index.js'

// Block header ("...") and grouping label ([...]) on the code-fence and
// colon-fence openers (grammar PART 9 §2 / §12). Mirrors carve-php.
describe('code-fence header and grouping label', () => {
  it('carries the header to the <pre> title attribute', () => {
    expect(carveToHtml('```php "src/Auth.php"\n$ok = true;\n```')).toBe(
      '<pre title="src/Auth.php"><code class="language-php">$ok = true;\n</code></pre>',
    )
  })

  it('combines a header and a label; the label is inert in core', () => {
    expect(carveToHtml('```php "src/Auth.php" [Composer]\ncomposer require x\n```')).toBe(
      '<pre title="src/Auth.php"><code class="language-php">composer require x\n</code></pre>',
    )
  })

  it('accepts a header with no language', () => {
    expect(carveToHtml('``` "notes.txt"\nremember the milk\n```')).toBe(
      '<pre title="notes.txt"><code>remember the milk\n</code></pre>',
    )
  })

  it('lets a preceding {title=} line win over the opener header', () => {
    expect(carveToHtml('{title="from the attribute line"}\n```php "from the header"\ncode\n```')).toBe(
      '<pre title="from the attribute line"><code class="language-php">code\n</code></pre>',
    )
  })

  it('falls back to an inline span for a key="value" pair', () => {
    expect(carveToHtml('```js title="x"\ncode\n```')).toBe(
      '<p><code>js title="x"\ncode\n</code></p>',
    )
  })

  it('falls back when the header and label are in the wrong order', () => {
    expect(carveToHtml('```php [Composer] "x"\ncode\n```')).toBe(
      '<p><code>php [Composer] "x"\ncode\n</code></p>',
    )
  })

  it('falls back when metadata is glued to the language (no space)', () => {
    expect(carveToHtml('```php"x"\ncode\n```')).toBe('<p><code>php"x"\ncode\n</code></p>')
  })

  it('falls back when a label is glued to the header (no space)', () => {
    expect(carveToHtml('```php "x"[Install]\ncode\n```')).toBe(
      '<p><code>php "x"[Install]\ncode\n</code></p>',
    )
  })

  it('feeds the opener [label] to the tabs extension as the tab name', () => {
    const html = carveToHtml(
      ':::: tabs\n::: tab [First]\nContent one.\n:::\n\n::: tab [Second]\nContent two.\n:::\n::::',
      { extensions: [tabs()] },
    )
    expect(html).toContain('>First</label>')
    expect(html).toContain('>Second</label>')
    expect(html).not.toContain('label="First"')
  })

  it('preserves a real content heading when an opener label is present', () => {
    const html = carveToHtml(
      ':::: tabs\n::: tab [First]\n### Visible Heading\nContent one.\n:::\n::::',
      { extensions: [tabs()] },
    )
    expect(html).toContain('>First</label>')
    expect(html).toContain('Visible Heading')
  })

  it('preserves a code-fence header inside a code-group', () => {
    const html = carveToHtml('::: code-group\n```php "src/Auth.php"\n$ok = true;\n```\n:::', {
      extensions: [codeGroup()],
    })
    expect(html).toContain('title="src/Auth.php"')
  })

  it('renders a bare div with an inert [label] as a plain <div>', () => {
    expect(carveToHtml('::: [First]\nFirst panel.\n:::')).toBe(
      '<div>\n  <p>First panel.</p>\n</div>',
    )
  })

  it('uses the header text literally (not inline-parsed) for the title', () => {
    // A header targets an HTML attribute, so markup chars stay literal -- a
    // filename like *.config.js must survive intact.
    expect(carveToHtml('```php "*.config.js"\nx\n```')).toBe(
      '<pre title="*.config.js"><code class="language-php">x\n</code></pre>',
    )
  })

  it('keeps the header on a captioned (figure-wrapped) code block', () => {
    const html = carveToHtml('```php "src/Auth.php"\n$ok = true;\n```\n^ Listing one')
    expect(html).toContain('<pre title="src/Auth.php">')
    expect(html).toContain('<figure')
  })

  it('accepts a label glued to the bare fence (`:::[First]`), like ```[NPM]', () => {
    expect(carveToHtml(':::[First]\nFirst panel.\n:::')).toBe(
      '<div>\n  <p>First panel.</p>\n</div>',
    )
  })
})
