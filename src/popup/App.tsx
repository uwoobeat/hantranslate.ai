import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TranslateButton } from "./components/TranslateButton";
import { DownloadProgress } from "./components/DownloadProgress";
import { LanguageBadge } from "./components/LanguageBadge";
import { StatusAlert } from "./components/StatusAlert";
import { MESSAGE_TYPES } from "@/shared/messages";
import type { TranslationStatus } from "@/shared/types";

export function App() {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingModel, setDownloadingModel] = useState<
    "detector" | "translator" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTranslate = () => {
    setStatus("detecting");
    setDetectedLanguage(null);
    setErrorMessage(null);
    setDownloadProgress(0);
    setDownloadingModel(null);

    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.START_TRANSLATION });
  };

  useEffect(() => {
    const listener = (message: {
      type: string;
      progress?: number;
      modelType?: "detector" | "translator";
      language?: string;
      confidence?: number;
      status?: TranslationStatus;
      error?: string;
    }) => {
      switch (message.type) {
        case MESSAGE_TYPES.MODEL_DOWNLOAD_PROGRESS:
          setStatus("downloading");
          setDownloadProgress((message.progress ?? 0) * 100);
          setDownloadingModel(message.modelType ?? null);
          break;

        case MESSAGE_TYPES.LANGUAGE_DETECTED:
          setDetectedLanguage(message.language ?? null);
          break;

        case MESSAGE_TYPES.TRANSLATION_STATUS:
          setStatus(message.status ?? "idle");
          if (message.error) {
            setErrorMessage(message.error);
          }
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const isLoading = status === "detecting" || status === "translating";
  const isDownloading = status === "downloading";

  const getDownloadTitle = () => {
    if (downloadingModel === "detector") {
      return "언어 감지 모델 다운로드 중...";
    }
    if (downloadingModel === "translator") {
      return "번역 모델 다운로드 중...";
    }
    return "모델 다운로드 중...";
  };

  return (
    <div className="w-[320px] p-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">HanTranslate.ai</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {detectedLanguage && (
            <div className="flex items-center gap-2">
              <LanguageBadge language={detectedLanguage} type="source" />
              <span className="text-muted-foreground">→</span>
              <LanguageBadge language="ko" type="target" />
            </div>
          )}

          {isDownloading && (
            <DownloadProgress
              title={getDownloadTitle()}
              progress={downloadProgress}
            />
          )}

          {status === "completed" && (
            <StatusAlert
              status="success"
              title="번역 완료"
              description="페이지가 한국어로 번역되었습니다."
            />
          )}

          {status === "error" && errorMessage && (
            <StatusAlert
              status="error"
              title="오류 발생"
              description={errorMessage}
            />
          )}

          <TranslateButton
            isLoading={isLoading}
            onClick={handleTranslate}
            disabled={isDownloading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
