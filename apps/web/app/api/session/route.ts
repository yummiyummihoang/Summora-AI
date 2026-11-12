import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/supabase/user";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  const retention = Math.max(1, Number(process.env.STUDIO_RETENTION_DAYS || 30));
  if (!user)
    return NextResponse.json(
      { mode: "online", user: null, usage: null, retention_days: retention },
      { headers: { "Cache-Control": "no-store" } },
    );
  const day = new Date().toISOString().slice(0, 10);
  const [usageRows, profileRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ used: bigint | number }>
    >`SELECT COALESCE(SUM(reserved+charged),0) AS used FROM jobs WHERE owner=${user.id}::uuid AND day=${day}`,
    prisma.$queryRaw<
      Array<{ daily_quota: number }>
    >`SELECT daily_quota FROM profiles WHERE user_id=${user.id}::uuid`,
  ]);
  const used = Number(usageRows[0]?.used || 0),
    limit = Number(profileRows[0]?.daily_quota || 200);
  return NextResponse.json(
    {
      mode: "online",
      user: { id: user.id, email: user.email, role: "member" },
      usage: { used, limit, remaining: Math.max(0, limit - used), day },
      retention_days: retention,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
