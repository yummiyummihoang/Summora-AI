import { NextResponse } from "next/server";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";
import { readJson } from "@/lib/http";
import { validatePayload } from "@/lib/summarization";
import { jsonError } from "@/lib/http";
export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  if (!(await getAuthenticatedUser(request)))
    return NextResponse.json({ error: "Đăng nhập để xác thực tài liệu." }, { status: 401 });
  try {
    return NextResponse.json(await validatePayload(await readJson(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
