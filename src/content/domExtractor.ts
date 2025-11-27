import type { TextNode } from "@/shared/types";

// Tags to skip entirely (including all descendants)
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "PRE", // Multiline code blocks
  "KBD",
  "VAR",
  "SAMP",
]);

// Classes to skip (for multiline code blocks)
const SKIP_CLASSES = new Set([
  "listingblock",
  "codeblock",
  "code-block",
  "highlight",
]);

// Block-level elements that should be translation units
const TRANSLATABLE_BLOCKS = new Set([
  "P",
  "LI",
  "TD",
  "TH",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "CAPTION",
  "FIGCAPTION",
  "BLOCKQUOTE",
  "DT",
  "DD",
]);

// Minimum text length to consider for translation
const MIN_TEXT_LENGTH = 2;

// Map to store references to actual elements for later replacement
const elementMap = new Map<string, Element>();

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `ht-node-${++nodeIdCounter}`;
}

function getXPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling: Element | null = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  return "/" + parts.join("/");
}

function shouldSkipElement(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    // Skip if tag is in skip list
    if (SKIP_TAGS.has(current.tagName)) {
      return true;
    }
    // Skip if class matches skip classes
    for (const cls of SKIP_CLASSES) {
      if (current.classList.contains(cls)) {
        return true;
      }
    }
    // Skip hidden elements
    if (current.hasAttribute("hidden")) {
      return true;
    }
    // Skip elements with aria-hidden
    if (current.getAttribute("aria-hidden") === "true") {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function hasVisibleText(element: Element): boolean {
  const text = element.textContent?.trim() || "";
  return text.length >= MIN_TEXT_LENGTH;
}

function hasNestedTranslatableBlock(element: Element): boolean {
  // Check if this element contains nested translatable blocks
  for (const tag of TRANSLATABLE_BLOCKS) {
    if (element.querySelector(tag.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function extractTextNodes(): TextNode[] {
  // Clear previous mapping
  elementMap.clear();
  nodeIdCounter = 0;

  const textNodes: TextNode[] = [];
  const processedElements = new Set<Element>();

  // Find all translatable block elements
  for (const tag of TRANSLATABLE_BLOCKS) {
    const elements = document.body.querySelectorAll(tag.toLowerCase());

    for (const element of elements) {
      // Skip if already processed or should be skipped
      if (processedElements.has(element)) continue;
      if (shouldSkipElement(element)) continue;
      if (!hasVisibleText(element)) continue;

      // Skip if has nested translatable blocks (process children instead)
      if (hasNestedTranslatableBlock(element)) continue;

      const id = generateNodeId();
      const xpath = getXPath(element);
      // Use innerHTML to preserve inline tags like <code>
      const text = element.innerHTML;

      elementMap.set(id, element);
      processedElements.add(element);

      textNodes.push({
        id,
        text,
        xpath,
      });
    }
  }

  return textNodes;
}

export function getElementById(id: string): Element | undefined {
  return elementMap.get(id);
}

export function clearElementMap(): void {
  elementMap.clear();
  nodeIdCounter = 0;
}
