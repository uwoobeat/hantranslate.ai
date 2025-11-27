export type TranslationStatus =
  | "idle"
  | "detecting"
  | "downloading"
  | "translating"
  | "completed"
  | "error";

export interface TextNode {
  id: string;
  text: string;
  xpath: string;
}

export interface TranslatedNode {
  id: string;
  translatedText: string;
}

export interface LanguageDetectionResult {
  detectedLanguage: string;
  confidence: number;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}
