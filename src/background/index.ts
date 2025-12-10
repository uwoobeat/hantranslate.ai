import { handleMessage } from "./messageHandler";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // 비동기 응답
});
