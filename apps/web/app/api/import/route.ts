import { NextResponse } from "next/server";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";
import { importDocument } from "@/lib/imports";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để nhập tài liệu." }, { status: 401 });
  try {
    await prisma.$transaction(async (tx) => {
      const key = `import:${user.id}`,
        now = Date.now() / 1000;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      const rows = await tx.$queryRaw<
        Array<{ count: number; expires: number }>
      >`SELECT count,expires FROM limits WHERE key=${key} FOR UPDATE`;
      const row = rows[0];
      if (row && row.expires > now && row.count >= 120)
        throw new Error("Thao tác quá nhanh. Vui lòng thử lại sau.");
      if (row && row.expires > now)
        await tx.$executeRaw`UPDATE limits SET count=count+1 WHERE key=${key}`;
      else
        await tx.$executeRaw`INSERT INTO limits(key,count,expires) VALUES(${key},1,${now + 60}) ON CONFLICT(key) DO UPDATE SET count=1,expires=EXCLUDED.expires`;
    });
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File)) throw new Error("Chưa chọn file.");
    const parsed = await importDocument(
      file,
      String(form.get("kind") || "data"),
      String(form.get("field") || "document"),
    );
    return NextResponse.json({ parsed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
