import { api, setCsrf } from "./api.js?v=progress-3";
import {
  words,
  clone,
  labels,
  activeStatuses,
  newDocument,
  effective,
  targetWords,
  groupKeys,
  prepareResultView,
  resultActivity,
  visibleResults,
  validateSettings,
} from "./state.js?v=progress-3";
const $ = (id) => document.getElementById(id);
const state = {
  documents: [newDocument()],
  active: null,
  common: {
    provider: "openai",
    model: "",
    prompts: [],
    parameters: { N: 1 },
    length: { mode: "percent", value: 20 },
    output_format: "paragraph",
  },
  results: [],
  resultSelection: {},
  jobIds: [],
  job: null,
  user: null,
  mode: "local",
  configs: {},
  sets: [],
  privatePrompts: [],
  field: "document",
  history: [],
  busy: false,
  importing: false,
};
state.active = state.documents[0].id;
let ready = false,
  dirty = false,
  saving = false,
  saveTimer,
  pollTimer,
  jobRefresh,
  deleteSelection = [],
  draftGeneration = 0,
  pendingSubmission = null,
  dialogScope = null,
  dialogPrompts = [];
const current = () => state.documents.find((d) => d.id === state.active) || state.documents[0];
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function notice(message = "", error = false) {
  $("notice").textContent = message;
  $("notice").className = "notice" + (error ? " error" : "");
  $("notice").hidden = !message;
}
function report(error) {
  notice(error.message || String(error), true);
}
function option(value, label) {
  const n = node("option", "", label);
  n.value = value;
  return n;
}
function modelKey(s) {
  return `${s.provider}::${s.model}`;
}
function parseModel(value) {
  const i = value.indexOf("::");
  return { provider: value.slice(0, i), model: value.slice(i + 2) };
}
function modelChoices(select, value) {
  select.replaceChildren();
  for (const [id, c] of Object.entries(state.configs))
    for (const model of c.models || []) {
      const o = option(
        `${id}::${model}`,
        `${c.label} · ${model}${c.ready ? "" : " (chưa có key)"}`,
      );
      o.disabled = !c.ready;
      select.append(o);
    }
  if (!select.options.length) select.append(option("", "Chưa có model được cấu hình"));
  if ([...select.options].some((o) => o.value === value)) select.value = value;
  else if (value && parseModel(value).model) {
    select.append(option(value, `${parseModel(value).model} (không còn được cấu hình)`));
    select.value = value;
  } else select.value = [...select.options].find((o) => !o.disabled)?.value || "";
}
function allPrompts() {
  return state.sets
    .flatMap((s) => s.prompts.map((p, i) => ({ ...p, set: s.name, key: `${s.id}:${i}` })))
    .concat(
      state.privatePrompts.map((p, i) => ({
        ...p,
        set: "Thư viện riêng",
        key: `private:${i}`,
      })),
    );
}
function renderCommon() {
  modelChoices($("model"), modelKey(state.common));
  $("length-mode").value = state.common.length.mode;
  $("length-value").value = state.common.length.value || 20;
  $("length-value").hidden = state.common.length.mode === "auto";
  $("length-value").max = state.common.length.mode === "percent" ? "100" : "";
  $("length-value").step = state.common.length.mode === "percent" ? "0.1" : "1";
  $("style-prompt").replaceChildren();
  for (const p of allPrompts()) $("style-prompt").append(option(p.key, p.name));
  const match =
    state.common.prompts.length === 1
      ? allPrompts().find(
          (p) => p.name === state.common.prompts[0].name && p.text === state.common.prompts[0].text,
        )
      : null;
  if (match) $("style-prompt").value = match.key;
  else {
    $("style-prompt").append(option("custom", `${state.common.prompts.length} prompt tùy chỉnh`));
    $("style-prompt").value = "custom";
  }
  updateMeta();
}
function draft() {
  return {
    version: 2,
    documents: state.documents,
    active: state.active,
    common: state.common,
    jobIds: state.jobIds,
    field: state.field,
  };
}
function changed() {
  if (!ready) return;
  dirty = true;
  draftGeneration++;
  $("save-status").textContent = state.user ? "Đang chờ lưu…" : "Chưa lưu · cần đăng nhập";
  clearTimeout(saveTimer);
  if (state.user) saveTimer = setTimeout(saveDraft, 600);
}
async function saveDraft() {
  if (saving || !dirty || !state.user) return;
  saving = true;
  const generation = draftGeneration;
  $("save-status").textContent = "Đang lưu…";
  try {
    await api("/api/draft", draft());
    if (generation === draftGeneration) {
      dirty = false;
      $("save-status").textContent = "Đã lưu bản nháp";
      $("save-status").classList.remove("failed");
    }
  } catch (e) {
    $("save-status").textContent = "Lưu thất bại · thử lại";
    $("save-status").classList.add("failed");
    report(e);
  } finally {
    saving = false;
    if (dirty && generation !== draftGeneration) saveTimer = setTimeout(saveDraft, 100);
  }
}
function renderDocuments() {
  const list = $("document-list");
  list.replaceChildren();
  for (const doc of state.documents) {
    const item = node("div", "document-item" + (doc.id === state.active ? " active" : "")),
      top = node("div", "document-top"),
      check = node("input");
    check.type = "checkbox";
    check.checked = doc.selected;
    check.setAttribute("aria-label", `Chọn ${doc.title}`);
    check.onchange = () => {
      doc.selected = check.checked;
      updateMeta();
      changed();
    };
    const open = node("button", "document-open");
    open.setAttribute("aria-current", String(doc.id === state.active));
    open.append(
      node("strong", "", doc.title || "Chưa đặt tên"),
      node(
        "small",
        "",
        `${words(doc.text)} từ${Object.keys(doc.overrides || {}).length ? " · tùy chọn riêng" : ""}`,
      ),
    );
    open.onclick = () => activate(doc.id);
    const run = node("button", "rail-run", "Tóm tắt tài liệu →");
    run.disabled = state.busy || state.importing || !doc.text.trim();
    run.onclick = () => runDocuments([doc.id]);
    top.append(check, open);
    item.append(top, run);
    list.append(item);
  }
  $("doc-count").textContent = state.documents.length;
  updateMeta();
}
function activate(id) {
  state.active = id;
  $("document-rail").classList.remove("open");
  renderSource();
  renderDocuments();
  renderResults();
  if (activeStatuses.has(state.job?.status)) refreshJob().catch(report);
  changed();
}
function renderSource() {
  const d = current();
  $("source-title").value = d.title;
  $("source-text").value = d.text;
  updateMeta();
}
function updateMeta() {
  const d = current();
  if (!d) return;
  const s = effective(d, state.common),
    count = words(d.text),
    target = targetWords(d, state.common);
  $("source-count").textContent = `${count.toLocaleString("vi")} từ`;
  $("source-origin").textContent = d.source;
  $("revision").textContent = `v${d.revision}`;
  $("target-info").textContent =
    `Mục tiêu: ${count ? (target === null ? "tự động" : `~${target.toLocaleString("vi")} từ`) : "—"}`;
  $("task-info").textContent =
    `${s.prompts.length} prompt · ${Object.keys(d.overrides || {}).length ? "tùy chọn riêng" : "cấu hình chung"}`;
  $("override-badge").hidden = !Object.keys(d.overrides || {}).length;
  $("override-badge").textContent = "Tùy chọn riêng";
  const selected = state.documents.filter((d) => d.selected),
    requests = selected.reduce((n, d) => n + effective(d, state.common).prompts.length, 0);
  $("batch-count").textContent =
    `Đã chọn ${selected.length}/${state.documents.length} tài liệu · ${requests} tác vụ`;
  for (const id of ["rail-select-all"]) {
    $(id).checked = selected.length === state.documents.length;
    $(id).indeterminate = selected.length > 0 && selected.length < state.documents.length;
  }
  $("run-document").disabled = state.busy || state.importing || !d.text.trim();
  $("run-batch").disabled = state.busy || state.importing || !selected.length;
  $("delete-selected").disabled = state.busy || state.importing || !selected.length;
  $("config-note").textContent =
    state.common.length.mode === "percent"
      ? `${state.common.length.value}% = giữ lại khoảng ${state.common.length.value}% số từ nguồn. Độ dài mục tiêu cho phép sai lệch ±10%.`
      : state.common.length.mode === "words"
        ? `${state.common.length.value} từ là độ dài mục tiêu. Độ dài thực tế có thể chênh lệch.`
        : "Độ dài do model và prompt quyết định.";
  for (const id of [
    "model",
    "style-prompt",
    "length-mode",
    "length-value",
    "advanced",
    "doc-options",
    "source-title",
    "source-text",
    "delete-document",
  ])
    $(id).disabled = state.busy;
  renderProgress();
}
function resultsForCurrent() {
  return visibleResults(state.results, current().id, state.demo);
}
function selectedResult() {
  return resultsForCurrent()[Number($("result-version").value) || 0];
}
function renderResults(preferred) {
  const activity = resultActivity(state);
  $("result-body").setAttribute("aria-busy", String(!!activity));
  if (activity) {
    renderResultActivity(activity);
    return;
  }
  delete $("result-body").dataset.loadingKey;
  const list = resultsForCurrent(),
    select = $("result-version");
  select.replaceChildren();
  list.forEach((r, i) =>
    select.append(
      option(
        String(i),
        `${r.prompt_name} · ${r.model} · nguồn v${r.document_revision} · ${new Date(r.created * 1000).toLocaleString("vi")}`,
      ),
    ),
  );
  preferred = preferred || state.resultSelection[current().id];
  if (preferred) {
    const index = list.findIndex((r) => r.task_id === preferred);
    if (index >= 0) select.value = String(index);
  }
  const r = list[Number(select.value) || 0];
  $("result-controls").hidden = !r;
  $("retry-result").hidden = !r || state.busy || r.demo;
  $("result-meta").replaceChildren();
  if (!r) {
    const task = state.job?.tasks?.find((t) => t.document_id === current().id),
      working = !!task && state.busy;
    $("result-badge").textContent = working
      ? "Đang xử lý"
      : task
        ? labels[task.status] || "Chưa có kết quả"
        : "Chưa có kết quả";
    $("result-badge").className = "badge";
    $("result-body").replaceChildren();
    const empty = node("div", "result-empty");
    empty.append(
      node("span", "empty-mark", "≡"),
      node(
        "h3",
        "",
        working
          ? "Đang tạo bản tóm tắt…"
          : task
            ? "Tài liệu chưa có bản tóm tắt."
            : "Chưa có bản tóm tắt.",
      ),
      node(
        "p",
        "",
        working
          ? "Kết quả sẽ hiện tại đây ngay khi model trả lời."
          : task
            ? state.job.message
            : "Bản tóm tắt sẽ xuất hiện bên cạnh nguồn để bạn dễ đọc và đối chiếu.",
      ),
    );
    if (!task) {
      const steps = node("div", "empty-steps");
      for (const t of ["01 Thêm nội dung", "02 Chọn độ dài", "03 Tóm tắt"])
        steps.append(node("span", "", t));
      empty.append(steps);
    }
    $("result-body").append(empty);
    return;
  }
  const stale = r.document_revision !== current().revision,
    testResult = ["mock-model", "mock-other"].includes(r.model);
  $("result-badge").textContent = stale
    ? "Nguồn đã thay đổi"
    : r.demo
      ? "Minh họa có sẵn"
      : testResult
        ? "Kết quả kiểm thử"
        : labels[r.status] || r.status;
  $("result-badge").className =
    "badge" +
    (stale || r.status === "incomplete" ? " warning" : r.status === "error" ? " error" : "");
  $("result-body").textContent =
    r.summary || (typeof r.error === "string" ? r.error : r.error?.message) || "Chưa có nội dung.";
  for (const text of [
    r.model,
    `${r.actual_words ?? "—"} từ`,
    `${r.actual_percent ?? "—"}% nguồn`,
    `Nguồn v${r.document_revision}`,
    r.length_ok === false
      ? "Ngoài khoảng độ dài mục tiêu"
      : r.target_words
        ? `Mục tiêu ${r.target_words} từ`
        : null,
  ])
    if (text) $("result-meta").append(node("span", "", text));
  $("export-json").hidden = !!r.demo;
  $("export-json").href = `/api/jobs/${encodeURIComponent(r.job_id)}/download`;
  $("export-json").setAttribute("download", "");
  $("copy-result").disabled = !r.summary;
  $("export-txt").disabled = !r.summary;
}
function renderResultActivity(activity) {
  const titles = {
    submitting: "Đang gửi yêu cầu…",
    waiting: "Đang chờ tóm tắt…",
    running: "Đang tóm tắt…",
    cancelling: "Đang dừng tóm tắt…",
  };
  const descriptions = {
    submitting: "Đang kết nối với không gian xử lý của bạn.",
    waiting: "Tài liệu đã vào hàng đợi. Kết quả sẽ hiện tại đây khi hoàn tất.",
    running: "AI đang xử lý nội dung và tạo bản tóm tắt cho bạn.",
    cancelling: "Đang chờ yêu cầu hiện tại kết thúc. Kết quả đã có sẽ được giữ lại.",
  };
  $("result-badge").textContent = titles[activity.status];
  $("result-badge").className = "badge";
  $("result-controls").hidden = true;
  $("retry-result").hidden = true;
  $("result-meta").replaceChildren();
  const key = `${current().id}:${JSON.stringify(activity)}`;
  if (
    $("result-body").dataset.loadingKey === key &&
    $("result-body").firstElementChild?.classList.contains("summary-loading")
  )
    return;
  const loading = node("div", "summary-loading");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  const symbol = node("div", "summary-loading-symbol");
  symbol.setAttribute("aria-hidden", "true");
  symbol.append(node("span", "summary-loading-ring"), node("span", "summary-loading-icon", "≡"));
  loading.append(
    symbol,
    node("h3", "", titles[activity.status]),
    node("p", "", descriptions[activity.status]),
  );
  if (activity.model)
    loading.append(
      node(
        "span",
        "summary-loading-detail",
        `${activity.model} · ${activity.done}/${activity.total} prompt hoàn tất`,
      ),
    );
  const skeleton = node("div", "summary-skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) skeleton.append(node("span", ""));
  loading.append(skeleton);
  $("result-body").replaceChildren(loading);
  $("result-body").dataset.loadingKey = key;
}
function renderProgress() {
  const job = state.job;
  $("job-progress").hidden = !job;
  if (!job) return;
  $("job-status").textContent = labels[job.status] || job.status;
  $("progress-text").textContent = `${job.done}/${job.total} tác vụ · ${job.message}`;
  $("progress").max = job.total || 1;
  $("progress").value = job.done;
  $("cancel-job").disabled = !activeStatuses.has(job.status) || job.status === "cancelling";
  $("cancel-job").textContent = job.status === "cancelling" ? "Đang dừng…" : "Dừng lượt chạy";
}
function ingest(job) {
  state.job = job;
  state.busy = activeStatuses.has(job.status);
  if (!state.jobIds.includes(job.id)) state.jobIds.push(job.id);
  for (const r of job.results)
    if (!state.results.some((x) => x.task_id === r.task_id))
      state.results.push({
        ...r,
        job_id: job.id,
        created: job.created || Date.now() / 1000,
      });
  if (
    state.resultRun?.jobId === job.id &&
    state.resultRun.revealPending &&
    job.results.some((r) => r.document_id === current().id)
  ) {
    state.resultRun.revealPending = false;
    setMobileTab(true);
  }
  renderDocuments();
  renderResults();
  updateMeta();
}
async function refreshJob() {
  const id = state.job?.id;
  if (!id) return;
  if (jobRefresh?.id === id) return jobRefresh.promise;
  const promise = api(`/api/jobs/${id}`).then((job) => {
    // Ignore an obsolete response after a different run or workspace was opened.
    if (state.job?.id === id) ingest(job);
    return job;
  });
  jobRefresh = { id, promise };
  try {
    return await promise;
  } finally {
    if (jobRefresh?.promise === promise) jobRefresh = null;
  }
}
async function poll() {
  if (!state.job || !activeStatuses.has(state.job.status)) return;
  try {
    await refreshJob();
    if (state.busy) pollTimer = setTimeout(poll, 900);
    else {
      changed();
      await refreshSession();
    }
  } catch (e) {
    report(e);
    if (e.status === 401) {
      state.busy = false;
      updateMeta();
      return;
    }
    pollTimer = setTimeout(poll, 3000);
  }
}
function payload(ids, special) {
  const docs = state.documents.filter((d) => ids.includes(d.id));
  if (!docs.length) throw new Error("Chọn ít nhất một tài liệu.");
  for (const d of docs) {
    if (!d.text.trim()) throw new Error(`${d.title}: chưa có nội dung.`);
    validateSettings(special || effective(d, state.common));
  }
  return {
    settings: state.common,
    documents: docs.map((d) => ({
      ...clone(d),
      overrides: special || d.overrides || {},
    })),
  };
}
async function runDocuments(ids, special) {
  if (state.busy || state.importing) return;
  if (!state.user) {
    openAccount();
    return;
  }
  try {
    notice();
    const body = payload(ids, special);
    prepareResultView(state, ids);
    closeRail();
    renderSource();
    renderDocuments();
    renderResults();
    pendingSubmission = { key: crypto.randomUUID(), body };
    await sendPending();
  } catch (e) {
    report(e);
  }
}
async function sendPending() {
  if (!pendingSubmission) return;
  state.busy = true;
  updateMeta();
  renderResults();
  setMobileTab(true);
  $("retry-submit").hidden = true;
  let accepted = false;
  try {
    const result = await api("/api/jobs", pendingSubmission.body, {
      "Idempotency-Key": pendingSubmission.key,
    });
    accepted = true;
    pendingSubmission = null;
    if (state.resultRun) state.resultRun.jobId = result.id;
    state.job = {
      id: result.id,
      status: "queued",
      total: 0,
      done: 0,
      message: "Yêu cầu đã được nhận. Đang nạp tiến trình…",
    };
    if (!state.jobIds.includes(result.id)) state.jobIds.push(result.id);
    changed();
    await saveDraft();
    ingest(await api(`/api/jobs/${result.id}`));
    clearTimeout(pollTimer);
    poll();
  } catch (e) {
    state.busy = accepted;
    updateMeta();
    renderResults();
    $("retry-submit").hidden = accepted || !pendingSubmission;
    if (accepted) pollTimer = setTimeout(poll, 1500);
    throw e;
  }
}
function addDocuments(rows) {
  if (rows.some((r) => r.text) && state.documents.length === 1 && !current().text.trim())
    state.documents = [];
  const added = rows.map((row, index) => newDocument(state.documents.length + index + 1, row));
  state.documents.unshift(...added);
  if (added.length) state.active = added[0].id;
  closeRail();
  setMobileTab(false);
  renderSource();
  renderDocuments();
  renderResults();
  $("document-list").scrollTop = 0;
  changed();
}
async function importFiles(files, kind = "data") {
  if (!files.length || state.importing) return;
  if (!state.user) {
    notice("Đăng nhập để nạp file.", true);
    openAccount();
    return;
  }
  state.importing = true;
  updateMeta();
  const errors = [];
  for (const file of files) {
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error("Vượt 24 MB/file.");
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("field", state.field);
      const { parsed } = await api("/api/import", form);
      if (kind === "prompts") {
        dialogPrompts = parsed.map((p) => ({ ...p, selected: true }));
        renderPromptEditors();
        syncDialogGroups();
      } else addDocuments(parsed);
    } catch (e) {
      errors.push(`${file.name}: ${e.message}`);
    }
  }
  state.importing = false;
  renderDocuments();
  notice(
    errors.length ? errors.join("\n") : "Đã nạp file. Nội dung được thêm vào danh sách.",
    errors.length > 0,
  );
}
function openSettings(doc = null) {
  dialogScope = doc?.id || null;
  const s = clone(doc ? effective(doc, state.common) : state.common);
  dialogPrompts = s.prompts.map((p) => ({ ...p, selected: true }));
  $("settings-heading").textContent = doc ? "Tùy chọn tài liệu" : "Tùy chọn nâng cao";
  $("settings-scope").textContent = doc ? doc.title : "CẤU HÌNH CHUNG";
  $("inherit-note").hidden = !doc;
  $("reset-overrides").hidden = !doc;
  $("settings-error").hidden = true;
  $("settings-error").className = "notice error";
  modelChoices($("advanced-model"), modelKey(s));
  $("advanced-n").value = s.parameters?.N || 1;
  $("advanced-length-mode").value = s.length.mode;
  $("advanced-length-value").value = s.length.value || 20;
  $("advanced-format").value = s.output_format;
  $("document-field").value = state.field;
  $("prompt-set").replaceChildren();
  for (const set of state.sets) $("prompt-set").append(option(set.id, set.name));
  if (state.privatePrompts.length) $("prompt-set").append(option("private", "Thư viện riêng"));
  document.querySelectorAll(".group-toggle").forEach((label) => {
    label.hidden = !doc;
    const check = label.querySelector("input");
    check.checked =
      !!doc && groupKeys(check.dataset.toggle).some((k) => k in (doc.overrides || {}));
  });
  renderPromptEditors();
  syncDialogGroups();
  $("settings-dialog").showModal();
}
function syncDialogGroups() {
  for (const group of ["model", "prompts", "length", "format"]) {
    const enabled = !dialogScope || document.querySelector(`[data-toggle="${group}"]`).checked,
      fields = document.querySelector(`[data-fields="${group}"]`);
    fields.classList.toggle("inherited", !enabled);
    fields.querySelectorAll("input,select,textarea,button").forEach((n) => (n.disabled = !enabled));
  }
  syncAdvancedLength();
}
function syncAdvancedLength() {
  const mode = $("advanced-length-mode").value;
  $("advanced-length-value").hidden = mode === "auto";
  $("advanced-length-value").max = mode === "percent" ? "100" : "";
  $("advanced-length-value").step = mode === "percent" ? "0.1" : "1";
}
function renderPromptEditors() {
  const list = $("prompt-editor-list");
  list.replaceChildren();
  dialogPrompts.forEach((p, index) => {
    const box = node("div", "prompt-editor"),
      top = node("div", "prompt-edit-top"),
      check = node("input");
    check.type = "checkbox";
    check.checked = p.selected;
    check.setAttribute("aria-label", `Dùng prompt ${index + 1}`);
    check.onchange = () => (p.selected = check.checked);
    const name = node("input");
    name.type = "text";
    name.value = p.name;
    name.setAttribute("aria-label", `Tên prompt ${index + 1}`);
    name.oninput = () => (p.name = name.value);
    const remove = node("button", "icon-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Xóa prompt ${index + 1}`);
    remove.onclick = () => {
      dialogPrompts.splice(index, 1);
      renderPromptEditors();
      syncDialogGroups();
    };
    const text = node("textarea");
    text.value = p.text;
    text.rows = 4;
    text.setAttribute("aria-label", `Nội dung prompt ${index + 1}`);
    text.oninput = () => (p.text = text.value);
    top.append(check, name, remove);
    box.append(top, text);
    list.append(box);
  });
}
function dialogSettings() {
  return {
    ...parseModel($("advanced-model").value),
    prompts: dialogPrompts
      .filter((p) => p.selected)
      .map((p) => ({ name: p.name.trim(), text: p.text.trim() })),
    parameters: { N: Number($("advanced-n").value) },
    length: {
      mode: $("advanced-length-mode").value,
      value: Number($("advanced-length-value").value),
    },
    output_format: $("advanced-format").value,
  };
}
async function refreshConfig() {
  state.configs = (await api("/api/config")).providers;
  renderCommon();
  if ($("settings-dialog").open) modelChoices($("advanced-model"), $("advanced-model").value);
}
async function refreshSession() {
  const value = await api("/api/session");
  state.mode = value.mode;
  state.user = value.user;
  setCsrf(value.user?.csrf);
  $("account").textContent = state.demo
    ? "Chế độ kiểm thử"
    : state.mode === "local"
      ? "Trên máy này"
      : state.user
        ? state.user.email
        : "Đăng nhập";
  $("privacy-note").textContent =
    `${state.mode === "local" ? "Bản nháp & lịch sử lưu trên máy này" : "Tài liệu lưu riêng theo tài khoản"} · Lưu ${value.retention_days ?? 30} ngày · Gửi nội dung tới nhà cung cấp khi tóm tắt`;
  return value;
}
function openAccount() {
  const local = state.mode === "local",
    logged = !!state.user;
  $("login-fields").hidden = logged;
  $("login-button").hidden = logged;
  $("logout").hidden = local || !logged;
  $("account-info").textContent = local
    ? "Bạn đang dùng không gian riêng trên máy này. Bản nháp và lịch sử được lưu trong thư mục studio_data."
    : logged
      ? `${state.user.email}. Phiên đăng nhập có hiệu lực trong 24 giờ.`
      : "Đăng nhập để tóm tắt và lưu tài liệu trong không gian riêng của bạn.";
  $("account-error").hidden = true;
  $("account-dialog").showModal();
}
async function loadWorkspace() {
  if (!state.user) return;
  const [saved, mine, history] = await Promise.all([
    api("/api/draft"),
    api("/api/my-prompts"),
    api("/api/history"),
  ]);
  state.privatePrompts = mine.prompts;
  const d = saved.draft;
  if (d?.version === 2 && Array.isArray(d.documents) && d.documents.length) {
    state.documents = d.documents;
    state.active = d.active;
    state.common = d.common;
    state.jobIds = d.jobIds || [];
    state.field = d.field || "document";
  }
  state.results = [];
  for (const id of state.jobIds.slice(-50)) {
    try {
      const job = await api(`/api/jobs/${id}`);
      for (const r of job.results)
        state.results.push({
          ...r,
          job_id: id,
          created: job.created || Date.now() / 1000,
        });
    } catch {
      /* Deleted history cannot be restored. */
    }
  }
  const active = history.jobs.find((j) => activeStatuses.has(j.status));
  if (active) {
    ingest(await api(`/api/jobs/${active.id}`));
    poll();
  }
  state.history = history.jobs;
  renderCommon();
  renderSource();
  renderDocuments();
  renderResults();
  $("save-status").textContent = saved.draft ? "Đã khôi phục bản nháp" : "Sẵn sàng · tự động lưu";
}
function showPage(page) {
  for (const p of ["work", "history", "library"]) {
    $(`${p}-page`).hidden = p !== page;
    $(`nav-${p}`).classList.toggle("active", p === page);
    if (p === page) $(`nav-${p}`).setAttribute("aria-current", "page");
    else $(`nav-${p}`).removeAttribute("aria-current");
  }
  if (page === "history") loadHistory().catch(report);
  if (page === "library") renderLibrary();
}
async function loadHistory() {
  if (!state.user) {
    $("history-list").textContent = "Đăng nhập để xem lịch sử.";
    return;
  }
  state.history = (await api("/api/history")).jobs;
  renderHistory();
}
function renderHistory() {
  const list = $("history-list");
  list.replaceChildren();
  const search = $("history-search").value.toLocaleLowerCase("vi"),
    status = $("history-status").value;
  const jobs = state.history.filter(
    (j) => j.title.toLocaleLowerCase("vi").includes(search) && (!status || j.status === status),
  );
  if (!jobs.length) {
    list.append(node("p", "help", "Chưa có lượt tóm tắt phù hợp."));
    return;
  }
  for (const j of jobs) {
    const row = node("article", "history-row"),
      info = node("div");
    info.append(
      node("h3", "", j.title),
      node(
        "p",
        "",
        `${new Date(j.created * 1000).toLocaleString("vi")} · ${j.documents} tài liệu · ${j.success}/${j.total} thành công · ${labels[j.status] || j.status}`,
      ),
    );
    const open = node("button", "secondary", "Mở & đối chiếu");
    open.disabled = state.busy && state.job?.id !== j.id;
    open.onclick = async () => {
      try {
        if (dirty && state.user) await saveDraft();
        if (
          state.documents.some((d) => d.text.trim()) &&
          !confirm(
            "Mở nguồn và kết quả của lượt này? Bản nháp hiện tại sẽ được thay bằng nguồn đã lưu trong lượt chạy.",
          )
        )
          return;
        const job = await api(`/api/jobs/${j.id}`);
        state.documents = job.documents.map((d) => ({
          ...d,
          selected: true,
          overrides: d.overrides || {},
        }));
        state.active = state.documents[0].id;
        state.common = job.documents[0].settings;
        ingest(job);
        renderCommon();
        renderSource();
        renderResults();
        showPage("work");
        changed();
        if (state.busy) poll();
      } catch (e) {
        report(e);
      }
    };
    const remove = node("button", "text-button danger", "Xóa");
    remove.disabled = activeStatuses.has(j.status);
    remove.onclick = async () => {
      if (!confirm("Xóa vĩnh viễn nguồn và kết quả của lượt này? Hạn mức đã sử dụng vẫn được giữ."))
        return;
      try {
        await api(`/api/jobs/${j.id}/delete`, {});
        state.results = state.results.filter((r) => r.job_id !== j.id);
        state.jobIds = state.jobIds.filter((id) => id !== j.id);
        changed();
        renderResults();
        await loadHistory();
      } catch (e) {
        report(e);
      }
    };
    row.append(info, open, remove);
    list.append(row);
  }
}
function renderLibrary() {
  const list = $("library-list");
  list.replaceChildren();
  for (const p of allPrompts()) {
    const card = node("article", "prompt-card");
    card.append(node("p", "eyebrow", p.set), node("h3", "", p.name), node("p", "", p.text));
    const use = node("button", "secondary", "Dùng prompt này");
    use.disabled = state.busy;
    use.onclick = () => {
      state.common.prompts = [{ name: p.name, text: p.text }];
      renderCommon();
      changed();
      showPage("work");
    };
    card.append(use);
    list.append(card);
  }
}
function setMobileTab(result) {
  document.querySelector(".reading-area").classList.toggle("show-result", result);
  $("tab-source").setAttribute("aria-selected", String(!result));
  $("tab-result").setAttribute("aria-selected", String(result));
}

// Bind static controls once; dynamic lists use closures over stable document IDs.
for (const page of ["work", "history", "library"]) $(`nav-${page}`).onclick = () => showPage(page);
$("source-text").oninput = () => {
  current().text = $("source-text").value;
  current().revision++;
  renderDocuments();
  renderResults();
  changed();
};
$("source-title").oninput = () => {
  current().title = $("source-title").value;
  renderDocuments();
  changed();
};
$("model").onchange = () => {
  Object.assign(state.common, parseModel($("model").value));
  updateMeta();
  changed();
};
$("style-prompt").onchange = () => {
  const p = allPrompts().find((p) => p.key === $("style-prompt").value);
  if (p) {
    state.common.prompts = [{ name: p.name, text: p.text }];
    updateMeta();
    changed();
  }
};
for (const id of ["length-mode", "length-value"])
  $(id).onchange = () => {
    state.common.length = {
      mode: $("length-mode").value,
      value: Number($("length-value").value),
    };
    renderCommon();
    changed();
  };
$("length-value").oninput = () => {
  state.common.length.value = Number($("length-value").value);
  updateMeta();
  changed();
};
$("advanced").onclick = () => openSettings();
$("doc-options").onclick = () => openSettings(current());
$("edit-prompts").onclick = () => openSettings();
$("add-document").onclick = () =>
  addDocuments([{ title: `Văn bản ${state.documents.length + 1}`, text: "" }]);
function removeDocuments(ids) {
  if (state.busy || state.importing) return;
  state.documents = state.documents.filter((d) => !ids.includes(d.id));
  if (!state.documents.length) state.documents = [newDocument()];
  if (!state.documents.some((d) => d.id === state.active)) state.active = state.documents[0].id;
  for (const id of ids) delete state.resultSelection[id];
  renderSource();
  renderDocuments();
  renderResults();
  changed();
}
$("delete-selected").onclick = () => {
  const ids = state.documents.filter((d) => d.selected).map((d) => d.id);
  if (!ids.length || state.busy || state.importing) return;
  deleteSelection = ids;
  $("delete-selection-message").textContent =
    `Xóa ${ids.length} tài liệu đã chọn khỏi bản nháp? Lịch sử tóm tắt vẫn được giữ.`;
  $("delete-selection-dialog").showModal();
};
$("confirm-delete-selection").onclick = () => {
  removeDocuments(deleteSelection);
  deleteSelection = [];
  $("delete-selection-dialog").close();
};
$("delete-document").onclick = () => {
  if (
    current().text.trim() &&
    !confirm("Xóa tài liệu này khỏi bản nháp? Các lượt chạy trong lịch sử vẫn được giữ.")
  )
    return;
  removeDocuments([current().id]);
};
if ($("upload")) $("upload").onclick = () => $("data-file").click();
$("data-file").onchange = () => {
  importFiles([...$("data-file").files]);
  $("data-file").value = "";
};
const drop = $("drop-zone");
if (drop) {
  drop.onclick = () => $("data-file").click();
  for (const event of ["dragenter", "dragover"])
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    importFiles([...e.dataTransfer.files]);
  });
}
const rail = $("document-rail");
if (rail && drop) {
  for (const event of ["dragenter", "dragover"])
    rail.addEventListener(event, (e) => {
      if ([...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        drop.classList.add("drag");
      }
    });
  rail.addEventListener("dragleave", (e) => {
    if (!rail.contains(e.relatedTarget)) drop.classList.remove("drag");
  });
  rail.addEventListener("drop", (e) => {
    if (e.target !== drop && !drop.contains(e.target)) {
      e.preventDefault();
      drop.classList.remove("drag");
      if (e.dataTransfer.files?.length) {
        importFiles([...e.dataTransfer.files]);
      }
    }
  });
}
window.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
window.addEventListener("drop", (e) => e.preventDefault());
for (const id of ["rail-select-all"])
  $(id).onchange = () => {
    for (const d of state.documents) d.selected = $(id).checked;
    renderDocuments();
    changed();
  };
$("run-document").onclick = () => runDocuments([current().id]);
$("run-batch").onclick = () =>
  runDocuments(state.documents.filter((d) => d.selected).map((d) => d.id));
$("retry-submit").onclick = () => sendPending().catch(report);
$("cancel-job").onclick = async () => {
  try {
    await api(`/api/jobs/${state.job.id}/cancel`, {});
    ingest(await api(`/api/jobs/${state.job.id}`));
    if (state.busy) poll();
  } catch (e) {
    report(e);
  }
};
$("result-version").onchange = () => {
  const r = selectedResult();
  state.resultSelection[current().id] = r?.task_id;
  renderResults(r?.task_id);
};
$("copy-result").onclick = async () => {
  try {
    await navigator.clipboard.writeText(selectedResult().summary);
    notice("Đã sao chép bản tóm tắt.");
  } catch {
    notice("Không sao chép được. Bạn có thể chọn và sao chép nội dung trong ô kết quả.", true);
  }
};
$("export-txt").onclick = () => {
  const r = selectedResult(),
    url = URL.createObjectURL(new Blob([r.summary], { type: "text/plain;charset=utf-8" })),
    a = node("a");
  a.href = url;
  a.download = "tom-tat.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("retry-result").onclick = async () => {
  try {
    const r = selectedResult(),
      job = await api(`/api/jobs/${r.job_id}`),
      old = job.documents.find((d) => d.id === r.document_id);
    await runDocuments([current().id], {
      ...old.settings,
      prompts: [{ name: r.prompt_name, text: r.prompt_text }],
    });
  } catch (e) {
    report(e);
  }
};
document
  .querySelectorAll(".close-dialog")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("[data-toggle]").forEach((c) => (c.onchange = syncDialogGroups));
$("advanced-length-mode").onchange = syncAdvancedLength;
document.querySelectorAll("[data-percent]").forEach(
  (b) =>
    (b.onclick = () => {
      $("advanced-length-mode").value = "percent";
      $("advanced-length-value").value = b.dataset.percent;
      syncAdvancedLength();
    }),
);
$("load-prompt-set").onclick = () => {
  const source =
    $("prompt-set").value === "private"
      ? state.privatePrompts
      : state.sets.find((s) => s.id === $("prompt-set").value)?.prompts || [];
  dialogPrompts = clone(source).map((p, i) => ({ ...p, selected: i === 0 }));
  renderPromptEditors();
  syncDialogGroups();
};
$("add-prompt").onclick = () => {
  dialogPrompts.push({
    name: `Prompt ${dialogPrompts.length + 1}`,
    text: "Tóm tắt văn bản bằng tiếng Việt. Giữ đúng ý chính và dữ kiện.\n\n{document}",
    selected: true,
  });
  renderPromptEditors();
  syncDialogGroups();
};
$("upload-prompt").onclick = () => $("prompt-file").click();
$("prompt-file").onchange = () => {
  importFiles([...$("prompt-file").files], "prompts");
  $("prompt-file").value = "";
};
$("refresh-config").onclick = () =>
  refreshConfig().catch((e) => {
    $("settings-error").textContent = e.message;
    $("settings-error").hidden = false;
  });
$("settings-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    const settings = dialogSettings();
    if (dialogScope) {
      const d = state.documents.find((d) => d.id === dialogScope),
        overrides = {};
      for (const group of ["model", "prompts", "length", "format"])
        if (document.querySelector(`[data-toggle="${group}"]`).checked)
          for (const key of groupKeys(group)) overrides[key] = settings[key];
      validateSettings({ ...state.common, ...overrides });
      d.overrides = overrides;
    } else state.common = validateSettings(settings);
    state.field = $("document-field").value.trim() || "document";
    renderCommon();
    renderDocuments();
    changed();
    $("settings-dialog").close();
  } catch (error) {
    $("settings-error").className = "notice error";
    $("settings-error").textContent = error.message;
    $("settings-error").hidden = false;
  }
};
$("reset-overrides").onclick = () => {
  state.documents.find((d) => d.id === dialogScope).overrides = {};
  renderDocuments();
  changed();
  $("settings-dialog").close();
};
$("save-prompt-library").onclick = async () => {
  try {
    const prompts = dialogSettings().prompts;
    if (!prompts.length) throw new Error("Chọn ít nhất một prompt.");
    await api("/api/my-prompts", { prompts });
    state.privatePrompts = clone(prompts);
    renderCommon();
    $("settings-error").hidden = false;
    $("settings-error").className = "notice";
    $("settings-error").textContent = "Đã lưu vào thư viện riêng.";
  } catch (e) {
    $("settings-error").className = "notice error";
    $("settings-error").textContent = e.message;
    $("settings-error").hidden = false;
  }
};
$("refresh-history").onclick = () => loadHistory().catch(report);
$("history-search").oninput = renderHistory;
$("history-status").onchange = renderHistory;
function closeRail() {
  const wasOpen = $("document-rail").classList.contains("open");
  $("document-rail").classList.remove("open");
  $("open-rail").setAttribute("aria-expanded", "false");
  if (wasOpen) $("open-rail").focus();
}
$("open-rail").onclick = () => {
  $("document-rail").classList.add("open");
  $("open-rail").setAttribute("aria-expanded", "true");
  $("close-rail").focus();
};
$("close-rail").onclick = closeRail;
$("tab-source").onclick = () => setMobileTab(false);
$("tab-result").onclick = () => setMobileTab(true);
for (const id of ["tab-source", "tab-result"])
  $(id).onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const result = id === "tab-source";
      setMobileTab(result);
      $(result ? "tab-result" : "tab-source").focus();
    }
  };
$("account").onclick = openAccount;
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("login-button").disabled = true;
  try {
    await api("/api/login", {
      email: $("login-email").value,
      password: $("login-password").value,
    });
    $("login-password").value = "";
    await refreshSession();
    await loadWorkspace();
    $("account-dialog").close();
    ready = true;
    notice("Đã mở không gian của bạn.");
  } catch (error) {
    $("account-error").textContent = error.message;
    $("account-error").hidden = false;
  } finally {
    $("login-button").disabled = false;
  }
};
$("logout").onclick = async () => {
  try {
    await saveDraft();
    await api("/api/logout", {});
    clearTimeout(pollTimer);
    state.documents = [newDocument()];
    state.active = state.documents[0].id;
    state.results = [];
    state.jobIds = [];
    state.privatePrompts = [];
    state.job = null;
    state.busy = false;
    dirty = false;
    await refreshSession();
    renderSource();
    renderDocuments();
    renderResults();
    $("account-dialog").close();
    $("save-status").textContent = "Chưa lưu · cần đăng nhập";
    notice("Đã đăng xuất.");
  } catch (e) {
    report(e);
  }
};
$("save-status").onclick = () => {
  if (dirty) saveDraft();
};
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    runDocuments([current().id]);
  }
  if (e.key === "Escape") closeRail();
  if (e.key === "Tab" && $("document-rail").classList.contains("open")) {
    const items = [
        ...$("document-rail").querySelectorAll("button:not(:disabled),input[type=checkbox]"),
      ],
      first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function init() {
  try {
    const [config, library] = await Promise.all([api("/api/config"), api("/api/prompts")]);
    state.configs = config.providers;
    state.sets = library.sets;
    state.common.prompts = clone(state.sets[0].prompts.slice(0, 1));
    modelChoices($("model"), "");
    if ($("model").value) Object.assign(state.common, parseModel($("model").value));
    state.demo =
      config.demo ||
      Object.values(state.configs).some((c) =>
        (c.models || []).some((m) => ["mock-model", "mock-other"].includes(m)),
      );
    if (state.demo) {
      const banner = node(
        "p",
        "notice",
        "Bạn đang dùng server kiểm thử: model giả trả nội dung “Kiểm thử”. Để tóm tắt thật, dùng bản local tại http://127.0.0.1:52635/ với model đã cấu hình.",
      );
      $("notice").before(banner);
    }
    await refreshSession();
    if (state.user) await loadWorkspace();
    else $("save-status").textContent = "Chưa lưu · cần đăng nhập";
    renderCommon();
    renderSource();
    renderDocuments();
    renderResults();
    ready = true;
    if (state.user && !state.jobIds.length) changed();
  } catch (e) {
    report(e);
    $("save-status").textContent = "Không mở được dữ liệu";
  }
}
/* ── Draggable resizers ──────────────────────────────────────── */
(function initResizers() {
  const RAIL_MIN = 140, RAIL_MAX = 400, RAIL_DEFAULT = 210;
  const PANE_MIN_RATIO = 0.2; // each pane gets at least 20% of reading-area width

  const railEl = $("document-rail");
  const railResizer = $("rail-resizer");
  const paneResizer = $("pane-resizer");
  const readingArea = document.querySelector(".reading-area");

  function isDesktop() { return window.matchMedia("(min-width: 768px)").matches; }

  // ── Rail resizer (sidebar width) ───────────────────────
  let railDragging = false;

  function applyRailWidth(w) {
    railEl.style.width = w + "px";
    document.querySelector("main").style.paddingLeft = (w + 24) + "px";
  }

  function loadRailWidth() {
    if (!isDesktop()) return;
    const saved = localStorage.getItem("summora-rail-width");
    if (saved) applyRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, +saved)));
  }

  railResizer.addEventListener("pointerdown", (e) => {
    if (!isDesktop()) return;
    e.preventDefault();
    railDragging = true;
    railResizer.classList.add("dragging");
    document.body.classList.add("resizing-col");
    railResizer.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (!railDragging) return;
      const x = ev.clientX;
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, x));
      applyRailWidth(w);
    };

    const onUp = () => {
      railDragging = false;
      railResizer.classList.remove("dragging");
      document.body.classList.remove("resizing-col");
      localStorage.setItem("summora-rail-width", railEl.offsetWidth);
      railResizer.removeEventListener("pointermove", onMove);
      railResizer.removeEventListener("pointerup", onUp);
      railResizer.removeEventListener("pointercancel", onUp);
    };

    railResizer.addEventListener("pointermove", onMove);
    railResizer.addEventListener("pointerup", onUp);
    railResizer.addEventListener("pointercancel", onUp);
  });

  // Keyboard accessibility for rail resizer
  railResizer.addEventListener("keydown", (e) => {
    if (!isDesktop()) return;
    const step = e.shiftKey ? 20 : 5;
    if (e.key === "ArrowRight") { e.preventDefault(); applyRailWidth(Math.min(RAIL_MAX, railEl.offsetWidth + step)); localStorage.setItem("summora-rail-width", railEl.offsetWidth); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); applyRailWidth(Math.max(RAIL_MIN, railEl.offsetWidth - step)); localStorage.setItem("summora-rail-width", railEl.offsetWidth); }
  });

  // ── Pane resizer (source ↔ result width) ───────────────
  let paneDragging = false;

  function applyPaneRatio(ratio) {
    const sourcePane = readingArea.querySelector(".source-pane");
    const resultPane = readingArea.querySelector(".result-pane");
    if (!sourcePane || !resultPane) return;
    const clamped = Math.min(1 - PANE_MIN_RATIO, Math.max(PANE_MIN_RATIO, ratio));
    sourcePane.style.flex = `0 0 ${clamped * 100}%`;
    resultPane.style.flex = `0 0 ${(1 - clamped) * 100 - 1}%`; // -1% for the resizer itself
  }

  function loadPaneRatio() {
    if (!isDesktop()) return;
    const saved = localStorage.getItem("summora-pane-ratio");
    if (saved) applyPaneRatio(+saved);
  }

  paneResizer.addEventListener("pointerdown", (e) => {
    if (!isDesktop()) return;
    e.preventDefault();
    paneDragging = true;
    paneResizer.classList.add("dragging");
    document.body.classList.add("resizing-col");
    paneResizer.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (!paneDragging) return;
      const rect = readingArea.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const ratio = x / rect.width;
      applyPaneRatio(ratio);
    };

    const onUp = () => {
      paneDragging = false;
      paneResizer.classList.remove("dragging");
      document.body.classList.remove("resizing-col");
      // Save the ratio
      const sourcePane = readingArea.querySelector(".source-pane");
      if (sourcePane) {
        const ratio = sourcePane.offsetWidth / readingArea.offsetWidth;
        localStorage.setItem("summora-pane-ratio", ratio.toFixed(4));
      }
      paneResizer.removeEventListener("pointermove", onMove);
      paneResizer.removeEventListener("pointerup", onUp);
      paneResizer.removeEventListener("pointercancel", onUp);
    };

    paneResizer.addEventListener("pointermove", onMove);
    paneResizer.addEventListener("pointerup", onUp);
    paneResizer.addEventListener("pointercancel", onUp);
  });

  // Keyboard accessibility for pane resizer
  paneResizer.addEventListener("keydown", (e) => {
    if (!isDesktop()) return;
    const step = e.shiftKey ? 0.05 : 0.02;
    const sourcePane = readingArea.querySelector(".source-pane");
    if (!sourcePane) return;
    const current = sourcePane.offsetWidth / readingArea.offsetWidth;
    if (e.key === "ArrowRight") { e.preventDefault(); applyPaneRatio(current + step); localStorage.setItem("summora-pane-ratio", (current + step).toFixed(4)); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); applyPaneRatio(current - step); localStorage.setItem("summora-pane-ratio", (current - step).toFixed(4)); }
  });

  // Double-click to reset either resizer
  railResizer.addEventListener("dblclick", () => {
    applyRailWidth(RAIL_DEFAULT);
    localStorage.removeItem("summora-rail-width");
  });
  paneResizer.addEventListener("dblclick", () => {
    const sourcePane = readingArea.querySelector(".source-pane");
    const resultPane = readingArea.querySelector(".result-pane");
    if (sourcePane) sourcePane.style.flex = "";
    if (resultPane) resultPane.style.flex = "";
    localStorage.removeItem("summora-pane-ratio");
  });

  // Reset inline styles on window resize to mobile
  function onResize() {
    if (!isDesktop()) {
      railEl.style.width = "";
      document.querySelector("main").style.paddingLeft = "";
      const sourcePane = readingArea.querySelector(".source-pane");
      const resultPane = readingArea.querySelector(".result-pane");
      if (sourcePane) sourcePane.style.flex = "";
      if (resultPane) resultPane.style.flex = "";
    } else {
      loadRailWidth();
      loadPaneRatio();
    }
  }
  window.addEventListener("resize", onResize);

  // Load saved sizes on page load
  loadRailWidth();
  loadPaneRatio();
})();

init();
