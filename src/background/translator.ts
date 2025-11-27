type ProgressCallback = (progress: number) => void;
type TranslationChunkCallback = (chunk: string) => void;

const translatorCache = new Map<string, Translator>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForModelAvailable(
  sourceLanguage: string,
  targetLanguage: string,
  maxWaitMs: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    const availability = await Translator.availability({
      sourceLanguage,
      targetLanguage,
    });

    if (availability === "available") {
      return true;
    }

    if (availability !== "downloading" && availability !== "downloadable") {
      return false;
    }

    await sleep(pollInterval);
  }

  return false;
}

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

  const createWithRetry = async (retryCount: number = 0): Promise<Translator> => {
    try {
      const translator = await Translator.create({
        sourceLanguage,
        targetLanguage,
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            onProgress?.(e.loaded);
          });
        },
      });
      return translator;
    } catch (error) {
      if (retryCount >= 2) {
        throw error;
      }

      // Check if model is downloading and wait for it
      const availability = await Translator.availability({
        sourceLanguage,
        targetLanguage,
      });

      if (availability === "downloading") {
        const isAvailable = await waitForModelAvailable(
          sourceLanguage,
          targetLanguage
        );
        if (isAvailable) {
          return createWithRetry(retryCount + 1);
        }
      } else if (availability === "available") {
        // Model is available but creation failed, retry after short delay
        await sleep(500);
        return createWithRetry(retryCount + 1);
      }

      throw error;
    }
  };

  const translator = await createWithRetry();
  translatorCache.set(cacheKey, translator);
  return translator;
}

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: ProgressCallback
): Promise<string> {
  const cacheKey = `${sourceLanguage}-${targetLanguage}`;

  try {
    const translator = await createTranslator(
      sourceLanguage,
      targetLanguage,
      onProgress
    );
    return await translator.translate(text);
  } catch (error) {
    // If translation fails (e.g., model was manually deleted), clear cache and retry once
    if (translatorCache.has(cacheKey)) {
      const cachedTranslator = translatorCache.get(cacheKey);
      cachedTranslator?.destroy();
      translatorCache.delete(cacheKey);

      // Retry with fresh translator
      const translator = await createTranslator(
        sourceLanguage,
        targetLanguage,
        onProgress
      );
      return await translator.translate(text);
    }
    throw error;
  }
}

export async function translateStreaming(
  text: string,
  sourceLanguage: string,
  targetLanguage: string = "ko",
  onProgress?: ProgressCallback,
  onChunk?: TranslationChunkCallback
): Promise<string> {
  const cacheKey = `${sourceLanguage}-${targetLanguage}`;

  const performTranslation = async (translator: Translator): Promise<string> => {
    const stream = translator.translateStreaming(text);
    let result = "";

    // ReadableStream with async iterator support (Chrome 138+)
    const asyncIterableStream = stream as unknown as AsyncIterable<string>;
    for await (const chunk of asyncIterableStream) {
      result = chunk;
      onChunk?.(chunk);
    }

    return result;
  };

  try {
    const translator = await createTranslator(
      sourceLanguage,
      targetLanguage,
      onProgress
    );
    return await performTranslation(translator);
  } catch (error) {
    // If translation fails (e.g., model was manually deleted), clear cache and retry once
    if (translatorCache.has(cacheKey)) {
      const cachedTranslator = translatorCache.get(cacheKey);
      cachedTranslator?.destroy();
      translatorCache.delete(cacheKey);

      // Retry with fresh translator
      const translator = await createTranslator(
        sourceLanguage,
        targetLanguage,
        onProgress
      );
      return await performTranslation(translator);
    }
    throw error;
  }
}

export function destroyTranslators(): void {
  for (const translator of translatorCache.values()) {
    translator.destroy();
  }
  translatorCache.clear();
}
