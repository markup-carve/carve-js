import type { BlockContent, PhrasingContent } from 'mdast'
import type { Literal, Parent } from 'unist'

interface MathBlock extends Literal { type: 'math', meta?: string | null }
interface InlineMath extends Literal { type: 'inlineMath' }
interface Toml extends Literal { type: 'toml' }
interface LeafDirective extends Parent {
  type: 'leafDirective', name: string, attributes?: Record<string, string>, children: PhrasingContent[]
}
interface ContainerDirective extends Parent {
  type: 'containerDirective', name: string, attributes?: Record<string, string>, children: BlockContent[]
}
interface TextDirective extends Parent {
  type: 'textDirective', name: string, attributes?: Record<string, string>, children: PhrasingContent[]
}

declare module 'mdast' {
  interface BlockContentMap { math: MathBlock, leafDirective: LeafDirective, containerDirective: ContainerDirective }
  interface PhrasingContentMap { inlineMath: InlineMath, textDirective: TextDirective }
  interface FrontmatterContentMap { toml: Toml, yaml: import('mdast').Yaml }
  interface RootContentMap {
    math: MathBlock, inlineMath: InlineMath, toml: Toml, yaml: import('mdast').Yaml,
    leafDirective: LeafDirective, containerDirective: ContainerDirective, textDirective: TextDirective
  }
}
