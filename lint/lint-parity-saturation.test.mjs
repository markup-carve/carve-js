import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const count = (source, rule) => lint(source).filter((entry) => entry.code === rule).length

describe('0.2 lint parity, lintsat1 round', () => {
  it("C2-B-046: a task box is no label", () => {
    expect(count("- [ ] a\n", 'blank-reference-label')).toBe(0)
  })
  it("C2-I-072: a bracket pair with nothing glued to it is no reference", () => {
    expect(count("a [ ]\n", 'blank-reference-label')).toBe(0)
  })
  it("C2-I-079: a blank full reference label", () => {
    expect(count("x [a][ ]\n", 'blank-reference-label')).toBe(1)
  })
  it("C2-I-079: a blank definition label", () => {
    expect(count("[ ]: u\n", 'blank-reference-label')).toBe(1)
  })
  it("C2-I-079: an image with no alt text holds no label", () => {
    expect(count("![](i.png)\n", 'blank-reference-label')).toBe(0)
  })
  it("C2-B-069: a term's later line is no opener candidate", () => {
    expect(count("::: box\n   :: t\n: d\n:::\n", 'block-opener-without-blank-line')).toBe(0)
  })
  it("C2-B-069: a term's later line is no paragraph line", () => {
    expect(count("2) :: t\n    : {#id}\n", 'markdown-definition-paragraph')).toBe(0)
  })
  it("C2-B-074: a colon line below a `::` line", () => {
    expect(count(":::{.c}\n:: key\n:  key\n", 'markdown-definition-paragraph')).toBe(0)
  })
  it("C2-B-074: the first line of a paragraph", () => {
    expect(count(": x\n", 'markdown-definition-paragraph')).toBe(0)
  })
  it("C2-B-074: a later paragraph line", () => {
    expect(count("a\n: x\n", 'markdown-definition-paragraph')).toBe(1)
  })
  it("C2-B-031: a quote run that is text leaves the next quote line a candidate", () => {
    expect(count(">>> |= A |= B |\n> | x | y |\n", 'block-opener-without-blank-line')).toBe(1)
  })
  it("C2-B-031: a glued mark is no container prefix", () => {
    expect(count(">*\n> : more\n", 'markdown-definition-paragraph')).toBe(0)
  })
  it("C2-B-151: a two-mark heading is a candidate", () => {
    expect(count("a\n## b\n", 'block-opener-without-blank-line')).toBe(1)
  })
  it("C2-B-151: a six-mark heading is a candidate", () => {
    expect(count("a\n====== b\n", 'block-opener-without-blank-line')).toBe(1)
  })
  it("C2-B-151: seven marks are text", () => {
    expect(count("a\n####### b\n", 'block-opener-without-blank-line')).toBe(0)
  })
  it("C2-B-149: a caption line in a footnote body", () => {
    expect(count("[^n]: ^ x\n", 'unattached-caption')).toBe(1)
  })
  it("C2-B-081: a definition on a list marker line", () => {
    expect(count("- [a]: u\n", 'definition-in-container')).toBe(1)
  })
  it("C2-B-081: a definition behind a description mark", () => {
    expect(count(":: t\n: [a]: u\n", 'definition-in-container')).toBe(1)
  })
  it("C2-B-081: a footnote definition is not reported for its own mark", () => {
    expect(count("[^n]: ^ x\n", 'definition-in-container')).toBe(0)
  })
  it("C2-B-075: a quote mark opening a term's text", () => {
    expect(count(":: > x\n", 'definition-term-block-folded')).toBe(1)
  })
  it("C2-B-075: a block opener on a later line of the term", () => {
    expect(count(":: c\n# H\n", 'definition-term-block-folded')).toBe(0)
  })
})
