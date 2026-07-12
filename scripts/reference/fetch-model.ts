import { env } from "@huggingface/transformers";

// transformers.js reads LOCAL models from env.localModelPath but writes REMOTE
// downloads to env.cacheDir (a node_modules cache by default). To make the
// downloaded weights land where prod reads them, point BOTH at the target dir
// BEFORE anything triggers a model load. The cache layout mirrors
// {model}/{filename} under cacheDir, matching the localModelPath lookup layout,
// so cacheDir === localModelPath makes prod's local read resolve.
const target = process.env.REFERENCE_MODEL_DIR || "reference-data/models";
env.cacheDir = target;
env.localModelPath = target;
env.allowRemoteModels = true;

(async () => {
  // Import embed AFTER setting env above. embed.ts sets some env at module load,
  // but the actual model load only happens on the first embed() call, and env is
  // a shared singleton — so re-assert the download target right before calling.
  const { embed } = await import("@/lib/reference/embed");
  env.cacheDir = target;
  env.localModelPath = target;
  env.allowRemoteModels = true;
  const v = await embed(["warm up the model to populate the local cache"]);
  console.log("model ready, dim:", v[0].length);
})();
