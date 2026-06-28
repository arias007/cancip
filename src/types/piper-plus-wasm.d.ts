declare module "piper-plus/wasm/multilingual" {
  const init: (moduleOrPath?: unknown) => Promise<unknown>;
  export default init;
  export class WasmPhonemizer {
    constructor(configJson: string);
    getSupportedLanguages(): string[];
    setChineseDictionary?(single: Uint8Array, phrases: Uint8Array): void;
    phonemize(text: string, language: string): {
      phonemeIds: Uint32Array;
      prosodyFeatures: Float32Array;
      free: () => void;
    };
    detectLanguage(text: string): string;
    free(): void;
  }
}
