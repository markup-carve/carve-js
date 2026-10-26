/** Adjust Native Djot fixture HTML for the image-only paragraph ruling. */
export function imageParagraphsAsImages(html: string): string {
  return html.replace(/<p(\s[^>]*)?>\s*(<img\b[^>]*>)\s*<\/p>/g, (_match, paragraphAttrs: string | undefined, image: string) =>
    paragraphAttrs ? image.replace(/>$/, `${paragraphAttrs}>`) : image)
}
