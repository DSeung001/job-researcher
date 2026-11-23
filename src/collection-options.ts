import { sourceSchema, type Source } from "./model.js";

export type CollectionOptions = {
  maxPages?: number;
  maxDetails?: number;
  sources?: Source[];
};
export function parseCollectionOptions(args: string[]): CollectionOptions {
  const options: CollectionOptions = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    if (flag === "--sources") {
      options.sources = [
        ...new Set(
          value.split(",").map((source) => sourceSchema.parse(source)),
        ),
      ];
      continue;
    }
    if (flag !== "--max-pages" && flag !== "--max-details")
      throw new Error(`Unknown option: ${flag}`);
    const count = Number(value);
    if (
      !Number.isSafeInteger(count) ||
      count < (flag === "--max-pages" ? 1 : 0)
    )
      throw new Error(`Invalid value for ${flag}: ${value}`);
    if (flag === "--max-pages") options.maxPages = count;
    else options.maxDetails = count === 0 ? undefined : count;
  }
  return options;
}
