import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/user";
import { getJob } from "@/lib/summarization";
import { jsonError } from "@/lib/http";
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để xem lượt chạy." }, { status: 401 });
  try {
    return NextResponse.json(await getJob(user.id, (await params).jobId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
