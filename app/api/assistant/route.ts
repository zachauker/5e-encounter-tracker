import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runAssistant, type AssistantEvent } from "@/lib/assistant/agent";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string; messages?: unknown };
  const campaignId = body.campaignId;
  const messages = body.messages;
  if (!campaignId || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "campaignId and messages required" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  if (!keyRow?.value) {
    return new Response(JSON.stringify({ error: "Add an Anthropic API key in Settings first" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AssistantEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAssistant({ apiKey: keyRow.value, db, campaignId, messages: messages as never }, send);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Assistant failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
