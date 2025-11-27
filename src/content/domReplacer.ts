import type { TranslatedNode } from "@/shared/types";
import { getElementById } from "./domExtractor";

export function replaceTextNodes(translatedNodes: TranslatedNode[]): number {
  let replacedCount = 0;

  for (const { id, translatedText } of translatedNodes) {
    const element = getElementById(id);

    if (element) {
      // Replace innerHTML directly (translated text includes inline tags like <code>)
      element.innerHTML = translatedText;
      replacedCount++;
    }
  }

  return replacedCount;
}

export function replaceTextNodeById(id: string, translatedText: string): boolean {
  const element = getElementById(id);

  if (element) {
    element.innerHTML = translatedText;
    return true;
  }

  return false;
}
