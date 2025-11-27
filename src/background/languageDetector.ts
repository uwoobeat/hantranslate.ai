type ProgressCallback = (progress: number) => void;

let detectorInstance: LanguageDetector | null = null;

export async function checkLanguageDetectorAvailability(): Promise<
  "available" | "downloadable" | "unavailable"
> {
  if (!("LanguageDetector" in self)) {
    return "unavailable";
  }

  const availability = await LanguageDetector.availability();
  if (availability === "available" || availability === "downloadable") {
    return availability;
  }
  if (availability === "downloading") {
    return "downloadable";
  }
  return "unavailable";
}

export async function createLanguageDetector(
  onProgress?: ProgressCallback
): Promise<LanguageDetector> {
  if (detectorInstance) {
    return detectorInstance;
  }

  if (!("LanguageDetector" in self)) {
    throw new Error("Language Detector API is not supported in this browser");
  }

  detectorInstance = await LanguageDetector.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        onProgress?.(e.loaded);
      });
    },
  });

  return detectorInstance;
}

export async function detectLanguage(
  text: string,
  onProgress?: ProgressCallback
): Promise<{ language: string; confidence: number }> {
  const detector = await createLanguageDetector(onProgress);
  const results = await detector.detect(text);

  if (results.length === 0) {
    throw new Error("Could not detect language");
  }

  const topResult = results[0];
  return {
    language: topResult.detectedLanguage ?? "unknown",
    confidence: topResult.confidence ?? 0,
  };
}

export function destroyLanguageDetector(): void {
  if (detectorInstance) {
    detectorInstance.destroy();
    detectorInstance = null;
  }
}
