"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Files,
  History,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Doc = {
  id: string;
  title: string;
  text: string;
  source?: string;
  selected?: boolean;
  revision?: number;
  overrides?: Partial<Settings>;
};
type Prompt = { name: string; text: string };
type Settings = {
  provider: string;
  model: string;
  prompts: Prompt[];
  length: { mode: "auto" | "percent" | "words"; value?: number };
  output_format: "paragraph" | "bullets";
  parameters?: Record<string, number>;
};
type Provider = { label: string; ready: boolean; key_configured: boolean; models: string[] };
type Job = {
  id: string;
  status: string;
  total: number;
  done: number;
  success: number;
  errors: number;
  message: string;
  documents: Doc[];
  tasks: Array<{ id: string; status: string; prompt_name: string }>;
  results: Array<{
    task_id: string;
    document_id: string;
    title: string;
    prompt_name: string;
    status: string;
    summary?: string;
    error?: string;
    job_id?: string;
  }>;
  download_ready: boolean;
};
type HistoryItem = {
  id: string;
  created: number;
  status: string;
  total: number;
  done: number;
  success: number;
  errors: number;
  title: string;
  documents: number;
};
type DraftData = {
  documents: Doc[];
  activeId?: string;
  settings?: Partial<Settings>;
  field?: string;
};
type ImportedItem = { title?: string; text?: string; source?: string; name?: string };
const supabase = createClient();
const blankDoc = (): Doc => ({
  id: crypto.randomUUID(),
  title: "Văn bản mới",
  text: "",
  revision: 1,
});
const defaultSettings: Settings = {
  provider: "",
  model: "",
  prompts: [
    {
      name: "Trung tính",
      text: "Tóm tắt văn bản bằng tiếng Việt, giữ đúng ý chính và dữ kiện. Không thêm thông tin ngoài nguồn.\n\n{document}",
    },
  ],
  length: { mode: "auto" },
  output_format: "paragraph",
};

async function api<T = unknown>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const options: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(data.session?.access_token
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
      ...headers,
    },
  };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers = { ...options.headers, "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  if (!response.ok) {
    let error = "Không thể xử lý yêu cầu.";
    try {
      error = (await response.json()).error || error;
    } catch {}
    throw new Error(error);
  }
  return response.json();
}

const statuses: Record<string, string> = {
  queued: "Đang chờ",
  running: "Đang xử lý",
  cancelling: "Đang dừng",
  completed: "Hoàn tất",
  failed: "Thất bại",
  cancelled: "Đã hủy",
  interrupted: "Bị gián đoạn",
};
function prettyDate(seconds: number) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(seconds * 1000),
  );
}

const ui = {
  authShell: "grid min-h-screen grid-cols-2 bg-background max-md:grid-cols-1",
  authBrand:
    "flex min-h-fit flex-col justify-between gap-8 border-b bg-background p-6 text-foreground md:min-h-screen md:border-b-0 md:border-r md:p-14",
  brandLockup:
    "flex items-center gap-3 [&>div:last-child]:flex [&>div:last-child]:flex-col [&>div:last-child]:gap-1 [&_strong]:text-sm [&_strong]:font-semibold [&_span]:text-xs [&_span]:text-muted-foreground",
  brandMark: "grid size-10 shrink-0 place-items-center rounded-xl border bg-muted text-foreground",
  brandMarkSmall: "size-9 rounded-lg bg-background",
  authBrandCopy: "my-auto py-8 md:py-12",
  eyebrow: "text-xs font-semibold tracking-widest text-muted-foreground",
  authTitle: "mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-foreground md:text-6xl",
  authDescription: "mt-4 max-w-sm text-base leading-7 text-muted-foreground",
  workflow: "mt-8 grid max-w-xl grid-cols-1 border-t border-border sm:grid-cols-3 md:mt-12",
  workflowStep:
    "flex items-center gap-3 py-3 text-sm text-muted-foreground sm:pr-3 sm:[&+div]:border-l sm:[&+div]:pl-4 [&_span]:text-xs [&_p]:m-0",
  authFoot: "hidden text-sm text-muted-foreground md:block",
  authPanel: "grid min-h-fit place-items-center p-6 md:min-h-screen md:p-12",
  authCard: "w-full max-w-sm border-0 shadow-none",
  authCardHeader: "gap-0 px-0 pb-7 pt-0",
  authKicker: "mb-2 text-xs font-semibold tracking-wide text-muted-foreground",
  authDescriptionSmall: "mt-2 text-sm leading-6 text-muted-foreground",
  authSwitch:
    "mt-6 text-center text-sm text-muted-foreground [&_button]:font-semibold [&_button]:text-foreground [&_button]:underline-offset-4 hover:[&_button]:underline",
  authSecurity: "mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground",
  fieldLabel: "flex flex-col gap-2 text-sm font-medium text-foreground",
  muted: "text-muted-foreground",
  notice: "rounded-md border bg-muted p-3 text-sm leading-6 text-foreground",
  appShell: "mx-auto max-w-screen-2xl px-4 pb-8 md:px-8",
  topbar: "flex h-14 items-center justify-between gap-2 border-b sm:h-16",
  topBrand:
    "flex items-center gap-3 [&>div:last-child]:flex [&>div:last-child]:flex-col [&>div:last-child]:gap-0.5 [&_strong]:text-sm [&_strong]:font-semibold [&_span]:text-xs [&_span]:text-muted-foreground",
  topActions: "flex shrink-0 items-center gap-1 sm:gap-2 md:gap-4",
  saveIndicator: "flex items-center gap-1.5 text-xs text-muted-foreground",
  userEmail: "hidden max-w-56 truncate text-xs text-muted-foreground md:block",
  pageHeading:
    "flex items-end justify-between gap-4 py-5 sm:gap-5 sm:py-6 max-md:flex-col max-md:items-start",
  pageTitle: "mt-2 text-2xl font-semibold tracking-tight sm:text-3xl",
  pageDescription: "mt-1 text-sm text-muted-foreground",
  quotaChip:
    "flex max-w-full flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground",
  globalNotice:
    "mb-4 flex items-center justify-between gap-3 rounded-md border bg-muted p-3 text-sm text-foreground",
  workspace: "grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-12",
  leftColumn: "flex min-w-0 flex-col gap-3 sm:gap-4 md:col-span-1 xl:col-span-3",
  centerColumn: "flex min-w-0 flex-col gap-3 sm:gap-4 md:col-span-2 xl:col-span-6",
  rightColumn: "flex min-w-0 flex-col gap-3 sm:gap-4 md:col-span-2 xl:col-span-3",
  cardHeader: "flex-row items-center justify-between gap-2 pb-3",
  cardTitle: "flex min-w-0 items-center gap-2 whitespace-nowrap text-sm font-semibold",
  count:
    "grid size-5 place-items-center rounded-md bg-secondary text-xs font-medium text-secondary-foreground",
  docContent: "pt-0",
  docList: "flex max-h-52 flex-col gap-1 overflow-auto",
  docItem:
    "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
  docItemActive: "bg-accent text-accent-foreground",
  docTitle: "min-w-0 flex-1 truncate",
  uploadDrop:
    "mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors hover:bg-accent",
  docActions: "mt-3 flex flex-wrap items-center justify-between gap-2 [&>button]:min-w-0",
  settingsStack: "flex flex-col gap-4",
  overrideGrid: "grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2",
  overrideOption: "flex min-w-0 flex-col items-stretch gap-3 rounded-lg border bg-card p-3",
  overrideToggle:
    "flex min-h-5 cursor-pointer items-center gap-2 text-sm font-medium text-foreground",
  overridePromptOption: "",
  overrideLength: "grid grid-cols-1 gap-2 sm:grid-cols-2",
  promptArea: "min-h-32 text-sm",
  promptEditors: "flex flex-col gap-2",
  promptEditor: "flex flex-col gap-2 rounded-md border bg-muted p-2",
  promptNameRow: "flex gap-2 [&_input]:h-8 [&_input]:text-xs",
  resultPicker: "mt-3",
  promptTools: "grid min-w-0 grid-cols-3 items-center gap-2 sm:flex",
  editorCard: "flex min-h-120 flex-col sm:min-h-160",
  editorHeader: "flex-col items-start justify-between gap-3 border-b sm:flex-row sm:items-center",
  editorHeaderTitle: "text-base font-semibold",
  editorHeaderDescription: "mt-1 text-xs text-muted-foreground",
  editorHeadActions: "flex w-full items-center gap-1 sm:w-auto",
  editorBody: "flex min-h-0 flex-1 flex-col items-center gap-3 bg-muted p-3 sm:p-4 md:p-6",
  sourceEditor:
    "min-h-72 w-full max-w-4xl flex-1 resize-y rounded-lg bg-card px-4 py-4 text-sm leading-7 shadow-sm focus-visible:ring-2 focus-visible:ring-ring sm:min-h-96 sm:px-6 sm:py-5 sm:text-base sm:leading-8 lg:min-h-120",
  editorFoot:
    "flex w-full max-w-4xl flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground",
  runFooter:
    "flex flex-wrap items-center gap-2 border-t p-3 sm:p-4 max-sm:flex-col max-sm:items-stretch",
  runMeta: "flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground",
  tipCard: "flex items-start gap-3 p-4",
  tipIcon:
    "grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground",
  tipCopy:
    "min-w-0 text-sm [&_p]:mt-1 [&_p]:text-xs [&_p]:leading-5 [&_p]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-foreground",
  resultCard: "min-h-96 overflow-hidden xl:min-h-160",
  resultTabs: "grid grid-cols-2 border-b",
  resultTab:
    "flex items-center justify-center gap-2 border-b-2 border-transparent px-2 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
  resultTabActive: "border-primary font-medium text-foreground",
  resultContent: "p-4",
  jobSummary: "flex items-start justify-between gap-2",
  resultList: "mt-4 flex max-h-120 flex-col gap-3 overflow-auto",
  summaryResult:
    "rounded-lg border p-3 [&>p]:mt-2 [&>p]:whitespace-pre-wrap [&>p]:text-sm [&>p]:leading-6 [&>p]:text-muted-foreground",
  summaryTitle:
    "flex items-center justify-between gap-2 [&>strong]:truncate [&>strong]:text-xs [&>strong]:font-medium",
  summaryActions: "flex shrink-0 items-center gap-1",
  emptyResult:
    "flex min-h-80 flex-col items-center justify-center gap-3 text-center text-muted-foreground sm:min-h-96 xl:min-h-140 [&_strong]:text-sm [&_strong]:font-medium [&_strong]:text-foreground [&_span]:max-w-56 [&_span]:text-xs [&_span]:leading-5",
  progress: "my-4",
  historyList: "max-h-140 overflow-auto p-2",
  historyItem: "flex items-center gap-1 border-b py-2",
  historyButton: "flex min-w-0 flex-1 items-center gap-2 text-left",
  historyIcon:
    "grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground",
  historyText:
    "flex min-w-0 flex-1 flex-col gap-1 [&_strong]:truncate [&_strong]:text-xs [&_strong]:font-medium [&_small]:text-xs [&_small]:text-muted-foreground",
  privacyNote:
    "flex items-start gap-2 px-1 text-xs leading-5 text-muted-foreground [&>svg]:shrink-0",
  appFooter: "mt-5 flex justify-between gap-3 text-xs text-muted-foreground max-sm:flex-wrap",
};

export function Studio() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<Record<string, Provider>>({});
  const [library, setLibrary] = useState<Array<{ id: string; name: string; prompts: Prompt[] }>>(
    [],
  );
  const [docs, setDocs] = useState<Doc[]>([blankDoc()]);
  const [activeId, setActiveId] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [field, setField] = useState("document");
  const [privatePrompts, setPrivatePrompts] = useState<Prompt[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [resultDocId, setResultDocId] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<{ dailyQuota: number } | null>(null);
  const [saved, setSaved] = useState(true);
  const [rightTab, setRightTab] = useState<"result" | "history">("result");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLInputElement>(null);

  const active = docs.find((doc) => doc.id === activeId) ?? docs[0];
  const modelOptions = useMemo(
    () =>
      Object.entries(providers).flatMap(([provider, value]) =>
        (value.models || []).map((model) => ({
          provider,
          model,
          label: `${value.label} · ${model}`,
          ready: value.ready,
        })),
      ),
    [providers],
  );
  const selectedResults =
    job?.results.filter((result) => result.document_id === (resultDocId || active?.id)) ?? [];

  const refreshHistory = useCallback(async () => {
    const result = await api<{ jobs: HistoryItem[] }>("/api/history");
    setHistory(result.jobs);
  }, []);

  const loadWorkspace = useCallback(async (loggedIn: boolean) => {
    if (!loggedIn) {
      setWorkspaceReady(false);
      setUser(null);
      setHistory([]);
      setJob(null);
      setProfile(null);
      return;
    }
    setWorkspaceReady(false);
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.user) {
      setUser(null);
      return;
    }
    setUser({ id: session.user.id, email: session.user.email });
    const [draftResponse, promptResponse, historyResponse, profileResponse] = await Promise.all([
      api<{ draft: DraftData | null }>("/api/draft"),
      api<{ prompts: Prompt[] }>("/api/my-prompts"),
      api<{ jobs: HistoryItem[] }>("/api/history"),
      fetch("/api/profile").then(
        (response) => response.json() as Promise<{ profile?: { dailyQuota: number } }>,
      ),
    ]);
    const draft = draftResponse.draft;
    if (draft && Array.isArray(draft.documents) && draft.documents.length) {
      setDocs(draft.documents);
      setActiveId(draft.activeId || draft.documents[0].id);
      setSettings({ ...defaultSettings, ...(draft.settings || {}) });
      setField(draft.field || "document");
    }
    setPrivatePrompts(promptResponse.prompts || []);
    setHistory(historyResponse.jobs || []);
    setProfile(profileResponse.profile || null);
    setWorkspaceReady(true);
  }, []);

  useEffect(() => {
    api<{ providers: Record<string, Provider> }>("/api/config")
      .then((result) => {
        setProviders(result.providers);
        const choice = Object.entries(result.providers).find(([, provider]) => provider.ready);
        if (choice)
          setSettings((old) =>
            old.provider ? old : { ...old, provider: choice[0], model: choice[1].models[0] || "" },
          );
      })
      .catch((e) => setError(e.message));
    api<{ sets: Array<{ id: string; name: string; prompts: Prompt[] }> }>("/api/prompts")
      .then((value) => {
        setLibrary(value.sets || []);
        if (value.sets?.[0]?.prompts?.[0])
          setSettings((old) =>
            old.prompts[0]?.text === defaultSettings.prompts[0].text
              ? { ...old, prompts: [value.sets[0].prompts[0]] }
              : old,
          );
      })
      .catch((e) => setError(e.message));
    supabase.auth
      .getSession()
      .then(({ data }) => loadWorkspace(Boolean(data.session?.user)))
      .catch(() => undefined);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(
        () => void loadWorkspace(Boolean(session?.user)).catch((e) => setError(e.message)),
      );
    });
    return () => subscription.unsubscribe();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!user || !workspaceReady) return;
    const timer = window.setTimeout(() => {
      api("/api/draft", { documents: docs, activeId, settings, field })
        .then(() => {
          setSaved(true);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [docs, activeId, settings, field, user, workspaceReady]);

  useEffect(() => {
    if (!job || !["queued", "running", "cancelling"].includes(job.status)) return;
    const timer = window.setTimeout(
      () =>
        api<Job>(`/api/jobs/${job.id}`)
          .then(setJob)
          .catch((e) => setError(e.message)),
      1200,
    );
    return () => window.clearTimeout(timer);
  }, [job]);

  const markChanged = () => {
    setSaved(false);
    setNotice("");
  };
  const setActiveText = (text: string) => {
    setDocs((old) =>
      old.map((doc) =>
        doc.id === active?.id ? { ...doc, text, revision: (doc.revision || 1) + 1 } : doc,
      ),
    );
    markChanged();
  };

  function overrideEnabled(group: "model" | "prompts" | "length" | "output_format") {
    const overrides = active?.overrides;
    if (!overrides) return false;
    if (group === "model") return Boolean(overrides.provider || overrides.model);
    return overrides[group] !== undefined;
  }

  function toggleOverride(
    group: "model" | "prompts" | "length" | "output_format",
    enabled: boolean,
  ) {
    if (!active) return;
    setDocs((old) =>
      old.map((doc) => {
        if (doc.id !== active.id) return doc;
        const overrides = { ...(doc.overrides || {}) };
        if (enabled) {
          if (group === "model") {
            overrides.provider = settings.provider;
            overrides.model = settings.model;
          } else if (group === "prompts") overrides.prompts = settings.prompts;
          else if (group === "length") overrides.length = settings.length;
          else overrides.output_format = settings.output_format;
        } else if (group === "model") {
          delete overrides.provider;
          delete overrides.model;
        } else {
          delete overrides[group];
        }
        return { ...doc, overrides };
      }),
    );
    markChanged();
  }

  function patchOverride(
    group: "model" | "prompts" | "length" | "output_format",
    value: Partial<Settings>,
  ) {
    if (!active) return;
    setDocs((old) =>
      old.map((doc) =>
        doc.id === active.id ? { ...doc, overrides: { ...(doc.overrides || {}), ...value } } : doc,
      ),
    );
    markChanged();
  }

  async function authSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError("");
    setNotice("");
    try {
      if (authMode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        if (!data.session)
          setNotice("Tài khoản đã được tạo. Hãy kiểm tra email để xác nhận trước khi đăng nhập.");
        else setNotice("Tạo tài khoản thành công.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể đăng nhập.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function addFiles(files: FileList | File[], kind: "data" | "prompts" = "data") {
    setError("");
    for (const file of Array.from(files)) {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("kind", kind);
        if (kind === "data") form.append("field", field);
        const response = await api<{ parsed: unknown }>("/api/import", form);
        const parsed = Array.isArray(response.parsed) ? (response.parsed as ImportedItem[]) : [];
        if (kind === "prompts") {
          const prompts = parsed as Prompt[];
          if (prompts.length) {
            setPrivatePrompts(prompts);
            setSettings((old) => ({ ...old, prompts: [prompts[0]] }));
            setNotice(`${prompts.length} prompt đã nạp vào phiên làm việc.`);
          }
        } else {
          const imported: Doc[] = parsed.map((item) => ({
            title: item.title || "Tài liệu",
            text: item.text || "",
            source: item.source,
            id: crypto.randomUUID(),
            revision: 1,
          }));
          if (imported.length) {
            setDocs((old) => [
              ...old.filter((doc) => doc.text || doc.title !== "Văn bản mới"),
              ...imported,
            ]);
            setActiveId(imported[0].id);
            markChanged();
          }
        }
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : "Không đọc được file."}`);
      }
    }
  }

  async function submitJob(ids: string[]) {
    const chosen = docs.filter((doc) => ids.includes(doc.id));
    if (!chosen.length) {
      setError("Chọn ít nhất một tài liệu.");
      return;
    }
    if (!settings.provider || !settings.model) {
      setError("Chọn provider và model đã cấu hình API key.");
      return;
    }
    if (chosen.some((doc) => !doc.text.trim())) {
      setError("Mỗi tài liệu cần có nội dung.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const jobSettings =
        settings.prompts.some((prompt) => prompt.text.includes("{N}")) && !settings.parameters?.N
          ? { ...settings, parameters: { ...settings.parameters, N: 1 } }
          : settings;
      const payload = { documents: chosen, settings: jobSettings, field };
      await api("/api/validate", payload);
      const created = await api<{ id: string }>("/api/jobs", payload, {
        "Idempotency-Key": crypto.randomUUID(),
      });
      const current = await api<Job>(`/api/jobs/${created.id}`);
      setJob(current);
      setResultDocId(chosen[0].id);
      setRightTab("result");
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được lượt tóm tắt.");
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(item: HistoryItem) {
    setRightTab("result");
    setError("");
    try {
      const full = await api<Job>(`/api/jobs/${item.id}`);
      setJob(full);
      setResultDocId(full.documents[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được lịch sử.");
    }
  }

  async function downloadJob() {
    if (!job) return;
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/jobs/${job.id}/download`, {
      headers: { Authorization: `Bearer ${data.session?.access_token || ""}` },
    });
    if (!response.ok) {
      setError("Chưa có file kết quả để tải.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `summaries_${job.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function savePrivatePrompts() {
    try {
      await api("/api/my-prompts", { prompts: settings.prompts });
      setPrivatePrompts(settings.prompts);
      setNotice("Đã lưu thư viện prompt riêng.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được prompt.");
    }
  }

  async function copySummary(summary: string) {
    try {
      await navigator.clipboard.writeText(summary);
      setNotice("Đã sao chép bản tóm tắt.");
    } catch {
      setError("Không sao chép được. Hãy chọn và sao chép nội dung trong kết quả.");
    }
  }

  function downloadSummary(summary: string) {
    const url = URL.createObjectURL(new Blob([summary], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tom-tat.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!user)
    return (
      <main className={ui.authShell}>
        <section className={ui.authBrand}>
          <div className={ui.brandLockup}>
            <div className={ui.brandMark}>
              <BookOpen size={19} />
            </div>
            <div>
              <strong>Summora</strong>
              <span>Không gian đọc tài liệu</span>
            </div>
          </div>
          <div className={ui.authBrandCopy}>
            <p className={ui.eyebrow}>ĐỌC VÀ TÓM TẮT</p>
            <h1 className={ui.authTitle}>
              Tài liệu dài.
              <br />Ý chính rõ ràng.
            </h1>
            <p className={ui.authDescription}>
              Thêm tài liệu, chọn cách tóm tắt và lưu kết quả gọn trong một không gian riêng.
            </p>
            <div className={ui.workflow}>
              <div className={ui.workflowStep}>
                <span>01</span>
                <p>Thêm tài liệu</p>
              </div>
              <div className={ui.workflowStep}>
                <span>02</span>
                <p>Chọn cách đọc</p>
              </div>
              <div className={ui.workflowStep}>
                <span>03</span>
                <p>Lưu ý chính</p>
              </div>
            </div>
          </div>
          <div className={ui.authFoot}>Được thiết kế cho việc đọc tập trung.</div>
        </section>
        <section className={ui.authPanel}>
          <Card className={ui.authCard}>
            <CardHeader className={ui.authCardHeader}>
              <p className={ui.authKicker}>KHÔNG GIAN CỦA BẠN</p>
              <CardTitle className="text-2xl font-semibold tracking-tight">
                {authMode === "login" ? "Chào mừng trở lại" : "Tạo tài khoản"}
              </CardTitle>
              <p className={ui.authDescriptionSmall}>
                {authMode === "login"
                  ? "Đăng nhập để tiếp tục với tài liệu của bạn."
                  : "Tạo tài khoản bằng email để bắt đầu."}
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <form onSubmit={authSubmit} className="space-y-4">
                <label className={ui.fieldLabel}>
                  Email
                  <Input
                    className="h-11"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ban@email.com"
                  />
                </label>
                <label className={ui.fieldLabel}>
                  Mật khẩu
                  <Input
                    className="h-11"
                    type="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                  />
                </label>
                {error && (
                  <p role="alert" className={ui.notice}>
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className={ui.notice}>
                    {notice}
                  </p>
                )}
                <Button className="mt-1 w-full" disabled={authBusy}>
                  {authBusy && <LoaderCircle className="animate-spin" size={16} />}
                  {authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
                </Button>
              </form>
              <p className={ui.authSwitch}>
                {authMode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
                <button
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setAuthMode(authMode === "login" ? "signup" : "login");
                    setError("");
                    setNotice("");
                  }}
                >
                  {authMode === "login" ? "Đăng ký" : "Đăng nhập"}
                </button>
              </p>
              <p className={ui.authSecurity}>
                <CircleHelp size={14} /> Đăng nhập bảo mật qua Supabase Auth.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    );

  return (
    <main className={ui.appShell}>
      <header className={ui.topbar}>
        <div className={ui.topBrand}>
          <div className={cn(ui.brandMark, ui.brandMarkSmall)}>
            <Sparkles size={17} />
          </div>
          <div>
            <strong>Summora</strong>
            <span>AI document studio</span>
          </div>
        </div>
        <div className={ui.topActions}>
          <span className={ui.saveIndicator}>
            {saved ? <Check size={14} /> : <LoaderCircle size={14} className="animate-spin" />}
            <span className="hidden sm:inline">{saved ? "Đã lưu" : "Đang lưu"}</span>
          </span>
          <span className={ui.userEmail}>{user.email}</span>
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:size-9 max-sm:px-0"
            onClick={async () => {
              await supabase.auth.signOut();
              setDocs([blankDoc()]);
              setJob(null);
            }}
          >
            <LogOut size={15} />
            <span className="max-sm:hidden">Đăng xuất</span>
          </Button>
        </div>
      </header>
      <div className={ui.pageHeading}>
        <div>
          <p className={ui.eyebrow}>KHÔNG GIAN LÀM VIỆC</p>
          <h1 className={ui.pageTitle}>Tóm tắt tài liệu</h1>
          <p className={ui.pageDescription}>
            Nhập nguồn, chọn cách tóm tắt và theo dõi kết quả ngay tại đây.
          </p>
        </div>
        <div className={ui.quotaChip}>
          <Sparkles size={15} />
          <span>Hạn mức mỗi ngày</span>
          <strong>{profile?.dailyQuota ?? 200} tác vụ</strong>
        </div>
      </div>
      {(error || notice) && (
        <div className={ui.globalNotice} role={error ? "alert" : "status"}>
          {error || notice}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setError("");
              setNotice("");
            }}
            aria-label="Đóng"
          >
            <X size={15} />
          </Button>
        </div>
      )}
      <div className={ui.workspace}>
        <aside className={ui.leftColumn}>
          <Card>
            <CardHeader className={ui.cardHeader}>
              <CardTitle className={ui.cardTitle}>
                <Files size={17} /> Tài liệu <span className={ui.count}>{docs.length}</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Thêm tài liệu"
                title="Thêm tài liệu"
                onClick={() => {
                  const next = blankDoc();
                  setDocs((old) => [...old, next]);
                  setActiveId(next.id);
                  markChanged();
                }}
              >
                <Plus size={17} />
              </Button>
            </CardHeader>
            <CardContent className={ui.docContent}>
              <div className={ui.docList}>
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className={cn(ui.docItem, active?.id === doc.id && ui.docItemActive)}
                  >
                    <Button
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-0 text-inherit hover:bg-transparent"
                      onClick={() => setActiveId(doc.id)}
                    >
                      <FileText size={16} />
                      <span className={ui.docTitle}>{doc.title || "Tài liệu chưa đặt tên"}</span>
                    </Button>
                    <Checkbox
                      aria-label={`Chọn ${doc.title}`}
                      checked={!!doc.selected}
                      onCheckedChange={(checked) =>
                        setDocs((old) =>
                          old.map((item) =>
                            item.id === doc.id ? { ...item, selected: checked === true } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <div
                role="button"
                tabIndex={0}
                className={cn(ui.uploadDrop, dragging && "border-primary bg-accent")}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void addFiles(event.dataTransfer.files);
                }}
              >
                <Upload size={19} />
                <strong className="font-medium text-foreground">Kéo thả tài liệu</strong>
                <span>hoặc nhấn để chọn file</span>
                <small className="text-xs">TXT · DOCX · PDF · JSON · CSV</small>
              </div>
              <input
                ref={fileInput}
                className="hidden"
                type="file"
                multiple
                accept=".txt,.docx,.pdf,.json,.csv"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              <div className={ui.docActions}>
                <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                  <FilePlus2 size={15} /> Thêm file
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={docs.length < 2}
                  onClick={() => {
                    setDocs((old) => old.filter((doc) => !doc.selected));
                    if (!docs.some((doc) => !doc.selected)) setDocs([blankDoc()]);
                    setActiveId("");
                    markChanged();
                  }}
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">Xóa đã chọn</span>
                  <span className="sm:hidden">Xóa</span>
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className={ui.cardHeader}>
              <CardTitle className={ui.cardTitle}>
                <Settings2 size={17} /> Cấu hình tóm tắt
              </CardTitle>
              <Badge className="shrink-0">{settings.prompts.length} prompt</Badge>
            </CardHeader>
            <CardContent className={ui.settingsStack}>
              <label className={ui.fieldLabel}>
                Mô hình
                <SelectMenu
                  aria-label="Mô hình"
                  className="w-full"
                  placeholder="Chọn model đã cấu hình"
                  value={`${settings.provider}::${settings.model}`}
                  onValueChange={(value) => {
                    const [provider, model] = value.split("::");
                    setSettings((old) => ({ ...old, provider, model }));
                    markChanged();
                  }}
                  items={[
                    { value: "::", label: "Chọn model đã cấu hình" },
                    ...modelOptions.map((item) => ({
                      value: `${item.provider}::${item.model}`,
                      label: item.ready ? item.label : `${item.label} · Chưa cấu hình key`,
                      disabled: !item.ready,
                    })),
                  ]}
                />
              </label>
              <label className={ui.fieldLabel}>
                Tên cột nội dung trong JSON/CSV
                <Input
                  value={field}
                  maxLength={80}
                  onChange={(event) => {
                    setField(event.target.value.trim() || "document");
                    markChanged();
                  }}
                  placeholder="document"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                <label className={ui.fieldLabel}>
                  Độ dài
                  <SelectMenu
                    aria-label="Độ dài"
                    className="w-full"
                    placeholder="Chọn độ dài"
                    value={settings.length.mode}
                    onValueChange={(value) => {
                      const mode = value as Settings["length"]["mode"];
                      setSettings((old) => ({
                        ...old,
                        length: {
                          mode,
                          value: mode === "percent" ? 30 : mode === "words" ? 150 : undefined,
                        },
                      }));
                      markChanged();
                    }}
                    items={[
                      { value: "auto", label: "Tự động" },
                      { value: "percent", label: "Theo phần trăm" },
                      { value: "words", label: "Theo số từ" },
                    ]}
                  />
                </label>
                {settings.length.mode !== "auto" && (
                  <label className={ui.fieldLabel}>
                    {settings.length.mode === "percent" ? "Phần trăm" : "Số từ"}
                    <Input
                      type="number"
                      min={1}
                      max={settings.length.mode === "percent" ? 100 : undefined}
                      value={settings.length.value || ""}
                      onChange={(event) => {
                        setSettings((old) => ({
                          ...old,
                          length: { ...old.length, value: Number(event.target.value) },
                        }));
                        markChanged();
                      }}
                    />
                  </label>
                )}
              </div>
              {settings.prompts.some((prompt) => prompt.text.includes("{N}")) && (
                <label className={ui.fieldLabel}>
                  Số vòng tinh chỉnh
                  <SelectMenu
                    aria-label="Số vòng tinh chỉnh"
                    className="w-full"
                    placeholder="Chọn số vòng"
                    value={String(settings.parameters?.N || 1)}
                    onValueChange={(value) => {
                      setSettings((old) => ({
                        ...old,
                        parameters: { ...old.parameters, N: Number(value) },
                      }));
                      markChanged();
                    }}
                    items={[
                      { value: "1", label: "1 vòng" },
                      { value: "3", label: "3 vòng" },
                      { value: "5", label: "5 vòng" },
                    ]}
                  />
                </label>
              )}
              <label className={ui.fieldLabel}>
                Cách trình bày
                <SelectMenu
                  aria-label="Cách trình bày"
                  className="w-full"
                  placeholder="Chọn cách trình bày"
                  value={settings.output_format}
                  onValueChange={(value) => {
                    setSettings((old) => ({
                      ...old,
                      output_format: value as Settings["output_format"],
                    }));
                    markChanged();
                  }}
                  items={[
                    { value: "paragraph", label: "Đoạn văn" },
                    { value: "bullets", label: "Gạch đầu dòng" },
                  ]}
                />
              </label>
              <div className={ui.promptEditors}>
                {settings.prompts.map((prompt, index) => (
                  <div className={ui.promptEditor} key={`${index}-${prompt.name}`}>
                    <div className={ui.promptNameRow}>
                      <Input
                        aria-label={`Tên prompt ${index + 1}`}
                        value={prompt.name}
                        onChange={(event) => {
                          setSettings((old) => ({
                            ...old,
                            prompts: old.prompts.map((item, i) =>
                              i === index ? { ...item, name: event.target.value } : item,
                            ),
                          }));
                          markChanged();
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Xóa prompt"
                        disabled={settings.prompts.length === 1}
                        onClick={() => {
                          setSettings((old) => ({
                            ...old,
                            prompts: old.prompts.filter((_, i) => i !== index),
                          }));
                          markChanged();
                        }}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                    <Textarea
                      className={ui.promptArea}
                      aria-label={`Nội dung prompt ${index + 1}`}
                      value={prompt.text}
                      onChange={(event) => {
                        setSettings((old) => ({
                          ...old,
                          prompts: old.prompts.map((item, i) =>
                            i === index ? { ...item, text: event.target.value } : item,
                          ),
                        }));
                        markChanged();
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className={ui.promptTools}>
                <SelectMenu
                  aria-label="Chọn thư viện prompt"
                  className="col-span-3 w-full min-w-0 sm:col-span-1 sm:w-auto sm:flex-1"
                  placeholder="Nạp prompt mẫu…"
                  onValueChange={(value) => {
                    const prompts =
                      value === "private"
                        ? privatePrompts
                        : library.find((set) => set.id === value)?.prompts;
                    if (prompts?.length) {
                      setSettings((old) => ({
                        ...old,
                        prompts,
                        parameters: prompts.some((prompt) => prompt.text.includes("{N}"))
                          ? { ...old.parameters, N: old.parameters?.N || 1 }
                          : old.parameters,
                      }));
                      markChanged();
                    }
                  }}
                  items={[
                    ...library.map((set) => ({ value: set.id, label: set.name })),
                    ...(privatePrompts.length
                      ? [{ value: "private", label: "Thư viện của tôi" }]
                      : []),
                  ]}
                />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => {
                    if (settings.prompts.length < 10) {
                      setSettings((old) => ({
                        ...old,
                        prompts: [
                          ...old.prompts,
                          {
                            name: `Prompt ${old.prompts.length + 1}`,
                            text: "Tóm tắt văn bản bằng tiếng Việt. Giữ ý chính và dữ kiện.\\n\\n{document}",
                          },
                        ],
                      }));
                      markChanged();
                    }
                  }}
                  title="Thêm prompt"
                >
                  <Plus size={14} />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => void savePrivatePrompts()}
                  title="Lưu prompt hiện tại"
                >
                  <Save size={14} />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => promptInput.current?.click()}
                  title="Nhập thư viện prompt"
                >
                  <Upload size={14} />
                </Button>
                <input
                  ref={promptInput}
                  className="hidden"
                  type="file"
                  accept=".txt,.json,.csv"
                  onChange={(event) => {
                    if (event.target.files) void addFiles(event.target.files, "prompts");
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </aside>
        <section className={ui.centerColumn}>
          <Card className={ui.editorCard}>
            <CardHeader className={ui.editorHeader}>
              <div className="min-w-0">
                <CardTitle className={cn(ui.cardTitle, "truncate")}>
                  {active?.title || "Tài liệu mới"}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {active?.text.split(/\s+/).filter(Boolean).length || 0} từ · nội dung chỉ lưu
                  trong không gian của bạn
                </p>
              </div>
              <div className={ui.editorHeadActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => {
                    if (!active) return;
                    const title = window.prompt("Tên tài liệu", active.title);
                    if (title) {
                      setDocs((old) =>
                        old.map((doc) => (doc.id === active.id ? { ...doc, title } : doc)),
                      );
                      markChanged();
                    }
                  }}
                >
                  <Settings2 size={14} /> Đổi tên
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Xóa tài liệu"
                  onClick={() => {
                    if (docs.length === 1) setDocs([blankDoc()]);
                    else setDocs((old) => old.filter((doc) => doc.id !== active?.id));
                    setActiveId("");
                    markChanged();
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className={ui.editorBody}>
              <Textarea
                className={ui.sourceEditor}
                value={active?.text || ""}
                placeholder="Dán văn bản nguồn tại đây hoặc kéo thả file vào danh sách tài liệu…"
                onChange={(event) => setActiveText(event.target.value)}
              />
              <div className={ui.editorFoot}>
                <span>{active?.text.length.toLocaleString("vi-VN") || 0} ký tự</span>
                <span>{saved ? "Bản nháp đã đồng bộ" : "Đang đồng bộ bản nháp…"}</span>
              </div>
            </CardContent>
            <div className={ui.runFooter}>
              <div className={ui.runMeta}>
                <span className="size-2 shrink-0 rounded-full bg-primary" />
                {settings.model
                  ? `${providers[settings.provider]?.label || settings.provider} · ${settings.model}`
                  : "Chưa chọn model"}
              </div>
              <Button
                className="max-sm:w-full"
                disabled={busy || !active?.text.trim()}
                onClick={() => void submitJob([active.id])}
              >
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <WandSparkles size={16} />
                )}
                Tóm tắt tài liệu
              </Button>
              <Button
                variant="secondary"
                className="max-sm:w-full"
                disabled={busy || !docs.some((doc) => doc.selected)}
                onClick={() =>
                  void submitJob(docs.filter((doc) => doc.selected).map((doc) => doc.id))
                }
              >
                <Files size={15} /> Tóm tắt đã chọn
              </Button>
            </div>
          </Card>
          <Card className="">
            <CardHeader className={ui.cardHeader}>
              <CardTitle className={ui.cardTitle}>
                <Settings2 size={16} /> Tùy chỉnh riêng cho tài liệu
              </CardTitle>
              <Badge className="shrink-0">
                {active?.overrides && Object.keys(active.overrides).length
                  ? "Đang bật"
                  : "Dùng cấu hình chung"}
              </Badge>
            </CardHeader>
            <CardContent className={ui.overrideGrid}>
              <section className={ui.overrideOption}>
                <label className={ui.overrideToggle}>
                  <Checkbox
                    checked={overrideEnabled("model")}
                    onCheckedChange={(checked) => toggleOverride("model", checked === true)}
                  />{" "}
                  Model riêng
                </label>
                {overrideEnabled("model") && (
                  <SelectMenu
                    aria-label="Model riêng cho tài liệu"
                    className="w-full max-w-sm"
                    placeholder="Chọn model"
                    value={`${active?.overrides?.provider || ""}::${active?.overrides?.model || ""}`}
                    onValueChange={(value) => {
                      const [provider, model] = value.split("::");
                      patchOverride("model", { provider, model });
                    }}
                    items={[
                      { value: "::", label: "Chọn model" },
                      ...modelOptions
                        .filter((item) => item.ready)
                        .map((item) => ({
                          value: `${item.provider}::${item.model}`,
                          label: item.label,
                        })),
                    ]}
                  />
                )}
              </section>
              <section className={cn(ui.overrideOption, ui.overridePromptOption)}>
                <label className={ui.overrideToggle}>
                  <Checkbox
                    checked={overrideEnabled("prompts")}
                    onCheckedChange={(checked) => toggleOverride("prompts", checked === true)}
                  />{" "}
                  Prompt riêng
                </label>
                {overrideEnabled("prompts") && (
                  <Textarea
                    aria-label="Prompt riêng cho tài liệu"
                    className={cn(ui.promptArea, "min-h-28")}
                    value={active?.overrides?.prompts?.[0]?.text || ""}
                    onChange={(event) =>
                      patchOverride("prompts", {
                        prompts: [
                          {
                            name: active?.overrides?.prompts?.[0]?.name || "Prompt riêng",
                            text: event.target.value,
                          },
                        ],
                      })
                    }
                  />
                )}
              </section>
              <section className={ui.overrideOption}>
                <label className={ui.overrideToggle}>
                  <Checkbox
                    checked={overrideEnabled("length")}
                    onCheckedChange={(checked) => toggleOverride("length", checked === true)}
                  />{" "}
                  Độ dài riêng
                </label>
                {overrideEnabled("length") && (
                  <div className={ui.overrideLength}>
                    <SelectMenu
                      aria-label="Kiểu độ dài riêng"
                      placeholder="Chọn độ dài"
                      value={active?.overrides?.length?.mode || "auto"}
                      onValueChange={(value) => {
                        const mode = value as Settings["length"]["mode"];
                        patchOverride("length", {
                          length: {
                            mode,
                            value: mode === "percent" ? 30 : mode === "words" ? 150 : undefined,
                          },
                        });
                      }}
                      items={[
                        { value: "auto", label: "Tự động" },
                        { value: "percent", label: "Theo phần trăm" },
                        { value: "words", label: "Theo số từ" },
                      ]}
                    />
                    {active?.overrides?.length?.mode !== "auto" && (
                      <Input
                        aria-label={
                          active?.overrides?.length?.mode === "percent"
                            ? "Phần trăm độ dài riêng"
                            : "Số từ riêng"
                        }
                        type="number"
                        min={1}
                        max={active?.overrides?.length?.mode === "percent" ? 100 : undefined}
                        value={active?.overrides?.length?.value || ""}
                        onChange={(event) =>
                          patchOverride("length", {
                            length: {
                              ...active?.overrides?.length,
                              mode: active?.overrides?.length?.mode || "percent",
                              value: Number(event.target.value),
                            },
                          })
                        }
                      />
                    )}
                  </div>
                )}
              </section>
              <section className={ui.overrideOption}>
                <label className={ui.overrideToggle}>
                  <Checkbox
                    checked={overrideEnabled("output_format")}
                    onCheckedChange={(checked) => toggleOverride("output_format", checked === true)}
                  />{" "}
                  Định dạng riêng
                </label>
                {overrideEnabled("output_format") && (
                  <SelectMenu
                    aria-label="Định dạng riêng cho tài liệu"
                    className="w-full max-w-sm"
                    placeholder="Chọn định dạng"
                    value={active?.overrides?.output_format || "paragraph"}
                    onValueChange={(value) =>
                      patchOverride("output_format", {
                        output_format: value as Settings["output_format"],
                      })
                    }
                    items={[
                      { value: "paragraph", label: "Đoạn văn" },
                      { value: "bullets", label: "Gạch đầu dòng" },
                    ]}
                  />
                )}
              </section>
            </CardContent>
          </Card>
          <Card className={ui.tipCard}>
            <div className={ui.tipIcon}>
              <MessageSquareText size={18} />
            </div>
            <div className={ui.tipCopy}>
              <strong>Mẹo nhỏ</strong>
              <p>
                Dùng <code>{"{document}"}</code> trong prompt để chọn vị trí chèn văn bản nguồn. Có
                thể lưu prompt riêng và dùng lại ở lần sau.
              </p>
            </div>
            <ChevronDown className="ml-auto shrink-0 text-muted-foreground" size={16} />
          </Card>
        </section>
        <aside className={ui.rightColumn}>
          <Card className={ui.resultCard}>
            <div className={ui.resultTabs}>
              <Button
                variant="ghost"
                className={cn(ui.resultTab, rightTab === "result" && ui.resultTabActive)}
                onClick={() => setRightTab("result")}
              >
                <Sparkles size={15} /> Kết quả
              </Button>
              <Button
                variant="ghost"
                className={cn(ui.resultTab, rightTab === "history" && ui.resultTabActive)}
                onClick={() => {
                  setRightTab("history");
                  void refreshHistory().catch((e) => setError(e.message));
                }}
              >
                <History size={15} /> Lịch sử
              </Button>
            </div>
            {rightTab === "result" ? (
              <div className={ui.resultContent}>
                {job ? (
                  <>
                    <div className={ui.jobSummary}>
                      <div>
                        <Badge>{statuses[job.status] || job.status}</Badge>
                        <h3 className="mt-2 text-sm font-semibold">
                          {job.message || "Lượt tóm tắt"}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {job.done} / {job.total} tác vụ · {job.success} thành công · {job.errors}{" "}
                          lỗi
                        </p>
                      </div>
                      {["queued", "running", "cancelling"].includes(job.status) ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void api(`/api/jobs/${job.id}/cancel`, {})
                              .then(() => api<Job>(`/api/jobs/${job.id}`).then(setJob))
                              .catch((e) => setError(e.message))
                          }
                        >
                          Dừng
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => void downloadJob()}>
                          <Download size={14} /> Tải JSON
                        </Button>
                      )}
                    </div>
                    {job.documents.length > 1 && (
                      <label className={cn(ui.fieldLabel, ui.resultPicker)}>
                        Tài liệu
                        <SelectMenu
                          aria-label="Chọn tài liệu kết quả"
                          className="w-full"
                          placeholder="Chọn tài liệu"
                          value={resultDocId || job.documents[0]?.id}
                          onValueChange={setResultDocId}
                          items={job.documents.map((doc) => ({ value: doc.id, label: doc.title }))}
                        />
                      </label>
                    )}
                    {["queued", "running", "cancelling"].includes(job.status) && (
                      <Progress
                        className={ui.progress}
                        value={job.total ? Math.round((job.done / job.total) * 100) : 0}
                      />
                    )}
                    {selectedResults.length ? (
                      <div className={ui.resultList}>
                        {selectedResults.map((result) => (
                          <article className={ui.summaryResult} key={result.task_id}>
                            <div className={ui.summaryTitle}>
                              <strong>{result.prompt_name}</strong>
                              <div className={ui.summaryActions}>
                                <Badge
                                  className={
                                    result.status === "success"
                                      ? "bg-zinc-100 text-zinc-800"
                                      : "bg-zinc-100 text-zinc-700"
                                  }
                                >
                                  {result.status === "success" ? "Hoàn tất" : "Lỗi"}
                                </Badge>
                                {result.summary && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Sao chép"
                                      aria-label="Sao chép"
                                      onClick={() => void copySummary(result.summary!)}
                                    >
                                      <Copy size={13} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Tải TXT"
                                      aria-label="Tải TXT"
                                      onClick={() => downloadSummary(result.summary!)}
                                    >
                                      <Download size={13} />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            {result.summary ? (
                              <p>{result.summary}</p>
                            ) : (
                              <p className={ui.muted}>{result.error || "Đang chờ kết quả…"}</p>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className={ui.emptyResult}>
                        <Sparkles size={24} />
                        <strong>Đang chờ kết quả</strong>
                        <span>Kết quả của tài liệu đang chọn sẽ xuất hiện tại đây.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={ui.emptyResult}>
                    <Sparkles size={24} />
                    <strong>Chưa có lượt tóm tắt</strong>
                    <span>Chạy một tài liệu để xem kết quả.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className={ui.historyList}>
                {history.length ? (
                  history.map((item) => (
                    <div className={ui.historyItem} key={item.id}>
                      <Button
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-1 text-left"
                        onClick={() => void openHistory(item)}
                      >
                        <span className={ui.historyIcon}>
                          <Clock3 size={15} />
                        </span>
                        <span className={ui.historyText}>
                          <strong>{item.title}</strong>
                          <small>
                            {prettyDate(item.created)} · {item.documents} tài liệu · {item.done}/
                            {item.total}
                          </small>
                        </span>
                        <Badge>{statuses[item.status] || item.status}</Badge>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Xóa lượt"
                        onClick={() =>
                          void api(`/api/jobs/${item.id}/delete`, {})
                            .then(refreshHistory)
                            .catch((e) => setError(e.message))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className={ui.emptyResult}>
                    <History size={24} />
                    <strong>Lịch sử trống</strong>
                    <span>Các lượt tóm tắt sẽ được lưu tự động.</span>
                  </div>
                )}
              </div>
            )}
          </Card>
          <div className={ui.privacyNote}>
            <BookOpen size={15} />
            <span>
              Tài liệu và kết quả được lưu riêng theo tài khoản. Nội dung cũ được dọn theo chính
              sách lưu trữ.
            </span>
          </div>
        </aside>
      </div>
      <footer className={ui.appFooter}>
        <span>Summora AI</span>
        <span>Được thiết kế cho việc đọc tập trung.</span>
      </footer>
    </main>
  );
}
