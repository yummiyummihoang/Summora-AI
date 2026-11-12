import { NextResponse } from "next/server";
import { providerConfigs } from "@/lib/summarization";
export async function GET() {
  return NextResponse.json(
    { providers: providerConfigs(), mode: "online", demo: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
