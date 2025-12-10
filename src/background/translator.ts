let translator: Translator | null = null;
let currentSourceLang: string | null = null;

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (!("Translator" in self)) {
    throw new Error("Translator API not supported");
  }

  // 언어가 바뀌면 인스턴스 재생성
  if (!translator || currentSourceLang !== sourceLanguage) {
    translator = await Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          onProgress?.(e.loaded);
        });
      },
    });
    currentSourceLang = sourceLanguage;
  }

  return await translator.translate(text);
}
