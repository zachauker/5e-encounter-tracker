import { pipeline, env } from "@huggingface/transformers";
import path from "path";

export const EMBED_DIMS = 384;
const MODEL = "Xenova/bge-small-en-v1.5";

// Prefer a baked local model dir if present (prod); allow download in dev.
const localDir = process.env.REFERENCE_MODEL_DIR || path.join(process.cwd(), "reference-data", "models");
env.localModelPath = localDir;
env.allowRemoteModels = process.env.NODE_ENV !== "production";

type Extractor = (texts: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<{ tolist: () => number[][] }>;

let _extractor: Extractor | null = null;
async function getExtractor(): Promise<Extractor> {
  if (!_extractor) _extractor = (await pipeline("feature-extraction", MODEL)) as unknown as Extractor;
  return _extractor;
}

/** Embed texts → 384-dim mean-pooled, L2-normalized vectors. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}
