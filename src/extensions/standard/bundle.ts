import type { DocumentTransform } from '../../api.ts'
import type { ExtensionDefinition, ExtensionRenderer } from '../types.ts'

/** The registrations of one standard extension, spread into the `extensions` and `renderers` options. */
export interface ExtensionBundle {
  extensions: readonly ExtensionDefinition[]
  renderers: Readonly<Record<string, ExtensionRenderer>>
  /** C2-X-053: document transforms, passed to `renderWithDocumentTransforms`. */
  transforms?: readonly DocumentTransform[]
}

/**
 * Merges bundles into one; two claims of one name fail at registration (C2-X-014). Without transforms the result
 * is itself valid render options.
 */
export function withExtensions(...bundles: readonly ExtensionBundle[]): ExtensionBundle {
  const extensions: ExtensionDefinition[] = []
  const renderers: Record<string, ExtensionRenderer> = {}
  const transforms: DocumentTransform[] = []
  for (const bundle of bundles) {
    extensions.push(...bundle.extensions)
    Object.assign(renderers, bundle.renderers)
    transforms.push(...(bundle.transforms ?? []))
  }
  return transforms.length === 0 ? { extensions, renderers } : { extensions, renderers, transforms }
}
