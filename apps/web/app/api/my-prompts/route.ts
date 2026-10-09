import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";

type Prompt = { name: string; text: string };

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Đăng nhập để xem prompt riêng." }, { status: 401 });
  const row = await prisma.promptLibrary.findUnique({ where: { owner: user.id } });
  return NextResponse.json({ prompts: row?.body ?? [] });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Đăng nhập để lưu prompt riêng." }, { status: 401 });
  const value = await request.json();
  const prompts = value?.prompts as Prompt[] | undefined;
  if (
    !Array.isArray(prompts) ||
    prompts.length > 100 ||
    prompts.some(
      (prompt) =>
        !prompt ||
        typeof prompt.name !== "string" ||
        !prompt.name.trim() ||
        typeof prompt.text !== "string" ||
        !prompt.text.trim() ||
        prompt.text.length > 10_000,
    )
  ) {
    return NextResponse.json(
      { error: "Thư viện cần tối đa 100 prompt hợp lệ; mỗi prompt tối đa 10.000 ký tự." },
      { status: 400 },
    );
  }
  const body = prompts as Prisma.InputJsonValue;
  await prisma.promptLibrary.upsert({
    where: { owner: user.id },
    create: { owner: user.id, body },
    update: { body },
  });
  return NextResponse.json({ saved: true });
}
