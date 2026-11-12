import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { HookConflictError, WorkflowStartError } from "workflow/errors";
import { getAuthenticatedUser, hasSameOrigin } from "@/lib/supabase/user";
import { readJson, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { submitJob } from "@/lib/summarization";
import { summarizeJob } from "@/workflows/summarize";

export const maxDuration = 60;
export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Đăng nhập để tạo lượt chạy." }, { status: 401 });
  try {
    const idem = request.headers.get("idempotency-key") || "";
    if (idem.length < 8 || idem.length > 128)
      throw new Error("Yêu cầu cần Idempotency-Key từ 8–128 ký tự.");
    const rateKey = `jobs:${user.id}`,
      now = Date.now() / 1000;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rateKey},0))`;
      const rows = await tx.$queryRaw<
        Array<{ count: number; expires: number }>
      >`SELECT count,expires FROM limits WHERE key=${rateKey} FOR UPDATE`;
      const row = rows[0];
      if (row && row.expires > now && row.count >= 20)
        throw new Error("Thao tác quá nhanh. Vui lòng thử lại sau.");
      if (row && row.expires > now)
        await tx.$executeRaw`UPDATE limits SET count=count+1 WHERE key=${rateKey}`;
      else
        await tx.$executeRaw`INSERT INTO limits(key,count,expires) VALUES(${rateKey},1,${now + 60}) ON CONFLICT(key) DO UPDATE SET count=1,expires=EXCLUDED.expires`;
    });
    const id = await submitJob(user.id, await readJson(request), idem);
    const current = await prisma.$queryRaw<
      Array<{ state: { status: string } }>
    >`SELECT state FROM jobs WHERE id=${id}`;
    if (current[0]?.state.status === "queued") {
      const options = {
        experimental_hook: {
          token: `summora-job:${id}`,
          experimental_minRetention: "30 days",
        },
      } as const;
      const recordRun = async (runId: string) => {
        await prisma.$executeRaw`UPDATE jobs SET workflow_run=${runId} WHERE id=${id} AND workflow_run IS NULL`;
      };
      const markQueuedJobFailed = async () => {
        await prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{ state: Record<string, unknown> }>
          >`SELECT state FROM jobs WHERE id=${id} AND status='queued' FOR UPDATE`;
          if (!rows.length) return;
          const state = rows[0].state;
          state.status = "failed";
          state.message = "Không thể đưa lượt vào hàng đợi. Hãy thử lại.";
          await tx.$executeRaw`UPDATE jobs SET status='failed',state=${JSON.stringify(state)}::jsonb,reserved=0 WHERE id=${id}`;
        });
      };
      let runId: string | undefined;
      try {
        runId = (await start(summarizeJob, [id], options)).runId;
      } catch (error) {
        if (error instanceof HookConflictError) {
          if (error.conflictingRunId) await recordRun(error.conflictingRunId);
          return NextResponse.json(
            { id },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (error instanceof WorkflowStartError) {
          try {
            runId = (await start(summarizeJob, [id], options)).runId;
          } catch (retryError) {
            if (retryError instanceof HookConflictError) {
              if (retryError.conflictingRunId) await recordRun(retryError.conflictingRunId);
              return NextResponse.json(
                { id },
                { status: 202, headers: { "Cache-Control": "no-store" } },
              );
            }
            await markQueuedJobFailed();
            throw retryError;
          }
        } else {
          await markQueuedJobFailed();
          throw error;
        }
      }
      if (runId) await recordRun(runId);
    }
    return NextResponse.json({ id }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
