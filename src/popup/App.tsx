import { useState } from "react";
import type { TranslationStatus, ModelType } from "../shared/types";
import type { BackgroundResponse } from "../shared/messages";

export function App() {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState<{
    model: ModelType;
    progress: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const isLoading =
    status === "detecting" ||
    status === "downloading" ||
    status === "translating";

  return (
    <div style={{ width: 280, padding: 16, fontFamily: "system-ui" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>HanTranslate.ai</h2>

      {/* 다운로드 진행률 */}
      {downloadProgress && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
            {downloadProgress.model === "detector" ? "언어 감지" : "번역"} 모델
            다운로드 중...
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
    </div>
  );
}
