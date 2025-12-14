# HTML 태그 보존 문제: 번역 시 인라인 태그 손상 복구

> **문서 목적**: 이 문서는 번역 시스템에서 발생하는 HTML 태그 손상 문제를 정의하고, 해결 전략 수립을 위한 충분한 컨텍스트를 제공합니다.
>
> **독자 대상**: 이 코드베이스에 대한 사전 지식이 없는 개발자/에이전트

---

## 1. 프로젝트 개요

### 1.1 시스템 소개

**HanTranslate.ai**는 웹 페이지를 한국어로 번역하는 Chrome 확장 프로그램입니다.

핵심 특징:
- Chrome에 내장된 **Translator API** (로컬 AI 모델)를 사용하여 번역 수행
- 서버 통신 없이 브라우저 내에서 모든 처리 완료
- 웹 페이지의 텍스트를 추출하여 번역 후 원래 위치에 교체

### 1.2 번역 대상

웹 페이지에서 다음과 같은 **블록 요소**의 내용을 번역합니다:

```html
<p>, <li>, <td>, <th>, <h1>~<h6>, <blockquote>, <figcaption>, <dt>, <dd>
```

이 블록 요소들은 내부에 **인라인 태그**를 포함할 수 있습니다:

```html
<!-- 인라인 태그 예시 -->
<strong>, <em>, <b>, <i>  <!-- 텍스트 강조 -->
<code>, <kbd>, <var>      <!-- 코드/입력 표시 -->
<a href="...">            <!-- 링크 -->
<span>, <mark>, <sub>, <sup>  <!-- 기타 스타일링 -->
```

---

## 2. 현재 구현 방식

### 2.1 데이터 흐름

```
┌──────────────────────────────────────────────────────────────────────┐
│                        웹 페이지 (DOM)                                │
│  <p>Use the <code>npm install</code> command to add packages.</p>   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1. innerHTML 추출
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     추출된 HTML 문자열                                │
│  "Use the <code>npm install</code> command to add packages."        │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 2. Translator API 호출
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Chrome Translator API (로컬 AI)                       │
│  - 입력: HTML 문자열 (태그 포함)                                      │
│  - 출력: 번역된 HTML 문자열 (태그 보존 시도)                           │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 3. 번역 결과 반환
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     번역된 HTML 문자열                                │
│  "패키지를 추가하려면 <code>npm install</code> 명령어를 사용하세요."   │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 4. DOM에 적용
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        웹 페이지 (DOM)                                │
│  <p>패키지를 추가하려면 <code>npm install</code> 명령어를 사용하세요.</p>│
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 핵심 코드 구조 (의사 코드)

```typescript
// 1. 블록 요소에서 innerHTML 추출
function extractTranslatableContents(): string[] {
  const blocks = document.querySelectorAll('p, li, h1, h2, ...');
  return blocks.map(block => block.innerHTML);
  // 결과: ["Use the <code>npm install</code> command...", ...]
}

// 2. 번역 수행
async function translate(html: string): Promise<string> {
  const translator = await Translator.create({
    sourceLanguage: 'en',
    targetLanguage: 'ko'
  });
  return translator.translate(html);
  // HTML 태그가 포함된 문자열을 그대로 전달
}

// 3. 번역 결과를 DOM에 적용
function replaceContent(index: number, translatedHTML: string): void {
  const block = extractedBlocks[index];
  block.innerHTML = translatedHTML;
  // 번역된 HTML을 그대로 삽입
}
```

### 2.3 왜 innerHTML을 사용하는가?

텍스트만 추출하면 인라인 태그로 인해 **문장이 분리**되는 문제가 발생합니다:

```html
<!-- 원본 -->
<p>This is <strong>very important</strong> text.</p>

<!-- 텍스트 노드만 추출하면: -->
["This is ", "very important", " text."]
// 3개의 분리된 문자열 → 문맥 손실, 번역 품질 저하

<!-- innerHTML 추출하면: -->
"This is <strong>very important</strong> text."
// 하나의 완전한 문장 → 문맥 보존, 번역 품질 향상
```

---

## 3. 문제 정의

### 3.1 Translator API의 HTML 태그 처리 특성

Chrome Translator API는 HTML 태그가 포함된 문자열을 입력받으면 **태그를 보존하려고 시도**합니다. 그러나 이 동작은 **완벽하지 않습니다**:

| 상황 | API 동작 |
|------|----------|
| 짧은 문자열 | 태그를 잘 보존함 |
| 긴 문자열 | 태그가 손실되거나 위치가 변경될 수 있음 |
| 복잡한 중첩 | 중첩 순서가 바뀔 수 있음 |

### 3.2 관찰된 손상 유형

#### 유형 1: 닫는 태그 누락 (Unclosed Tag)

```
입력:  "Run the <code>npm install lodash</code> command."
출력:  "패키지를 추가하려면 <code>npm install lodash 명령어를 실행하세요."
                                              ↑
                                      </code> 누락
```

특히 **여러 단어로 이루어진 코드**에서 자주 발생합니다.

#### 유형 2: 여는 태그 누락 또는 예상치 못한 닫는 태그

```
입력:  "The <strong>important</strong> part is here."
출력:  "중요한</strong> 부분이 여기 있습니다."
       ↑
       <strong> 누락, </strong>만 남음
```

#### 유형 3: 태그 중첩 순서 오류

```
입력:  "A <strong>B <em>C</em></strong> D"
출력:  "A <strong>B <em>C</strong></em> D"
                       ↑        ↑
                   순서가 바뀜 (잘못된 HTML)
```

#### 유형 4: 태그 완전 손실

```
입력:  "Visit <a href="https://example.com">our site</a> for more."
출력:  "더 많은 정보는 저희 사이트를 방문하세요."
                    ↑
            <a> 태그 완전히 제거됨
```

#### 유형 5: 코드 내용 대소문자 변형

```
입력:  "The <code>String</code> type represents text."
출력:  "<code>string</code> 타입은 텍스트를 나타냅니다."
              ↑
       String → string (대소문자 변경)
```

**참고**: `<code>` 내부의 텍스트는 번역되지 않지만, 대소문자가 변경되는 현상이 관찰되었습니다.

### 3.3 문제의 심각성

손상된 HTML이 DOM에 삽입되면:

1. **레이아웃 깨짐**: 닫히지 않은 태그가 후속 요소에 영향
2. **스타일 손실**: `<strong>`, `<em>` 등이 제거되면 강조 표시 사라짐
3. **기능 손실**: `<a>` 태그가 제거되면 링크 클릭 불가
4. **코드 가독성 저하**: `<code>` 태그가 손상되면 코드 스타일링 손실
5. **정보 왜곡**: 대소문자가 바뀐 코드는 실제 코드와 다름 (예: `String` vs `string`)

---

## 4. 상세 예시

### 4.1 실제 웹 페이지 패턴

#### MDN 문서 스타일
```html
<!-- 원본 -->
<p>The <code>Array.prototype.map()</code> method creates a new array.</p>

<!-- 이상적인 번역 -->
<p><code>Array.prototype.map()</code> 메서드는 새 배열을 생성합니다.</p>

<!-- 가능한 손상 1: 닫는 태그 누락 -->
<p><code>Array.prototype.map() 메서드는 새 배열을 생성합니다.</p>

<!-- 가능한 손상 2: 대소문자 변경 -->
<p><code>array.prototype.map()</code> 메서드는 새 배열을 생성합니다.</p>
```

#### GitHub README 스타일
```html
<!-- 원본 -->
<p>Run <code>npm install</code> to install dependencies.</p>

<!-- 이상적인 번역 -->
<p>의존성을 설치하려면 <code>npm install</code>을 실행하세요.</p>

<!-- 가능한 손상: 닫는 태그 위치 오류 -->
<p>의존성을 설치하려면 <code>npm install을 실행하세요.</p>
```

#### 기술 블로그 스타일
```html
<!-- 원본 -->
<p>Use the <code>useState</code> hook to manage <strong>local state</strong>.</p>

<!-- 이상적인 번역 -->
<p><strong>로컬 상태</strong>를 관리하려면 <code>useState</code> 훅을 사용하세요.</p>

<!-- 가능한 손상: 여러 태그 동시 손상 -->
<p><strong>로컬 상태를 관리하려면 <code>useState 훅을 사용하세요.</p>
```

### 4.2 `<code>` 태그의 특수성

`<code>` 태그는 다른 인라인 태그와 다른 특성이 있습니다:

| 특성 | `<strong>`, `<em>` 등 | `<code>` |
|------|----------------------|----------|
| 내용 번역 | O (번역됨) | X (번역 안 됨) |
| 내용 변형 | 번역으로 인해 길이/내용 변경 | 대소문자만 변경 가능 |
| 단어 수 | 보통 여러 단어 | 1~N 단어 (가변) |
| 공백 포함 | 거의 항상 | 가끔 (`npm install`) |

**핵심 관찰**:
- `<code>` 내용은 번역되지 않으므로, 원본 내용을 알면 번역 결과에서 해당 위치를 찾을 수 있음
- 단, 대소문자가 바뀔 수 있으므로 **case-insensitive** 매칭 필요
- 예: 원본 `String` → 번역 후 `string`으로 변경될 수 있음

---

## 5. 제약 조건

### 5.1 변경 불가능한 요소

1. **Translator API 동작**: Chrome 내장 API로, 동작 방식을 수정할 수 없음
2. **입력 형식**: innerHTML (HTML 문자열)로 전달해야 함 (문장 분리 방지를 위해)
3. **출력 사용**: 번역 결과를 `element.innerHTML`로 설정하여 DOM에 적용

### 5.2 가용한 정보

번역 전후로 다음 정보를 활용할 수 있습니다:

**번역 전 (원본)**:
- 원본 HTML 문자열 (`innerHTML`)
- 원본의 모든 태그 위치 및 내용
- 특히 `<code>` 태그의 원본 내용 (대소문자 포함)

**번역 후**:
- 번역된 HTML 문자열 (손상 가능성 있음)
- 번역 전 원본 정보 참조 가능

### 5.3 성능 요구사항

- 웹 페이지당 수십~수백 개의 블록 요소 처리
- 각 블록에 대해 검증/복구 로직 실행
- 사용자 체감 지연 최소화 필요

---

## 6. 해결 목표

### 6.1 필수 목표

1. **검증**: 번역 결과의 HTML이 well-formed인지 검사
   - 모든 여는 태그에 대응하는 닫는 태그 존재
   - 태그 중첩 순서 올바름

2. **복구**: 손상된 태그 구조 복원
   - 누락된 닫는 태그 삽입
   - 예상치 못한 태그 처리
   - 중첩 순서 교정

3. **코드 보존**: `<code>` 태그 특별 처리
   - 원본 대소문자 복원 (예: `string` → `String`)
   - 여러 단어 코드의 태그 경계 정확히 복구

### 6.2 품질 목표

| 지표 | 목표 |
|------|------|
| 손상 감지율 | 100% (모든 손상 감지) |
| 복구 성공률 | > 80% |
| 성능 오버헤드 | < 50ms per block |

### 6.3 안전성 목표

- 복구 실패 시 **안전한 폴백** (원문 유지 또는 태그 제거)
- 복구 시도로 인해 더 심각한 손상 발생 방지
- 페이지 레이아웃 깨짐 방지

---

## 7. 해결 전략 수립을 위한 고려 사항

### 7.1 태그 유형별 복구 난이도

| 태그 | 내용 특성 | 복구 난이도 | 이유 |
|------|----------|------------|------|
| `<code>` | 번역 안 됨, 대소문자만 변형 | 낮음 | 원본 내용으로 위치 특정 가능 |
| `<a>` | href 속성 보존 필요 | 중간 | 속성까지 복구해야 함 |
| `<strong>`, `<em>` | 내용이 번역됨 | 높음 | 원본과 번역문 길이/내용 다름 |

### 7.2 `<code>` 태그 복구 힌트

`<code>` 태그는 내용이 번역되지 않으므로 다음 전략이 가능합니다:

```
원본: "Run <code>npm install lodash</code> to add."
추출: { content: "npm install lodash", lowerContent: "npm install lodash" }

손상된 번역: "<code>npm install lodash를 실행하세요."

복구 과정:
1. 번역 결과에서 "npm install lodash" 검색 (case-insensitive)
2. 해당 문자열 끝에 </code> 삽입
3. 결과: "<code>npm install lodash</code>를 실행하세요."
```

**대소문자 복원**:
```
원본: "The <code>String</code> type"
추출: { content: "String", lowerContent: "string" }

번역: "<code>string</code> 타입"

복원 과정:
1. 번역 결과에서 <code>string</code> 발견
2. "string"을 원본 "String"으로 교체
3. 결과: "<code>String</code> 타입"
```

### 7.3 복구 불가능한 경우

다음 경우에는 복구가 어렵거나 불가능할 수 있습니다:

1. **태그가 완전히 제거된 경우**: 어디에 태그가 있었는지 알 수 없음
2. **`<strong>` 등 내용이 번역된 태그**: 원본과 번역문의 대응 관계 파악 어려움
3. **복잡한 중첩 손상**: 여러 태그가 동시에 손상된 경우

이런 경우에는 **폴백 전략**이 필요합니다:
- 원문 유지 (번역 취소)
- 손상된 태그만 제거
- 모든 태그 제거 (순수 텍스트)

### 7.4 복구 신뢰도

복구 결과의 신뢰도를 평가하는 기준이 필요합니다:

- 복구 후 태그 수가 원본과 일치하는가?
- 텍스트 길이가 합리적인 범위인가?
- 추가적인 구조 오류가 없는가?

신뢰도가 낮으면 폴백 전략을 적용해야 합니다.

---

## 8. 질문 및 토론 포인트

이 문제에 대한 해결 전략을 수립할 때 다음 사항을 고려해 주세요:

1. **태그 검증 알고리즘**: HTML 태그의 well-formedness를 어떻게 효율적으로 검사할 것인가?

2. **닫는 태그 삽입 위치**: 누락된 닫는 태그를 어디에 삽입해야 하는가?
   - `<code>`: 원본 콘텐츠 길이 기반?
   - `<strong>`: 문장 끝? 다음 태그 직전?

3. **복구 우선순위**: 여러 오류가 동시에 발생했을 때 어떤 순서로 복구할 것인가?

4. **폴백 전략 선택**: 어떤 기준으로 폴백을 결정하고, 어떤 폴백 방식을 사용할 것인가?

5. **성능 최적화**: 수백 개의 블록을 처리할 때 어떻게 성능을 유지할 것인가?

---

## 부록 A: 테스트 케이스

다음 케이스들은 해결 전략 검증에 활용할 수 있습니다:

```javascript
const TEST_CASES = [
  // Case 1: 정상 (변경 없음)
  {
    original: '<p>Hello <strong>world</strong>!</p>',
    translated: '안녕 <strong>세계</strong>!',
    expected: '안녕 <strong>세계</strong>!',
    description: '정상 케이스 - 변경 불필요'
  },

  // Case 2: 닫는 태그 누락 (단일 단어 코드)
  {
    original: '<p>Use <code>npm</code> to install.</p>',
    translated: '<code>npm을 사용하여 설치하세요.',
    expected: '<code>npm</code>을 사용하여 설치하세요.',
    description: '단일 단어 code 태그 복구'
  },

  // Case 3: 닫는 태그 누락 (여러 단어 코드)
  {
    original: '<p>Run <code>npm install lodash</code> to add.</p>',
    translated: '<code>npm install lodash를 실행하세요.',
    expected: '<code>npm install lodash</code>를 실행하세요.',
    description: '여러 단어 code 태그 복구'
  },

  // Case 4: 대소문자 변형
  {
    original: '<p>The <code>String</code> type.</p>',
    translated: '<code>string</code> 타입.',
    expected: '<code>String</code> 타입.',
    description: '대소문자 복원'
  },

  // Case 5: 여러 code 태그
  {
    original: '<p>Use <code>String</code> or <code>Number</code>.</p>',
    translated: '<code>string</code> 또는 <code>number</code>를 사용하세요.',
    expected: '<code>String</code> 또는 <code>Number</code>를 사용하세요.',
    description: '여러 code 태그 순서 유지 및 대소문자 복원'
  },

  // Case 6: 중첩 태그 순서 오류
  {
    original: '<p>A <strong>B <em>C</em></strong> D</p>',
    translated: 'A <strong>B <em>C</strong></em> D',
    expected: 'A <strong>B <em>C</em></strong> D',
    description: '중첩 순서 교정'
  },

  // Case 7: 태그 완전 손실 (폴백 필요)
  {
    original: '<p>Visit <a href="https://example.com">our site</a>.</p>',
    translated: '저희 사이트를 방문하세요.',
    expected: null, // 폴백 필요
    description: '태그 완전 손실 - 폴백'
  },

  // Case 8: 복잡한 실제 예시
  {
    original: '<p>The <code>Array.prototype.map()</code> method creates a new <strong>array</strong>.</p>',
    translated: '<code>array.prototype.map() 메서드는 새 <strong>배열</strong>을 생성합니다.',
    expected: '<code>Array.prototype.map()</code> 메서드는 새 <strong>배열</strong>을 생성합니다.',
    description: '복합 케이스 - code 태그 복구 + 대소문자 복원'
  }
];
```

---

## 부록 B: 용어 정의

| 용어 | 정의 |
|------|------|
| 블록 요소 | `<p>`, `<li>` 등 문단 수준의 HTML 요소 |
| 인라인 태그 | `<strong>`, `<code>` 등 텍스트 내부에 사용되는 태그 |
| innerHTML | DOM 요소의 내부 HTML 문자열 |
| Well-formed HTML | 모든 태그가 올바르게 열고 닫힌 HTML |
| 폴백 | 복구 실패 시 적용되는 대체 전략 |

---

*문서 끝*
