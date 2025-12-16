import { useState } from "react";
import type { TranslationStatus, ModelType } from "../shared/types";
import type { BackgroundResponse } from "../shared/messages";

type TabType = "page" | "text";

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>("page");

  // 페이지 번역 상태
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<{
    model: ModelType;
    progress: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 텍스트 번역 상태
  const [inputText, setInputText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [isTextTranslating, setIsTextTranslating] = useState(false);

  const handleTranslate = async () => {
    setStatus("detecting");
    setError(null);

    const response: BackgroundResponse = await chrome.runtime.sendMessage({
      type: "START_TRANSLATION",
    });

    if (response.type === "STATUS") {
      setStatus(response.status);
      if (response.error) setError(response.error);
    }
  };

  const handleTextTranslate = async () => {
    setIsTextTranslating(true);
    setTextError(null);
    setTranslatedText("");

    const response: BackgroundResponse = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text: inputText,
    });

    if (response.type === "TRANSLATED_TEXT") {
      setTranslatedText(response.text);
      if (response.error) setTextError(response.error);
    }

    setIsTextTranslating(false);
  };

  const isLoading =
    status === "detecting" ||
    status === "downloading" ||
    status === "translating";

  const tabStyle = (isActive: boolean) => ({
    flex: 1,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    borderBottom: isActive ? "2px solid #4285f4" : "2px solid transparent",
    background: "transparent",
    color: isActive ? "#4285f4" : "#666",
    cursor: "pointer",
  });

  return (
    <div style={{ width: 280, fontFamily: "system-ui" }}>
      <h2 style={{ margin: "16px 16px 12px", fontSize: 18 }}>
        HanTranslate.ai
      </h2>

      {/* 탭 */}
      <div style={{ display: "flex", borderBottom: "1px solid #eee" }}>
        <button
          style={tabStyle(activeTab === "page")}
          onClick={() => setActiveTab("page")}
        >
          페이지 번역
        </button>
        <button
          style={tabStyle(activeTab === "text")}
          onClick={() => setActiveTab("text")}
        >
          텍스트 번역
        </button>
      </div>

      <div style={{ padding: 16 }}>
        {activeTab === "page" && (
          <>
            {/* 다운로드 진행률 */}
            {downloadProgress && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                  {downloadProgress.model === "detector" ? "언어 감지" : "번역"}{" "}
                  모델 다운로드 중...
                </div>
                <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
                  <div
                    style={{
                      background: "#4285f4",
                      borderRadius: 4,
                      height: "100%",
                      width: `${downloadProgress.progress * 100}%`,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              </div>
            )}

            {/* 상태 메시지 */}
            {status === "completed" && (
              <div
                style={{
                  padding: 8,
                  background: "#e8f5e9",
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: 14,
                }}
              >
                번역 완료
              </div>
            )}
            {error && (
              <div
                style={{
                  padding: 8,
                  background: "#ffebee",
                  borderRadius: 4,
                  marginBottom: 12,
                  fontSize: 14,
                  color: "#c62828",
                }}
              >
                {error}
              </div>
            )}

            {/* 번역 버튼 */}
            <button
              onClick={handleTranslate}
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                borderRadius: 6,
                background: isLoading ? "#ccc" : "#4285f4",
                color: "white",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "번역 중..." : "이 페이지 번역하기"}
            </button>
          </>
        )}

        {activeTab === "text" && (
          <>
            {/* 입력 영역 */}
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="번역할 텍스트를 입력하세요"
              style={{
                width: "100%",
                height: 80,
                padding: 8,
                fontSize: 13,
                border: "1px solid #ddd",
                borderRadius: 4,
                resize: "none",
                boxSizing: "border-box",
              }}
            />

            {/* 번역 버튼 */}
            <button
              onClick={handleTextTranslate}
              disabled={isTextTranslating || !inputText.trim()}
              style={{
                width: "100%",
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                borderRadius: 6,
                marginTop: 8,
                background:
                  isTextTranslating || !inputText.trim() ? "#ccc" : "#4285f4",
                color: "white",
                cursor:
                  isTextTranslating || !inputText.trim()
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {isTextTranslating ? "번역 중..." : "번역하기"}
            </button>

            {/* 에러 메시지 */}
            {textError && (
              <div
                style={{
                  padding: 8,
                  background: "#ffebee",
                  borderRadius: 4,
                  marginTop: 12,
                  fontSize: 14,
                  color: "#c62828",
                }}
              >
                {textError}
              </div>
            )}

            {/* 번역 결과 */}
            {translatedText && !textError && (
              <div
                style={{
                  marginTop: 12,
                  padding: 8,
                  background: "#f5f5f5",
                  borderRadius: 4,
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {translatedText}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
