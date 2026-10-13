import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  [
    'backtick run at column zero',
    '- a\n  :: b\n  ```\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ul>',
  ],
  [
    'body line before the run',
    '- a\n  :: b\n  ```\n  x\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>x\n```\nafter\n</code></pre></li></ul>',
  ],
  [
    'backtick run at column one',
    '- a\n  :: b\n  ```\n ```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ul>',
  ],
  [
    'tilde run at column zero',
    '- a\n  :: b\n  ~~~\n~~~\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>~~~\nafter\n</code></pre></li></ul>',
  ],
  [
    'shorter backtick run',
    '- a\n  :: b\n  ````\n```\nafter\n',
    '<ul><li>a\n    <dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ul>',
  ],
  [
    'ordered item',
    '1. a\n   :: b\n   ```\n```\nafter\n',
    '<ol><li>a\n    <dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ol>',
  ],
  [
    'ordered item column one',
    '1. a\n   :: b\n   ```\n ```\nafter\n',
    '<ol><li>a\n    <dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ol>',
  ],
  [
    'nested item control',
    '- a\n  - s\n  :: b\n  ```\n```\nafter\n',
    '<ul><li>a\n    <ul><li>s</li></ul><dl><dt>b</dt></dl><pre><code>```\nafter\n</code></pre></li></ul>',
  ],
])('%s', (_name, source, expected) => {
  expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(expected)
})
