import type { TranslatedNode } from "@/shared/types";
import { getTextNodeById } from "./domExtractor";

export function replaceTextNodes(translatedNodes: TranslatedNode[]): number {
  let replacedCount = 0;

  for (const { id, translatedText } of translatedNodes) {
    const textNode = getTextNodeById(id);

    if (textNode && textNode.parentNode) {
      // Preserve leading/trailing whitespace from original
      const original = textNode.textContent || "";
      const leadingSpace = original.match(/^\s*/)?.[0] || "";
      const trailingSpace = original.match(/\s*$/)?.[0] || "";

      textNode.textContent = leadingSpace + translatedText + trailingSpace;
      replacedCount++;
    }
  }

  return replacedCount;
}

export function replaceTextNodeById(id: string, translatedText: string): boolean {
  const textNode = getTextNodeById(id);

  if (textNode && textNode.parentNode) {
    const original = textNode.textContent || "";
    const leadingSpace = original.match(/^\s*/)?.[0] || "";
    const trailingSpace = original.match(/\s*$/)?.[0] || "";

    textNode.textContent = leadingSpace + translatedText + trailingSpace;
    return true;
  }

  return false;
}
