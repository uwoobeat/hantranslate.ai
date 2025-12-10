/**
 * 번역에서 제외할 HTML 태그 목록.
 * 스크립트, 스타일, 코드 블록 등 번역하면 안 되는 기술적 콘텐츠를 필터링한다.
 */
const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "INPUT",
  "SVG",
  "MATH",
]);

/**
 * 추출된 텍스트 노드 참조를 저장하는 배열.
 * {@link extractTextNodes}에서 채워지며, {@link getExtractedNodes}를 통해 접근한다.
 * 번역 후 DOM 교체 시 원본 노드 참조로 사용된다.
 */
let extractedNodes: Text[] = [];

/**
 * DOM에서 번역 대상 텍스트 노드를 추출한다.
 *
 * TreeWalker API를 사용하여 document.body 내의 모든 텍스트 노드를 순회하며,
 * 다음 조건을 만족하는 노드만 추출한다:
 * - 부모 요소가 존재할 것
 * - 부모 태그가 {@link EXCLUDED_TAGS}에 포함되지 않을 것
 * - 공백만 있는 텍스트가 아닐 것
 *
 * @returns 추출된 텍스트 문자열 배열. 각 요소는 개별 텍스트 노드의 내용이다.
 *
 * @example
 * // <p>Hello <strong>world</strong>!</p>
 * // 위 HTML에서 추출 결과: ["Hello ", "world", "!"]
 *
 * @sideeffect {@link extractedNodes} 배열을 초기화하고 추출된 노드 참조로 채운다.
 */
export function extractTextNodes(): string[] {
  extractedNodes = [];
  const texts: string[] = [];

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (EXCLUDED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    extractedNodes.push(node);
    texts.push(node.textContent || "");
  }

  return texts;
}

/**
 * 가장 최근에 추출된 텍스트 노드 참조 배열을 반환한다.
 *
 * {@link extractTextNodes} 호출 시 저장된 노드 참조를 반환하며,
 * 번역된 텍스트로 DOM을 교체할 때 사용된다.
 *
 * @returns 추출된 Text 노드 배열. {@link extractTextNodes}가 호출되지 않았으면 빈 배열.
 */
export function getExtractedNodes(): Text[] {
  return extractedNodes;
}
