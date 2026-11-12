import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/supabase/user";
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để xem lịch sử." }, { status: 401 });
  const rows = await prisma.$queryRaw<
    Array<{ id: string; state: unknown; created: number }>
  >`SELECT id,state,created FROM jobs WHERE owner=${user.id}::uuid AND NOT deleted ORDER BY created DESC LIMIT 200`;
  const jobs = rows.map(({ id, state: rawState, created }) => {
    const state = rawState as Record<string, unknown>;
    const documents = state.documents as Array<Record<string, unknown>> | undefined;
    return {
      id,
      created,
      status: state.status,
      total: state.total,
      done: state.done,
      success: state.success,
      errors: state.errors,
      title: documents?.[0]?.title,
      documents: documents?.length || 0,
    };
  });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
