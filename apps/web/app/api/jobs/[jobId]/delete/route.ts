import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để xóa lượt chạy." }, { status: 401 });
  const id = (await params).jobId;
  const rows = await prisma.$queryRaw<
    Array<{ status: string }>
  >`SELECT status FROM jobs WHERE id=${id} AND owner=${user.id}::uuid AND NOT deleted`;
  if (!rows.length)
    return NextResponse.json({ error: "Không tìm thấy lượt chạy." }, { status: 404 });
  if (["queued", "running", "cancelling"].includes(rows[0].status))
    return NextResponse.json({ error: "Dừng lượt chạy trước khi xóa." }, { status: 400 });
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket = process.env.STUDIO_RESULTS_BUCKET || "summora-results";
  if (base && key)
    await fetch(`${base.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [`${id}.json`] }),
    });
  await prisma.$executeRaw`UPDATE jobs SET deleted=true,body='{}'::jsonb,state='{}'::jsonb WHERE id=${id} AND owner=${user.id}::uuid`;
  return NextResponse.json({ ok: true });
}
