import { getDbSqlite } from "@/lib/db/raw";
import { resolveInboxFile } from "@/lib/reference/inbox";
import { ingestSource, ingestSrd } from "@/lib/reference/ingest";

// Module-level lock: embedding is CPU-heavy; one ingest at a time.
let ingesting = false;

interface Evt { type: "progress" | "done" | "error"; done?: number; total?: number; collection?: string; chunkCount?: number; message?: string }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { file?: string; srd?: boolean; collection?: string; notes?: string };

  if (ingesting) {
    return new Response(JSON.stringify({ error: "An ingest is already running." }), { status: 409, headers: { "content-type": "application/json" } });
  }

  let filePath: string | undefined;
  let collection: string;
  if (body.srd) {
    collection = "SRD 5.1";
  } else if (body.file) {
    try {
      filePath = resolveInboxFile(body.file);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Invalid file" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    collection = body.collection?.trim() || body.file.replace(/\.[^.]+$/, "");
  } else {
    return new Response(JSON.stringify({ error: "Provide a file or srd: true" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  ingesting = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Evt) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const sqlite = getDbSqlite();
        const onProgress = (done: number, total: number) => send({ type: "progress", done, total });
        const res = body.srd
          ? await ingestSrd(sqlite, { onProgress })
          : await ingestSource(sqlite, { filePath: filePath!, collection, notes: body.notes?.trim() || undefined, onProgress });
        send({ type: "done", collection, chunkCount: res.chunkCount });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Ingest failed" });
      } finally {
        ingesting = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
