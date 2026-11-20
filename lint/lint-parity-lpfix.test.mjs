import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const cases = [
  [5167, 'indented-code-block', '\n    ## H', []],
  [5167, 'indented-code-block', '\n      = H', []],
  [5174, 'uneven-list-indent', '[^n]: 10. +|\n   1. :::', []],
  [5174, 'uneven-list-indent', '[^f]: - [ ] ::: box\n\t- x', []],
  [5173, 'deprecated-separator-row', '[^n]: | A | B |\n      |:--|--:|', [[22, 31]]],
  [5163, 'emphasis-marker-before-attributes', 'a |={<}', []],
  [5163, 'emphasis-marker-before-attributes', '+ |={<}', []],
  [5156, 'block-opener-overindented', '  ````=html', [[2, 6]]],
  [5156, 'block-opener-overindented', '   ```=html', [[3, 6]]],
  [5161, 'unattached-block-attribute', '### H\n {#id}', []],
  [5161, 'unattached-block-attribute', 'i) ### H\n    {#id .c k=v}', []],
  [5166, 'definition-in-container', ':: t\n[a]: u', []],
  [5166, 'definition-in-container', ':: t\n[^f]: [a]:', []],
  [5166, 'definition-in-container', '   :: term\n: #H\n  [a]: u\n::::\n', [[18, 22]]],
  [5160, 'unattached-block-attribute', '> :\n{#id}\n>', []],
  [5159, 'unattached-block-attribute', ':::\n{#id}\n:::', [[4, 9]]],
  [5159, 'unattached-block-attribute', '    :::\n{.c}\n:::', [[8, 12]]],
  [5169, 'list-item-body-below-content-column', '2) ==\n\t- [x]', []],
  [5169, 'list-item-body-below-content-column', '- a\n\n\t- b', []],
  [5158, 'list-item-block-overindented', '- a\n\n   %%x', []],
  [5158, 'list-item-block-overindented', '* $$x$$\n   %% #region r', []],
  [5172, 'github-alert-marker', '> [^f]: > [!NOTE]', [[10, 17]]],
  [5172, 'github-alert-marker', '>   [^n]: > [!NOTE]', [[12, 19]]],
  [5172, 'github-alert-marker', '> prose > [!NOTE]', []],
  [5171, 'unattached-caption', '[^f]: %%x\n^ Caption', [[10, 19]]],
  [5165, 'description-separator-below-content-column', '\t:: more\n> ::', []],
  [5164, 'description-separator-below-content-column', ':: term\n: :: t\n: %%', []],
  [5164, 'description-separator-below-content-column', ':: term\n: ::::\n   :: t\n: ::::', []],
  [5162, 'block-marker-as-text', 'a\n> ::::', []],
  [5162, 'block-marker-as-text', '{%c%}\n> ::::', []],
  [5162, 'block-marker-as-text', 'a\n~~~js', []],
  [5168, 'comment-fence-closer-with-text', '- %%%\n  %%% x', [[6, 13]]],
  [5157, 'list-item-block-overindented', '* a\n\n   ![alt](i.png)', [[8, 21]]],
  [5155, 'block-opener-overindented', ':: term\n: > :: word', []],
  [5155, 'block-opener-overindented', '[^n]: > :: word', []],
  [5155, 'block-opener-overindented', '- > :: word', []],
  [5155, 'block-opener-overindented', ':: term\n: > > :: w', []],
  [5170, 'list-item-body-below-content-column', '\ti) :: term\n\n     +|', [[18, 20]]],
]

describe('0.2 lint parity ticket inputs', () => {
  for (const [ticket, rule, source, expected] of cases) {
    it(`#${ticket} ${rule}: ${JSON.stringify(source)}`, () => {
      const actual = lint(source).filter((finding) => finding.code === rule)
        .map((finding) => [finding.range.startOffset, finding.range.endOffset])
      expect(actual).toEqual(expected)
    })
  }
})
