import { NextRequest } from "next/server";
import { subscribe, getRequests } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fingerprint = request.cookies.get("__nni_fp")?.value;
  if (!fingerprint) {
    return new Response("Missing __nni_fp cookie", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send existing requests as initial batch
      const existing = getRequests(fingerprint);
      for (const req of existing) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(req)}\n\n`));
      }

      // Subscribe to new requests
      const unsubscribe = subscribe(fingerprint, (req) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(req)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
