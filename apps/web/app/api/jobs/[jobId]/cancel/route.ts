import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để hủy lượt chạy." }, { status: 401 });
  const id = (await params).jobId;
  const changed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ status: string; state: unknown }>
    >`SELECT status,state FROM jobs WHERE id=${id} AND owner=${user.id}::uuid AND NOT deleted FOR UPDATE`;
    if (!rows.length) return false;
    const { status } = rows[0],
      state = rows[0].state as Record<string, unknown>;
    if (status === "queued") {
      state.status = "cancelled";
      state.message = "Đã hủy trước khi gửi API.";
      await tx.$executeRaw`UPDATE jobs SET status='cancelled',state=${JSON.stringify(state)}::jsonb,cancel=true,reserved=0 WHERE id=${id}`;
    } else if (["running", "cancelling"].includes(status)) {
      state.status = "cancelling";
      state.message = "Đang dừng; chờ request hiện tại kết thúc.";
      await tx.$executeRaw`UPDATE jobs SET status='cancelling',state=${JSON.stringify(state)}::jsonb,cancel=true WHERE id=${id}`;
    }
    return true;
  });
  return changed
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Không tìm thấy lượt chạy." }, { status: 404 });
}
