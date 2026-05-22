import { getWebRuntimeVersionProof } from "../../lib/runtime-version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(getWebRuntimeVersionProof(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
