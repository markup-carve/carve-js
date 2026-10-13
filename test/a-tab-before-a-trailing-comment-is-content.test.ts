import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-041 consumes separating spaces and preserves tabs.
it.each([
  ['a\t %% c\n', '<p>a\t</p>'],
  ['a\t%% c\n', '<p>a\t%% c</p>'],
  ['a \t%% c\n', '<p>a \t%% c</p>'],
  ['# a\t %% c\n', '<section id="a">\n  <h1>a\t</h1>\n</section>'],
  ['| a\t%% c | b |\n', '<table>\n  <tbody>\n    <tr><td>a\t%% c</td><td>b</td></tr>\n  </tbody>\n</table>'],
  [':: a\t%% c\n: d\n', '<dl>\n  <dt>a\t%% c</dt>\n  <dd>d</dd>\n</dl>'],
])('keeps tab content in %j', (source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})
