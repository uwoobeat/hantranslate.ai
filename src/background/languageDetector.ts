let detector: LanguageDetector | null = null;

export async function detectLanguage(
  text: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (!("LanguageDetector" in self)) {
    throw new Error("LanguageDetector API not supported");
  }

  if (!detector) {
    detector = await LanguageDetector.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          onProgress?.(e.loaded);
        });
      },
    });
  }

  const results = await detector.detect(text);
  return results[0]?.detectedLanguage ?? "unknown";
}
