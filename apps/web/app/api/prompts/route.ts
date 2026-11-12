import { NextResponse } from "next/server";
import library from "@/data/prompt_library.json";
export async function GET() {
  return NextResponse.json(library, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
