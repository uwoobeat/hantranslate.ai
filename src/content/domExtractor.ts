import type { TextNode } from "@/shared/types";

// Tags to skip when extracting text
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
  "CODE",
  "PRE",
  "KBD",
  "VAR",
  "SAMP",
]);

// Minimum text length to consider for translation
const MIN_TEXT_LENGTH = 2;

// Map to store references to actual text nodes for later replacement
const textNodeMap = new Map<string, Text>();

let nodeIdCounter = 0;

function generateNodeId(): string {
  return `ht-node-${++nodeIdCounter}`;
}

function getXPath(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const element = current as Element;
    let index = 1;
    let sibling: Element | null = element.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === element.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = element.tagName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);
    current = element.parentNode;
  }

  return "/" + parts.join("/");
}

function shouldSkipElement(element: Element): boolean {
  // Skip if element or ancestors are in skip list
  let current: Element | null = element;

  while (current) {
    if (SKIP_TAGS.has(current.tagName)) {
      return true;
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

function isVisibleText(text: string): boolean {
  // Check if text has meaningful content (not just whitespace)
  const trimmed = text.trim();
  return trimmed.length >= MIN_TEXT_LENGTH;
}

export function extractTextNodes(): TextNode[] {
  // Clear previous mapping
  textNodeMap.clear();
  nodeIdCounter = 0;

  const textNodes: TextNode[] = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Text): number {
        // Skip empty or whitespace-only text
        if (!isVisibleText(node.textContent || "")) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip if parent should be skipped
        const parent = node.parentElement;
        if (!parent || shouldSkipElement(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let currentNode: Text | null;
  while ((currentNode = walker.nextNode() as Text | null)) {
    const text = currentNode.textContent?.trim();
    if (!text) continue;

    const id = generateNodeId();
    const xpath = getXPath(currentNode.parentElement!);

    textNodeMap.set(id, currentNode);

    textNodes.push({
      id,
      text,
      xpath,
    });
  }

  return textNodes;
}

export function getTextNodeById(id: string): Text | undefined {
  return textNodeMap.get(id);
}

export function clearTextNodeMap(): void {
  textNodeMap.clear();
  nodeIdCounter = 0;
}
