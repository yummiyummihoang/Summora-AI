import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Đăng nhập để lưu bản nháp." }, { status: 401 });
  const row = await prisma.draft.findUnique({ where: { owner: user.id } });
  return NextResponse.json(row ? { draft: row.body, updated: row.updated } : { draft: null });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Đăng nhập để lưu bản nháp." }, { status: 401 });
  const value = await request.json();
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.documents) ||
    value.documents.length > 1000
  ) {
    return NextResponse.json({ error: "Bản nháp nhận tối đa 1.000 tài liệu." }, { status: 400 });
  }
  const body = value as Prisma.InputJsonValue;
  const updated = Date.now() / 1000;
  await prisma.draft.upsert({
    where: { owner: user.id },
    create: { owner: user.id, body, updated },
    update: { body, updated },
  });
  return NextResponse.json({ saved: true });
}
