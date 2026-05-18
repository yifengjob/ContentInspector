declare module 'word-extractor' {
  class WordExtractor {
    extract(filePath: string): Promise<{
      getBody(): string;
      getFootnotes(): string;
      getEndnotes(): string;
      getHeaders(): string;
      getFooters(): string;
    }>;
  }

  export = WordExtractor;
}
