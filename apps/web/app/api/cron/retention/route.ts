import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (
    !secret ||
    bearer.length !== secret.length ||
    !timingSafeEqual(Buffer.from(bearer), Buffer.from(secret))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.max(1, Number(process.env.STUDIO_RETENTION_DAYS || 30));
  const before = Date.now() / 1000 - days * 86400;
  const candidates = await prisma.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM jobs WHERE created<${before} AND NOT deleted AND status NOT IN ('queued','running','cancelling')`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.STUDIO_RESULTS_BUCKET || "summora-results";
  if (candidates.length && (!base || !key))
    return NextResponse.json({ error: "Supabase Storage is not configured." }, { status: 503 });
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const prefixes = candidates.slice(offset, offset + 100).map(({ id }) => `${id}.json`);
    const response = await fetch(
      `${base!.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`,
      {
        method: "DELETE",
        headers: {
          apikey: key!,
          Authorization: `Bearer ${key!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes }),
        cache: "no-store",
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: "Could not remove expired result files." },
        { status: 502 },
      );
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE jobs SET deleted=true,body='{}'::jsonb,state='{}'::jsonb WHERE created<${before} AND NOT deleted AND status NOT IN ('queued','running','cancelling')`;
    await tx.$executeRaw`DELETE FROM drafts WHERE updated<${before}`;
    await tx.$executeRaw`DELETE FROM limits WHERE expires<${Date.now() / 1000}`;
  });
  return NextResponse.json({ pruned: candidates.length, retention_days: days });
}
