import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  [
    'backtick run at column zero',
    '- a\n  :: b\n  ```\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
  [
    'body line before the run',
    '- a\n  :: b\n  ```\n  x\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>x\n</code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
  [
    'backtick run at column one',
    '- a\n  :: b\n  ```\n ```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
  [
    'tilde run at column zero',
    '- a\n  :: b\n  ~~~\n~~~\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
  [
    'shorter backtick run',
    '- a\n  :: b\n  ````\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
  [
    'ordered item',
    '1. a\n   :: b\n   ```\n```\nafter\n',
    '<ol><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ol><pre><code>after\n</code></pre>',
  ],
  [
    'ordered item column one',
    '1. a\n   :: b\n   ```\n ```\nafter\n',
    '<ol><li>a\n    <dl><dt>b</dt></dl><pre><code></code></pre></li></ol><pre><code>after\n</code></pre>',
  ],
  [
    'nested item control',
    '- a\n  - s\n  :: b\n  ```\n```\nafter\n',
    '<ul><li>a\n    <ul><li>s</li></ul><dl><dt>b</dt></dl><pre><code></code></pre></li></ul><pre><code>after\n</code></pre>',
  ],
])('%s', (_name, source, expected) => {
  expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(expected)
})
