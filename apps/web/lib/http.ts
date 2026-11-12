import { NextResponse } from "next/server";

export function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!message)
    return NextResponse.json(
      { error: "Không thể xử lý yêu cầu lúc này." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  if (
    /prisma|database|postgres|connection|\bsql\b|ENOTFOUND|timeout|socket|fetch failed|storage failed|workflow|world|deployment/i.test(
      message,
    )
  ) {
    return NextResponse.json(
      { error: "Không thể xử lý yêu cầu lúc này." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const status = /tối đa 4 MB/i.test(message)
    ? 413
    : /không tìm thấy/i.test(message)
      ? 404
      : /quá nhanh|vượt hạn mức|đang chạy|đã chạm hạn mức/i.test(message)
        ? 429
        : 400;
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJson(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4 * 1024 * 1024) throw new Error("Yêu cầu tối đa 4 MB.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024)
    throw new Error("Yêu cầu tối đa 4 MB.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON không hợp lệ.");
  }
}
