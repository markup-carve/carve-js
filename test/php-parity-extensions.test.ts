import { describe, expect, it } from 'vitest'

import {
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  codeGroup,
  defaultAttributes,
  headingLevelShift,
  headingReference,
  tabs,
} from '../src/index.js'

// Golden strings in this file were captured from carve-php
// (vendor/autoload.php + the matching Extension) and verified byte-for-byte,
// modulo the trailing newline carve-php's convert() appends (carve-js's
// carveToHtml does not emit one). See the task brief for the reproduction
// commands.

describe('codeGroup extension (carve-php parity)', () => {
  it('renders a basic code group with language labels', () => {
    const src =
      '::: code-group\n``` php\necho "Hello";\n```\n\n``` javascript\nconsole.log("Hello");\n```\n:::'
    expect(carveToHtml(src, { extensions: [codeGroup()] })).toBe(
      '<div class="code-group">\n' +
        '<input type="radio" name="codegroup-1" id="codegroup-1-tab-1" class="code-group-radio" checked>\n' +
        '<label for="codegroup-1-tab-1" class="code-group-label">php</label>\n' +
        '<input type="radio" name="codegroup-1" id="codegroup-1-tab-2" class="code-group-radio">\n' +
        '<label for="codegroup-1-tab-2" class="code-group-label">javascript</label>\n' +
        '<div class="code-group-panel"><pre><code class="language-php">echo "Hello";\n</code></pre>\n</div>\n' +
        '<div class="code-group-panel"><pre><code class="language-javascript">console.log("Hello");\n</code></pre>\n</div>\n' +
        '</div>',
    )
  })

  it('honors explicit [Label] over the language name', () => {
    const src =
      '::: code-group\n``` php [Installation]\ncomposer require example/pkg\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('>Installation</label>')
    expect(html).toContain('language-php')
  })

  it('falls back to "Code N" when there is no language or label', () => {
    const src =
      '::: code-group\n```\nfirst block\n```\n\n```\nsecond block\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('>Code 1</label>')
    expect(html).toContain('>Code 2</label>')
  })

  it('uses a bare [Label] with no language and emits no language class', () => {
    const src = '::: code-group\n``` [Custom Label]\nplain text\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('>Custom Label</label>')
    expect(html).toContain('<code>')
    expect(html).not.toContain('language-')
  })

  it('selects the first tab by default and honors {selected}', () => {
    const src =
      '::: code-group\n``` php\na\n```\n\n{selected}\n``` js\nb\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('id="codegroup-1-tab-1" class="code-group-radio">')
    expect(html).toContain('id="codegroup-1-tab-2" class="code-group-radio" checked>')
    // The internal `selected` attribute must not leak onto the <pre>.
    expect(html).not.toContain('selected=')
  })

  it('merges author classes and keeps the id on the wrapper', () => {
    const src = '{.custom-style #my-code}\n::: code-group\n``` php\ntest\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('<div class="code-group custom-style" id="my-code">')
  })

  it('numbers groups independently and resets between conversions', () => {
    const src =
      '::: code-group\n``` php\nfirst group\n```\n:::\n\n::: code-group\n``` javascript\nsecond group\n```\n:::'
    const ext = codeGroup()
    const html = carveToHtml(src, { extensions: [ext] })
    expect(html).toContain('name="codegroup-1"')
    expect(html).toContain('name="codegroup-2"')
    // Re-running the same extension instance must restart at 1.
    const second = carveToHtml(src, { extensions: [ext] })
    expect(second).toContain('name="codegroup-1"')
    expect(second).not.toContain('name="codegroup-3"')
  })

  it('escapes label special characters', () => {
    const src = '::: code-group\n``` php [Config & Setup]\n$config = [];\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('>Config &amp; Setup</label>')
  })

  it('keeps special characters in the language class (c++, c#, text/html)', () => {
    const src =
      '::: code-group\n``` c++\nint main() {}\n```\n\n``` c#\nclass Main {}\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('>c++</label>')
    expect(html).toContain('>c#</label>')
    expect(html).toContain('language-c++')
    expect(html).toContain('language-c#')
  })

  it('uses a custom highlighter for the panel body', () => {
    const hl = (code: string, lang: string | undefined) =>
      `<div class="highlighted" data-lang="${lang ?? 'none'}">${code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`
    const src = '::: code-group\n``` php\n$test = true;\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup({ highlighter: hl })] })
    expect(html).toContain('<div class="highlighted" data-lang="php">$test = true;</div>')
  })

  it('honors custom classes and id prefix', () => {
    const src = '::: code-group\n``` php\ncode\n```\n:::'
    const html = carveToHtml(src, {
      extensions: [
        codeGroup({
          wrapperClass: 'vp-code-group',
          panelClass: 'vp-panel',
          labelClass: 'vp-tab',
          radioClass: 'vp-radio',
          idPrefix: 'myprefix',
        }),
      ],
    })
    expect(html).toContain('class="vp-code-group"')
    expect(html).toContain('class="vp-panel"')
    expect(html).toContain('class="vp-tab"')
    expect(html).toContain('class="vp-radio"')
    expect(html).toContain('name="myprefix-1"')
  })

  it('leaves a non code-group div untouched', () => {
    const src = '::: custom\n``` php\ncode here\n```\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('<div class="custom">')
    expect(html).not.toContain('code-group')
    expect(html).not.toContain('type="radio"')
  })

  it('ignores a code-group with no code blocks', () => {
    const src = '::: code-group\nJust some text, no code blocks.\n:::'
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).not.toContain('type="radio"')
  })

  it('is inert without the extension', () => {
    const src = '::: code-group\n``` php\ncode\n```\n:::'
    expect(carveToHtml(src)).not.toContain('type="radio"')
  })
})

describe('tabs extension (carve-php parity)', () => {
  it('renders CSS-only tabs with heading labels', () => {
    const src =
      ':::: tabs\n\n::: tab\n### First Tab\n\nContent for the first tab.\n:::\n\n::: tab\n### Second Tab\n\nContent for the second tab.\n:::\n\n::::'
    expect(carveToHtml(src, { extensions: [tabs()] })).toBe(
      '<div class="tabs">\n' +
        '<input type="radio" name="tabset-1" id="tabset-1-tab-1" class="tabs-radio" checked>\n' +
        '<label for="tabset-1-tab-1" class="tabs-label">First Tab</label>\n' +
        '<input type="radio" name="tabset-1" id="tabset-1-tab-2" class="tabs-radio">\n' +
        '<label for="tabset-1-tab-2" class="tabs-label">Second Tab</label>\n' +
        '<div class="tabs-panel">\n<p>Content for the first tab.</p>\n</div>\n' +
        '<div class="tabs-panel">\n<p>Content for the second tab.</p>\n</div>\n' +
        '</div>',
    )
  })

  it('uses label attributes and honors {selected}', () => {
    const src =
      ':::: tabs\n\n{label="First Tab"}\n::: tab\nContent here.\n:::\n\n{label="Second Tab" selected}\n::: tab\nThis tab is selected.\n:::\n\n::::'
    expect(carveToHtml(src, { extensions: [tabs()] })).toBe(
      '<div class="tabs">\n' +
        '<input type="radio" name="tabset-1" id="tabset-1-tab-1" class="tabs-radio">\n' +
        '<label for="tabset-1-tab-1" class="tabs-label">First Tab</label>\n' +
        '<input type="radio" name="tabset-1" id="tabset-1-tab-2" class="tabs-radio" checked>\n' +
        '<label for="tabset-1-tab-2" class="tabs-label">Second Tab</label>\n' +
        '<div class="tabs-panel">\n<p>Content here.</p>\n</div>\n' +
        '<div class="tabs-panel">\n<p>This tab is selected.</p>\n</div>\n' +
        '</div>',
    )
  })

  it('renders ARIA-mode tabs with button/tabpanel roles', () => {
    const src =
      ':::: tabs\n\n::: tab\n### First\n\nContent one.\n:::\n\n::: tab\n### Second\n\nContent two.\n:::\n\n::::'
    expect(carveToHtml(src, { extensions: [tabs({ mode: 'aria' })] })).toBe(
      '<div class="tabs" role="tablist">\n' +
        '<button role="tab" id="tabset-1-tab-1" aria-selected="true" aria-controls="tabset-1-panel-1" class="tabs-label">First</button>\n' +
        '<button role="tab" id="tabset-1-tab-2" aria-selected="false" aria-controls="tabset-1-panel-2" class="tabs-label" tabindex="-1">Second</button>\n' +
        '<div role="tabpanel" id="tabset-1-panel-1" aria-labelledby="tabset-1-tab-1" class="tabs-panel">\n<p>Content one.</p>\n</div>\n' +
        '<div role="tabpanel" id="tabset-1-panel-2" aria-labelledby="tabset-1-tab-2" class="tabs-panel" hidden>\n<p>Content two.</p>\n</div>\n' +
        '</div>',
    )
  })

  it('keeps multiple paragraphs in a panel', () => {
    const src = ':::: tabs\n\n::: tab\n### First\n\nPara one.\n\nPara two.\n:::\n\n::::'
    const html = carveToHtml(src, { extensions: [tabs()] })
    expect(html).toContain('<div class="tabs-panel">\n<p>Para one.</p>\n<p>Para two.</p>\n</div>')
  })

  it('is inert without the extension', () => {
    const src = ':::: tabs\n\n::: tab\nx\n:::\n\n::::'
    expect(carveToHtml(src)).not.toContain('type="radio"')
  })
})

describe('headingLevelShift extension (carve-php parity)', () => {
  it('shifts every heading down by one', () => {
    expect(
      carveToHtml('# Heading 1\n\n## Heading 2\n\n### Heading 3', {
        extensions: [headingLevelShift({ shift: 1 })],
      }),
    ).toBe(
      '<section id="Heading-1">\n' +
        '  <h2>Heading 1</h2>\n' +
        '  <section id="Heading-2">\n' +
        '    <h3>Heading 2</h3>\n' +
        '    <section id="Heading-3">\n' +
        '      <h4>Heading 3</h4>\n' +
        '    </section>\n' +
        '  </section>\n' +
        '</section>',
    )
  })

  it('defaults to a shift of 1', () => {
    const html = carveToHtml('# Heading', { extensions: [headingLevelShift()] })
    expect(html).toContain('<h2>Heading</h2>')
  })

  it('caps shifted levels at h6', () => {
    const html = carveToHtml('##### Heading 5\n\n###### Heading 6', {
      extensions: [headingLevelShift({ shift: 2 })],
    })
    expect(html).toContain('<h6>Heading 5</h6>')
    expect(html).toContain('<h6>Heading 6</h6>')
  })

  it('clamps the shift to the 0-5 range', () => {
    expect(carveToHtml('# H', { extensions: [headingLevelShift({ shift: 10 })] })).toContain(
      '<h6>H</h6>',
    )
    expect(carveToHtml('# H', { extensions: [headingLevelShift({ shift: -1 })] })).toContain(
      '<h1>H</h1>',
    )
  })

  it('does nothing for a zero shift', () => {
    expect(carveToHtml('# Heading 1', { extensions: [headingLevelShift({ shift: 0 })] })).toBe(
      '<section id="Heading-1">\n  <h1>Heading 1</h1>\n</section>',
    )
  })

  it('keeps heading attributes; id stays on the section', () => {
    const html = carveToHtml('{.custom-class}\n# Heading', {
      extensions: [headingLevelShift({ shift: 1 })],
    })
    expect(html).toContain('<section id="Heading">')
    expect(html).toContain('<h2 class="custom-class">Heading</h2>')
  })

  it('applies to the Markdown renderer too', () => {
    const md = carveToMarkdown('# Heading 1\n\n## Heading 2', {
      extensions: [headingLevelShift({ shift: 1 })],
    })
    expect(md).toContain('## Heading 1')
    expect(md).toContain('### Heading 2')
  })

  it('applies to the plain-text renderer (no markup leaks)', () => {
    const txt = carveToPlainText('# Heading 1\n\nSome text.', {
      extensions: [headingLevelShift({ shift: 1 })],
    })
    expect(txt).toContain('Heading 1')
    expect(txt).toContain('Some text.')
    expect(txt).not.toContain('<')
  })
})

describe('headingReference extension (carve-php parity)', () => {
  it('resolves a basic [[Heading]] reference to the heading id', () => {
    expect(
      carveToHtml('See [[Getting Started]].\n\n# Getting Started', {
        extensions: [headingReference()],
      }),
    ).toBe(
      '<p>See <a href="#Getting-Started" class="heading-ref">Getting Started</a>.</p>\n' +
        '<section id="Getting-Started">\n  <h1>Getting Started</h1>\n</section>',
    )
  })

  it('supports custom display text', () => {
    const html = carveToHtml('See [[Getting Started|the introduction]] for details.\n\n# Getting Started', {
      extensions: [headingReference()],
    })
    expect(html).toContain('<a href="#Getting-Started" class="heading-ref">the introduction</a>')
    expect(html).not.toContain('data-heading-ref')
  })

  it('uses an explicit heading id', () => {
    const html = carveToHtml('See [[Installation]].\n\n{#install}\n## Installation', {
      extensions: [headingReference()],
    })
    expect(html).toContain('href="#install"')
  })

  it('falls back to literal text for a missing heading', () => {
    const html = carveToHtml('See [[Missing|click here]].', { extensions: [headingReference()] })
    expect(html).toContain('[[Missing|click here]]')
    expect(html).not.toContain('<a ')
  })

  it('falls back to literal text for an ambiguous (duplicate) heading', () => {
    const html = carveToHtml('See [[Installation]].\n\n## Installation\n\n## Installation', {
      extensions: [headingReference()],
    })
    expect(html).toContain('[[Installation]]')
    expect(html).not.toContain('data-heading-ref="Installation"')
  })

  it('matches a heading with formatting by its plain text', () => {
    const html = carveToHtml('See [[Say Hello]].\n\n# Say _Hello_', {
      extensions: [headingReference()],
    })
    expect(html).toContain('href="#Say-Hello"')
  })

  it('matches a heading with smart quotes against a straight-quote reference', () => {
    const html = carveToHtml('See [[Say "Hello"]].\n\n# Say "Hello"', {
      extensions: [headingReference()],
    })
    expect(html).toContain('href="#Say-Hello"')
    expect(html).not.toContain('[[Say "Hello"]]')
  })

  it('honors a custom css class, filtering empty parts', () => {
    const html = carveToHtml('See [[Test]].\n\n# Test', {
      extensions: [headingReference({ cssClass: 'foo  bar' })],
    })
    expect(html).toContain('class="foo bar"')
  })

  it('leaves a leading-# reference to core (a tag inside brackets)', () => {
    const html = carveToHtml('See [[#installation]].', { extensions: [headingReference()] })
    expect(html).not.toContain('href="#installation"')
    expect(html).toContain('[[<span class="tag"><strong>#installation</strong></span>]]')
  })

  it('is inert without the extension', () => {
    expect(carveToHtml('See [[Getting Started]].\n\n# Getting Started')).toContain(
      '<p>See [[Getting Started]].</p>',
    )
  })
})

describe('defaultAttributes extension (carve-php parity)', () => {
  it('adds image attributes', () => {
    expect(
      carveToHtml('![Alt text](image.jpg)', {
        extensions: [defaultAttributes({ defaults: { image: { loading: 'lazy', decoding: 'async' } } })],
      }),
    ).toBe('<img src="image.jpg" alt="Alt text" loading="lazy" decoding="async">')
  })

  it('merges classes rather than overwriting', () => {
    expect(
      carveToHtml('{.custom-class}\nSome text', {
        extensions: [defaultAttributes({ defaults: { paragraph: { class: 'default-class' } } })],
      }),
    ).toBe('<p class="custom-class default-class">Some text</p>')
  })

  it('does not overwrite an existing attribute', () => {
    expect(
      carveToHtml('![Alt](image.jpg){loading=eager}', {
        extensions: [defaultAttributes({ defaults: { image: { loading: 'lazy' } } })],
      }),
    ).toBe('<img src="image.jpg" alt="Alt" loading="eager">')
  })

  it('applies to tables, links, blockquotes, divs, and spans', () => {
    expect(
      carveToHtml('| A | B |\n|---|---|\n| 1 | 2 |', {
        extensions: [defaultAttributes({ defaults: { table: { class: 'table table-striped' } } })],
      }),
    ).toContain('<table class="table table-striped">')

    expect(
      carveToHtml('[Example](https://example.com)', {
        extensions: [defaultAttributes({ defaults: { link: { class: 'link' } } })],
      }),
    ).toContain('<a href="https://example.com" class="link">Example</a>')

    expect(
      carveToHtml('> A quote', {
        extensions: [defaultAttributes({ defaults: { block_quote: { class: 'quote' } } })],
      }),
    ).toContain('<blockquote class="quote">')

    expect(
      carveToHtml('[some text]{}', {
        extensions: [defaultAttributes({ defaults: { span: { class: 'inline' } } })],
      }),
    ).toContain('<span class="inline">some text</span>')
  })

  it('uses snake_case type names (code_block)', () => {
    const html = carveToHtml("```php\necho 'hello';\n```", {
      extensions: [defaultAttributes({ defaults: { code_block: { class: 'highlight' } } })],
    })
    expect(html).toContain('class="highlight"')
  })

  it('applies a div default to admonitions and bare divs (carve-php div coverage)', () => {
    expect(
      carveToHtml('::: note\nc\n:::', {
        extensions: [defaultAttributes({ defaults: { div: { class: 'X' } } })],
      }),
    ).toContain('<aside class="admonition note X">')
    expect(
      carveToHtml(':::\nc\n:::', {
        extensions: [defaultAttributes({ defaults: { div: { class: 'X' } } })],
      }),
    ).toContain('<div class="X">')
  })

  it('does NOT target list_item, table_cell, or table_row (carve-php parity)', () => {
    expect(
      carveToHtml('- a\n- b', {
        extensions: [defaultAttributes({ defaults: { list_item: { class: 'X' } } })],
      }),
    ).not.toContain('X')
    const table = '| A |\n|---|\n| 1 |'
    expect(
      carveToHtml(table, {
        extensions: [defaultAttributes({ defaults: { table_cell: { class: 'X' } } })],
      }),
    ).not.toContain('X')
    expect(
      carveToHtml(table, {
        extensions: [defaultAttributes({ defaults: { table_row: { class: 'X' } } })],
      }),
    ).not.toContain('X')
  })

  it('still reaches inline children inside non-targeted cells', () => {
    // table_cell is not targetable, but a link default inside a cell still applies.
    const html = carveToHtml('| [a](x) | b |\n|---|---|\n| 1 | 2 |', {
      extensions: [defaultAttributes({ defaults: { link: { class: 'l' } } })],
    })
    expect(html).toContain('<a href="x" class="l">a</a>')
    // No duplicate class from double-visiting the cell children.
    expect(html).not.toContain('class="l l"')
  })

  it('adds a heading data attribute (kept on the <h*>)', () => {
    const html = carveToHtml('## Heading', {
      extensions: [defaultAttributes({ defaults: { heading: { 'data-toc': 'true' } } })],
    })
    expect(html).toContain('<h2 data-toc="true">Heading</h2>')
  })

  it('is a no-op for empty defaults', () => {
    const html = carveToHtml('![Alt](image.jpg)', {
      extensions: [defaultAttributes({ defaults: {} })],
    })
    expect(html).not.toContain('loading=')
  })

  it('does not duplicate the default class on repeated renders', () => {
    const ext = defaultAttributes({ defaults: { paragraph: { class: 'prose' } } })
    const first = carveToHtml('Hello world', { extensions: [ext] })
    const second = carveToHtml('Hello world', { extensions: [ext] })
    expect(first).toContain('<p class="prose">')
    expect(second).toContain('<p class="prose">')
    expect(second).not.toContain('prose prose')
  })
})
