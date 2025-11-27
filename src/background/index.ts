import { MESSAGE_TYPES } from "@/shared/messages";
import type {
  Message,
  ModelDownloadProgressMessage,
  LanguageDetectedMessage,
  TranslationStatusMessage,
  ReplaceContentMessage,
  GetPageContentMessage,
  PageContentMessage,
} from "@/shared/messages";
import type { TextNode, TranslatedNode } from "@/shared/types";
import {
  detectLanguage,
  checkLanguageDetectorAvailability,
} from "./languageDetector";
import {
  translate,
  checkTranslatorAvailability,
} from "./translator";

async function sendMessageToPopup(message: Message): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Popup might be closed, ignore error
  }
}

async function sendMessageToTab(tabId: number, message: Message): Promise<unknown> {
  return await chrome.tabs.sendMessage(tabId, message);
}

async function getPageContent(tabId: number): Promise<TextNode[]> {
  const message: GetPageContentMessage = {
    type: MESSAGE_TYPES.GET_PAGE_CONTENT,
  };

  const response = await sendMessageToTab(tabId, message) as PageContentMessage;
  return response.nodes;
}

async function replacePageContent(
  tabId: number,
  nodes: TranslatedNode[]
): Promise<void> {
  const message: ReplaceContentMessage = {
    type: MESSAGE_TYPES.REPLACE_CONTENT,
    nodes,
  };

  await sendMessageToTab(tabId, message);
}

async function handleStartTranslation(
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      throw new Error("No active tab found");
    }

    const tabId = tab.id;

    // Check API availability
    const detectorAvailability = await checkLanguageDetectorAvailability();
    if (detectorAvailability === "unavailable") {
      throw new Error(
        "Language Detector API is not available. Please enable Chrome Built-in AI features."
      );
    }

    // Update status: detecting
    await sendMessageToPopup({
      type: MESSAGE_TYPES.TRANSLATION_STATUS,
      status: "detecting",
    } as TranslationStatusMessage);

    // Get page content
    const textNodes = await getPageContent(tabId);

    if (textNodes.length === 0) {
      throw new Error("No text content found on page");
    }

    // Combine text for language detection (sample first few nodes)
    const sampleText = textNodes
      .slice(0, 10)
      .map((n) => n.text)
      .join(" ");

    // Detect language
    const { language, confidence } = await detectLanguage(sampleText, (progress) => {
      sendMessageToPopup({
        type: MESSAGE_TYPES.MODEL_DOWNLOAD_PROGRESS,
        progress,
        modelType: "detector",
      } as ModelDownloadProgressMessage);
    });

    // Send detected language
    await sendMessageToPopup({
      type: MESSAGE_TYPES.LANGUAGE_DETECTED,
      language,
      confidence,
    } as LanguageDetectedMessage);

    // Skip if already Korean
    if (language === "ko") {
      await sendMessageToPopup({
        type: MESSAGE_TYPES.TRANSLATION_STATUS,
        status: "completed",
      } as TranslationStatusMessage);
      sendResponse({ success: true, message: "Page is already in Korean" });
      return;
    }

    // Check translator availability
    const translatorAvailability = await checkTranslatorAvailability(language);
    if (translatorAvailability === "unavailable") {
      throw new Error(
        `Translation from ${language} to Korean is not supported`
      );
    }

    // Update status: translating
    await sendMessageToPopup({
      type: MESSAGE_TYPES.TRANSLATION_STATUS,
      status: "translating",
    } as TranslationStatusMessage);

    // Translate all text nodes and replace immediately
    for (const node of textNodes) {
      const translatedText = await translate(
        node.text,
        language,
        "ko",
        (progress) => {
          sendMessageToPopup({
            type: MESSAGE_TYPES.MODEL_DOWNLOAD_PROGRESS,
            progress,
            modelType: "translator",
          } as ModelDownloadProgressMessage);
        }
      );

      // 번역 완료 즉시 DOM 교체
      await replacePageContent(tabId, [{ id: node.id, translatedText }]);
    }

    // Update status: completed
    await sendMessageToPopup({
      type: MESSAGE_TYPES.TRANSLATION_STATUS,
      status: "completed",
    } as TranslationStatusMessage);

    sendResponse({ success: true });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    await sendMessageToPopup({
      type: MESSAGE_TYPES.TRANSLATION_STATUS,
      status: "error",
      error: errorMessage,
    } as TranslationStatusMessage);

    sendResponse({ success: false, error: errorMessage });
  }
}

// Message listener
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.START_TRANSLATION) {
    handleStartTranslation(sendResponse);
    return true; // Keep message channel open for async response
  }
  return false;
});

console.log("HanTranslate.ai background service worker initialized");
