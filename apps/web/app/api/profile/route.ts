import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return NextResponse.json({ error: "Chưa cấu hình Supabase Auth." }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Vui lòng đăng nhập." }, { status: 401 });
  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, email: user.email },
    update: { email: user.email },
    select: { userId: true, email: true, role: true, dailyQuota: true },
  });
  return NextResponse.json({ profile });
}
