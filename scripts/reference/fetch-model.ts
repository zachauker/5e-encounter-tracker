import { embed } from "@/lib/reference/embed";

(async () => {
  const v = await embed(["warm up the model to populate the local cache"]);
  console.log("model ready, dim:", v[0].length);
})();
