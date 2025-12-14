# domExtractor 번역 로직 진단 보고서

## 1. 현재 상태 분석

### 1.1 현재 domExtractor 동작 방식

```typescript
// domExtractor.ts (현재)
const EXCLUDED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE",
  "TEXTAREA", "INPUT", "SVG", "MATH",
]);

export function extractTextNodes(): string[] {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    { acceptNode(node) { /* ... */ } }
  );
  // 개별 Text 노드를 순회하며 추출
}
```

**현재 동작:**
1. `TreeWalker`로 `document.body` 내 모든 **Text 노드**를 개별 순회
2. `EXCLUDED_TAGS`에 `CODE`가 포함되어 **모든 `<code>` 태그 내용 제외**
3. 각 Text 노드를 **독립적인 번역 단위**로 처리

### 1.2 문제 상황

#### 문제 1: 인라인 요소로 인한 문장 분리

```html
<p>Hello <strong>world</strong>!</p>
```

**현재 결과:** `["Hello ", "world", "!"]` (3개의 독립 텍스트)
**기대 결과:** `"Hello world!"` (1개의 문장)

#### 문제 2: 인라인 코드가 포함된 문장 처리 불가

```html
<p>There is a flag <code>channelTransacted</code> which, if <code>true</code>, tells the framework...</p>
```

**현재 결과:**
- `["There is a flag ", " which, if ", ", tells the framework..."]`
- `<code>` 내용은 완전히 누락

**기대 결과:**
- 전체 문장이 하나의 번역 단위
- `<code>` 내용은 번역하지 않고 그대로 유지

#### 문제 3: 멀티라인 코드블럭 구분 불가

```html
<!-- 번역 제외 대상 (멀티라인 코드블럭) -->
<pre><code class="language-java">
@Transactional
public void doSomething() {
    String incoming = rabbitTemplate.receiveAndConvert();
}
</code></pre>

<!-- 번역 포함 대상 (인라인 코드) -->
<p>The <code>RabbitTemplate</code> is a helper class.</p>
```

현재 로직은 **두 경우를 동일하게 처리**하여 인라인 코드도 제외됨.

---

## 2. 문제의 근본 원인

### 2.1 번역 단위(Translation Unit) 정의 부재

현재 시스템은 **Text 노드**를 번역 단위로 사용하지만, 이는 부적절함:

| 번역 단위 | 장점 | 단점 |
|-----------|------|------|
| Text 노드 | 구현 단순 | 문장 분리, 문맥 손실 |
| 블록 요소 (p, div, li) | 문맥 보존 | HTML 구조 처리 필요 |
| 문장 (NLP 기반) | 정확한 문맥 | 구현 복잡, 성능 비용 |

### 2.2 인라인 vs 블록 코드 구분 기준 부재

HTML에서 인라인 코드와 멀티라인 코드블럭을 구분하는 일반적인 패턴:

```
인라인 코드:     <code>...</code> (부모가 <pre>가 아님)
멀티라인 코드:   <pre><code>...</code></pre>
                 또는 <pre>...</pre>
```

### 2.3 현재 인터페이스의 한계

```typescript
// 현재 인터페이스
type ContentResponse = { type: 'TEXT_NODES'; texts: string[] };
```

**한계점:**
- 텍스트만 전달하므로 **HTML 구조 정보 손실**
- 번역 결과를 원본 위치에 정확히 매핑하기 어려움
- 인라인 요소 내 텍스트 그룹핑 불가능

---

## 3. 해결 방안 검토

### 방안 A: 블록 레벨 요소 기반 추출 (권장)

**개념:** 블록 레벨 요소(`<p>`, `<div>`, `<li>` 등)를 번역 단위로 사용

**장점:**
- 문장 분리 문제 해결
- 구현 상대적으로 단순
- 문맥 보존

**단점:**
- 인라인 요소(`<strong>`, `<em>`) 구조 손실 가능
- 인라인 코드 처리 별도 로직 필요

**구현 아이디어:**

```typescript
interface TranslationUnit {
  id: string;                    // 고유 식별자
  element: Element;              // 원본 요소 참조
  originalHTML: string;          // 원본 HTML (구조 보존용)
  textContent: string;           // 번역 대상 텍스트
  inlineCodePlaceholders: Map<string, string>;  // 인라인 코드 placeholder
}

function extractTranslationUnits(): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  const blockElements = document.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, td, th');

  for (const element of blockElements) {
    if (shouldSkipElement(element)) continue;

    const unit = createTranslationUnit(element);
    units.push(unit);
  }

  return units;
}
```

---

### 방안 B: Placeholder 기반 HTML 구조 보존 (고급)

**개념:** 인라인 요소를 placeholder로 치환 후 번역, 복원

**예시:**

```
원본:     "There is a flag <code>channelTransacted</code> which tells..."
변환:     "There is a flag {{CODE_1}} which tells..."
번역:     "{{CODE_1}}라는 플래그가 있습니다..."
복원:     "<code>channelTransacted</code>라는 플래그가 있습니다..."
```

**장점:**
- 모든 인라인 요소 구조 완벽 보존
- 정확한 번역 결과

**단점:**
- 구현 복잡도 높음
- Placeholder 충돌 가능성 관리 필요
- 번역 API가 placeholder를 변형할 가능성

**구현 아이디어:**

```typescript
interface PlaceholderMap {
  placeholder: string;   // e.g., "{{INLINE_1}}"
  originalHTML: string;  // e.g., "<code>channelTransacted</code>"
  type: 'code' | 'link' | 'emphasis' | 'other';
}

function preprocessHTML(html: string): {
  processedText: string;
  placeholders: PlaceholderMap[];
} {
  const placeholders: PlaceholderMap[] = [];
  let counter = 0;

  // 인라인 코드 치환 (멀티라인 코드블럭이 아닌 경우만)
  const processedText = html.replace(
    /<code(?![^>]*class=["']language-)[^>]*>([^<]+)<\/code>/gi,
    (match) => {
      const placeholder = `{{CODE_${++counter}}}`;
      placeholders.push({ placeholder, originalHTML: match, type: 'code' });
      return placeholder;
    }
  );

  return { processedText, placeholders };
}

function postprocessHTML(translatedText: string, placeholders: PlaceholderMap[]): string {
  let result = translatedText;
  for (const { placeholder, originalHTML } of placeholders) {
    result = result.replace(placeholder, originalHTML);
  }
  return result;
}
```

---

### 방안 C: 텍스트 노드 그룹핑 (중간 복잡도)

**개념:** 같은 블록 요소 내의 텍스트 노드들을 그룹으로 묶어 처리

**장점:**
- 현재 구조 유지하면서 점진적 개선 가능
- 기존 `extractedNodes` 배열 활용 가능

**단점:**
- 번역 결과를 개별 노드에 분배하는 로직 복잡
- 번역으로 인한 텍스트 길이 변화 대응 어려움

**구현 아이디어:**

```typescript
interface TextNodeGroup {
  blockParent: Element;         // 공통 블록 부모 (p, div 등)
  nodes: Text[];                // 그룹 내 텍스트 노드들
  combinedText: string;         // 합쳐진 텍스트
  nodeOffsets: number[];        // 각 노드의 시작 위치
}

function groupTextNodes(nodes: Text[]): TextNodeGroup[] {
  const groups: TextNodeGroup[] = [];
  // 같은 블록 부모를 가진 노드들을 그룹화
  // ...
  return groups;
}
```

---

### 방안 D: 하이브리드 접근 (권장)

**개념:** 방안 A + B 조합

1. **블록 요소 기반 번역 단위** 사용 (방안 A)
2. **인라인 코드에 Placeholder 적용** (방안 B의 일부)
3. **멀티라인 코드블럭 완전 제외**

**장점:**
- 대부분의 케이스 커버
- 구현 복잡도 적절
- 점진적 개선 가능

**구현 우선순위:**
1. 먼저 인라인 vs 멀티라인 코드블럭 구분 로직 추가
2. 블록 요소 기반 추출로 전환
3. 인라인 코드 placeholder 처리 추가

---

## 4. 인터페이스 변경 제안

### 4.1 현재 인터페이스

```typescript
// shared/messages.ts
type ContentMessage =
  | { type: 'GET_TEXT_NODES' }
  | { type: 'REPLACE_TEXT'; replacements: Array<{ index: number; text: string }> };

type ContentResponse =
  | { type: 'TEXT_NODES'; texts: string[] }
  | { type: 'REPLACE_DONE' };
```

### 4.2 제안 인터페이스

```typescript
// shared/messages.ts (개선)

interface TranslationSegment {
  id: string;                    // 고유 식별자 (UUID 또는 data-translate-id)
  text: string;                  // 번역 대상 텍스트 (placeholder 적용된)
  preservedElements: string[];   // 보존해야 할 인라인 요소들 (복원용)
}

type ContentMessage =
  | { type: 'GET_TRANSLATION_SEGMENTS' }
  | { type: 'APPLY_TRANSLATIONS'; translations: Array<{ id: string; translatedText: string }> };

type ContentResponse =
  | { type: 'TRANSLATION_SEGMENTS'; segments: TranslationSegment[] }
  | { type: 'TRANSLATIONS_APPLIED'; success: boolean };
```

### 4.3 domExtractor 인터페이스 변경

```typescript
// content/domExtractor.ts (개선)

interface ExtractionOptions {
  excludeMultilineCode: boolean;  // 멀티라인 코드블럭 제외 (default: true)
  preserveInlineCode: boolean;    // 인라인 코드는 placeholder로 보존 (default: true)
  blockElements: string[];        // 번역 단위로 사용할 블록 요소들
}

interface TranslationSegment {
  id: string;
  element: Element;
  originalHTML: string;
  textForTranslation: string;
  placeholders: Map<string, string>;  // placeholder -> originalHTML
}

export function extractTranslationSegments(
  options?: Partial<ExtractionOptions>
): TranslationSegment[];

export function applyTranslations(
  translations: Map<string, string>  // id -> translatedText
): void;
```

---

## 5. 인라인 코드 vs 멀티라인 코드블럭 구분 전략

### 5.1 구분 기준

| 유형 | HTML 패턴 | 처리 방식 |
|------|-----------|-----------|
| 멀티라인 코드블럭 | `<pre>`, `<pre><code>` | 완전 제외 |
| 인라인 코드 | `<code>` (부모가 `<pre>`가 아님) | Placeholder로 보존 |
| 하이라이팅된 코드블럭 | `<code class="language-*">`, `<code class="hljs">` | 완전 제외 |

### 5.2 구현

```typescript
function isMultilineCodeBlock(element: Element): boolean {
  // 1. <pre> 태그 자체
  if (element.tagName === 'PRE') return true;

  // 2. <pre> 내부의 <code>
  if (element.tagName === 'CODE' && element.closest('pre')) return true;

  // 3. 코드 하이라이팅 클래스가 있는 <code>
  if (element.tagName === 'CODE') {
    const classList = element.classList;
    if (classList.contains('hljs') ||
        [...classList].some(c => c.startsWith('language-'))) {
      return true;
    }
  }

  return false;
}

function isInlineCode(element: Element): boolean {
  return element.tagName === 'CODE' && !isMultilineCodeBlock(element);
}
```

---

## 6. 구현 로드맵

### Phase 1: 기반 작업 (우선순위 높음)

1. **인라인/멀티라인 코드 구분 로직 추가**
   - `isMultilineCodeBlock()` 함수 구현
   - `EXCLUDED_TAGS`에서 `CODE` 제거
   - `<pre>` 및 조건부 `<code>` 제외 로직으로 변경

2. **블록 요소 기반 추출로 전환**
   - `extractTextNodes()` → `extractTranslationSegments()`
   - 블록 요소 단위 추출
   - 기존 Text 노드 기반 로직 제거

### Phase 2: Placeholder 시스템 (우선순위 중간)

3. **인라인 코드 Placeholder 처리**
   - `preprocessHTML()` / `postprocessHTML()` 구현
   - Placeholder 매핑 관리

4. **인터페이스 변경**
   - `shared/messages.ts` 타입 업데이트
   - Background/Content 통신 로직 수정

### Phase 3: 고급 기능 (우선순위 낮음)

5. **기타 인라인 요소 지원**
   - `<strong>`, `<em>`, `<a>` 등 처리
   - 복잡한 중첩 구조 대응

6. **원문 복원 기능**
   - `originalHTML` 저장
   - 복원 UI 및 로직

---

## 7. 예상 영향 분석

### 7.1 Breaking Changes

| 변경 사항 | 영향 범위 | 마이그레이션 |
|-----------|-----------|--------------|
| 메시지 타입 변경 | Background, Content | 인터페이스 동시 업데이트 필요 |
| 추출 함수 시그니처 변경 | Content Script | 호출부 수정 |
| 교체 함수 시그니처 변경 | Content Script | 호출부 수정 |

### 7.2 테스트 케이스

```typescript
// 테스트해야 할 케이스
const testCases = [
  // 기본 케이스
  '<p>Hello world</p>',

  // 인라인 요소
  '<p>Hello <strong>world</strong>!</p>',

  // 인라인 코드
  '<p>Use <code>npm install</code> to install.</p>',

  // 멀티라인 코드블럭
  '<pre><code>const x = 1;\nconst y = 2;</code></pre>',

  // 하이라이팅된 코드블럭
  '<pre><code class="language-java">public void main() {}</code></pre>',

  // 혼합
  '<p>The <code>SimpleMessageListenerContainer</code> has a flag <code>channelTransacted</code>.</p>',

  // 복잡한 중첩
  '<p>See <a href="#"><code>RabbitTemplate</code></a> for details.</p>',
];
```

---

## 8. 결론 및 권장 사항

### 8.1 핵심 문제

현재 domExtractor는 **Text 노드 단위**로 추출하여 문장이 분리되고, **모든 `<code>` 태그**를 제외하여 인라인 코드 처리가 불가능함.

### 8.2 권장 해결책

**하이브리드 접근 (방안 D)** 채택:

1. **블록 요소 기반 번역 단위** 전환
2. **인라인/멀티라인 코드 구분** 로직 추가
3. **인라인 코드 Placeholder** 시스템 도입

### 8.3 구현 우선순위

1. (높음) 인라인/멀티라인 코드 구분 → `EXCLUDED_TAGS` 로직 개선
2. (높음) 블록 요소 기반 추출 → `extractTranslationSegments()` 구현
3. (중간) Placeholder 시스템 → 인라인 코드 보존
4. (낮음) 인터페이스 정규화 → 메시지 타입 개선

### 8.4 예상 작업량

| 항목 | 예상 복잡도 | 영향 범위 |
|------|-------------|-----------|
| 코드 구분 로직 | 낮음 | domExtractor.ts |
| 블록 기반 추출 | 중간 | domExtractor.ts, domReplacer.ts |
| Placeholder 시스템 | 중간 | domExtractor.ts, 새 유틸리티 |
| 인터페이스 변경 | 중간 | messages.ts, messageHandler.ts, content/index.ts |

---

## 부록: example.html 분석

example.html (Spring AMQP 문서)에서 발견된 패턴:

### 인라인 코드 (번역 포함 + 코드 보존)
```html
<p>In both the <code>RabbitTemplate</code> and <code>SimpleMessageListenerContainer</code>,
there is a flag <code>channelTransacted</code> which, if <code>true</code>, tells the framework...</p>
```

### 멀티라인 코드블럭 (번역 제외)
```html
<pre class="highlightjs highlight">
  <code class="language-java hljs" data-lang="java">
    @Transactional
    public void doSomething() {
        String incoming = rabbitTemplate.receiveAndConvert();
        // ...
    }
  </code>
</pre>
```

### 구분 포인트
- 멀티라인: `<pre>` 태그로 감싸짐, `class="language-*"` 또는 `class="hljs"` 존재
- 인라인: 단독 `<code>` 태그, 짧은 식별자/키워드

---

## 9. 관련 문서

- **[EXTRACTION_STRATEGY_INTERFACE.md](PLAN_EXTRACTION_STRATEGY.md)**: 범용 추출 인터페이스 설계 (Strategy Pattern)
  - 다양한 추출 로직 실험을 위한 플러그인 아키텍처
  - 전략별 구현 예시 (Text 노드, 블록 요소, Placeholder)
  - 테스트 하네스 및 마이그레이션 전략
