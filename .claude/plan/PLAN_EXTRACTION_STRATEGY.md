# 범용 추출 인터페이스 설계 (Strategy Pattern)

다양한 추출 로직을 실험하고 교체 가능하게 하기 위한 범용 인터페이스 설계입니다.

> 관련 문서: [DOM_EXTRACTOR_DIAGNOSIS.md](PLAN_REFACTOR_DOM_EXTRACTOR.md)

---

## 1. 설계 목표

1. **전략 교체 용이성**: 추출 로직을 런타임에 교체 가능
2. **테스트 용이성**: 각 전략을 독립적으로 테스트 가능
3. **일관된 인터페이스**: 어떤 전략이든 동일한 입출력 형식
4. **점진적 마이그레이션**: 기존 로직 유지하면서 새 로직 실험 가능

---

## 2. 핵심 인터페이스 정의

```typescript
// content/extraction/types.ts

/**
 * 번역 세그먼트 - 모든 추출 전략의 공통 출력 형식
 */
interface TranslationSegment {
  /** 고유 식별자 (DOM 요소 매핑용) */
  id: string;

  /** 번역 대상 텍스트 (placeholder 적용 후) */
  textToTranslate: string;

  /** 원본 정보 (복원용) */
  original: {
    html: string;           // 원본 HTML
    textContent: string;    // 원본 텍스트
  };

  /** Placeholder 매핑 (복원 시 사용) */
  placeholders: Array<{
    token: string;          // e.g., "{{CODE_1}}"
    html: string;           // e.g., "<code>foo</code>"
    type: PlaceholderType;
  }>;

  /** 메타데이터 */
  metadata: {
    tagName: string;        // 원본 요소 태그
    depth: number;          // DOM 깊이
    index: number;          // 추출 순서
  };
}

type PlaceholderType = 'code' | 'link' | 'emphasis' | 'image' | 'other';

/**
 * 번역 결과 - 번역 완료 후 적용할 데이터
 */
interface TranslationResult {
  id: string;
  translatedText: string;   // placeholder 포함된 번역 결과
}

/**
 * 추출 옵션 - 전략에 전달되는 설정
 */
interface ExtractionOptions {
  /** 추출 범위 (기본: document.body) */
  root?: Element;

  /** 제외할 선택자 */
  excludeSelectors?: string[];

  /** 포함할 블록 요소들 */
  blockSelectors?: string[];

  /** 인라인 코드 처리 방식 */
  inlineCodeHandling?: 'exclude' | 'placeholder' | 'include';

  /** 멀티라인 코드블럭 처리 방식 */
  codeBlockHandling?: 'exclude' | 'include';

  /** 최소 텍스트 길이 (이하는 제외) */
  minTextLength?: number;

  /** 디버그 모드 */
  debug?: boolean;
}

/**
 * 적용 옵션 - 번역 결과 적용 시 설정
 */
interface ApplicationOptions {
  /** 적용 방식 */
  mode?: 'replace' | 'overlay';

  /** 원문 보존 여부 */
  preserveOriginal?: boolean;

  /** 적용 후 콜백 */
  onApplied?: (segment: TranslationSegment) => void;
}
```

---

## 3. 추출 전략 인터페이스

```typescript
// content/extraction/strategy.ts

/**
 * 추출 전략 인터페이스
 * 모든 추출 로직은 이 인터페이스를 구현해야 함
 */
interface ExtractionStrategy {
  /** 전략 이름 (디버깅/로깅용) */
  readonly name: string;

  /** 전략 버전 */
  readonly version: string;

  /**
   * DOM에서 번역 세그먼트 추출
   */
  extract(options?: ExtractionOptions): TranslationSegment[];

  /**
   * 번역 결과를 DOM에 적용
   */
  apply(
    results: TranslationResult[],
    options?: ApplicationOptions
  ): void;

  /**
   * 원문으로 복원
   */
  restore(): void;

  /**
   * 전략이 현재 페이지에 적합한지 검사 (선택적)
   */
  isApplicable?(): boolean;

  /**
   * 전략 정리 (메모리 해제 등)
   */
  cleanup?(): void;
}

/**
 * 추출 전략 팩토리
 */
type ExtractionStrategyFactory = (options?: ExtractionOptions) => ExtractionStrategy;
```

---

## 4. 추출 컨텍스트 (Strategy 실행기)

```typescript
// content/extraction/context.ts

/**
 * 추출 컨텍스트 - 전략을 관리하고 실행
 */
class ExtractionContext {
  private strategy: ExtractionStrategy;
  private segments: TranslationSegment[] = [];
  private options: ExtractionOptions;

  constructor(
    strategy: ExtractionStrategy,
    options: ExtractionOptions = {}
  ) {
    this.strategy = strategy;
    this.options = options;
  }

  /** 현재 전략 이름 */
  get strategyName(): string {
    return this.strategy.name;
  }

  /** 전략 교체 */
  setStrategy(strategy: ExtractionStrategy): void {
    this.cleanup();
    this.strategy = strategy;
  }

  /** 추출 실행 */
  extract(): TranslationSegment[] {
    this.segments = this.strategy.extract(this.options);
    return this.segments;
  }

  /** 번역 결과 적용 */
  apply(results: TranslationResult[], options?: ApplicationOptions): void {
    this.strategy.apply(results, options);
  }

  /** 원문 복원 */
  restore(): void {
    this.strategy.restore();
  }

  /** 정리 */
  cleanup(): void {
    this.strategy.cleanup?.();
    this.segments = [];
  }

  /** 추출된 세그먼트 반환 */
  getSegments(): TranslationSegment[] {
    return this.segments;
  }

  /** 텍스트 배열만 반환 (Background 전송용) */
  getTextsForTranslation(): string[] {
    return this.segments.map(s => s.textToTranslate);
  }

  /** ID 배열 반환 */
  getSegmentIds(): string[] {
    return this.segments.map(s => s.id);
  }
}
```

---

## 5. 전략 레지스트리 (전략 관리)

```typescript
// content/extraction/registry.ts

/**
 * 전략 레지스트리 - 사용 가능한 전략들을 관리
 */
class StrategyRegistry {
  private static instance: StrategyRegistry;
  private strategies: Map<string, ExtractionStrategyFactory> = new Map();
  private defaultStrategy: string = 'textNode';

  private constructor() {}

  static getInstance(): StrategyRegistry {
    if (!StrategyRegistry.instance) {
      StrategyRegistry.instance = new StrategyRegistry();
    }
    return StrategyRegistry.instance;
  }

  /** 전략 등록 */
  register(name: string, factory: ExtractionStrategyFactory): void {
    this.strategies.set(name, factory);
  }

  /** 전략 등록 해제 */
  unregister(name: string): boolean {
    return this.strategies.delete(name);
  }

  /** 전략 생성 */
  create(name: string, options?: ExtractionOptions): ExtractionStrategy {
    const factory = this.strategies.get(name);
    if (!factory) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    return factory(options);
  }

  /** 기본 전략 설정 */
  setDefault(name: string): void {
    if (!this.strategies.has(name)) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    this.defaultStrategy = name;
  }

  /** 기본 전략 생성 */
  createDefault(options?: ExtractionOptions): ExtractionStrategy {
    return this.create(this.defaultStrategy, options);
  }

  /** 등록된 전략 목록 */
  listStrategies(): string[] {
    return [...this.strategies.keys()];
  }

  /** 전략 존재 여부 확인 */
  has(name: string): boolean {
    return this.strategies.has(name);
  }
}

// 싱글톤 인스턴스 내보내기
export const strategyRegistry = StrategyRegistry.getInstance();
```

---

## 6. 구체적 전략 구현 예시

### 전략 1: 현재 로직 (Text 노드 기반)

```typescript
// content/extraction/strategies/textNodeStrategy.ts

class TextNodeStrategy implements ExtractionStrategy {
  readonly name = 'textNode';
  readonly version = '1.0.0';

  private extractedNodes: Text[] = [];
  private originalTexts: Map<Text, string> = new Map();

  private readonly EXCLUDED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE',
    'TEXTAREA', 'INPUT', 'SVG', 'MATH',
  ]);

  extract(options?: ExtractionOptions): TranslationSegment[] {
    this.extractedNodes = [];
    this.originalTexts.clear();

    const root = options?.root ?? document.body;
    const segments: TranslationSegment[] = [];

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (this.EXCLUDED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let index = 0;
    let node: Text | null;
    while ((node = walker.nextNode() as Text)) {
      this.extractedNodes.push(node);
      this.originalTexts.set(node, node.textContent || '');

      segments.push({
        id: `text-node-${index}`,
        textToTranslate: node.textContent || '',
        original: {
          html: node.textContent || '',
          textContent: node.textContent || '',
        },
        placeholders: [],
        metadata: {
          tagName: node.parentElement?.tagName || 'UNKNOWN',
          depth: this.getNodeDepth(node),
          index: index++,
        },
      });
    }

    return segments;
  }

  apply(results: TranslationResult[]): void {
    for (const result of results) {
      const index = parseInt(result.id.replace('text-node-', ''), 10);
      const node = this.extractedNodes[index];
      if (node) {
        node.textContent = result.translatedText;
      }
    }
  }

  restore(): void {
    for (const [node, originalText] of this.originalTexts) {
      node.textContent = originalText;
    }
  }

  cleanup(): void {
    this.extractedNodes = [];
    this.originalTexts.clear();
  }

  private getNodeDepth(node: Node): number {
    let depth = 0;
    let current: Node | null = node;
    while (current?.parentNode) {
      depth++;
      current = current.parentNode;
    }
    return depth;
  }
}

// 팩토리 함수
export const createTextNodeStrategy: ExtractionStrategyFactory = () => {
  return new TextNodeStrategy();
};
```

### 전략 2: 블록 요소 기반

```typescript
// content/extraction/strategies/blockElementStrategy.ts

class BlockElementStrategy implements ExtractionStrategy {
  readonly name = 'blockElement';
  readonly version = '1.0.0';

  private segments: Map<string, {
    element: Element;
    originalHTML: string;
  }> = new Map();

  private readonly BLOCK_SELECTORS = [
    'p', 'div', 'li', 'td', 'th',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'figcaption', 'dt', 'dd',
  ];

  private readonly SKIP_SELECTORS = [
    'script', 'style', 'noscript', 'pre',
    'textarea', 'input', 'svg', 'math',
    '[data-no-translate]', '[contenteditable="true"]',
  ];

  extract(options?: ExtractionOptions): TranslationSegment[] {
    this.segments.clear();

    const root = options?.root ?? document.body;
    const blockSelectors = options?.blockSelectors ?? this.BLOCK_SELECTORS;
    const skipSelectors = options?.excludeSelectors ?? this.SKIP_SELECTORS;

    const selector = blockSelectors.join(', ');
    const elements = root.querySelectorAll(selector);
    const result: TranslationSegment[] = [];

    let index = 0;
    for (const element of elements) {
      // 제외 대상 확인
      if (this.shouldSkip(element, skipSelectors)) continue;

      // 중첩된 블록 요소 제외 (부모가 이미 처리됨)
      if (this.hasBlockParent(element, elements)) continue;

      const id = `block-${index}`;
      const textContent = element.textContent?.trim() || '';

      if (!textContent || textContent.length < (options?.minTextLength ?? 1)) {
        continue;
      }

      this.segments.set(id, {
        element,
        originalHTML: element.innerHTML,
      });

      result.push({
        id,
        textToTranslate: textContent,
        original: {
          html: element.innerHTML,
          textContent,
        },
        placeholders: [],
        metadata: {
          tagName: element.tagName,
          depth: this.getElementDepth(element),
          index: index++,
        },
      });
    }

    return result;
  }

  apply(results: TranslationResult[]): void {
    for (const result of results) {
      const segment = this.segments.get(result.id);
      if (segment) {
        // textContent로 교체 (HTML 구조 손실, 하지만 안전)
        segment.element.textContent = result.translatedText;
      }
    }
  }

  restore(): void {
    for (const [, segment] of this.segments) {
      segment.element.innerHTML = segment.originalHTML;
    }
  }

  cleanup(): void {
    this.segments.clear();
  }

  private shouldSkip(element: Element, skipSelectors: string[]): boolean {
    return skipSelectors.some(sel => element.closest(sel) !== null);
  }

  private hasBlockParent(element: Element, allBlocks: NodeListOf<Element>): boolean {
    for (const block of allBlocks) {
      if (block !== element && block.contains(element)) {
        return true;
      }
    }
    return false;
  }

  private getElementDepth(element: Element): number {
    let depth = 0;
    let current: Element | null = element;
    while (current?.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }
}

export const createBlockElementStrategy: ExtractionStrategyFactory = () => {
  return new BlockElementStrategy();
};
```

### 전략 3: Placeholder 기반 (하이브리드)

```typescript
// content/extraction/strategies/placeholderStrategy.ts

class PlaceholderStrategy implements ExtractionStrategy {
  readonly name = 'placeholder';
  readonly version = '1.0.0';

  private segments: Map<string, {
    element: Element;
    originalHTML: string;
    placeholders: Array<{ token: string; html: string; type: PlaceholderType }>;
  }> = new Map();

  private readonly BLOCK_SELECTORS = ['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  private readonly INLINE_PRESERVE_TAGS: Array<{ tag: string; type: PlaceholderType }> = [
    { tag: 'code', type: 'code' },
    { tag: 'a', type: 'link' },
    { tag: 'strong', type: 'emphasis' },
    { tag: 'em', type: 'emphasis' },
    { tag: 'b', type: 'emphasis' },
    { tag: 'i', type: 'emphasis' },
  ];

  extract(options?: ExtractionOptions): TranslationSegment[] {
    this.segments.clear();

    const root = options?.root ?? document.body;
    const result: TranslationSegment[] = [];

    const elements = root.querySelectorAll(this.BLOCK_SELECTORS.join(', '));

    let index = 0;
    for (const element of elements) {
      if (this.shouldSkip(element)) continue;
      if (this.hasBlockParent(element, elements)) continue;

      const { processedText, placeholders } = this.processElement(element, index);

      if (!processedText.trim()) continue;

      const id = `placeholder-${index}`;

      this.segments.set(id, {
        element,
        originalHTML: element.innerHTML,
        placeholders,
      });

      result.push({
        id,
        textToTranslate: processedText,
        original: {
          html: element.innerHTML,
          textContent: element.textContent || '',
        },
        placeholders,
        metadata: {
          tagName: element.tagName,
          depth: this.getElementDepth(element),
          index: index++,
        },
      });
    }

    return result;
  }

  apply(results: TranslationResult[]): void {
    for (const result of results) {
      const segment = this.segments.get(result.id);
      if (!segment) continue;

      // Placeholder 복원
      let finalHTML = result.translatedText;
      for (const { token, html } of segment.placeholders) {
        finalHTML = finalHTML.replace(token, html);
      }

      segment.element.innerHTML = finalHTML;
    }
  }

  restore(): void {
    for (const [, segment] of this.segments) {
      segment.element.innerHTML = segment.originalHTML;
    }
  }

  cleanup(): void {
    this.segments.clear();
  }

  private processElement(
    element: Element,
    blockIndex: number
  ): {
    processedText: string;
    placeholders: Array<{ token: string; html: string; type: PlaceholderType }>;
  } {
    const placeholders: Array<{ token: string; html: string; type: PlaceholderType }> = [];
    let html = element.innerHTML;
    let counter = 0;

    for (const { tag, type } of this.INLINE_PRESERVE_TAGS) {
      // 멀티라인 코드블럭 제외 (code 태그 중 pre 안에 있거나 language- 클래스 있는 것)
      if (tag === 'code') {
        // 인라인 코드만 처리 (pre 안에 없는 것)
        const inlineCodeRegex = /<code(?![^>]*(?:class=["'][^"']*(?:language-|hljs)))[^>]*>([^<]*)<\/code>/gi;
        html = html.replace(inlineCodeRegex, (match) => {
          const token = `{{${type.toUpperCase()}_${blockIndex}_${counter++}}}`;
          placeholders.push({ token, html: match, type });
          return token;
        });
      } else {
        const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
        html = html.replace(regex, (match) => {
          const token = `{{${type.toUpperCase()}_${blockIndex}_${counter++}}}`;
          placeholders.push({ token, html: match, type });
          return token;
        });
      }
    }

    // HTML 태그 제거하여 순수 텍스트 + placeholder 추출
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const processedText = tempDiv.textContent || '';

    return { processedText, placeholders };
  }

  private shouldSkip(element: Element): boolean {
    const skipSelectors = ['script', 'style', 'noscript', 'pre', 'textarea', 'svg', 'math'];
    return skipSelectors.some(sel => element.closest(sel) !== null);
  }

  private hasBlockParent(element: Element, allBlocks: NodeListOf<Element>): boolean {
    for (const block of allBlocks) {
      if (block !== element && block.contains(element)) {
        return true;
      }
    }
    return false;
  }

  private getElementDepth(element: Element): number {
    let depth = 0;
    let current: Element | null = element;
    while (current?.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }
}

export const createPlaceholderStrategy: ExtractionStrategyFactory = () => {
  return new PlaceholderStrategy();
};
```

---

## 7. 전략 등록 및 사용

```typescript
// content/extraction/index.ts

import { strategyRegistry } from './registry';
import { ExtractionContext } from './context';
import { createTextNodeStrategy } from './strategies/textNodeStrategy';
import { createBlockElementStrategy } from './strategies/blockElementStrategy';
import { createPlaceholderStrategy } from './strategies/placeholderStrategy';

// 전략 등록
strategyRegistry.register('textNode', createTextNodeStrategy);
strategyRegistry.register('blockElement', createBlockElementStrategy);
strategyRegistry.register('placeholder', createPlaceholderStrategy);

// 기본 전략 설정
strategyRegistry.setDefault('textNode');

// 내보내기
export { strategyRegistry, ExtractionContext };
export * from './types';
export * from './strategy';
```

---

## 8. Content Script에서 사용

```typescript
// content/index.ts

import { strategyRegistry, ExtractionContext } from './extraction';
import type { ContentMessage, ContentResponse } from '../shared/messages';

// 설정에서 전략 선택 (또는 메시지로 전달)
let currentStrategyName = 'textNode';  // 기본값
let context: ExtractionContext | null = null;

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse) => {

    // 전략 변경 메시지
    if (message.type === 'SET_STRATEGY') {
      const { strategyName } = message;
      if (strategyRegistry.has(strategyName)) {
        currentStrategyName = strategyName;
        context?.cleanup();
        context = null;
        sendResponse({ type: 'STRATEGY_SET', strategyName });
      } else {
        sendResponse({ type: 'ERROR', error: `Unknown strategy: ${strategyName}` });
      }
      return true;
    }

    // 추출 요청
    if (message.type === 'GET_TRANSLATION_SEGMENTS') {
      const strategy = strategyRegistry.create(currentStrategyName, message.options);
      context = new ExtractionContext(strategy, message.options);

      const segments = context.extract();

      sendResponse({
        type: 'TRANSLATION_SEGMENTS',
        segments: segments.map(s => ({
          id: s.id,
          text: s.textToTranslate,
          metadata: s.metadata,
        })),
        strategyUsed: currentStrategyName,
      } as ContentResponse);

      return true;
    }

    // 번역 결과 적용
    if (message.type === 'APPLY_TRANSLATIONS') {
      if (!context) {
        sendResponse({ type: 'ERROR', error: 'No active extraction context' });
        return true;
      }

      context.apply(message.translations);
      sendResponse({ type: 'TRANSLATIONS_APPLIED', success: true });
      return true;
    }

    // 원문 복원
    if (message.type === 'RESTORE_ORIGINAL') {
      if (!context) {
        sendResponse({ type: 'ERROR', error: 'No active extraction context' });
        return true;
      }

      context.restore();
      sendResponse({ type: 'ORIGINAL_RESTORED', success: true });
      return true;
    }

    // 사용 가능한 전략 목록
    if (message.type === 'LIST_STRATEGIES') {
      sendResponse({
        type: 'STRATEGIES_LIST',
        strategies: strategyRegistry.listStrategies(),
        current: currentStrategyName,
      });
      return true;
    }

    return true;
  }
);
```

---

## 9. 메시지 타입 확장

```typescript
// shared/messages.ts (확장)

// Background → Content
export type ContentMessage =
  | { type: 'SET_STRATEGY'; strategyName: string }
  | { type: 'GET_TRANSLATION_SEGMENTS'; options?: ExtractionOptions }
  | { type: 'APPLY_TRANSLATIONS'; translations: TranslationResult[] }
  | { type: 'RESTORE_ORIGINAL' }
  | { type: 'LIST_STRATEGIES' };

// Content → Background
export type ContentResponse =
  | { type: 'STRATEGY_SET'; strategyName: string }
  | { type: 'TRANSLATION_SEGMENTS'; segments: TranslationSegmentDTO[]; strategyUsed: string }
  | { type: 'TRANSLATIONS_APPLIED'; success: boolean }
  | { type: 'ORIGINAL_RESTORED'; success: boolean }
  | { type: 'STRATEGIES_LIST'; strategies: string[]; current: string }
  | { type: 'ERROR'; error: string };

// DTO (메시지 전송용, 직렬화 가능)
interface TranslationSegmentDTO {
  id: string;
  text: string;
  metadata: {
    tagName: string;
    depth: number;
    index: number;
  };
}
```

---

## 10. 테스트 하네스

```typescript
// content/extraction/__tests__/testHarness.ts

import { strategyRegistry, ExtractionContext } from '../index';
import type { TranslationSegment, TranslationResult } from '../types';

/**
 * 테스트 하네스 - 여러 전략을 동일 입력으로 비교 테스트
 */
class StrategyTestHarness {
  private testHTML: string;
  private results: Map<string, {
    segments: TranslationSegment[];
    extractionTime: number;
    applicationTime: number;
  }> = new Map();

  constructor(testHTML: string) {
    this.testHTML = testHTML;
  }

  /**
   * 모든 등록된 전략으로 테스트 실행
   */
  runAllStrategies(): void {
    const strategies = strategyRegistry.listStrategies();
    for (const name of strategies) {
      this.runStrategy(name);
    }
  }

  /**
   * 특정 전략으로 테스트 실행
   */
  runStrategy(strategyName: string): void {
    // 테스트용 DOM 생성
    const container = document.createElement('div');
    container.innerHTML = this.testHTML;
    document.body.appendChild(container);

    try {
      const strategy = strategyRegistry.create(strategyName, { root: container });
      const context = new ExtractionContext(strategy, { root: container });

      // 추출 시간 측정
      const extractStart = performance.now();
      const segments = context.extract();
      const extractionTime = performance.now() - extractStart;

      // 모의 번역 결과 생성
      const mockResults: TranslationResult[] = segments.map(s => ({
        id: s.id,
        translatedText: `[번역됨] ${s.textToTranslate}`,
      }));

      // 적용 시간 측정
      const applyStart = performance.now();
      context.apply(mockResults);
      const applicationTime = performance.now() - applyStart;

      this.results.set(strategyName, {
        segments,
        extractionTime,
        applicationTime,
      });

      // 정리
      context.cleanup();
    } finally {
      container.remove();
    }
  }

  /**
   * 테스트 결과 비교 리포트 생성
   */
  generateReport(): string {
    let report = '# Strategy Comparison Report\n\n';

    report += '## Summary\n\n';
    report += '| Strategy | Segments | Extraction (ms) | Application (ms) |\n';
    report += '|----------|----------|-----------------|------------------|\n';

    for (const [name, result] of this.results) {
      report += `| ${name} | ${result.segments.length} | ${result.extractionTime.toFixed(2)} | ${result.applicationTime.toFixed(2)} |\n`;
    }

    report += '\n## Segment Details\n\n';

    for (const [name, result] of this.results) {
      report += `### ${name}\n\n`;
      report += '```json\n';
      report += JSON.stringify(
        result.segments.map(s => ({
          id: s.id,
          text: s.textToTranslate.slice(0, 50) + (s.textToTranslate.length > 50 ? '...' : ''),
          placeholders: s.placeholders.length,
          tag: s.metadata.tagName,
        })),
        null,
        2
      );
      report += '\n```\n\n';
    }

    return report;
  }

  /**
   * 특정 케이스에 대한 전략 간 차이점 분석
   */
  analyzeDifferences(): Array<{
    strategyA: string;
    strategyB: string;
    differences: string[];
  }> {
    const strategies = [...this.results.keys()];
    const diffs: Array<{ strategyA: string; strategyB: string; differences: string[] }> = [];

    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const a = this.results.get(strategies[i])!;
        const b = this.results.get(strategies[j])!;

        const differences: string[] = [];

        if (a.segments.length !== b.segments.length) {
          differences.push(`Segment count: ${a.segments.length} vs ${b.segments.length}`);
        }

        // 텍스트 내용 비교
        const textsA = new Set(a.segments.map(s => s.textToTranslate));
        const textsB = new Set(b.segments.map(s => s.textToTranslate));

        const onlyInA = [...textsA].filter(t => !textsB.has(t));
        const onlyInB = [...textsB].filter(t => !textsA.has(t));

        if (onlyInA.length > 0) {
          differences.push(`Only in ${strategies[i]}: ${onlyInA.length} segments`);
        }
        if (onlyInB.length > 0) {
          differences.push(`Only in ${strategies[j]}: ${onlyInB.length} segments`);
        }

        if (differences.length > 0) {
          diffs.push({
            strategyA: strategies[i],
            strategyB: strategies[j],
            differences,
          });
        }
      }
    }

    return diffs;
  }
}

export { StrategyTestHarness };
```

---

## 11. 디렉토리 구조

```
src/content/
├── extraction/
│   ├── index.ts                    # 진입점, 전략 등록
│   ├── types.ts                    # 타입 정의
│   ├── strategy.ts                 # 전략 인터페이스
│   ├── context.ts                  # 실행 컨텍스트
│   ├── registry.ts                 # 전략 레지스트리
│   ├── strategies/
│   │   ├── textNodeStrategy.ts     # 전략 1: Text 노드 기반 (현재)
│   │   ├── blockElementStrategy.ts # 전략 2: 블록 요소 기반
│   │   ├── placeholderStrategy.ts  # 전략 3: Placeholder 기반
│   │   └── index.ts                # 전략 내보내기
│   └── __tests__/
│       ├── testHarness.ts          # 테스트 하네스
│       ├── textNodeStrategy.test.ts
│       ├── blockElementStrategy.test.ts
│       └── placeholderStrategy.test.ts
├── domExtractor.ts                 # (레거시, 점진적 마이그레이션)
├── domReplacer.ts                  # (레거시, 점진적 마이그레이션)
└── index.ts                        # Content Script 진입점
```

---

## 12. 마이그레이션 전략

### Phase 1: 새 인터페이스 도입 (병렬 운영)

```typescript
// content/index.ts - 병렬 운영

// 기존 방식 (레거시)
import { extractTextNodes, getExtractedNodes } from './domExtractor';
import { replaceTextNodes } from './domReplacer';

// 새 방식 (실험)
import { strategyRegistry, ExtractionContext } from './extraction';

// 메시지 타입으로 분기
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 레거시 메시지 (기존 호환)
  if (message.type === 'GET_TEXT_NODES') {
    const texts = extractTextNodes();
    sendResponse({ type: 'TEXT_NODES', texts });
    return true;
  }

  // 새 메시지 (실험용)
  if (message.type === 'GET_TRANSLATION_SEGMENTS') {
    // 새 전략 사용
    // ...
  }

  return true;
});
```

### Phase 2: 점진적 전환

1. 새 인터페이스로 모든 테스트 통과 확인
2. Background에서 새 메시지 타입 사용하도록 변경
3. 레거시 코드 제거

### Phase 3: 전략 최적화

1. 테스트 하네스로 성능 비교
2. 최적 전략 선정
3. 기본 전략으로 설정

---

## 13. 설정을 통한 전략 선택

```typescript
// shared/settings.ts (확장)

interface UserSettings {
  // ... 기존 설정

  /** 추출 전략 */
  extractionStrategy: 'textNode' | 'blockElement' | 'placeholder' | 'auto';

  /** 전략별 세부 옵션 */
  strategyOptions: {
    /** 인라인 코드 처리 */
    inlineCodeHandling: 'exclude' | 'placeholder' | 'include';

    /** 멀티라인 코드블럭 처리 */
    codeBlockHandling: 'exclude' | 'include';

    /** 최소 텍스트 길이 */
    minTextLength: number;

    /** 사용자 정의 제외 선택자 */
    customExcludeSelectors: string[];
  };
}

const defaultSettings: UserSettings = {
  // ... 기존 기본값

  extractionStrategy: 'textNode',  // 안정성 위해 기존 방식 기본값
  strategyOptions: {
    inlineCodeHandling: 'placeholder',
    codeBlockHandling: 'exclude',
    minTextLength: 1,
    customExcludeSelectors: [],
  },
};
```

---

## 14. 설계 요약

| 구성 요소 | 역할 | 주요 메서드 |
|-----------|------|-------------|
| `TranslationSegment` | 번역 단위 데이터 구조 | - |
| `ExtractionStrategy` | 전략 인터페이스 | `extract()`, `apply()`, `restore()` |
| `ExtractionContext` | 전략 실행/관리 | `setStrategy()`, `extract()`, `apply()` |
| `StrategyRegistry` | 전략 등록/생성 | `register()`, `create()`, `setDefault()` |
| `StrategyTestHarness` | 테스트/비교 도구 | `runAllStrategies()`, `generateReport()` |

---

## 15. 이점 정리

1. **교체 용이성**: 한 줄로 전략 교체 (`context.setStrategy(newStrategy)`)
2. **테스트 용이성**: 각 전략을 독립적으로 단위 테스트 가능
3. **비교 분석**: 테스트 하네스로 전략 간 성능/정확도 비교
4. **점진적 마이그레이션**: 기존 로직 유지하며 새 로직 실험
5. **설정 기반 선택**: 사용자/개발자가 설정으로 전략 선택 가능
6. **확장성**: 새 전략 추가 시 인터페이스만 구현하면 됨
