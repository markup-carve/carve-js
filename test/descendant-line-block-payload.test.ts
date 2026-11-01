import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('line-block payload in item descendants', () => {
  it('keeps a definition-shaped payload and lazy line in an item description', () => {
    expect(carveToHtml('- :: u\n  : ::: |\n    [x]: /u\nb\n').trim()).toBe(`<ul>
  <li>
    <dl>
      <dt>u</dt>
      <dd>
        <div class="line-block">
          <p>[x]: /u<br>
b</p>
        </div>
      </dd>
    </dl>
  </li>
</ul>`)
  })

  it('keeps an empty verse line and lazy line in a child item', () => {
    expect(carveToHtml('- - ::: |\n    %% c\nb\n').trim()).toBe(`<ul>
  <li>
    <ul>
      <li>
        <div class="line-block">
          <p><br>
b</p>
        </div>
      </li>
    </ul>
  </li>
</ul>`)
  })

  it('keeps a marker and shifted colon run as description payload', () => {
    expect(carveToHtml('- :: u\n  : ::: |\n     [x]: /u\n    - l\n       :::\nb\n').trim()).toBe(`<ul>
  <li>
    <dl>
      <dt>u</dt>
      <dd>
        <div class="line-block">
          <p>&nbsp;[x]: /u<br>
- l<br>
&nbsp;&nbsp;&nbsp;:::<br>
b</p>
        </div>
      </dd>
    </dl>
  </li>
</ul>`)
  })
})
