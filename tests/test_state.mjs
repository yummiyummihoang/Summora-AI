import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const source = await readFile(new URL("../web/state.js", import.meta.url), "utf8");
const {
  effective,
  targetWords,
  validateSettings,
  groupKeys,
  prepareResultView,
  resultActivity,
  visibleResults,
  words,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const common = {
  provider: "openai",
  model: "a",
  prompts: [{ name: "A", text: "{document}" }],
  parameters: { N: 1 },
  length: { mode: "percent", value: 20 },
  output_format: "paragraph",
};
test("production results exclude saved mock output and remain scoped to the open document", () => {
  const results = [
    { document_id: "a", model: "real", task_id: "real-a" },
    { document_id: "b", model: "mock-model", task_id: "mock-b" },
    { document_id: "b", model: "real", demo: true, task_id: "demo-b" },
  ];
  assert.deepEqual(visibleResults(results, "b"), []);
  assert.deepEqual(
    visibleResults(results, "a").map((r) => r.task_id),
    ["real-a"],
  );
  assert.equal(visibleResults(results, "b", true).length, 2);
  results.push({ document_id: "b", model: "real", task_id: "real-b" });
  assert.deepEqual(
    visibleResults(results, "b").map((r) => r.task_id),
    ["real-b"],
  );
  assert.equal(results.length, 4);
});
test("switching away and back keeps batch progress above old results", () => {
  const state = {
    active: "a",
    busy: true,
    resultSelection: { b: "old-b" },
    results: [{ document_id: "b", task_id: "old-b", summary: "Previous run" }],
    job: {
      id: "batch",
      status: "running",
      tasks: [
        { document_id: "a", status: "success", model: "test" },
        { document_id: "b", status: "running", model: "test" },
      ],
    },
  };
  assert.equal(resultActivity(state), null);
  state.active = "b";
  assert.equal(resultActivity(state).status, "running");
  state.active = "a";
  assert.equal(resultActivity(state), null);
  state.active = "b";
  assert.equal(resultActivity(state).status, "running");
  state.job.tasks[1].status = "success";
  state.job.status = "completed";
  assert.equal(resultActivity(state), null);
});
test("a new request shows activity even when the document has older results", () => {
  const state = {
    active: "a",
    busy: true,
    results: [{ document_id: "a", summary: "old" }],
    resultRun: { jobId: null, documentIds: ["a"] },
    job: { id: "old", status: "completed" },
  };
  assert.equal(resultActivity(state).status, "submitting");
  state.resultRun.jobId = "new";
  state.job = { id: "new", status: "queued" };
  assert.equal(resultActivity(state).status, "waiting");
});
test("activity follows the open document and ends when its prompts finish", () => {
  const state = {
    active: "a",
    busy: true,
    job: {
      id: "new",
      status: "running",
      tasks: [
        { document_id: "a", status: "success", model: "test" },
        { document_id: "a", status: "running", model: "test" },
        { document_id: "b", status: "waiting", model: "other" },
      ],
    },
  };
  assert.deepEqual(resultActivity(state), { status: "running", model: "test", done: 1, total: 2 });
  state.job.tasks[1].status = "error";
  assert.equal(resultActivity(state), null);
  state.active = "b";
  assert.equal(resultActivity(state).status, "waiting");
  state.job.status = "cancelling";
  assert.equal(resultActivity(state).status, "cancelling");
  state.job.status = "cancelled";
  assert.equal(resultActivity(state), null);
  state.active = "unrelated";
  state.job.status = "running";
  assert.equal(resultActivity(state), null);
});
test("partial override continues to inherit updated common model and prompts", () => {
  const d = {
    text: "x ".repeat(100),
    overrides: { length: { mode: "words", value: 15 } },
  };
  const changed = {
    ...common,
    model: "b",
    prompts: [
      { name: "B", text: "B {document}" },
      { name: "C", text: "C {document}" },
    ],
  };
  assert.equal(effective(d, changed).model, "b");
  assert.equal(effective(d, changed).prompts.length, 2);
  assert.equal(targetWords(d, changed), 15);
  assert.deepEqual(groupKeys("model"), ["provider", "model"]);
  assert.deepEqual(groupKeys("prompts"), ["prompts", "parameters"]);
});
test("length and prompt validation supports decimal percent but rejects invalid word targets", () => {
  assert.equal(targetWords({ text: "x ".repeat(11), overrides: {} }, common), 3);
  assert.equal(words("nghiên\ncứu\t mới"), 3);
  assert.equal(
    validateSettings({ ...common, length: { mode: "percent", value: 12.5 } }).length.value,
    12.5,
  );
  for (const length of [
    { mode: "percent", value: 0 },
    { mode: "percent", value: 101 },
    { mode: "words", value: 1.5 },
  ])
    assert.throws(() => validateSettings({ ...common, length }));
  assert.throws(() =>
    validateSettings({
      ...common,
      prompts: [common.prompts[0], common.prompts[0]],
    }),
  );
});
test("running a different document opens its results and resets the previous version", () => {
  const state = {
    documents: [{ id: "a" }, { id: "b" }],
    active: "b",
    resultSelection: { a: "old-error", b: "previous-b" },
  };
  prepareResultView(state, ["a"]);
  assert.equal(state.active, "a");
  assert.equal(state.resultSelection.a, undefined);
  assert.equal(state.resultSelection.b, "previous-b");
  assert.deepEqual(state.resultRun, {
    jobId: null,
    documentIds: ["a"],
    revealPending: true,
  });
});
test("batch keeps the opened selected document and otherwise opens the first selected one", () => {
  const state = {
    documents: [{ id: "a" }, { id: "b" }, { id: "c" }],
    active: "c",
    resultSelection: { a: "a-old", b: "b-old", c: "c-old" },
  };
  prepareResultView(state, ["a", "b"]);
  assert.equal(state.active, "a");
  assert.equal(state.resultSelection.c, "c-old");
  state.active = "b";
  prepareResultView(state, ["a", "b"]);
  assert.equal(state.active, "b");
});
