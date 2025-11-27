type ProgressCallback = (progress: number) => void;
type TranslationChunkCallback = (chunk: string) => void;

const translatorCache = new Map<string, Translator>();

export async function checkTranslatorAvailability(
  sourceLanguage: string,
  targetLanguage: string = "ko"
): Promise<"available" | "downloadable" | "unavailable"> {
  if (!("Translator" in self)) {
    return "unavailable";
  }

  const availability = await Translator.availability({
    sourceLanguage,
    targetLanguage,
  });

  if (availability === "available" || availability === "downloadable") {
    return availability;
  }
  if (availability === "downloading") {
    return "downloadable";
  }
  return "unavailable";
}

export async function createTranslator(
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: ProgressCallback
): Promise<Translator> {
  const cacheKey = `${sourceLanguage}-${targetLanguage}`;

  if (translatorCache.has(cacheKey)) {
    return translatorCache.get(cacheKey)!;
  }

  if (!("Translator" in self)) {
    throw new Error("Translator API is not supported in this browser");
  }

  const translator = await Translator.create({
    sourceLanguage,
    targetLanguage,
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        onProgress?.(e.loaded);
      });
    },
  });

  translatorCache.set(cacheKey, translator);
  return translator;
}

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: ProgressCallback
): Promise<string> {
  const translator = await createTranslator(
    sourceLanguage,
    targetLanguage,
    onProgress
  );
  return await translator.translate(text);
}

export async function translateStreaming(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: ProgressCallback,
  onChunk?: TranslationChunkCallback
): Promise<string> {
  const translator = await createTranslator(
    sourceLanguage,
    targetLanguage,
    onProgress
  );

  const stream = translator.translateStreaming(text);
  let result = "";

  // ReadableStream with async iterator support (Chrome 138+)
  const asyncIterableStream = stream as unknown as AsyncIterable<string>;
  for await (const chunk of asyncIterableStream) {
    result = chunk;
    onChunk?.(chunk);
  }

  return result;
}

export function destroyTranslators(): void {
  for (const translator of translatorCache.values()) {
    translator.destroy();
  }
  translatorCache.clear();
}
