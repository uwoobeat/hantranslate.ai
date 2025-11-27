import { Badge } from "@/components/ui/badge";

interface LanguageBadgeProps {
  language: string;
  type: "source" | "target";
}

const languageNames: Record<string, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  hi: "हिन्दी",
  th: "ไทย",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
  nl: "Nederlands",
  pl: "Polski",
  tr: "Türkçe",
  uk: "Українська",
  cs: "Čeština",
  sv: "Svenska",
  da: "Dansk",
  fi: "Suomi",
  no: "Norsk",
  el: "Ελληνικά",
  he: "עברית",
  ro: "Română",
  hu: "Magyar",
  bg: "Български",
  hr: "Hrvatski",
  sk: "Slovenčina",
  sl: "Slovenščina",
  lt: "Lietuvių",
  lv: "Latviešu",
  et: "Eesti",
};

export function LanguageBadge({ language, type }: LanguageBadgeProps) {
  return (
    <Badge variant={type === "source" ? "outline" : "default"}>
      {languageNames[language] || language.toUpperCase()}
    </Badge>
  );
}
