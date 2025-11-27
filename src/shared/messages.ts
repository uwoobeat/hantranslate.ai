import type {
  TranslationStatus,
  TextNode,
  TranslatedNode,
  LanguageDetectionResult,
} from "./types";

// Message types
export const MESSAGE_TYPES = {
  // Popup → Background
  START_TRANSLATION: "START_TRANSLATION",

  // Background → Popup
  MODEL_DOWNLOAD_PROGRESS: "MODEL_DOWNLOAD_PROGRESS",
  LANGUAGE_DETECTED: "LANGUAGE_DETECTED",
  TRANSLATION_STATUS: "TRANSLATION_STATUS",

  // Background → Content
  GET_PAGE_CONTENT: "GET_PAGE_CONTENT",
  REPLACE_CONTENT: "REPLACE_CONTENT",

  // Content → Background
  PAGE_CONTENT: "PAGE_CONTENT",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

// Message payloads
export interface StartTranslationMessage {
  type: typeof MESSAGE_TYPES.START_TRANSLATION;
}

export interface ModelDownloadProgressMessage {
  type: typeof MESSAGE_TYPES.MODEL_DOWNLOAD_PROGRESS;
  progress: number;
  modelType: "detector" | "translator";
}

export interface LanguageDetectedMessage {
  type: typeof MESSAGE_TYPES.LANGUAGE_DETECTED;
  language: string;
  confidence: number;
}

export interface TranslationStatusMessage {
  type: typeof MESSAGE_TYPES.TRANSLATION_STATUS;
  status: TranslationStatus;
  error?: string;
}

export interface GetPageContentMessage {
  type: typeof MESSAGE_TYPES.GET_PAGE_CONTENT;
}

export interface PageContentMessage {
  type: typeof MESSAGE_TYPES.PAGE_CONTENT;
  nodes: TextNode[];
}

export interface ReplaceContentMessage {
  type: typeof MESSAGE_TYPES.REPLACE_CONTENT;
  nodes: TranslatedNode[];
}

export type Message =
  | StartTranslationMessage
  | ModelDownloadProgressMessage
  | LanguageDetectedMessage
  | TranslationStatusMessage
  | GetPageContentMessage
  | PageContentMessage
  | ReplaceContentMessage;
