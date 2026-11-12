import {
  claimJob,
  finishJob,
  getTaskCount,
  isCancelled,
  markJobFailed,
  runTask,
} from "@/workflows/steps";

export async function summarizeJob(jobId: string) {
  "use workflow";
  try {
    if (!(await claimJob(jobId))) return;
    const count = await getTaskCount(jobId);
    if (!count) return;
    let cancelled = false;
    for (let i = 0; i < count; i++) {
      if (await isCancelled(jobId)) {
        cancelled = true;
        break;
      }
      await runTask(jobId, i);
    }
    await finishJob(jobId, cancelled);
  } catch (error) {
    await markJobFailed(jobId);
    throw error;
  }
}
