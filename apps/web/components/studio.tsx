"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown, CircleHelp, Clock3, Copy, Download, FilePlus2, FileText, Files, History, LoaderCircle, LogOut, MessageSquareText, Plus, Save, Settings2, Sparkles, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Doc = { id: string; title: string; text: string; source?: string; selected?: boolean; revision?: number; overrides?: Partial<Settings> };
type Prompt = { name: string; text: string };
type Settings = { provider: string; model: string; prompts: Prompt[]; length: { mode: "auto" | "percent" | "words"; value?: number }; output_format: "paragraph" | "bullets"; parameters?: Record<string, number> };
type Provider = { label: string; ready: boolean; key_configured: boolean; models: string[] };
type Job = { id: string; status: string; total: number; done: number; success: number; errors: number; message: string; documents: Doc[]; tasks: Array<{ id: string; status: string; prompt_name: string }>; results: Array<{ task_id: string; document_id: string; title: string; prompt_name: string; status: string; summary?: string; error?: string; job_id?: string }>; download_ready: boolean };
type HistoryItem = { id: string; created: number; status: string; total: number; done: number; success: number; errors: number; title: string; documents: number };
type DraftData = { documents: Doc[]; activeId?: string; settings?: Partial<Settings>; field?: string };
type ImportedItem = { title?: string; text?: string; source?: string; name?: string };
const supabase = createClient();
const blankDoc = (): Doc => ({ id: crypto.randomUUID(), title: "Văn bản mới", text: "", revision: 1 });
const defaultSettings: Settings = { provider: "", model: "", prompts: [{ name: "Trung tính", text: "Tóm tắt văn bản bằng tiếng Việt, giữ đúng ý chính và dữ kiện. Không thêm thông tin ngoài nguồn.\n\n{document}" }], length: { mode: "auto" }, output_format: "paragraph" };

async function api<T = unknown>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const options: RequestInit = { method: body === undefined ? "GET" : "POST", headers: { ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}), ...headers } };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.headers = { ...options.headers, "Content-Type": "application/json" }; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  if (!response.ok) { let error = "Không thể xử lý yêu cầu."; try { error = (await response.json()).error || error; } catch {} throw new Error(error); }
  return response.json();
}

const statuses: Record<string, string> = { queued: "Đang chờ", running: "Đang xử lý", cancelling: "Đang dừng", completed: "Hoàn tất", failed: "Thất bại", cancelled: "Đã hủy", interrupted: "Bị gián đoạn" };
function prettyDate(seconds: number) { return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(seconds * 1000)); }

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
  const [library, setLibrary] = useState<Array<{ id: string; name: string; prompts: Prompt[] }>>([]);
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
  const modelOptions = useMemo(() => Object.entries(providers).flatMap(([provider, value]) => (value.models || []).map((model) => ({ provider, model, label: `${value.label} · ${model}`, ready: value.ready }))), [providers]);
  const selectedResults = job?.results.filter((result) => result.document_id === (resultDocId || active?.id)) ?? [];

  const refreshHistory = useCallback(async () => {
    const result = await api<{ jobs: HistoryItem[] }>("/api/history");
    setHistory(result.jobs);
  }, []);

  const loadWorkspace = useCallback(async (loggedIn: boolean) => {
    if (!loggedIn) { setWorkspaceReady(false); setUser(null); setHistory([]); setJob(null); setProfile(null); return; }
    setWorkspaceReady(false);
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.user) { setUser(null); return; }
    setUser({ id: session.user.id, email: session.user.email });
    const [draftResponse, promptResponse, historyResponse, profileResponse] = await Promise.all([
      api<{ draft: DraftData | null }>("/api/draft"), api<{ prompts: Prompt[] }>("/api/my-prompts"), api<{ jobs: HistoryItem[] }>("/api/history"), fetch("/api/profile").then((response) => response.json() as Promise<{ profile?: { dailyQuota: number } }>),
    ]);
    const draft = draftResponse.draft;
    if (draft && Array.isArray(draft.documents) && draft.documents.length) {
      setDocs(draft.documents); setActiveId(draft.activeId || draft.documents[0].id); setSettings({ ...defaultSettings, ...(draft.settings || {}) }); setField(draft.field || "document");
    }
    setPrivatePrompts(promptResponse.prompts || []);
    setHistory(historyResponse.jobs || []);
    setProfile(profileResponse.profile || null);
    setWorkspaceReady(true);
  }, []);

  useEffect(() => {
    api<{ providers: Record<string, Provider> }>("/api/config").then((result) => {
      setProviders(result.providers);
      const choice = Object.entries(result.providers).find(([, provider]) => provider.ready);
      if (choice) setSettings((old) => old.provider ? old : { ...old, provider: choice[0], model: choice[1].models[0] || "" });
    }).catch((e) => setError(e.message));
    api<{ sets: Array<{ id: string; name: string; prompts: Prompt[] }> }>("/api/prompts").then((value) => {
      setLibrary(value.sets || []);
      if (value.sets?.[0]?.prompts?.[0]) setSettings((old) => old.prompts[0]?.text === defaultSettings.prompts[0].text ? { ...old, prompts: [value.sets[0].prompts[0]] } : old);
    }).catch((e) => setError(e.message));
    supabase.auth.getSession().then(({ data }) => loadWorkspace(Boolean(data.session?.user))).catch(() => undefined);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { queueMicrotask(() => void loadWorkspace(Boolean(session?.user)).catch((e) => setError(e.message))); });
    return () => subscription.unsubscribe();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!user || !workspaceReady) return;
    const timer = window.setTimeout(() => {
      api("/api/draft", { documents: docs, activeId, settings, field }).then(() => { setSaved(true); setError(""); }).catch((e) => setError(e.message));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [docs, activeId, settings, field, user, workspaceReady]);

  useEffect(() => {
    if (!job || !["queued", "running", "cancelling"].includes(job.status)) return;
    const timer = window.setTimeout(() => api<Job>(`/api/jobs/${job.id}`).then(setJob).catch((e) => setError(e.message)), 1200);
    return () => window.clearTimeout(timer);
  }, [job]);

  const markChanged = () => { setSaved(false); setNotice(""); };
  const setActiveText = (text: string) => {
    setDocs((old) => old.map((doc) => doc.id === active?.id ? { ...doc, text, revision: (doc.revision || 1) + 1 } : doc)); markChanged();
  };

  function overrideEnabled(group: "model" | "prompts" | "length" | "output_format") {
    const overrides = active?.overrides;
    if (!overrides) return false;
    if (group === "model") return Boolean(overrides.provider || overrides.model);
    return overrides[group] !== undefined;
  }

  function toggleOverride(group: "model" | "prompts" | "length" | "output_format", enabled: boolean) {
    if (!active) return;
    setDocs((old) => old.map((doc) => {
      if (doc.id !== active.id) return doc;
      const overrides = { ...(doc.overrides || {}) };
      if (enabled) {
        if (group === "model") { overrides.provider = settings.provider; overrides.model = settings.model; }
        else if (group === "prompts") overrides.prompts = settings.prompts;
        else if (group === "length") overrides.length = settings.length;
        else overrides.output_format = settings.output_format;
      } else if (group === "model") {
        delete overrides.provider; delete overrides.model;
      } else {
        delete overrides[group];
      }
      return { ...doc, overrides };
    }));
    markChanged();
  }

  function patchOverride(group: "model" | "prompts" | "length" | "output_format", value: Partial<Settings>) {
    if (!active) return;
    setDocs((old) => old.map((doc) => doc.id === active.id ? { ...doc, overrides: { ...(doc.overrides || {}), ...value } } : doc));
    markChanged();
  }

  async function authSubmit(event: React.FormEvent) {
    event.preventDefault(); setAuthBusy(true); setError(""); setNotice("");
    try {
      if (authMode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        if (!data.session) setNotice("Tài khoản đã được tạo. Hãy kiểm tra email để xác nhận trước khi đăng nhập.");
        else setNotice("Tạo tài khoản thành công.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể đăng nhập."); }
    finally { setAuthBusy(false); }
  }

  async function addFiles(files: FileList | File[], kind: "data" | "prompts" = "data") {
    setError("");
    for (const file of Array.from(files)) {
      try {
        const form = new FormData(); form.append("file", file); form.append("kind", kind); if (kind === "data") form.append("field", field);
        const response = await api<{ parsed: unknown }>("/api/import", form);
        const parsed = Array.isArray(response.parsed) ? response.parsed as ImportedItem[] : [];
        if (kind === "prompts") {
          const prompts = parsed as Prompt[];
          if (prompts.length) { setPrivatePrompts(prompts); setSettings((old) => ({ ...old, prompts: [prompts[0]] })); setNotice(`${prompts.length} prompt đã nạp vào phiên làm việc.`); }
        } else {
          const imported: Doc[] = parsed.map((item) => ({ title: item.title || "Tài liệu", text: item.text || "", source: item.source, id: crypto.randomUUID(), revision: 1 }));
          if (imported.length) { setDocs((old) => [...old.filter((doc) => doc.text || doc.title !== "Văn bản mới"), ...imported]); setActiveId(imported[0].id); markChanged(); }
        }
      } catch (e) { setError(`${file.name}: ${e instanceof Error ? e.message : "Không đọc được file."}`); }
    }
  }

  async function submitJob(ids: string[]) {
    const chosen = docs.filter((doc) => ids.includes(doc.id));
    if (!chosen.length) { setError("Chọn ít nhất một tài liệu."); return; }
    if (!settings.provider || !settings.model) { setError("Chọn provider và model đã cấu hình API key."); return; }
    if (chosen.some((doc) => !doc.text.trim())) { setError("Mỗi tài liệu cần có nội dung."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = { documents: chosen, settings, field };
      await api("/api/validate", payload);
      const created = await api<{ id: string }>("/api/jobs", payload, { "Idempotency-Key": crypto.randomUUID() });
      const current = await api<Job>(`/api/jobs/${created.id}`);
      setJob(current); setResultDocId(chosen[0].id); setRightTab("result"); await refreshHistory();
    } catch (e) { setError(e instanceof Error ? e.message : "Không tạo được lượt tóm tắt."); }
    finally { setBusy(false); }
  }

  async function openHistory(item: HistoryItem) {
    setRightTab("result"); setError("");
    try { const full = await api<Job>(`/api/jobs/${item.id}`); setJob(full); setResultDocId(full.documents[0]?.id || ""); }
    catch (e) { setError(e instanceof Error ? e.message : "Không mở được lịch sử."); }
  }

  async function downloadJob() {
    if (!job) return;
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/jobs/${job.id}/download`, { headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
    if (!response.ok) { setError("Chưa có file kết quả để tải."); return; }
    const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `summaries_${job.id.slice(0, 8)}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function savePrivatePrompts() {
    try { await api("/api/my-prompts", { prompts: settings.prompts }); setPrivatePrompts(settings.prompts); setNotice("Đã lưu thư viện prompt riêng."); }
    catch (e) { setError(e instanceof Error ? e.message : "Không lưu được prompt."); }
  }

  async function copySummary(summary: string) {
    try { await navigator.clipboard.writeText(summary); setNotice("Đã sao chép bản tóm tắt."); }
    catch { setError("Không sao chép được. Hãy chọn và sao chép nội dung trong kết quả."); }
  }

  function downloadSummary(summary: string) {
    const url = URL.createObjectURL(new Blob([summary], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tom-tat.txt"; anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!user) return <main className="auth-shell">
    <section className="auth-brand">
      <div className="auth-brand-lockup"><div className="brand-mark"><BookOpen size={19} strokeWidth={1.8} /></div><div><strong>Summora</strong><span>Không gian đọc tài liệu</span></div></div>
      <div className="auth-brand-copy"><p className="eyebrow">ĐỌC VÀ TÓM TẮT</p><h1>Tài liệu dài.<br />Ý chính rõ ràng.</h1><p className="muted light">Thêm tài liệu, chọn cách tóm tắt và lưu kết quả gọn trong một không gian riêng.</p>
        <div className="auth-workflow"><div><span>01</span><p>Thêm tài liệu</p></div><div><span>02</span><p>Chọn cách đọc</p></div><div><span>03</span><p>Lưu ý chính</p></div></div>
      </div>
      <div className="auth-foot">Được thiết kế cho việc đọc tập trung.</div>
    </section>
    <section className="auth-panel"><Card className="auth-card"><CardHeader className="auth-card-header"><p className="auth-kicker">KHÔNG GIAN CỦA BẠN</p><CardTitle>{authMode === "login" ? "Chào mừng trở lại" : "Tạo tài khoản"}</CardTitle><p className="auth-description">{authMode === "login" ? "Đăng nhập để tiếp tục với tài liệu của bạn." : "Tạo tài khoản bằng email để bắt đầu."}</p></CardHeader><CardContent><form onSubmit={authSubmit} className="space-y-4"><label className="field-label">Email<Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@email.com" /></label><label className="field-label">Mật khẩu<Input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status" className="notice success">{notice}</p>}<Button className="w-full" disabled={authBusy}>{authBusy && <LoaderCircle className="animate-spin" size={16} />}{authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button></form><p className="auth-switch">{authMode === "login" ? "Chưa có tài khoản?" : "Đã có tài khoản?"} <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}>{authMode === "login" ? "Đăng ký" : "Đăng nhập"}</button></p><p className="auth-security"><CircleHelp size={14} /> Đăng nhập bảo mật qua Supabase Auth.</p></CardContent></Card></section>
  </main>;

  return <main className="app-shell">
    <header className="topbar"><div className="top-brand"><div className="brand-mark small"><Sparkles size={17} /></div><div><strong>Summora</strong><span>AI document studio</span></div></div><div className="top-actions"><span className="save-indicator">{saved ? <Check size={14} /> : <LoaderCircle size={14} className="animate-spin" />}{saved ? "Đã lưu" : "Đang lưu"}</span><span className="user-email">{user.email}</span><Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); setDocs([blankDoc()]); setJob(null); }}><LogOut size={15} /> Đăng xuất</Button></div></header>
    <div className="page-heading"><div><p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p><h1>Tóm tắt tài liệu</h1><p>Nhập nguồn, chọn cách tóm tắt và theo dõi kết quả ngay tại đây.</p></div><div className="quota-chip"><Sparkles size={15} /><span>Hạn mức mỗi ngày</span><strong>{profile?.dailyQuota ?? 200} tác vụ</strong></div></div>
    {(error || notice) && <div className={`global-notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label="Đóng"><X size={15} /></button></div>}
    <div className="workspace">
      <aside className="left-column">
        <Card><CardHeader className="card-head-row"><CardTitle><Files size={17} /> Tài liệu <span className="count">{docs.length}</span></CardTitle><Button variant="ghost" size="icon" aria-label="Thêm tài liệu" title="Thêm tài liệu" onClick={() => { const next = blankDoc(); setDocs((old) => [...old, next]); setActiveId(next.id); markChanged(); }}><Plus size={17} /></Button></CardHeader><CardContent className="doc-list-wrap"><div className="doc-list">{docs.map((doc) => <button key={doc.id} className={`doc-item ${active?.id === doc.id ? "active" : ""}`} onClick={() => setActiveId(doc.id)}><FileText size={16} /><span className="doc-title">{doc.title || "Tài liệu chưa đặt tên"}</span><input type="checkbox" aria-label={`Chọn ${doc.title}`} checked={!!doc.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => { setDocs((old) => old.map((item) => item.id === doc.id ? { ...item, selected: event.target.checked } : item)); }} /></button>)}</div><div className={`upload-drop ${dragging ? "dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}><Upload size={19} /><strong>Kéo thả tài liệu</strong><span>hoặc nhấn để chọn file</span><small>TXT · DOCX · PDF · JSON · CSV</small></div><input ref={fileInput} className="hidden" type="file" multiple accept=".txt,.docx,.pdf,.json,.csv" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = ""; }} /><div className="doc-actions"><Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><FilePlus2 size={15} /> Thêm file</Button><Button variant="ghost" size="sm" disabled={docs.length < 2} onClick={() => { setDocs((old) => old.filter((doc) => !doc.selected)); if (!docs.some((doc) => !doc.selected)) setDocs([blankDoc()]); setActiveId(""); markChanged(); }}><Trash2 size={14} /> Xóa đã chọn</Button></div></CardContent></Card>
        <Card>
          <CardHeader className="card-head-row"><CardTitle><Settings2 size={17} /> Cấu hình tóm tắt</CardTitle><Badge>{settings.prompts.length} prompt</Badge></CardHeader>
          <CardContent className="settings-stack">
            <label className="field-label">Mô hình<select className="select" value={`${settings.provider}::${settings.model}`} onChange={(event) => { const [provider, model] = event.target.value.split("::"); setSettings((old) => ({ ...old, provider, model })); markChanged(); }}><option value="::">Chọn model đã cấu hình</option>{modelOptions.map((item) => <option disabled={!item.ready} key={`${item.provider}::${item.model}`} value={`${item.provider}::${item.model}`}>{item.label}{item.ready ? "" : " · Chưa cấu hình key"}</option>)}</select></label>
            <label className="field-label">Tên cột nội dung trong JSON/CSV<Input value={field} maxLength={80} onChange={(event) => { setField(event.target.value.trim() || "document"); markChanged(); }} placeholder="document" /></label>
            <div className="settings-grid"><label className="field-label">Độ dài<select className="select" value={settings.length.mode} onChange={(event) => { const mode = event.target.value as Settings["length"]["mode"]; setSettings((old) => ({ ...old, length: { mode, value: mode === "percent" ? 30 : mode === "words" ? 150 : undefined } })); markChanged(); }}><option value="auto">Tự động</option><option value="percent">Theo phần trăm</option><option value="words">Theo số từ</option></select></label>{settings.length.mode !== "auto" && <label className="field-label">{settings.length.mode === "percent" ? "Phần trăm" : "Số từ"}<Input type="number" min={1} max={settings.length.mode === "percent" ? 100 : undefined} value={settings.length.value || ""} onChange={(event) => { setSettings((old) => ({ ...old, length: { ...old.length, value: Number(event.target.value) } })); markChanged(); }} /></label>}</div>
            {settings.prompts.some((prompt) => prompt.text.includes("{N}")) && <label className="field-label">Số vòng tinh chỉnh<select className="select" value={settings.parameters?.N || 1} onChange={(event) => { setSettings((old) => ({ ...old, parameters: { ...old.parameters, N: Number(event.target.value) } })); markChanged(); }}><option value={1}>1 vòng</option><option value={3}>3 vòng</option><option value={5}>5 vòng</option></select></label>}
            <label className="field-label">Cách trình bày<select className="select" value={settings.output_format} onChange={(event) => { setSettings((old) => ({ ...old, output_format: event.target.value as Settings["output_format"] })); markChanged(); }}><option value="paragraph">Đoạn văn</option><option value="bullets">Gạch đầu dòng</option></select></label>
            <div className="prompt-editors">{settings.prompts.map((prompt, index) => <div className="prompt-editor" key={`${index}-${prompt.name}`}><div className="prompt-name-row"><Input aria-label={`Tên prompt ${index + 1}`} value={prompt.name} onChange={(event) => { setSettings((old) => ({ ...old, prompts: old.prompts.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })); markChanged(); }} /><Button variant="ghost" size="icon" aria-label="Xóa prompt" disabled={settings.prompts.length === 1} onClick={() => { setSettings((old) => ({ ...old, prompts: old.prompts.filter((_, i) => i !== index) })); markChanged(); }}><X size={14} /></Button></div><Textarea className="prompt-area" aria-label={`Nội dung prompt ${index + 1}`} value={prompt.text} onChange={(event) => { setSettings((old) => ({ ...old, prompts: old.prompts.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })); markChanged(); }} /></div>)}</div>
            <div className="prompt-tools"><select className="select" aria-label="Chọn thư viện prompt" onChange={(event) => { const prompts = event.target.value === "private" ? privatePrompts : library.find((set) => set.id === event.target.value)?.prompts; if (prompts?.length) { setSettings((old) => ({ ...old, prompts })); markChanged(); } }}><option value="">Nạp prompt mẫu…</option>{library.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}{privatePrompts.length > 0 && <option value="private">Thư viện của tôi</option>}</select><Button variant="secondary" size="sm" onClick={() => { if (settings.prompts.length < 10) { setSettings((old) => ({ ...old, prompts: [...old.prompts, { name: `Prompt ${old.prompts.length + 1}`, text: "Tóm tắt văn bản bằng tiếng Việt. Giữ ý chính và dữ kiện.\\n\\n{document}" }] })); markChanged(); } }} title="Thêm prompt"><Plus size={14} /></Button><Button variant="secondary" size="sm" onClick={() => void savePrivatePrompts()} title="Lưu prompt hiện tại"><Save size={14} /></Button><Button variant="secondary" size="sm" onClick={() => promptInput.current?.click()} title="Nhập thư viện prompt"><Upload size={14} /></Button><input ref={promptInput} className="hidden" type="file" accept=".txt,.json,.csv" onChange={(event) => { if (event.target.files) void addFiles(event.target.files, "prompts"); event.currentTarget.value = ""; }} /></div>
          </CardContent>
        </Card>
      </aside>
      <section className="center-column"><Card className="editor-card"><CardHeader className="editor-header"><div><CardTitle>{active?.title || "Tài liệu mới"}</CardTitle><p>{active?.text.split(/\s+/).filter(Boolean).length || 0} từ · nội dung chỉ lưu trong không gian của bạn</p></div><div className="editor-head-actions"><Button variant="secondary" size="sm" onClick={() => { if (!active) return; const title = window.prompt("Tên tài liệu", active.title); if (title) { setDocs((old) => old.map((doc) => doc.id === active.id ? { ...doc, title } : doc)); markChanged(); } }}><Settings2 size={14} /> Đổi tên</Button><Button variant="ghost" size="icon" aria-label="Xóa tài liệu" onClick={() => { if (docs.length === 1) setDocs([blankDoc()]); else setDocs((old) => old.filter((doc) => doc.id !== active?.id)); setActiveId(""); markChanged(); }}><Trash2 size={16} /></Button></div></CardHeader><CardContent className="editor-body"><Textarea className="source-editor" value={active?.text || ""} placeholder="Dán văn bản nguồn tại đây hoặc kéo thả file vào danh sách tài liệu…" onChange={(event) => setActiveText(event.target.value)} /><div className="editor-foot"><span>{active?.text.length.toLocaleString("vi-VN") || 0} ký tự</span><span>{saved ? "Bản nháp đã đồng bộ" : "Đang đồng bộ bản nháp…"}</span></div></CardContent><div className="run-footer"><div><span className="ready-dot" />{settings.model ? `${providers[settings.provider]?.label || settings.provider} · ${settings.model}` : "Chưa chọn model"}</div><Button disabled={busy || !active?.text.trim()} onClick={() => void submitJob([active.id])}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <WandSparkles size={16} />}Tóm tắt tài liệu</Button><Button variant="secondary" disabled={busy || !docs.some((doc) => doc.selected)} onClick={() => void submitJob(docs.filter((doc) => doc.selected).map((doc) => doc.id))}><Files size={15} /> Tóm tắt đã chọn</Button></div></Card>
        <Card className="doc-override-card">
          <CardHeader className="card-head-row"><CardTitle><Settings2 size={16} /> Tùy chỉnh riêng cho tài liệu</CardTitle><Badge>{active?.overrides && Object.keys(active.overrides).length ? "Đang bật" : "Dùng cấu hình chung"}</Badge></CardHeader>
          <CardContent className="override-grid">
            <label><input type="checkbox" checked={overrideEnabled("model")} onChange={(event) => toggleOverride("model", event.target.checked)} /> Model riêng</label>
            {overrideEnabled("model") && <select className="select" value={`${active?.overrides?.provider || ""}::${active?.overrides?.model || ""}`} onChange={(event) => { const [provider, model] = event.target.value.split("::"); patchOverride("model", { provider, model }); }}><option value="::">Chọn model</option>{modelOptions.filter((item) => item.ready).map((item) => <option key={`${item.provider}::${item.model}`} value={`${item.provider}::${item.model}`}>{item.label}</option>)}</select>}
            <label><input type="checkbox" checked={overrideEnabled("prompts")} onChange={(event) => toggleOverride("prompts", event.target.checked)} /> Prompt riêng</label>
            {overrideEnabled("prompts") && <Textarea className="prompt-area override-prompt" value={active?.overrides?.prompts?.[0]?.text || ""} onChange={(event) => patchOverride("prompts", { prompts: [{ name: active?.overrides?.prompts?.[0]?.name || "Prompt riêng", text: event.target.value }] })} />}
            <label><input type="checkbox" checked={overrideEnabled("length")} onChange={(event) => toggleOverride("length", event.target.checked)} /> Độ dài riêng</label>
            {overrideEnabled("length") && <div className="settings-grid"><select className="select" value={active?.overrides?.length?.mode || "auto"} onChange={(event) => patchOverride("length", { length: { mode: event.target.value as Settings["length"]["mode"], value: active?.overrides?.length?.value } })}><option value="auto">Tự động</option><option value="percent">Phần trăm</option><option value="words">Số từ</option></select><Input aria-label="Giá trị độ dài riêng" type="number" min={1} value={active?.overrides?.length?.value || ""} onChange={(event) => patchOverride("length", { length: { mode: active?.overrides?.length?.mode || "percent", value: Number(event.target.value) } })} /></div>}
            <label><input type="checkbox" checked={overrideEnabled("output_format")} onChange={(event) => toggleOverride("output_format", event.target.checked)} /> Định dạng riêng</label>
            {overrideEnabled("output_format") && <select className="select" value={active?.overrides?.output_format || "paragraph"} onChange={(event) => patchOverride("output_format", { output_format: event.target.value as Settings["output_format"] })}><option value="paragraph">Đoạn văn</option><option value="bullets">Gạch đầu dòng</option></select>}
          </CardContent>
        </Card>
        <Card className="tip-card"><div className="tip-icon"><MessageSquareText size={18} /></div><div><strong>Mẹo nhỏ</strong><p>Dùng <code>{"{document}"}</code> trong prompt để chọn vị trí chèn văn bản nguồn. Có thể lưu prompt riêng và dùng lại ở lần sau.</p></div><ChevronDown className="tip-chevron" size={16} /></Card>
      </section>
      <aside className="right-column">
        <Card className="result-card">
          <div className="result-tabs">
            <button className={rightTab === "result" ? "selected" : ""} onClick={() => setRightTab("result")}><Sparkles size={15} /> Kết quả</button>
            <button className={rightTab === "history" ? "selected" : ""} onClick={() => { setRightTab("history"); void refreshHistory().catch((e) => setError(e.message)); }}><History size={15} /> Lịch sử</button>
          </div>
          {rightTab === "result" ? (
            <div className="result-content">
              {job ? <>
                <div className="job-summary"><div><Badge className={job.status === "completed" ? "bg-zinc-100 text-zinc-800" : ""}>{statuses[job.status] || job.status}</Badge><h3>{job.message || "Lượt tóm tắt"}</h3><p>{job.done} / {job.total} tác vụ · {job.success} thành công · {job.errors} lỗi</p></div>{["queued", "running", "cancelling"].includes(job.status) ? <Button variant="secondary" size="sm" onClick={() => void api(`/api/jobs/${job.id}/cancel`, {}).then(() => api<Job>(`/api/jobs/${job.id}`).then(setJob)).catch((e) => setError(e.message))}>Dừng</Button> : <Button variant="secondary" size="sm" onClick={() => void downloadJob()}><Download size={14} /> Tải JSON</Button>}</div>
                {job.documents.length > 1 && <label className="field-label result-document-picker">Tài liệu<select className="select" value={resultDocId} onChange={(event) => setResultDocId(event.target.value)}>{job.documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>}
                {["queued", "running", "cancelling"].includes(job.status) && <div className="progress-track"><span style={{ width: `${job.total ? Math.round(job.done / job.total * 100) : 0}%` }} /></div>}
                {selectedResults.length ? <div className="result-list">{selectedResults.map((result) => <article className="summary-result" key={result.task_id}><div className="summary-title"><strong>{result.prompt_name}</strong><div className="summary-result-actions"><Badge className={result.status === "success" ? "bg-zinc-100 text-zinc-800" : "bg-zinc-100 text-zinc-700"}>{result.status === "success" ? "Hoàn tất" : "Lỗi"}</Badge>{result.summary && <><Button variant="ghost" size="icon" title="Sao chép" aria-label="Sao chép" onClick={() => void copySummary(result.summary!)}><Copy size={13} /></Button><Button variant="ghost" size="icon" title="Tải TXT" aria-label="Tải TXT" onClick={() => downloadSummary(result.summary!)}><Download size={13} /></Button></>}</div></div>{result.summary ? <p>{result.summary}</p> : <p className="muted">{result.error || "Đang chờ kết quả…"}</p>}</article>)}</div> : <div className="empty-result"><Sparkles size={24} /><strong>Đang chờ kết quả</strong><span>Kết quả của tài liệu đang chọn sẽ xuất hiện tại đây.</span></div>}
              </> : <div className="empty-result"><Sparkles size={24} /><strong>Chưa có lượt tóm tắt</strong><span>Chạy một tài liệu để xem kết quả.</span></div>}
            </div>
          ) : (
            <div className="history-list">{history.length ? history.map((item) => <div className="history-item" key={item.id}><button onClick={() => void openHistory(item)}><div className="history-icon"><Clock3 size={15} /></div><span><strong>{item.title}</strong><small>{prettyDate(item.created)} · {item.documents} tài liệu · {item.done}/{item.total}</small></span><Badge className={item.status === "completed" ? "bg-zinc-100 text-zinc-800" : ""}>{statuses[item.status] || item.status}</Badge></button><Button variant="ghost" size="icon" aria-label="Xóa lượt" onClick={() => void api(`/api/jobs/${item.id}/delete`, {}).then(refreshHistory).catch((e) => setError(e.message))}><Trash2 size={14} /></Button></div>) : <div className="empty-result"><History size={24} /><strong>Lịch sử trống</strong><span>Các lượt tóm tắt sẽ được lưu tự động.</span></div>}</div>
          )}
        </Card>
        <div className="privacy-note"><BookOpen size={15} /><span>Tài liệu và kết quả được lưu riêng theo tài khoản. Nội dung cũ được dọn theo chính sách lưu trữ.</span></div>
      </aside>
    </div>
    <footer className="app-footer"><span>Summora AI</span><span>Được thiết kế cho việc đọc tập trung.</span></footer>
  </main>;
}
