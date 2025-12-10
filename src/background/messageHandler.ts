import { detectLanguage } from "./languageDetector";
import { translate } from "./translator";
import type {
  PopupMessage,
  BackgroundResponse,
  ContentResponse,
} from "../shared/messages";

export async function handleMessage(
  message: PopupMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  if (message.type === "GET_STATUS") {
    return { type: "STATUS", status: "idle" };
  }

  if (message.type === "START_TRANSLATION") {
    return await handleTranslation();
  }

  return { type: "STATUS", status: "error", error: "Unknown message" };
}

async function handleTranslation(): Promise<BackgroundResponse> {
  try {
    // 1. 현재 탭에서 텍스트 추출
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab.id) throw new Error("No active tab");

    const textResponse = (await chrome.tabs.sendMessage(tab.id, {
      type: "GET_TEXT_NODES",
    })) as ContentResponse;

    if (textResponse.type !== "TEXT_NODES" || textResponse.texts.length === 0) {
      return { type: "STATUS", status: "completed" };
    }

    // 2. 언어 감지 (첫 1000자 샘플)
    const sample = textResponse.texts.slice(0, 5).join(" ").slice(0, 1000);
    const detectedLang = await detectLanguage(sample);

    if (detectedLang === "ko") {
      return { type: "STATUS", status: "completed" }; // 이미 한국어
    }

    // 3. 번역
    const translations = await Promise.all(
      textResponse.texts.map((text) => translate(text, detectedLang)),
    );

    // 4. DOM 교체
    const replacements = translations.map((text, index) => ({ index, text }));
    await chrome.tabs.sendMessage(tab.id, {
      type: "REPLACE_TEXT",
      replacements,
    });

    return { type: "STATUS", status: "completed" };
  } catch (error) {
    return {
      type: "STATUS",
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
