export const words = (text) =>
  typeof text === "string" && text.trim() ? text.trim().split(/\s+/u).length : 0;
export const clone = (value) => structuredClone(value);
export const labels = {
  queued: "Đang chờ",
  waiting: "Đang chờ",
  running: "Đang tóm tắt",
  cancelling: "Đang dừng",
  success: "Hoàn thành",
  incomplete: "Chưa hoàn chỉnh",
  error: "Có lỗi",
  completed: "Hoàn thành",
  completed_with_errors: "Có lỗi",
  cancelled: "Đã dừng",
  failed: "Thất bại",
  interrupted: "Gián đoạn",
  unknown: "Chưa xác định",
};
export const activeStatuses = new Set(["queued", "running", "cancelling"]);
export function visibleResults(results, documentId, preview = false) {
  return results
    .filter(
      (result) =>
        result.document_id === documentId &&
        (preview || (!result.demo && !["mock-model", "mock-other"].includes(result.model))),
    )
    .slice()
    .reverse();
}
export function newDocument(index = 1, row = {}) {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    title: row.title || `Văn bản ${index}`,
    text: row.text || "",
    source: row.source || "Nhập tay",
    selected: true,
    overrides: {},
    ...(row.original ? { original: row.original } : {}),
  };
}
export const effective = (doc, common) => ({ ...common, ...doc.overrides });
export function targetWords(doc, common) {
  const s = effective(doc, common);
  return s.length.mode === "percent"
    ? Math.max(1, Math.ceil((words(doc.text) * s.length.value) / 100))
    : s.length.mode === "words"
      ? s.length.value
      : null;
}
export function groupKeys(group) {
  return {
    model: ["provider", "model"],
    prompts: ["prompts", "parameters"],
    length: ["length"],
    format: ["output_format"],
  }[group];
}
export function prepareResultView(state, ids) {
  const included = state.documents.filter((d) => ids.includes(d.id));
  if (!included.length) throw new Error("Chọn ít nhất một tài liệu.");
  if (!included.some((d) => d.id === state.active)) state.active = included[0].id;
  for (const doc of included) delete state.resultSelection[doc.id];
  state.resultRun = {
    jobId: null,
    documentIds: included.map((d) => d.id),
    revealPending: true,
  };
}
export function resultActivity(state) {
  const run = state.resultRun;
  if (state.busy && run?.jobId === null && run.documentIds.includes(state.active))
    return { status: "submitting" };
  const job = state.job;
  if (!job || !activeStatuses.has(job.status)) return null;
  const tasks = (job.tasks || []).filter((task) => task.document_id === state.active);
  const task =
    tasks.find((t) => t.status === "running") || tasks.find((t) => t.status === "waiting");
  if (!task) {
    if (!job.tasks && job.id === run?.jobId && run.documentIds.includes(state.active))
      return { status: "waiting" };
    return null;
  }
  return {
    status: job.status === "cancelling" ? "cancelling" : task.status,
    model: task.model,
    done: tasks.filter((t) => !["running", "waiting"].includes(t.status)).length,
    total: tasks.length,
  };
}
export function validateSettings(s) {
  if (!s.model || !s.provider) throw new Error("Chọn model đã cấu hình trên server.");
  if (!s.prompts?.length || s.prompts.some((p) => !p.name.trim() || !p.text.trim()))
    throw new Error("Chọn ít nhất một prompt có tên và nội dung.");
  if (new Set(s.prompts.map((p) => p.name.trim())).size !== s.prompts.length)
    throw new Error("Tên prompt trong cùng lượt cần khác nhau.");
  if (
    s.length.mode !== "auto" &&
    (!Number.isFinite(s.length.value) ||
      s.length.value < 1 ||
      (s.length.mode === "percent" && s.length.value > 100) ||
      (s.length.mode === "words" && !Number.isInteger(s.length.value)))
  )
    throw new Error("Phần trăm cần từ 1–100; số từ cần là số nguyên dương.");
  return s;
}
