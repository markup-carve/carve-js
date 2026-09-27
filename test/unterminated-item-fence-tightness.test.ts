import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expectations verified with the layout and HTML oracle at spec 8017328e.

const cases = [
  [
    'item: unterminated code at +0 with interior blank',
    '- head\n\n  ```\n  a\n\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated code at +0 without interior blank',
    '- head\n\n  ```\n  a\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed code at +0 with interior blank',
    '- head\n\n  ```\n  a\n\n  b\n  ```\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\nb\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed code at +0 then blank and tail',
    '- head\n\n  ```\n  a\n  ```\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <pre><code>a\n</code></pre>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated code at +4 with interior blank',
    '- head\n\n      ```\n      a\n\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated code at +4 without interior blank',
    '- head\n\n      ```\n      a\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed code at +4 with interior blank',
    '- head\n\n      ```\n      a\n\n      b\n      ```\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\nb\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed code at +4 then blank and tail',
    '- head\n\n      ```\n      a\n      ```\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <pre><code>a\n</code></pre>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated tilde at +0 with interior blank',
    '- head\n\n  ~~~\n  a\n\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated tilde at +0 without interior blank',
    '- head\n\n  ~~~\n  a\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed tilde at +0 with interior blank',
    '- head\n\n  ~~~\n  a\n\n  b\n  ~~~\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\nb\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed tilde at +0 then blank and tail',
    '- head\n\n  ~~~\n  a\n  ~~~\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <pre><code>a\n</code></pre>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated tilde at +4 with interior blank',
    '- head\n\n      ~~~\n      a\n\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated tilde at +4 without interior blank',
    '- head\n\n      ~~~\n      a\n  tail\n',
    '<ul>\n  <li>head\n    <pre><code>a\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed tilde at +4 with interior blank',
    '- head\n\n      ~~~\n      a\n\n      b\n      ~~~\n',
    '<ul>\n  <li>head\n    <pre><code>a\n\nb\n</code></pre>\n  </li>\n</ul>',
  ],
  [
    'item: closed tilde at +4 then blank and tail',
    '- head\n\n      ~~~\n      a\n      ~~~\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <pre><code>a\n</code></pre>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated raw at +0 with interior blank',
    '- head\n\n  ```=html\n  a\n\n  tail\n',
    '<ul>\n  <li>head\n    a\n\ntail\n  </li>\n</ul>',
  ],
  [
    'item: unterminated raw at +0 without interior blank',
    '- head\n\n  ```=html\n  a\n  tail\n',
    '<ul>\n  <li>head\n    a\ntail\n  </li>\n</ul>',
  ],
  [
    'item: closed raw at +0 with interior blank',
    '- head\n\n  ```=html\n  a\n\n  b\n  ```\n',
    '<ul>\n  <li>head\n    a\n\nb\n  </li>\n</ul>',
  ],
  [
    'item: closed raw at +0 then blank and tail',
    '- head\n\n  ```=html\n  a\n  ```\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    a\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: unterminated raw at +4 with interior blank',
    '- head\n\n      ```=html\n      a\n\n  tail\n',
    '<ul>\n  <li>head\n    a\n\ntail\n  </li>\n</ul>',
  ],
  [
    'item: unterminated raw at +4 without interior blank',
    '- head\n\n      ```=html\n      a\n  tail\n',
    '<ul>\n  <li>head\n    a\ntail\n  </li>\n</ul>',
  ],
  [
    'item: closed raw at +4 with interior blank',
    '- head\n\n      ```=html\n      a\n\n      b\n      ```\n',
    '<ul>\n  <li>head\n    a\n\nb\n  </li>\n</ul>',
  ],
  [
    'item: closed raw at +4 then blank and tail',
    '- head\n\n      ```=html\n      a\n      ```\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    a\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated code at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ```\n    a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated code at +0 without interior blank',
    '- outer\n\n  - inner\n\n    ```\n    a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed code at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ```\n    a\n\n    b\n    ```\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed code at +0 then blank and tail',
    '- outer\n\n  - inner\n\n    ```\n    a\n    ```\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <pre><code>a\n</code></pre>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated code at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ```\n        a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated code at +4 without interior blank',
    '- outer\n\n  - inner\n\n        ```\n        a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed code at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ```\n        a\n\n        b\n        ```\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed code at +4 then blank and tail',
    '- outer\n\n  - inner\n\n        ```\n        a\n        ```\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <pre><code>a\n</code></pre>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated tilde at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ~~~\n    a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated tilde at +0 without interior blank',
    '- outer\n\n  - inner\n\n    ~~~\n    a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed tilde at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ~~~\n    a\n\n    b\n    ~~~\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed tilde at +0 then blank and tail',
    '- outer\n\n  - inner\n\n    ~~~\n    a\n    ~~~\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <pre><code>a\n</code></pre>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated tilde at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ~~~\n        a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated tilde at +4 without interior blank',
    '- outer\n\n  - inner\n\n        ~~~\n        a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\ntail\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed tilde at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ~~~\n        a\n\n        b\n        ~~~\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <pre><code>a\n\nb\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed tilde at +4 then blank and tail',
    '- outer\n\n  - inner\n\n        ~~~\n        a\n        ~~~\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <pre><code>a\n</code></pre>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated raw at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ```=html\n    a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\n\ntail\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated raw at +0 without interior blank',
    '- outer\n\n  - inner\n\n    ```=html\n    a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\ntail\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed raw at +0 with interior blank',
    '- outer\n\n  - inner\n\n    ```=html\n    a\n\n    b\n    ```\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\n\nb\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed raw at +0 then blank and tail',
    '- outer\n\n  - inner\n\n    ```=html\n    a\n    ```\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        a\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated raw at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ```=html\n        a\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\n\ntail\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: unterminated raw at +4 without interior blank',
    '- outer\n\n  - inner\n\n        ```=html\n        a\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\ntail\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed raw at +4 with interior blank',
    '- outer\n\n  - inner\n\n        ```=html\n        a\n\n        b\n        ```\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        a\n\nb\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: closed raw at +4 then blank and tail',
    '- outer\n\n  - inner\n\n        ```=html\n        a\n        ```\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        a\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'quoteitem: unterminated code at +0 with interior blank',
    '> - head\n>\n>   ```\n>   a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated code at +0 without interior blank',
    '> - head\n>\n>   ```\n>   a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed code at +0 with interior blank',
    '> - head\n>\n>   ```\n>   a\n> \n>   b\n>   ```\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\nb\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed code at +0 then blank and tail',
    '> - head\n>\n>   ```\n>   a\n>   ```\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <pre><code>a\n</code></pre>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated code at +4 with interior blank',
    '> - head\n>\n>       ```\n>       a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated code at +4 without interior blank',
    '> - head\n>\n>       ```\n>       a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed code at +4 with interior blank',
    '> - head\n>\n>       ```\n>       a\n> \n>       b\n>       ```\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\nb\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed code at +4 then blank and tail',
    '> - head\n>\n>       ```\n>       a\n>       ```\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <pre><code>a\n</code></pre>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated tilde at +0 with interior blank',
    '> - head\n>\n>   ~~~\n>   a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated tilde at +0 without interior blank',
    '> - head\n>\n>   ~~~\n>   a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed tilde at +0 with interior blank',
    '> - head\n>\n>   ~~~\n>   a\n> \n>   b\n>   ~~~\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\nb\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed tilde at +0 then blank and tail',
    '> - head\n>\n>   ~~~\n>   a\n>   ~~~\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <pre><code>a\n</code></pre>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated tilde at +4 with interior blank',
    '> - head\n>\n>       ~~~\n>       a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated tilde at +4 without interior blank',
    '> - head\n>\n>       ~~~\n>       a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed tilde at +4 with interior blank',
    '> - head\n>\n>       ~~~\n>       a\n> \n>       b\n>       ~~~\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <pre><code>a\n\nb\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed tilde at +4 then blank and tail',
    '> - head\n>\n>       ~~~\n>       a\n>       ~~~\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <pre><code>a\n</code></pre>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated raw at +0 with interior blank',
    '> - head\n>\n>   ```=html\n>   a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\n\ntail\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated raw at +0 without interior blank',
    '> - head\n>\n>   ```=html\n>   a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\ntail\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed raw at +0 with interior blank',
    '> - head\n>\n>   ```=html\n>   a\n> \n>   b\n>   ```\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\n\nb\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed raw at +0 then blank and tail',
    '> - head\n>\n>   ```=html\n>   a\n>   ```\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      a\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated raw at +4 with interior blank',
    '> - head\n>\n>       ```=html\n>       a\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\n\ntail\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: unterminated raw at +4 without interior blank',
    '> - head\n>\n>       ```=html\n>       a\n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\ntail\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed raw at +4 with interior blank',
    '> - head\n>\n>       ```=html\n>       a\n> \n>       b\n>       ```\n',
    '<blockquote>\n  <ul>\n    <li>head\n      a\n\nb\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: closed raw at +4 then blank and tail',
    '> - head\n>\n>       ```=html\n>       a\n>       ```\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      a\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'unterminated code before sibling',
    '- ```\n  b\n\n- s\n',
    '<ul>\n  <li>\n    <pre><code>b\n\n</code></pre>\n  </li>\n  <li><p>s</p></li>\n</ul>',
  ],
  [
    'unterminated colon before sibling',
    '- ::: d\n  b\n\n- s\n',
    '<ul>\n  <li>\n    <div class="d">\n      <p>b</p>\n    </div>\n  </li>\n  <li><p>s</p></li>\n</ul>',
  ],
  [
    'closed code before sibling',
    '- ```\n  b\n  ```\n\n- s\n',
    '<ul>\n  <li>\n    <pre><code>b\n</code></pre>\n  </li>\n  <li><p>s</p></li>\n</ul>',
  ],
  [
    'attached unterminated code before sibling',
    '- head\n\n  ```\n  a\n\n  tail\n\n- s\n',
    '<ul>\n  <li><p>head</p>\n    <pre><code>a\n\ntail\n\n</code></pre>\n  </li>\n  <li><p>s</p></li>\n</ul>',
  ],
  [
    'lead unterminated colon remains loose',
    '- ::: d\n  b\n\n  tail\n',
    '<ul>\n  <li>\n    <div class="d">\n      <p>b</p>\n      <p>tail</p>\n    </div>\n  </li>\n</ul>',
  ],
  [
    'lead closed colon remains loose',
    '- ::: d\n  b\n\n  tail\n  :::\n',
    '<ul>\n  <li>\n    <div class="d">\n      <p>b</p>\n      <p>tail</p>\n    </div>\n  </li>\n</ul>',
  ],
  [
    'link definition preserves separation',
    '- a\n  [r]: /u\n\n    more\n',
    '<ul>\n  <li><p>a</p>\n    <p>more</p>\n  </li>\n</ul>',
  ],
  [
    'unclosed fence in open paragraph stays inline',
    '- head\n  ```\n  a\n',
    '<ul>\n  <li>head\n<code>\na</code></li>\n</ul>',
  ],
  [
    'fence after heading opens without closer',
    '- # head\n  ```\n  a\n\n  tail\n',
    '<ul>\n  <li>\n    <h1 id="head">head</h1>\n    <pre><code>a\n\ntail\n</code></pre>\n  </li>\n</ul>',
  ],
] as const

describe('interior fence blanks and list tightness', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }
})
