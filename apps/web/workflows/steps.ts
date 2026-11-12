import { prisma } from "@/lib/prisma";
import {
  finalizeJob,
  processTask,
  saveTaskResult,
  taskCount,
  type AnyObject,
} from "@/lib/summarization";

export async function claimJob(jobId: string) {
  "use step";
  const rows = await prisma.$queryRaw<
    Array<{ id: string }>
  >`UPDATE jobs SET status='running' WHERE id=${jobId} AND status='queued' AND NOT deleted RETURNING id`;
  return rows.length > 0;
}

export async function runTask(jobId: string, index: number) {
  "use step";
  const result = await processTask(jobId, index);
  if (result) await saveTaskResult(jobId, index, result);
  return Boolean(result);
}

export async function isCancelled(jobId: string) {
  "use step";
  const rows = await prisma.$queryRaw<AnyObject[]>`SELECT cancel FROM jobs WHERE id=${jobId}`;
  return !rows.length || Boolean(rows[0].cancel);
}

export async function getTaskCount(jobId: string) {
  "use step";
  return taskCount(jobId);
}

export async function finishJob(jobId: string, cancelled: boolean) {
  "use step";
  await finalizeJob(jobId, cancelled);
}

export async function markJobFailed(jobId: string) {
  "use step";
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ state: AnyObject }>
    >`SELECT state FROM jobs WHERE id=${jobId} FOR UPDATE`;
    if (!rows.length) return;
    const state = rows[0].state;
    if (["completed", "completed_with_errors", "cancelled"].includes(state.status)) return;
    state.status = "failed";
    state.message = "Không thể hoàn tất lượt xử lý. Thử lại hoặc liên hệ quản trị viên.";
    await tx.$executeRaw`UPDATE jobs SET status='failed',state=${JSON.stringify(state)}::jsonb,reserved=0 WHERE id=${jobId}`;
  });
}
