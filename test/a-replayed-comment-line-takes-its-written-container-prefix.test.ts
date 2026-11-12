import { expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, parse, renderCarve } from '../src/index.js'

const tree = (source: string): string =>
  JSON.stringify(carveToAstJson(source), (key, value: unknown) => (key === 'pos' || key === 'srcByteLength') ? undefined : value)
const withoutPositions = (source: string): ReturnType<typeof parse> =>
  JSON.parse(JSON.stringify(parse(source), (key, value: unknown) => key === 'pos' ? undefined : value))

it.each([
  ['- [ ] x\n      - y\n      %% a\n- [ ] o\n', '- [ ] x\n  - y\n  %% a\n- [ ] o\n'],
  ['- [ ] x\n\n      - y\n\n      %% a\n- [ ] o\n', '- [ ] x\n\n  - y\n  %% a\n\n- [ ] o\n'],
  [' - [ ] x\n       - y\n       %% a\n - [ ] o\n', '- [ ] x\n  - y\n  %% a\n- [ ] o\n'],
  ['- [ ] x\n      - y\n    %% a\nz\n', '- [ ] x\n  - y\n  %% a\nz\n'],
  ['> - [ ] x\n>       - [ ] y\n>     %% a\n> z\n', '> - [ ] x\n>   - [ ] y\n>   %% a\n> z\n'],
  [' > - x\n >   %% a\n >   y\n', '> - x\n>   %% a\n>   y\n'],
  [' > - [ ] x\n >       %% a\n >       y\n', '> - [ ] x\n>       %% a\n>       y\n'],
  [' - top\n \n   > 1. x\n   >    %% a\n   >    y\n', '- top\n\n  > 1. x\n  >    %% a\n  >    y\n'],
])('writes a replayed comment line under its written container prefix (carve-js#5014): %j', (source, expected) => {
  for (const written of [
    renderCarve(parse(source)),
    renderCarve(parse(source, { positions: false })),
    renderCarve(withoutPositions(source)),
  ]) {
    expect(written).toBe(expected)
    expect(tree(written)).toBe(tree(source))
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  }
})

it.each([
  ['- x\n   %% a\n- o\n', '- x\n   %% a\n- o\n'],
  ['- a\n%% c\n    %% c\n', '- a\n\n%% c\n    %% c\n'],
  ['> - a\n> > x\n>     %% c\n', '> - a\n>\n> > x\n>\n>     %% c\n'],
])('keeps an authored comment column that no written item takes (carve-js#5014): %j', (source, expected) => {
  const written = renderCarve(parse(source, { positions: false }))
  expect(written).toBe(expected)
  expect(tree(written)).toBe(tree(source))
})
