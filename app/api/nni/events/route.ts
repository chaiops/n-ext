import { NextRequest } from "next/server";
import { subscribe, getRequests } from "@/lib/store";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getConfig();
  const fingerprint = request.cookies.get(config.cookieName)?.value;
  if (!fingerprint) {
    return new Response(`Missing ${config.cookieName} cookie`, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const existing = getRequests(fingerprint);
      for (const req of existing) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(req)}\n\n`));
      }

      const unsubscribe = subscribe(fingerprint, (req) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(req)}\n\n`));
        } catch (err) {
          console.error("[NNI] SSE enqueue error:", err);
          unsubscribe();
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch (err) {
          console.debug("[NNI] Stream already closed:", err);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": config.corsOrigin,
    },
  });
}
