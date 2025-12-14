# DOM Extractor 개선 계획 v2

> **이전 문서 검토 결과 반영**
> - [PLAN_REFACTOR_DOM_EXTRACTOR.md](PLAN_REFACTOR_DOM_EXTRACTOR.md): 진단 보고서 (문제 정의)
> - [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md): Strategy Pattern 설계 (Phase 3 참조용)

---

## 1. 계획 수정 배경

### 1.1 기존 계획의 문제점

PLAN_EXTRACTION_STRATEGY는 Strategy Pattern + Registry + Context + TestHarness를 포함한 범용 아키텍처를 제안했으나:

| 문제 | 설명 |
|------|------|
| YAGNI 위반 | 현재 전략이 1개뿐인데 교체 인프라 구축은 시기상조 |
| 과도한 추상화 | ~1000줄 설계로 MVP 복잡도 증가 |
| 핵심 문제 우회 | 패턴 설계에 집중하여 실제 문제 해결 지연 |

### 1.2 수정된 접근법

**"동작하는 코드 먼저, 패턴 나중"**

```
AS-IS: 설계 문서 → Strategy Pattern 구현 → 전략 실험
TO-BE: 핵심 문제 해결 → 동작 검증 → 필요시 패턴 도입
```

---

## 2. 핵심 문제 정의

### 2.1 현재 상태

```typescript
// domExtractor.ts (현재)
const EXCLUDED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", // ← CODE가 포함됨
  "TEXTAREA", "INPUT", "SVG", "MATH",
]);
```

- Text 노드 단위 추출 → 문장 분리 발생
- 모든 `<code>` 제외 → 인라인 코드도 누락

### 2.2 해결해야 할 문제

| 문제 | 입력 | 현재 결과 | 기대 결과 |
|------|------|-----------|-----------|
| 문장 분리 | `<p>Hello <strong>world</strong>!</p>` | `["Hello ", "world", "!"]` | `"Hello world!"` |
| 인라인 코드 누락 | `<p>Use <code>npm</code> to install</p>` | `["Use ", " to install"]` | `"Use {{CODE_0}} to install"` + placeholder |
| 멀티라인 코드 포함 | `<pre><code>...</code></pre>` | 제외됨 ✅ | 제외 유지 ✅ |

---

## 3. 구현 계획

### Phase 1: 핵심 문제 해결 (즉시)

#### 3.1 인라인/멀티라인 코드 구분

```typescript
// content/domExtractor.ts에 추가

/**
 * 멀티라인 코드블럭 여부 판별
 * - <pre> 태그
 * - <pre> 내부의 <code>
 * - language-* 또는 hljs 클래스를 가진 <code>
 */
function isMultilineCodeBlock(element: Element): boolean {
  if (element.tagName === 'PRE') return true;

  if (element.tagName === 'CODE') {
    // <pre> 내부의 <code>
    if (element.closest('pre')) return true;

    // 코드 하이라이팅 클래스
    const classList = element.classList;
    if (classList.contains('hljs')) return true;
    if ([...classList].some(c => c.startsWith('language-'))) return true;
  }

  return false;
}

/**
 * 인라인 코드 여부 판별
 */
function isInlineCode(element: Element): boolean {
  return element.tagName === 'CODE' && !isMultilineCodeBlock(element);
}
```

#### 3.2 블록 요소 기반 추출

```typescript
// content/domExtractor.ts 대체

interface TranslationUnit {
  id: string;
  element: Element;
  originalHTML: string;
  textForTranslation: string;
  placeholders: PlaceholderMap[];
}

interface PlaceholderMap {
  token: string;      // "{{CODE_0}}"
  html: string;       // "<code>npm</code>"
}

const BLOCK_SELECTORS = [
  'p', 'li', 'td', 'th', 'dt', 'dd',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'figcaption',
];

const SKIP_SELECTORS = [
  'script', 'style', 'noscript', 'pre',
  'textarea', 'input', 'svg', 'math',
  '[data-no-translate]',
];

// 추출된 유닛 저장 (교체 시 사용)
let extractedUnits: TranslationUnit[] = [];

/**
 * 블록 요소 기반 번역 단위 추출
 */
export function extractTranslationUnits(): TranslationUnit[] {
  extractedUnits = [];

  const blocks = document.querySelectorAll(BLOCK_SELECTORS.join(', '));
  let index = 0;

  for (const block of blocks) {
    // 제외 대상 확인
    if (shouldSkip(block)) continue;

    // 중첩된 블록 제외 (부모가 이미 처리됨)
    if (hasBlockParent(block, blocks)) continue;

    const { text, placeholders } = processInlineElements(block, index);

    // 빈 텍스트 제외
    if (!text.trim()) continue;

    extractedUnits.push({
      id: `unit-${index}`,
      element: block,
      originalHTML: block.innerHTML,
      textForTranslation: text,
      placeholders,
    });

    index++;
  }

  return extractedUnits;
}

function shouldSkip(element: Element): boolean {
  return SKIP_SELECTORS.some(sel => element.closest(sel) !== null);
}

function hasBlockParent(element: Element, allBlocks: NodeListOf<Element>): boolean {
  for (const block of allBlocks) {
    if (block !== element && block.contains(element)) {
      return true;
    }
  }
  return false;
}
```

#### 3.3 인라인 코드 Placeholder 처리

```typescript
/**
 * 인라인 요소를 placeholder로 치환
 */
function processInlineElements(
  block: Element,
  blockIndex: number
): { text: string; placeholders: PlaceholderMap[] } {
  const placeholders: PlaceholderMap[] = [];
  let html = block.innerHTML;
  let counter = 0;

  // 인라인 <code> 치환 (멀티라인 코드블럭 제외)
  // 패턴: <code>...</code> (class="language-*" 또는 hljs가 없는 것)
  html = html.replace(
    /<code(?![^>]*(?:class=["'][^"']*(?:language-|hljs)))[^>]*>([\s\S]*?)<\/code>/gi,
    (match) => {
      const token = `{{CODE_${blockIndex}_${counter++}}}`;
      placeholders.push({ token, html: match });
      return token;
    }
  );

  // HTML 태그 제거하여 순수 텍스트 추출
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const text = tempDiv.textContent || '';

  return { text, placeholders };
}
```

#### 3.4 번역 결과 적용

```typescript
/**
 * 번역 결과를 DOM에 적용
 */
export function applyTranslations(
  translations: Array<{ id: string; translatedText: string }>
): void {
  for (const { id, translatedText } of translations) {
    const unit = extractedUnits.find(u => u.id === id);
    if (!unit) continue;

    // Placeholder 복원
    let finalHTML = translatedText;
    for (const { token, html } of unit.placeholders) {
      finalHTML = finalHTML.replace(token, html);
    }

    // DOM 교체
    unit.element.innerHTML = finalHTML;
  }
}

/**
 * 원문 복원
 */
export function restoreOriginal(): void {
  for (const unit of extractedUnits) {
    unit.element.innerHTML = unit.originalHTML;
  }
}

/**
 * 번역 대상 텍스트 배열 반환 (Background 전송용)
 */
export function getTextsForTranslation(): string[] {
  return extractedUnits.map(u => u.textForTranslation);
}

/**
 * 추출된 유닛 반환
 */
export function getExtractedUnits(): TranslationUnit[] {
  return extractedUnits;
}
```

#### 3.5 메시지 타입 업데이트

```typescript
// shared/messages.ts 수정

// Background → Content
export type ContentMessage =
  | { type: 'GET_TRANSLATION_UNITS' }
  | { type: 'APPLY_TRANSLATIONS'; translations: Array<{ id: string; translatedText: string }> }
  | { type: 'RESTORE_ORIGINAL' }
  // 레거시 호환 (점진적 마이그레이션)
  | { type: 'GET_TEXT_NODES' }
  | { type: 'REPLACE_TEXT'; replacements: Array<{ index: number; text: string }> };

// Content → Background
export type ContentResponse =
  | { type: 'TRANSLATION_UNITS'; units: Array<{ id: string; text: string }> }
  | { type: 'TRANSLATIONS_APPLIED'; success: boolean }
  | { type: 'ORIGINAL_RESTORED'; success: boolean }
  // 레거시 호환
  | { type: 'TEXT_NODES'; texts: string[] }
  | { type: 'REPLACE_DONE' };
```

---

### Phase 2: 인터페이스 정규화 (필요시)

Phase 1 완료 후 안정화되면:

1. **레거시 메시지 타입 제거**
   - `GET_TEXT_NODES`, `REPLACE_TEXT` 제거
   - `TEXT_NODES`, `REPLACE_DONE` 제거

2. **추가 인라인 요소 지원**
   - `<a>` 링크 보존
   - `<strong>`, `<em>` 강조 보존

3. **에러 처리 강화**
   - Placeholder 복원 실패 시 원문 유지
   - 번역 실패 시 부분 적용

---

### Phase 3: Strategy Pattern 도입 (확장시)

**도입 조건:**
- 실제로 여러 추출 전략이 필요해졌을 때
- 사이트별로 다른 전략이 필요함이 검증되었을 때

**참조 문서:** [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md)
- ExtractionStrategy 인터페이스
- StrategyRegistry 싱글톤
- ExtractionContext 실행기
- StrategyTestHarness 비교 도구

---

## 4. 파일 변경 계획

### 4.1 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `content/domExtractor.ts` | 블록 기반 추출 로직으로 전면 교체 |
| `content/domReplacer.ts` | `applyTranslations()` 통합 후 삭제 가능 |
| `content/index.ts` | 새 메시지 타입 핸들러 추가 |
| `shared/messages.ts` | 새 메시지 타입 추가 (레거시 호환 유지) |
| `background/messageHandler.ts` | 새 메시지 타입 처리 |

### 4.2 디렉토리 구조 (Phase 1 완료 후)

```
src/content/
├── index.ts              # 진입점, 메시지 리스너
├── domExtractor.ts       # 블록 기반 추출 + placeholder + 적용 + 복원
└── (domReplacer.ts)      # 삭제 또는 domExtractor에 통합
```

---

## 5. 테스트 케이스

### 5.1 핵심 테스트

```typescript
describe('extractTranslationUnits', () => {
  it('블록 요소를 하나의 번역 단위로 추출', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong>!</p>';
    const units = extractTranslationUnits();
    expect(units).toHaveLength(1);
    expect(units[0].textForTranslation).toBe('Hello world!');
  });

  it('인라인 코드를 placeholder로 치환', () => {
    document.body.innerHTML = '<p>Use <code>npm</code> to install</p>';
    const units = extractTranslationUnits();
    expect(units[0].textForTranslation).toMatch(/Use \{\{CODE_\d+_\d+\}\} to install/);
    expect(units[0].placeholders).toHaveLength(1);
  });

  it('멀티라인 코드블럭은 제외', () => {
    document.body.innerHTML = '<pre><code>const x = 1;</code></pre><p>Hello</p>';
    const units = extractTranslationUnits();
    expect(units).toHaveLength(1);
    expect(units[0].textForTranslation).toBe('Hello');
  });

  it('language-* 클래스 코드블럭은 제외', () => {
    document.body.innerHTML = '<code class="language-js">const x = 1;</code><p>Hello</p>';
    const units = extractTranslationUnits();
    expect(units).toHaveLength(1);
  });
});

describe('applyTranslations', () => {
  it('placeholder를 복원하여 적용', () => {
    document.body.innerHTML = '<p>Use <code>npm</code> to install</p>';
    extractTranslationUnits();

    applyTranslations([{
      id: 'unit-0',
      translatedText: '{{CODE_0_0}}을 사용하여 설치하세요'
    }]);

    expect(document.body.innerHTML).toContain('<code>npm</code>');
    expect(document.body.innerHTML).toContain('설치하세요');
  });
});

describe('restoreOriginal', () => {
  it('원문으로 복원', () => {
    const originalHTML = '<p>Use <code>npm</code> to install</p>';
    document.body.innerHTML = originalHTML;

    extractTranslationUnits();
    applyTranslations([{ id: 'unit-0', translatedText: '번역됨' }]);
    restoreOriginal();

    expect(document.body.innerHTML).toBe(originalHTML);
  });
});
```

### 5.2 엣지 케이스 테스트

```typescript
describe('edge cases', () => {
  it('중첩된 블록 요소는 상위만 추출', () => {
    document.body.innerHTML = '<div><p>Inner</p></div>';
    const units = extractTranslationUnits();
    // <p>만 추출 (가장 구체적인 블록)
  });

  it('빈 블록은 제외', () => {
    document.body.innerHTML = '<p>   </p><p>Hello</p>';
    const units = extractTranslationUnits();
    expect(units).toHaveLength(1);
  });

  it('복잡한 인라인 코드 패턴', () => {
    document.body.innerHTML = `
      <p>The <code>RabbitTemplate</code> has a flag <code>channelTransacted</code>.</p>
    `;
    const units = extractTranslationUnits();
    expect(units[0].placeholders).toHaveLength(2);
  });
});
```

---

## 6. 마이그레이션 전략

### 6.1 점진적 전환

```typescript
// content/index.ts

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 새 메시지 타입 (우선)
  if (message.type === 'GET_TRANSLATION_UNITS') {
    const units = extractTranslationUnits();
    sendResponse({
      type: 'TRANSLATION_UNITS',
      units: units.map(u => ({ id: u.id, text: u.textForTranslation })),
    });
    return true;
  }

  if (message.type === 'APPLY_TRANSLATIONS') {
    applyTranslations(message.translations);
    sendResponse({ type: 'TRANSLATIONS_APPLIED', success: true });
    return true;
  }

  // 레거시 메시지 타입 (호환성 유지)
  if (message.type === 'GET_TEXT_NODES') {
    // 기존 로직 또는 새 로직으로 래핑
    const units = extractTranslationUnits();
    sendResponse({ type: 'TEXT_NODES', texts: units.map(u => u.textForTranslation) });
    return true;
  }

  // ...
});
```

### 6.2 전환 완료 후

1. Background에서 새 메시지 타입 사용하도록 변경
2. 레거시 메시지 타입 제거
3. `domReplacer.ts` 삭제

---

## 7. 체크리스트

### Phase 1 완료 조건

- [x] `isMultilineCodeBlock()` 구현
- [x] `extractTranslationUnits()` 구현
- [x] `processInlineElements()` 구현 (placeholder 처리)
- [x] `applyTranslations()` 구현
- [x] `restoreOriginal()` 구현
- [x] 새 메시지 타입 추가
- [x] Content Script 메시지 핸들러 수정
- [x] Background 메시지 핸들러 수정
- [x] 핵심 테스트 케이스 통과
- [x] example.html에서 동작 검증

### Phase 2 완료 조건

- [ ] 레거시 메시지 타입 제거
- [ ] 추가 인라인 요소 지원 (`<a>`, `<strong>`, `<em>`)
- [ ] 에러 처리 강화

### Phase 3 진입 조건

- [ ] 다른 추출 전략이 실제로 필요해짐
- [ ] 사이트별 전략 분기 요구사항 발생
- [ ] PLAN_EXTRACTION_STRATEGY.md 참조하여 구현

---

## 8. 참고 문서

- [PLAN_REFACTOR_DOM_EXTRACTOR.md](PLAN_REFACTOR_DOM_EXTRACTOR.md): 문제 진단 및 해결 방안 상세
- [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md): Strategy Pattern 설계 (Phase 3 참조)
