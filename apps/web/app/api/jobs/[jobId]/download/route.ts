import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/user";
import { buildResultFile, getJob } from "@/lib/summarization";
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để tải kết quả." }, { status: 401 });
  try {
    const { jobId } = await params,
      state = await getJob(user.id, jobId);
    if (!state.download_ready)
      return NextResponse.json({ error: "Chưa có file kết quả." }, { status: 404 });
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) {
      const body = JSON.stringify(buildResultFile(state), null, 2);
      return new Response(body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="summaries_${jobId.slice(0, 8)}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const bucket = process.env.STUDIO_RESULTS_BUCKET || "summora-results";
    const response = await fetch(
      `${base.replace(/\/$/, "")}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeURIComponent(jobId + ".json")}`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 300, download: `summaries_${jobId.slice(0, 8)}.json` }),
        cache: "no-store",
      },
    );
    if (!response.ok)
      return NextResponse.json({ error: "Chưa có file kết quả để tải." }, { status: 404 });
    const signed = (await response.json()).signedURL;
    const url = signed.startsWith("http")
      ? signed
      : `${base.replace(/\/$/, "")}${signed.startsWith("/storage/v1/") ? "" : "/storage/v1"}${signed}`;
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Chưa có file kết quả để tải." }, { status: 404 });
  }
}
