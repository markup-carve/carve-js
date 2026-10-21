import { describe, expect, it } from 'vitest'
import { carveToCarve, markdownToCarve } from '../src/index.js'

describe('a Markdown import is a writer fixed point in nested containers', () => {
  const cases: Array<[string, string, string]> = [
    ['list marker padding', '- 1.  foo\n', '- 1. foo\n'],
    ['quoted marker padding', '> - 1.  foo\n', '> - 1. foo\n'],
    ['nested quote marker padding', '> > - 1.  foo\n', '> > - 1. foo\n'],
    ['list heading spacing', '- #   foo\n', '- # foo\n'],
    ['quoted heading spacing', '> #   foo\n', '> # foo\n'],
    ['nested quote heading spacing', '> > #   foo\n', '> > # foo\n'],
    ['list thematic break', '- foo\n  \n  ****\n', '{loose}\n- foo\n\n  ---\n'],
    ['quoted thematic break', '> ****\n', '> ---\n'],
    ['nested quote thematic break', '> > ****\n', '> > ---\n'],
    ['list break after heading', '- ****\n  ## foo\n  ****\n', '- ---\n  ## foo\n  ***\n'],
    ['quoted list break after heading', '> - ****\n>   ## foo\n>   ****\n', '> - ***\n>   ## foo\n>   ***\n'],
    ['nested quote list break after heading', '> > - ****\n> >   ## foo\n> >   ****\n', '> > - ***\n> >   ## foo\n> >   ***\n'],
    ['list reference title', "- [x][r]\n\n[r]: /u 'title'\n", '- [x][r]\n\n[r]: /u "title"\n'],
    ['reference title entity decodes once', "[x][r]\n\n[r]: /u '&amp;lt;'\n", '[x][r]\n\n[r]: /u "&lt;"\n'],
    ['list reference title entity decodes once', "- [x][r]\n\n[r]: /u '&amp;amp;'\n", '- [x][r]\n\n[r]: /u "&amp;"\n'],
    ['quoted reference title', "> [x][r]\n>\n> [r]: /u 'title'\n", '> [x][r]\n\n[r]: /u "title"\n'],
    ['nested quote reference title', "> > [x][r]\n> >\n> > [r]: /u 'title'\n", '> > [x][r]\n\n[r]: /u "title"\n'],
    ['list paragraph padding', '-  foo\n', '- foo\n'],
    ['quoted paragraph padding', '>   foo\n', '> foo\n'],
    ['nested quote paragraph padding', '> >   foo\n', '> > foo\n'],
    ['list punctuation padding', '-   **\n', '- **\n'],
    ['quoted punctuation padding', '>   **\n', '> **\n'],
    ['nested quote punctuation padding', '> >   **\n', '> > **\n'],
    ['tab-indented item paragraph stays in its item', '>   - foo\n> \n> \tbar\n', '> - foo\n>\n>   bar\n'],
    ['quoted raw block boundary', '> <pre>\n> x\n> </pre>\n> y\n', '> ```=html\n> <pre>\n> x\n> </pre>\n> ```\n>\n> y\n'],
    ['nested quote raw block boundary', '> > <pre>\n> > x\n> > </pre>\n> > y\n', '> > ```=html\n> > <pre>\n> > x\n> > </pre>\n> > ```\n> >\n> > y\n'],
    ['nested quote raw block exits to outer quote', '> > <pre>\n> > x\n> > </pre>\n> y\n', '> > ```=html\n> > <pre>\n> > x\n> > </pre>\n> > ```\n>\n> y\n'],
    ['adjacent raw blocks in a plain quote', '> <pre>\n> x\n> </pre>\n> <div>\n', '> ```=html\n> <pre>\n> x\n> </pre>\n> ```\n>\n> ```=html\n> <div>\n> ```\n'],
    ['adjacent raw blocks in a quoted item', '> - <table><tr><td>\n>   <pre>\n>   **Hello**,\n>   \n>   _world_.\n>   </pre>\n>   </td></tr></table>\n', '> - `<table>`{=html}`<tr>`{=html}`<td>`{=html}\n>   ```=html\n>   <pre>\n>   **Hello**,\n>\n>   _world_.\n>   </pre>\n>   ```\n>   ```=html\n>   </td></tr></table>\n>   ```\n'],
    ['list raw block column', '- <table>\n    <tr>\n  </table>\n', '- `<table>`{=html}\n  ```=html\n  <tr>\n  </table>\n  ```\n'],
    ['quoted list raw block column', '> - <table>\n>     <tr>\n>   </table>\n', '> - `<table>`{=html}\n>   `<tr>`{=html}\n>   ```=html\n>   </table>\n>   ```\n'],
    ['nested quote list raw block column', '> > - <table>\n> >     <tr>\n> >   </table>\n', '> > - `<table>`{=html}\n> >   `<tr>`{=html}\n> >   ```=html\n> >   </table>\n> >   ```\n'],
    ['list fence blank', '- ```\n  \n  x\n  ```\n', '- ```\n\n  x\n  ```\n'],
    ['quoted list fence blank', '> - ```\n>   \n>   x\n>   ```\n', '> - ```\n>\n>   x\n>   ```\n'],
    ['nested quote list fence blank', '> > - ```\n> >   \n> >   x\n> >   ```\n', '> > - ```\n> >\n> >   x\n> >   ```\n'],
    ['quoted fence keeps heading text', '> ````\n> #   foo\n> ````\n', '> ```\n> #   foo\n> ```\n'],
    ['nested quote fence keeps break text', '> > ````\n> > ****\n> > ````\n', '> > ```\n> > ****\n> > ```\n'],
    ['quoted list fence keeps break text', '> - ````\n>   ****\n>   ````\n', '> - ```\n>   ****\n>   ```\n'],
    ['quoted fence keeps underscore text', '> ````\n> ____\n> ````\n', '> ```\n> ____\n> ```\n'],
    ['quoted fence keeps pipe rows', '> ```\n> | a | b |\n> |---|---|\n> ```\n', '> ```\n> | a | b |\n> |---|---|\n> ```\n'],
    ['nested quote fence keeps pipe rows', '> > ```\n> > | a | b |\n> > |---|---|\n> > ```\n', '> > ```\n> > | a | b |\n> > |---|---|\n> > ```\n'],
    ['nested item continuation column', '- 1.  foo\n  \n      - bar\n', '- {loose}\n  1. foo\n\n     - bar\n'],
    ['list marker padding across a blank', '-   foo\n  \n    bar\n', '- foo\n\n  bar\n'],
    ['quoted marker padding across a blank', '> -   foo\n>\n>     bar\n', '> - foo\n>\n>   bar\n'],
    ['nested quote marker padding across a blank', '> > -   foo\n> >\n> >     bar\n', '> > - foo\n> >\n> >   bar\n'],
    ['list marker padding before outside paragraph', '-    foo\n\n  bar\n', '- foo\n\nbar\n'],
    ['quoted marker padding before outside paragraph', '> -    foo\n>\n>   bar\n', '> - foo\n>\n> bar\n'],
    ['nested quote marker padding before outside paragraph', '> > -    foo\n> >\n> >   bar\n', '> > - foo\n> >\n> > bar\n'],
    ['list item separates a quoted heading from paragraph', '- > # Foo\n  > bar\n', '- > # Foo\n  >\n  > bar\n'],
    ['quoted item separates a heading from paragraph', '> - > # Foo\n>   > bar\n', '> - > # Foo\n>   >\n>   > bar\n'],
    ['nested quote item separates a heading from paragraph', '> > - > # Foo\n> >   > bar\n', '> > - > # Foo\n> >   >\n> >   > bar\n'],
  ]

  it.each(cases)('%s', (_name, markdown, expected) => {
    const imported = markdownToCarve(markdown)
    expect(imported).toBe(expected)
    expect(carveToCarve(imported)).toBe(imported)
  })


  it('drops paragraph trailing spaces in a quoted item', () => {
    const imported = markdownToCarve('> - alpha   \n')
    expect(imported).toBe('> - alpha\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('collapses empty quote lines between paragraphs', () => {
    const imported = markdownToCarve('> alpha\n>\n>\n> beta\n')
    expect(imported).toBe('> alpha\n>\n> beta\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('moves a nested ordered item continuation with its marker', () => {
    const imported = markdownToCarve('- 01. alpha\n      beta\n')
    expect(imported).toBe('- 1. alpha\n     beta\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('shortens nested ordered markers before rewriting their padding', () => {
    for (const [markdown, expected] of [
      ['- 01.   foo\n       bar\n', '- 1. foo\n     bar\n'],
      ['> - 007.  a\n>         b\n', '> - 7. a\n>      b\n'],
    ]) {
      const imported = markdownToCarve(markdown)
      expect(imported).toBe(expected)
      expect(carveToCarve(imported)).toBe(imported)
    }
  })

  it('removes paragraph slack in a quote on an item opener', () => {
    const imported = markdownToCarve('* >     sapling\n    leaf\n')
    expect(imported).toBe('* > sapling\n  > leaf\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('keeps a lazy line under the innermost hosted quote', () => {
    const imported = markdownToCarve('* > 7. > bud\n  opens\n')
    expect(imported).toBe('* > 7. > bud\n  >    > opens\n')
    expect(carveToCarve(imported)).toBe(imported)
  })
})
