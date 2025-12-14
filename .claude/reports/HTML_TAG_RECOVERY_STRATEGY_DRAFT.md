# HTML 태그 검증 및 복구 전략 계획서

> **문서 버전**: 1.0
> **작성일**: 2024-12-15
> **상태**: 계획 단계

---

## 1. 요약 (Executive Summary)

### 1.1 문제 정의

HanTranslate.ai는 웹 페이지의 블록 요소에서 `innerHTML`을 추출하여 인라인 태그(`<strong>`, `<em>`, `<code>`, `<a>` 등)를 포함한 HTML 문자열을 Chrome Translator API에 전달합니다. Translator API는 **짧은 문자열에서는 HTML 태그를 보존**하지만, **긴 문자열에서는 태그를 손실하거나 변형**시킬 수 있습니다.

### 1.2 영향 범위

| 시나리오 | 입력 | Translator API 출력 (예상) | 문제점 |
|----------|------|---------------------------|--------|
| 정상 | `<p>Hello <strong>world</strong>!</p>` | `안녕 <strong>세계</strong>!` | 없음 |
| 태그 누락 | `<p>This is a <code>very long code example</code> in text...</p>` | `이것은 텍스트 내의 <code>매우 긴 코드 예시입니다...` | `</code>` 누락 |
| 태그 중첩 오류 | `<p>A <strong>B <em>C</em></strong> D</p>` | `A <strong>B <em>C</strong></em> D` | 중첩 순서 오류 |
| 완전 손실 | `<p>Use <a href="...">this link</a></p>` | `이 링크를 사용하세요` | 태그 완전 제거 |
| 대소문자 변형 | `<p>The <code>String</code> type</p>` | `<code>string</code> 타입` | 코드 대소문자 변경 |
| 여러 단어 코드 | `<p>Run <code>npm install lodash</code></p>` | `<code>npm install lodash를 실행하세요` | 닫는 태그 위치 오류 |

### 1.3 해결 목표

1. **검증**: 번역 결과의 HTML 태그가 올바르게 열고 닫혔는지 검사
2. **복구**: 손상된 태그 구조를 가능한 한 원래 의도에 맞게 복원
3. **폴백**: 복구 불가능 시 안전하게 처리 (원문 유지 또는 태그 제거)

---

## 2. 기술적 배경

### 2.1 현재 아키텍처

```
┌─────────────────┐     innerHTML      ┌─────────────────┐
│  DOM Element    │ ─────────────────▶ │  extractedHTML  │
│  <p>A <b>B</b></p>│                    │  "A <b>B</b>"   │
└─────────────────┘                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ Translator API  │
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ translatedHTML  │
                                    │ "가 <b>나</b>"   │ ← 정상
                                    │ "가 <b>나"       │ ← 손상
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ 검증 & 복구     │ ← NEW
                                    └─────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ DOM.innerHTML   │
                                    └─────────────────┘
```

### 2.2 관련 코드 위치

| 파일 | 함수 | 역할 |
|------|------|------|
| `src/content/domExtractor.ts` | `extractTranslatableContents()` | 블록 요소의 innerHTML 추출 |
| `src/background/translator.ts` | `translate()` | Translator API 호출 |
| `src/content/domReplacer.ts` | `replaceTextNodes()` | 번역 결과를 DOM에 적용 |

### 2.3 인라인 태그 분류

```typescript
// 번역 시 보존이 필요한 인라인 태그
const INLINE_TAGS = {
  // 의미 보존 필수 (번역 불가 콘텐츠)
  untranslatable: ['code', 'kbd', 'samp', 'var'],

  // 스타일링 (번역 가능, 구조 보존)
  styling: ['strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup'],

  // 링크 (href 보존 필수)
  links: ['a'],

  // 기타
  misc: ['span', 'abbr', 'cite', 'q', 'dfn', 'time'],
};
```

---

## 3. HTML 태그 검증 로직

### 3.1 검증 목표

번역된 HTML 문자열이 **Well-formed**한지 검사합니다:

1. 모든 여는 태그에 대응하는 닫는 태그가 존재
2. 태그가 올바른 순서로 중첩됨 (LIFO)
3. 자기 닫힘 태그(`<br/>`, `<img/>`)는 검증에서 제외

### 3.2 검증 알고리즘

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: TagError[];
  tagStack: string[];  // 복구 시 활용
}

interface TagError {
  type: 'unclosed' | 'unexpected_close' | 'mismatch';
  tag: string;
  position: number;
  expected?: string;
}

function validateHTML(html: string): ValidationResult {
  const tagStack: string[] = [];
  const errors: TagError[] = [];

  // 자기 닫힘 태그 (검증 제외)
  const VOID_ELEMENTS = new Set([
    'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'
  ]);

  // 태그 매칭 정규식
  const TAG_REGEX = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;

  let match;
  while ((match = TAG_REGEX.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const position = match.index;

    // 자기 닫힘 태그 스킵
    if (VOID_ELEMENTS.has(tagName) || fullTag.endsWith('/>')) {
      continue;
    }

    const isClosing = fullTag.startsWith('</');

    if (isClosing) {
      // 닫는 태그
      if (tagStack.length === 0) {
        errors.push({ type: 'unexpected_close', tag: tagName, position });
      } else {
        const expected = tagStack.pop()!;
        if (expected !== tagName) {
          errors.push({ type: 'mismatch', tag: tagName, position, expected });
          // 스택 복구: expected를 다시 push하거나, tagName이 스택에 있으면 그까지 pop
          const stackIndex = tagStack.lastIndexOf(tagName);
          if (stackIndex !== -1) {
            // tagName까지의 태그들은 unclosed
            while (tagStack.length > stackIndex) {
              const unclosed = tagStack.pop()!;
              errors.push({ type: 'unclosed', tag: unclosed, position });
            }
            tagStack.pop(); // tagName 제거
          } else {
            // tagName이 스택에 없으면 unexpected_close
            tagStack.push(expected); // 원래 expected 복구
          }
        }
      }
    } else {
      // 여는 태그
      tagStack.push(tagName);
    }
  }

  // 스택에 남은 태그는 모두 unclosed
  while (tagStack.length > 0) {
    const unclosed = tagStack.pop()!;
    errors.push({ type: 'unclosed', tag: unclosed, position: html.length });
  }

  return {
    isValid: errors.length === 0,
    errors,
    tagStack: [],  // 정상이면 빈 스택
  };
}
```

### 3.3 검증 테스트 케이스

```typescript
// 정상 케이스
validateHTML('Hello <strong>world</strong>!')
// → { isValid: true, errors: [] }

// unclosed 태그
validateHTML('Hello <strong>world!')
// → { isValid: false, errors: [{ type: 'unclosed', tag: 'strong', position: 19 }] }

// unexpected close
validateHTML('Hello world</strong>!')
// → { isValid: false, errors: [{ type: 'unexpected_close', tag: 'strong', position: 11 }] }

// mismatch
validateHTML('A <strong>B <em>C</strong></em> D')
// → { isValid: false, errors: [
//     { type: 'mismatch', tag: 'strong', position: 17, expected: 'em' }
//   ]}
```

---

## 4. 태그 복구 전략

### 4.1 복구 전략 개요

태그 손상 유형에 따라 다른 복구 전략을 적용합니다:

| 오류 유형 | 복구 전략 | 우선순위 |
|-----------|-----------|----------|
| `unclosed` | 적절한 위치에 닫는 태그 삽입 | 1 |
| `unexpected_close` | 여는 태그 삽입 또는 닫는 태그 제거 | 2 |
| `mismatch` | 태그 순서 교정 또는 재구성 | 3 |
| 복구 불가 | 폴백 전략 적용 | 4 |

### 4.2 Unclosed 태그 복구

닫히지 않은 태그에 대해 **닫는 태그를 삽입**합니다.

#### 4.2.1 삽입 위치 결정 규칙

```typescript
interface InsertionRule {
  tag: string;
  strategy: 'end_of_word' | 'end_of_sentence' | 'end_of_block' | 'immediate';
}

const INSERTION_RULES: InsertionRule[] = [
  // code: 단어 끝에 닫기 (띄어쓰기 없는 코드)
  { tag: 'code', strategy: 'end_of_word' },
  { tag: 'kbd', strategy: 'end_of_word' },
  { tag: 'var', strategy: 'end_of_word' },

  // strong/em: 문장 또는 구절 끝에 닫기
  { tag: 'strong', strategy: 'end_of_sentence' },
  { tag: 'b', strategy: 'end_of_sentence' },
  { tag: 'em', strategy: 'end_of_sentence' },
  { tag: 'i', strategy: 'end_of_sentence' },

  // a: 링크 텍스트 끝에 닫기
  { tag: 'a', strategy: 'end_of_word' },

  // 기본: 즉시 닫기 (최소한의 영향)
  { tag: '*', strategy: 'immediate' },
];
```

#### 4.2.2 삽입 위치 결정 알고리즘

```typescript
function findClosingPosition(
  html: string,
  openTagPosition: number,
  tagName: string,
  strategy: string
): number {
  const afterOpen = html.slice(openTagPosition);
  const tagEndMatch = afterOpen.match(/^<[^>]+>/);
  const contentStart = openTagPosition + (tagEndMatch?.[0].length ?? 0);
  const content = html.slice(contentStart);

  switch (strategy) {
    case 'end_of_word': {
      // 다음 공백, 구두점, 또는 태그 직전
      const match = content.match(/^[^\s<,.!?;:'")\]]+/);
      return contentStart + (match?.[0].length ?? 0);
    }

    case 'end_of_sentence': {
      // 다음 문장 종결 부호 또는 태그 직전
      const match = content.match(/^[^<]*?[.!?]/);
      if (match) {
        return contentStart + match[0].length;
      }
      // 문장 종결 없으면 블록 끝
      return findClosingPosition(html, openTagPosition, tagName, 'end_of_block');
    }

    case 'end_of_block': {
      // 다음 블록 태그 또는 문자열 끝 직전
      const match = content.match(/^[^<]*(?=<(?:p|div|li|h[1-6]|br)[\s>]|$)/i);
      return contentStart + (match?.[0].length ?? content.length);
    }

    case 'immediate':
    default: {
      // 즉시 닫기 (여는 태그 직후)
      return contentStart;
    }
  }
}
```

#### 4.2.3 복구 예시

```
입력: "이것은 <code>npm install 명령어입니다."
오류: unclosed 'code' at position 27

전략: end_of_word
분석: "npm install" 다음에 공백 → "install" 끝에서 닫기
결과: "이것은 <code>npm install</code> 명령어입니다."

---

입력: "이것은 <strong>중요한 내용입니다"
오류: unclosed 'strong' at position 18

전략: end_of_sentence
분석: 문장 끝(.) 없음 → 블록 끝에서 닫기
결과: "이것은 <strong>중요한 내용입니다</strong>"
```

### 4.3 Unexpected Close 태그 복구

예상치 못한 닫는 태그에 대한 복구 전략:

```typescript
function recoverUnexpectedClose(
  html: string,
  position: number,
  tagName: string
): string {
  // 전략 1: 대응하는 여는 태그 삽입 (콘텐츠 시작 부분)
  // 전략 2: 닫는 태그 제거

  // 휴리스틱: 닫는 태그 앞의 콘텐츠 분석
  const before = html.slice(0, position);
  const closingTag = `</${tagName}>`;

  // 닫는 태그 앞에 관련 콘텐츠가 있는지 확인
  const contentMatch = before.match(new RegExp(`([^>]+)$`));
  const contentBefore = contentMatch?.[1] ?? '';

  if (contentBefore.trim().length > 0) {
    // 콘텐츠가 있으면 여는 태그 삽입
    const openingTag = `<${tagName}>`;
    const insertPosition = position - contentBefore.length;
    return (
      html.slice(0, insertPosition) +
      openingTag +
      html.slice(insertPosition)
    );
  } else {
    // 콘텐츠가 없으면 닫는 태그 제거
    return (
      html.slice(0, position) +
      html.slice(position + closingTag.length)
    );
  }
}
```

### 4.4 Mismatch 태그 복구

중첩 순서가 잘못된 경우의 복구:

```typescript
function recoverMismatch(
  html: string,
  position: number,
  actualTag: string,
  expectedTag: string
): string {
  // 예: <strong><em>text</strong></em>
  // → <strong><em>text</em></strong>

  const closeActual = `</${actualTag}>`;
  const closeExpected = `</${expectedTag}>`;

  // 두 닫는 태그의 위치 찾기
  const actualPos = html.indexOf(closeActual, position);
  const expectedPos = html.indexOf(closeExpected, actualPos + closeActual.length);

  if (actualPos !== -1 && expectedPos !== -1) {
    // 태그 순서 교환
    return (
      html.slice(0, actualPos) +
      closeExpected +
      closeActual +
      html.slice(expectedPos + closeExpected.length)
    );
  }

  // 교환 불가능하면 내부 태그만 닫기
  return (
    html.slice(0, position) +
    closeExpected +
    html.slice(position)
  );
}
```

### 4.5 폴백 전략

복구가 불가능하거나 신뢰도가 낮은 경우:

```typescript
enum FallbackStrategy {
  KEEP_ORIGINAL = 'keep_original',      // 원문 유지 (번역 취소)
  STRIP_TAGS = 'strip_tags',            // 모든 태그 제거
  STRIP_BROKEN_ONLY = 'strip_broken',   // 손상된 태그만 제거
  USE_TEXT_CONTENT = 'use_text_content' // textContent 사용
}

function applyFallback(
  originalHTML: string,
  translatedHTML: string,
  errors: TagError[],
  strategy: FallbackStrategy
): string {
  switch (strategy) {
    case FallbackStrategy.KEEP_ORIGINAL:
      return originalHTML;

    case FallbackStrategy.STRIP_TAGS:
      return translatedHTML.replace(/<[^>]*>/g, '');

    case FallbackStrategy.STRIP_BROKEN_ONLY: {
      let result = translatedHTML;
      for (const error of errors) {
        // 손상된 태그만 제거
        result = result.replace(new RegExp(`</?${error.tag}[^>]*>`, 'gi'), '');
      }
      return result;
    }

    case FallbackStrategy.USE_TEXT_CONTENT: {
      const temp = document.createElement('div');
      temp.innerHTML = translatedHTML;
      return temp.textContent ?? '';
    }
  }
}
```

### 4.6 코드 태그 콘텐츠 보존 전략

`<code>` 태그는 특별한 처리가 필요합니다:

1. **콘텐츠가 번역되지 않음**: 코드는 번역 대상이 아님
2. **대소문자 변형 가능성**: `String` → `string` 처럼 대소문자가 바뀔 수 있음
3. **여러 단어 포함 가능**: `npm install`, `Array.prototype.map()` 등

#### 4.6.1 원본 코드 콘텐츠 추출 및 저장

번역 전 모든 `<code>` 태그의 내용을 추출하여 저장합니다:

```typescript
interface CodeContent {
  index: number;           // 등장 순서
  originalContent: string; // 원본 내용 (대소문자 보존)
  normalizedContent: string; // 소문자 변환 (매칭용)
  fullTag: string;         // 전체 태그 (<code>...</code>)
  attributes: string;      // 태그 속성 (class 등)
}

interface CodeContentMap {
  contents: CodeContent[];
  byNormalized: Map<string, CodeContent[]>; // 소문자 기준 인덱스
}

function extractCodeContents(html: string): CodeContentMap {
  const contents: CodeContent[] = [];
  const byNormalized = new Map<string, CodeContent[]>();

  // <code> 태그 매칭 (속성 포함)
  const CODE_REGEX = /<code([^>]*)>([\s\S]*?)<\/code>/gi;
  let match;
  let index = 0;

  while ((match = CODE_REGEX.exec(html)) !== null) {
    const attributes = match[1].trim();
    const originalContent = match[2];
    const normalizedContent = originalContent.toLowerCase();
    const fullTag = match[0];

    const content: CodeContent = {
      index,
      originalContent,
      normalizedContent,
      fullTag,
      attributes,
    };

    contents.push(content);

    // 소문자 기준 인덱싱 (동일 내용이 여러 번 등장할 수 있음)
    const existing = byNormalized.get(normalizedContent) ?? [];
    existing.push(content);
    byNormalized.set(normalizedContent, existing);

    index++;
  }

  return { contents, byNormalized };
}
```

#### 4.6.2 번역 후 코드 콘텐츠 복원

번역 결과에서 변형된 `<code>` 콘텐츠를 원본으로 복원합니다:

```typescript
function restoreCodeContents(
  translatedHTML: string,
  originalCodeMap: CodeContentMap
): string {
  let result = translatedHTML;

  // 번역 결과의 <code> 태그 추출
  const CODE_REGEX = /<code([^>]*)>([\s\S]*?)<\/code>/gi;
  const translatedCodes: Array<{
    fullMatch: string;
    attributes: string;
    content: string;
    position: number;
  }> = [];

  let match;
  while ((match = CODE_REGEX.exec(translatedHTML)) !== null) {
    translatedCodes.push({
      fullMatch: match[0],
      attributes: match[1].trim(),
      content: match[2],
      position: match.index,
    });
  }

  // 역순으로 처리 (위치 이동 방지)
  for (let i = translatedCodes.length - 1; i >= 0; i--) {
    const translated = translatedCodes[i];
    const normalizedTranslated = translated.content.toLowerCase();

    // 원본에서 매칭되는 콘텐츠 찾기 (case-insensitive)
    const originalMatches = originalCodeMap.byNormalized.get(normalizedTranslated);

    if (originalMatches && originalMatches.length > 0) {
      // 순서대로 매칭 (같은 코드가 여러 번 나오는 경우)
      const originalContent = originalMatches[Math.min(i, originalMatches.length - 1)];

      // 원본 대소문자로 복원
      if (translated.content !== originalContent.originalContent) {
        const restoredTag = `<code${translated.attributes ? ' ' + translated.attributes : ''}>${originalContent.originalContent}</code>`;
        result =
          result.slice(0, translated.position) +
          restoredTag +
          result.slice(translated.position + translated.fullMatch.length);
      }
    }
  }

  return result;
}
```

#### 4.6.3 손상된 코드 태그 복구

`<code>` 태그가 손상된 경우 (닫는 태그 누락 등) 원본 정보를 활용하여 복구합니다:

```typescript
function recoverBrokenCodeTag(
  html: string,
  originalCodeMap: CodeContentMap,
  error: TagError
): string {
  if (error.tag !== 'code') {
    return html; // code 태그만 처리
  }

  // 손상된 <code> 태그 위치에서 콘텐츠 추출 시도
  const afterError = html.slice(error.position);
  const openTagMatch = afterError.match(/^<code([^>]*)>/i);

  if (!openTagMatch) {
    // 여는 태그가 없으면 일반 복구
    return html;
  }

  const contentStart = error.position + openTagMatch[0].length;
  const contentAfter = html.slice(contentStart);

  // 원본 코드 내용과 매칭 시도 (case-insensitive)
  for (const original of originalCodeMap.contents) {
    const normalizedOriginal = original.normalizedContent;

    // 번역문에서 해당 코드가 시작하는지 확인
    if (contentAfter.toLowerCase().startsWith(normalizedOriginal)) {
      // 원본 코드 길이만큼의 위치에 닫는 태그 삽입
      const closePosition = contentStart + original.originalContent.length;
      return (
        html.slice(0, closePosition) +
        '</code>' +
        html.slice(closePosition)
      );
    }

    // 부분 매칭도 시도 (코드 내용이 변형되었을 수 있음)
    // 예: "npm install" 중 "npm"만 남은 경우
    const words = normalizedOriginal.split(/\s+/);
    for (let wordCount = words.length; wordCount > 0; wordCount--) {
      const partialMatch = words.slice(0, wordCount).join(' ');
      if (contentAfter.toLowerCase().startsWith(partialMatch)) {
        // 부분 매칭 성공 - 해당 부분까지 닫기
        const closePosition = contentStart + partialMatch.length;
        return (
          html.slice(0, closePosition) +
          '</code>' +
          html.slice(closePosition)
        );
      }
    }
  }

  // 매칭 실패 시 기본 전략 (다음 공백/태그 직전에서 닫기)
  const endMatch = contentAfter.match(/^[^\s<]+/);
  const closePosition = contentStart + (endMatch?.[0].length ?? 0);
  return (
    html.slice(0, closePosition) +
    '</code>' +
    html.slice(closePosition)
  );
}
```

#### 4.6.4 여러 단어 코드 처리 예시

```
원본: "Run <code>npm install lodash</code> to add the package."
추출: { originalContent: "npm install lodash", normalizedContent: "npm install lodash" }

번역 결과 (손상): "패키지를 추가하려면 <code>npm install lodash를 실행하세요."
오류: unclosed 'code'

복구 과정:
1. 원본 코드 맵에서 "npm install lodash" 확인
2. 번역 결과에서 "npm install lodash" 검색 (case-insensitive)
3. 해당 문자열 끝에 </code> 삽입

복구 결과: "패키지를 추가하려면 <code>npm install lodash</code>를 실행하세요."
```

#### 4.6.5 대소문자 변형 처리 예시

```
원본: "The <code>String</code> type is used for text."
추출: { originalContent: "String", normalizedContent: "string" }

번역 결과 (대소문자 변형): "<code>string</code> 타입은 텍스트에 사용됩니다."

복원 과정:
1. 번역 결과의 <code>string</code> 감지
2. 원본 맵에서 "string" (소문자) 검색
3. 원본 "String" (대문자 S)로 복원

복원 결과: "<code>String</code> 타입은 텍스트에 사용됩니다."
```

#### 4.6.6 코드 태그 복구 우선순위

`<code>` 태그 복구 시 다음 순서로 시도합니다:

| 순서 | 전략 | 조건 |
|------|------|------|
| 1 | 원본 콘텐츠 완전 매칭 | 원본과 동일한 내용 (대소문자 무시) |
| 2 | 원본 콘텐츠 부분 매칭 | 원본의 앞부분과 일치 |
| 3 | 단어 경계 기반 | 공백/구두점 직전에서 닫기 |
| 4 | 즉시 닫기 | 여는 태그 직후 닫기 (최후 수단) |

---

### 4.7 복구 신뢰도 평가

복구 결과의 신뢰도를 평가하여 폴백 여부 결정:

```typescript
interface RecoveryResult {
  html: string;
  confidence: number;  // 0.0 ~ 1.0
  appliedStrategies: string[];
}

function evaluateRecoveryConfidence(
  original: string,
  recovered: string,
  errors: TagError[]
): number {
  let confidence = 1.0;

  // 오류 수에 따른 감점
  confidence -= errors.length * 0.1;

  // 태그 수 변화에 따른 감점
  const originalTagCount = (original.match(/<[^>]+>/g) ?? []).length;
  const recoveredTagCount = (recovered.match(/<[^>]+>/g) ?? []).length;
  const tagDiff = Math.abs(originalTagCount - recoveredTagCount);
  confidence -= tagDiff * 0.05;

  // 텍스트 길이 변화에 따른 감점
  const temp1 = document.createElement('div');
  const temp2 = document.createElement('div');
  temp1.innerHTML = original;
  temp2.innerHTML = recovered;
  const textLengthRatio = (temp2.textContent?.length ?? 0) / (temp1.textContent?.length ?? 1);
  if (textLengthRatio < 0.8 || textLengthRatio > 1.5) {
    confidence -= 0.2;
  }

  return Math.max(0, Math.min(1, confidence));
}
```

---

## 5. 원본 태그 정보 활용

### 5.1 원본 태그 맵 생성

번역 전 원본 HTML의 태그 정보를 저장하여 복구 시 참조:

```typescript
interface TagInfo {
  tag: string;
  attributes: Record<string, string>;
  position: number;  // 원본에서의 위치
  textBefore: string;  // 태그 앞 텍스트 (5자)
  textAfter: string;   // 태그 뒤 텍스트 (5자)
}

interface OriginalTagMap {
  openTags: TagInfo[];
  closeTags: TagInfo[];
  tagPairs: Array<{ open: TagInfo; close: TagInfo }>;
}

function createOriginalTagMap(html: string): OriginalTagMap {
  const openTags: TagInfo[] = [];
  const closeTags: TagInfo[] = [];

  const TAG_REGEX = /<(\/?[a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let match;

  while ((match = TAG_REGEX.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    const position = match.index;

    const textBefore = html.slice(Math.max(0, position - 5), position);
    const textAfter = html.slice(position + fullTag.length, position + fullTag.length + 5);

    const info: TagInfo = {
      tag: tagName.replace('/', ''),
      attributes,
      position,
      textBefore,
      textAfter,
    };

    if (tagName.startsWith('/')) {
      closeTags.push(info);
    } else {
      openTags.push(info);
    }
  }

  // 태그 쌍 매칭
  const tagPairs = matchTagPairs(openTags, closeTags);

  return { openTags, closeTags, tagPairs };
}
```

### 5.2 원본 정보 기반 복구 힌트

```typescript
function getRecoveryHint(
  originalMap: OriginalTagMap,
  translatedHTML: string,
  error: TagError
): string | null {
  // 원본에서 해당 태그의 컨텍스트 찾기
  const originalTag = originalMap.openTags.find(t => t.tag === error.tag);
  if (!originalTag) return null;

  // 번역문에서 비슷한 컨텍스트 찾기
  // (원본 태그 주변 텍스트의 번역문 위치 추정)

  // 이 정보를 활용하여 복구 위치 결정
  return `원본에서 '${originalTag.textBefore}' 뒤, '${originalTag.textAfter}' 앞에 위치`;
}
```

---

## 6. 구현 계획

### 6.1 Phase 1: 검증 모듈 구현

**목표**: 번역 결과의 HTML 유효성 검증

**파일**: `src/content/htmlValidator.ts`

```
작업 항목:
1. validateHTML() 함수 구현
2. ValidationResult 타입 정의
3. 단위 테스트 작성
```

**예상 소요**: 구현 + 테스트

### 6.2 Phase 2: 코드 콘텐츠 보존 모듈 구현

**목표**: `<code>` 태그 콘텐츠 추출, 저장, 복원

**파일**: `src/content/codeContentPreserver.ts`

```
작업 항목:
1. CodeContent, CodeContentMap 타입 정의
2. extractCodeContents() 함수 구현
3. restoreCodeContents() 함수 구현 (대소문자 복원)
4. recoverBrokenCodeTag() 함수 구현 (손상된 코드 태그 복구)
5. 단위 테스트 작성 (대소문자 변형, 여러 단어 코드)
```

### 6.3 Phase 3: 일반 복구 모듈 구현

**목표**: 손상된 HTML 태그 복구

**파일**: `src/content/htmlRecovery.ts`

```
작업 항목:
1. recoverUnclosed() 함수 구현
2. recoverUnexpectedClose() 함수 구현
3. recoverMismatch() 함수 구현
4. 삽입 위치 결정 로직 구현
5. 단위 테스트 작성
```

### 6.4 Phase 4: 통합 및 폴백

**목표**: 검증/복구 모듈을 번역 파이프라인에 통합

**파일**: `src/content/domReplacer.ts` (수정)

```
작업 항목:
1. 번역 결과 검증 추가
2. 복구 로직 적용
3. 신뢰도 평가 및 폴백 적용
4. 통합 테스트 작성
```

### 6.5 Phase 5: 원본 태그 맵 활용

**목표**: 복구 정확도 향상

**파일**: `src/content/domExtractor.ts` (수정)

```
작업 항목:
1. createOriginalTagMap() 구현
2. 추출 시 태그 맵 생성 및 저장
3. 복구 시 태그 맵 참조
```

---

## 7. 파일 구조

```
src/content/
├── domExtractor.ts          # 기존 (태그 맵 생성 추가)
├── domReplacer.ts           # 기존 (검증/복구 통합)
├── htmlValidator.ts         # NEW: HTML 검증 모듈
├── htmlRecovery.ts          # NEW: HTML 복구 모듈 (일반 태그)
├── codeContentPreserver.ts  # NEW: 코드 콘텐츠 보존 모듈
└── index.ts                 # 진입점
```

---

## 8. 위험 요소 및 대응

### 8.1 기술적 위험

| 위험 | 영향 | 대응 |
|------|------|------|
| 복구 알고리즘 부정확 | 잘못된 HTML 생성 | 폴백 전략 적용, 신뢰도 임계값 설정 |
| 성능 저하 | 번역 속도 감소 | 검증만 수행 옵션, 캐싱 |
| 엣지 케이스 누락 | 특정 태그 조합 오류 | 테스트 케이스 확장, 사용자 피드백 수집 |

### 8.2 대응 전략

```typescript
// 설정으로 동작 제어
interface RecoveryConfig {
  enabled: boolean;           // 복구 기능 활성화
  confidenceThreshold: number; // 복구 신뢰도 임계값 (기본: 0.7)
  fallbackStrategy: FallbackStrategy; // 폴백 전략
  maxRecoveryAttempts: number; // 최대 복구 시도 횟수
}

const DEFAULT_CONFIG: RecoveryConfig = {
  enabled: true,
  confidenceThreshold: 0.7,
  fallbackStrategy: FallbackStrategy.KEEP_ORIGINAL,
  maxRecoveryAttempts: 3,
};
```

---

## 9. 테스트 전략

### 9.1 단위 테스트

```typescript
describe('HTML Validation', () => {
  describe('validateHTML', () => {
    it('정상 HTML 통과', () => {
      expect(validateHTML('<p>Hello <strong>world</strong>!</p>').isValid).toBe(true);
    });

    it('unclosed 태그 감지', () => {
      const result = validateHTML('<p>Hello <strong>world!</p>');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('unclosed');
      expect(result.errors[0].tag).toBe('strong');
    });

    it('mismatch 태그 감지', () => {
      const result = validateHTML('<strong><em>text</strong></em>');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('mismatch');
    });

    it('자기 닫힘 태그 허용', () => {
      expect(validateHTML('<p>Hello<br/>world</p>').isValid).toBe(true);
    });
  });
});

describe('HTML Recovery', () => {
  describe('recoverUnclosed', () => {
    it('code 태그 - 단어 끝에서 닫기', () => {
      const result = recover('<p>Use <code>npm install packages</p>');
      expect(result.html).toBe('<p>Use <code>npm</code> install packages</p>');
    });

    it('strong 태그 - 문장 끝에서 닫기', () => {
      const result = recover('<p>This is <strong>important text.</p>');
      expect(result.html).toBe('<p>This is <strong>important text.</strong></p>');
    });
  });
});

describe('Code Content Preservation', () => {
  describe('extractCodeContents', () => {
    it('단일 코드 추출', () => {
      const map = extractCodeContents('<p>Use <code>npm</code> to install</p>');
      expect(map.contents).toHaveLength(1);
      expect(map.contents[0].originalContent).toBe('npm');
    });

    it('여러 단어 코드 추출', () => {
      const map = extractCodeContents('<p>Run <code>npm install lodash</code></p>');
      expect(map.contents[0].originalContent).toBe('npm install lodash');
    });

    it('대소문자 보존', () => {
      const map = extractCodeContents('<p>The <code>String</code> type</p>');
      expect(map.contents[0].originalContent).toBe('String');
      expect(map.contents[0].normalizedContent).toBe('string');
    });
  });

  describe('restoreCodeContents', () => {
    it('대소문자 복원', () => {
      const originalMap = extractCodeContents('<p>The <code>String</code> type</p>');
      const translated = '<code>string</code> 타입';
      const result = restoreCodeContents(translated, originalMap);
      expect(result).toBe('<code>String</code> 타입');
    });

    it('여러 코드 순서 유지', () => {
      const originalMap = extractCodeContents(
        '<p>Use <code>String</code> and <code>Number</code></p>'
      );
      const translated = '<code>string</code> 및 <code>number</code> 사용';
      const result = restoreCodeContents(translated, originalMap);
      expect(result).toBe('<code>String</code> 및 <code>Number</code> 사용');
    });
  });

  describe('recoverBrokenCodeTag', () => {
    it('원본 콘텐츠 기반 닫는 태그 위치 결정', () => {
      const originalMap = extractCodeContents('<p>Run <code>npm install</code></p>');
      const broken = '<code>npm install을 실행하세요';
      const error = { type: 'unclosed', tag: 'code', position: 0 };
      const result = recoverBrokenCodeTag(broken, originalMap, error);
      expect(result).toBe('<code>npm install</code>을 실행하세요');
    });

    it('대소문자 무시 매칭', () => {
      const originalMap = extractCodeContents('<p>The <code>Array.prototype.map()</code></p>');
      const broken = '<code>array.prototype.map() 메서드';
      const error = { type: 'unclosed', tag: 'code', position: 0 };
      const result = recoverBrokenCodeTag(broken, originalMap, error);
      expect(result).toBe('<code>array.prototype.map()</code> 메서드');
    });
  });
});
```

### 9.2 통합 테스트

```typescript
describe('Translation Pipeline with Recovery', () => {
  it('손상된 번역 결과 복구', async () => {
    // Mock Translator API가 손상된 HTML 반환
    mockTranslator.translate.mockResolvedValue('이것은 <code>npm 명령어입니다.');

    const original = '<p>This is <code>npm</code> command.</p>';
    const result = await translateWithRecovery(original);

    expect(result).toBe('<p>이것은 <code>npm</code> 명령어입니다.</p>');
  });

  it('복구 불가 시 원문 유지', async () => {
    // 복잡한 손상으로 복구 불가
    mockTranslator.translate.mockResolvedValue('<a>텍스트</strong>');

    const original = '<p><a href="#">Link</a> text</p>';
    const result = await translateWithRecovery(original);

    expect(result).toBe(original); // 폴백: 원문 유지
  });
});
```

### 9.3 실제 환경 테스트 케이스

다양한 웹사이트에서 수집한 실제 HTML 패턴:

```typescript
const REAL_WORLD_CASES = [
  // MDN 문서 스타일
  {
    original: '<p>The <code>Array.prototype.map()</code> method creates a new array.</p>',
    expectedPattern: /<code>Array\.prototype\.map\(\)<\/code>/,
    description: '대문자 메서드명 보존',
  },

  // GitHub README 스타일
  {
    original: '<p>Run <code>npm install</code> to install dependencies.</p>',
    expectedPattern: /<code>npm install<\/code>/,
    description: '여러 단어 코드 보존',
  },

  // 블로그 포스트 스타일
  {
    original: '<p>This is <strong>very <em>important</em></strong> information.</p>',
    expectedPattern: /<strong>.*<em>.*<\/em>.*<\/strong>/,
    description: '중첩 태그 보존',
  },

  // 링크가 포함된 텍스트
  {
    original: '<p>Visit <a href="https://example.com">our website</a> for more.</p>',
    expectedPattern: /<a href="https:\/\/example\.com">.*<\/a>/,
    description: '링크 속성 보존',
  },

  // 대소문자 변형 가능성 있는 코드
  {
    original: '<p>Use <code>String</code> or <code>Number</code> types.</p>',
    expectedPattern: /<code>String<\/code>.*<code>Number<\/code>/,
    description: '대문자 타입명 보존 (String → string 복원)',
  },

  // 긴 코드 예시
  {
    original: '<p>Execute <code>docker-compose up -d</code> to start.</p>',
    expectedPattern: /<code>docker-compose up -d<\/code>/,
    description: '긴 명령어 보존',
  },

  // 코드와 텍스트 혼합
  {
    original: '<p>The <code>useState</code> hook returns a <code>state</code> value.</p>',
    expectedPattern: /<code>useState<\/code>.*<code>state<\/code>/,
    description: '여러 코드 태그 순서 보존',
  },
];
```

---

## 10. 성공 기준

### 10.1 정량적 기준

| 지표 | 목표 |
|------|------|
| 검증 정확도 | 100% (모든 손상 감지) |
| 복구 성공률 | > 80% (신뢰도 0.7 이상) |
| 성능 오버헤드 | < 50ms per block |
| 폴백 발생률 | < 5% |

### 10.2 정성적 기준

- 사용자가 번역 결과에서 깨진 HTML을 경험하지 않음
- 인라인 코드, 링크, 강조 등이 적절히 보존됨
- 복구 불가 시 안전하게 처리됨 (페이지 깨짐 없음)

---

## 11. 향후 확장

### 11.1 학습 기반 복구 (ML)

현재 rule-based 접근의 한계를 극복하기 위해 향후 ML 모델 적용 고려:

```
학습 데이터:
- 원본 HTML
- 번역 전 텍스트
- 번역 후 텍스트 (손상됨)
- 복구된 HTML (정답)

모델 목표:
- 손상 유형 분류
- 복구 위치 예측
- 신뢰도 점수 예측
```

### 11.2 Translator API 피드백

Chrome Translator API 개선 요청:
- HTML 태그 보존 모드 옵션
- 태그 위치 힌트 반환
- 손상 가능성 경고

---

## 12. 참고 자료

### 12.1 관련 문서

- [PLAN_DOM_EXTRACTOR_V2.md](PLAN_DOM_EXTRACTOR_V2.md): DOM 추출 개선 계획
- [PLAN_EXTRACTION_STRATEGY.md](PLAN_EXTRACTION_STRATEGY.md): Strategy Pattern 설계

### 12.2 외부 참고

- [HTML5 Parsing Specification](https://html.spec.whatwg.org/multipage/parsing.html)
- [W3C DOM Parsing](https://www.w3.org/TR/DOM-Parsing/)

---

## 부록 A: 전체 복구 파이프라인

```typescript
interface TranslationPipelineResult {
  html: string;
  status: 'success' | 'recovered' | 'fallback';
  confidence?: number;
  errors?: TagError[];
}

async function translateWithRecovery(
  originalHTML: string,
  config: RecoveryConfig = DEFAULT_CONFIG
): Promise<TranslationPipelineResult> {
  // 1. 원본 정보 추출 (태그 맵 + 코드 콘텐츠)
  const originalTagMap = createOriginalTagMap(originalHTML);
  const originalCodeMap = extractCodeContents(originalHTML);

  // 2. 번역 수행
  const translatedHTML = await translate(originalHTML);

  // 3. 코드 콘텐츠 대소문자 복원 (정상 태그인 경우)
  let processedHTML = restoreCodeContents(translatedHTML, originalCodeMap);

  // 4. 검증
  const validation = validateHTML(processedHTML);

  if (validation.isValid) {
    return { html: processedHTML, status: 'success' };
  }

  if (!config.enabled) {
    // 복구 비활성화 → 즉시 폴백
    return {
      html: applyFallback(originalHTML, processedHTML, validation.errors, config.fallbackStrategy),
      status: 'fallback',
      errors: validation.errors,
    };
  }

  // 5. 복구 시도
  let recoveredHTML = processedHTML;
  let attempts = 0;

  while (attempts < config.maxRecoveryAttempts) {
    const currentValidation = validateHTML(recoveredHTML);
    if (currentValidation.isValid) break;

    // 5.1 코드 태그 복구 (원본 콘텐츠 기반)
    for (const error of currentValidation.errors) {
      if (error.tag === 'code') {
        recoveredHTML = recoverBrokenCodeTag(recoveredHTML, originalCodeMap, error);
      }
    }

    // 5.2 일반 태그 복구
    recoveredHTML = applyRecovery(
      recoveredHTML,
      currentValidation.errors,
      originalTagMap
    );
    attempts++;
  }

  // 6. 최종 코드 콘텐츠 복원 (복구 후 대소문자 재확인)
  recoveredHTML = restoreCodeContents(recoveredHTML, originalCodeMap);

  // 7. 최종 검증 및 신뢰도 평가
  const finalValidation = validateHTML(recoveredHTML);
  const confidence = evaluateRecoveryConfidence(
    originalHTML,
    recoveredHTML,
    validation.errors
  );

  if (finalValidation.isValid && confidence >= config.confidenceThreshold) {
    return {
      html: recoveredHTML,
      status: 'recovered',
      confidence,
    };
  }

  // 8. 폴백
  return {
    html: applyFallback(originalHTML, translatedHTML, validation.errors, config.fallbackStrategy),
    status: 'fallback',
    confidence,
    errors: validation.errors,
  };
}
```

---

*문서 끝*
