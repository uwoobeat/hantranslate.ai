import { MESSAGE_TYPES } from "@/shared/messages";
import type {
  Message,
  GetPageContentMessage,
  ReplaceContentMessage,
  PageContentMessage,
} from "@/shared/messages";
import { extractTextNodes, clearTextNodeMap } from "./domExtractor";
import { replaceTextNodes } from "./domReplacer";

function handleGetPageContent(): PageContentMessage {
  // Clear any previous extraction
  clearTextNodeMap();

  // Extract text nodes from DOM
  const nodes = extractTextNodes();

  return {
    type: MESSAGE_TYPES.PAGE_CONTENT,
    nodes,
  };
}

function handleReplaceContent(message: ReplaceContentMessage): void {
  const { nodes } = message;
  const replacedCount = replaceTextNodes(nodes);
  console.log(`HanTranslate.ai: Replaced ${replacedCount} text nodes`);
}

// Message listener
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    switch (message.type) {
      case MESSAGE_TYPES.GET_PAGE_CONTENT: {
        const response = handleGetPageContent();
        sendResponse(response);
        return false;
      }

      case MESSAGE_TYPES.REPLACE_CONTENT: {
        handleReplaceContent(message as ReplaceContentMessage);
        sendResponse({ success: true });
        return false;
      }

      default:
        return false;
    }
  }
);

console.log("HanTranslate.ai content script loaded");
