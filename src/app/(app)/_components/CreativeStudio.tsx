"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { type CreativeSettings } from "@/lib/creative";
import type { UserPrompt } from "./PromptLibrary";

type Improvement = { improvedPrompt: string; changes: string[]; questions: string[] };
const field = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";
export default function CreativeStudio({ open, onClose, value, onChange, draft, onApplyPrompt }: {
  open: boolean; onClose: () => void; value: CreativeSettings; onChange: (v: CreativeSettings) => void;
  draft: string; onApplyPrompt: (v: string) => void;
}) {
  const [prompts, setPrompts] = useState<UserPrompt[]>([]);
  const [drafts, setDrafts] = useState<{ id: string; content: string; conversation_id: string; created_at: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [improvement, setImprovement] = useState<Improvement | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [wordTarget, setWordTarget] = useState(value.targetWords?.toString() ?? "");
  useEffect(() => { setWordTarget(value.targetWords?.toString() ?? ""); }, [value.targetWords]);
  const [tab, setTab] = useState<"brief" | "layers" | "improve" | "history">("brief");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    void Promise.all([fetch("/api/prompts", { signal: controller.signal, cache: "no-store" }), fetch("/api/creative-history", { signal: controller.signal, cache: "no-store" })])
      .then(async ([p, d]) => {
        const [pj, dj] = await Promise.all([p.json(), d.json()]);
        if (!p.ok || !d.ok) throw Error("Could not load your saved prompts or answer history.");
        setPrompts(pj.prompts ?? []); setDrafts(dj.drafts ?? []);
      }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load studio data."); });
    return () => controller.abort();
  }, [open]);
  function update(patch: Partial<CreativeSettings>) { onChange({ ...value, ...patch }); }
  async function improve() {
    setBusy(true); setError(""); setImprovement(null);
    try {
      const res = await fetch("/api/prompt-improve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: draft }) });
      const json = await res.json(); if (!res.ok) throw Error(json.error ?? "Could not improve the prompt.");
      setImprovement(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not improve the prompt."); }
    finally { setBusy(false); }
  }
  async function saveVoice() {
    if (!voiceName.trim() || !value.voice.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/prompts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `Voice: ${voiceName.trim()}`.slice(0, 120), body: value.voice }) });
      const json = await res.json(); if (!res.ok) throw Error("Could not save this voice profile.");
      setPrompts(p => [json.prompt, ...p]); setVoiceName("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save voice."); }
    finally { setBusy(false); }
  }
  const selected = value.promptIds.map(id => prompts.find(p => p.id === id)).filter((p): p is UserPrompt => !!p);
  return <Modal open={open} onClose={onClose} title="Writing studio" className="max-w-3xl">
    <p className="mb-4 text-sm text-muted-foreground">Shape the draft, layer your instructions, and check recent account history. Grounding and data permissions always apply.</p>
    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Writing studio sections">
      {([['brief', 'Creative brief'], ['layers', 'Prompt layers'], ['improve', 'Improve prompt'], ['history', 'Answer history']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={tab === id} className={`rounded-full border px-3 py-2 text-sm ${tab === id ? 'bg-accent-soft text-accent-strong' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
    {tab === "brief" && <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Audience<input className={field} maxLength={300} value={value.audience} onChange={e => update({ audience: e.target.value })} placeholder="Who should this speak to?" /></label>
      <label className="text-sm">Goal<input className={field} maxLength={500} value={value.goal} onChange={e => update({ goal: e.target.value })} placeholder="What should the reader do or understand?" /></label>
      <label className="text-sm">Angle<select className={field} value={value.angle} onChange={e => update({ angle: e.target.value as CreativeSettings['angle'] })}>{['auto', 'practical', 'contrarian', 'story', 'diagnostic', 'comparison'].map(a => <option key={a}>{a}</option>)}</select></label>
      <label className="text-sm">Word target (optional)<input className={field} type="number" min={50} max={3000} step={50} value={wordTarget} onChange={e => setWordTarget(e.target.value)} onBlur={() => { const n = Number(wordTarget); update({ targetWords: wordTarget && Number.isFinite(n) ? Math.round(Math.max(50, Math.min(3000, n))) : undefined }); }} /></label>
      <label className="text-sm">Saved voice<select className={field} defaultValue="" onChange={e => { const p = prompts.find(p => p.id === e.target.value); if (p) update({ voice: p.body.slice(0, 1000) }); }}><option value="">Choose a voice profile</option>{prompts.filter(p => p.title.startsWith("Voice: ")).map(p => <option key={p.id} value={p.id}>{p.title.slice(7)}</option>)}</select></label>
      <label className="text-sm">Avoid words or themes<input className={field} maxLength={500} value={value.avoid} onChange={e => update({ avoid: e.target.value })} /></label>
      <label className="text-sm sm:col-span-2">Voice and tone<textarea className={field} rows={3} maxLength={1000} value={value.voice} onChange={e => update({ voice: e.target.value })} placeholder="Plainspoken, specific, practical. Short paragraphs. No exaggerated claims." /></label>
      <div className="flex gap-2 sm:col-span-2"><input aria-label="Voice profile name" className={`${field} min-w-0 flex-1`} maxLength={100} value={voiceName} onChange={e => setVoiceName(e.target.value)} placeholder="Name this voice" /><Button type="button" className="shrink-0 whitespace-nowrap" disabled={busy || !voiceName.trim() || !value.voice.trim()} onClick={saveVoice}>Save voice</Button></div>
      <label className="text-sm">Variation<select className={field} value={value.freshness} onChange={e => update({ freshness: e.target.value as CreativeSettings['freshness'] })}><option value="fresh">Fresh approach</option><option value="preserve">Preserve style for edits</option></select></label>
      <label className="text-sm">Saved history check<select className={field} value={value.memoryScope} onChange={e => update({ memoryScope: e.target.value as CreativeSettings['memoryScope'] })}><option value="account">My account</option><option value="thread">This chat</option><option value="off">Off</option></select></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Fresh drafts use up to 12 relevant answers from your 120 most recent saved answers. Current chat context remains available. History helps avoid recycled wording; it is never treated as verified business evidence.</p>
    </div>}
    {tab === "layers" && <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Order: workspace rules → project instructions (when this chat has a project) → your saved layers → per-message instructions. Evidence and access rules take priority. Manage reusable layers in the prompt library.</p>
      {value.promptIds.map((id, i) => <div key={id} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><span className="flex-1">{i + 1}. {prompts.find(p => p.id === id)?.title ?? "Unavailable prompt — remove it"}</span><button type="button" disabled={i === 0} onClick={() => { const ids = [...value.promptIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; update({ promptIds: ids }); }}>Move up</button><button type="button" onClick={() => update({ promptIds: value.promptIds.filter(p => p !== id) })}>Remove</button></div>)}
      <label className="block text-sm">Add a layer (up to 3)<select className={field} value="" disabled={value.promptIds.length >= 3} onChange={e => { if (e.target.value) update({ promptIds: [...value.promptIds, e.target.value] }); }}><option value="">Choose a saved prompt</option>{prompts.filter(p => !value.promptIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label className="block text-sm">Per-message instructions<textarea className={field} rows={3} maxLength={2000} value={value.messageInstructions} onChange={e => update({ messageInstructions: e.target.value })} /></label>
      <details className="text-sm"><summary className="cursor-pointer">Preview my layers ({selected.reduce((n, p) => n + p.body.length, value.messageInstructions.length).toLocaleString()} characters)</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-xs">{selected.map(p => `${p.title}\n${p.body}`).concat(value.messageInstructions).filter(Boolean).join("\n\n") || "No personal layers selected."}</pre></details>
    </div>}
    {tab === "improve" && <div className="space-y-3"><p className="text-sm">Improve the prompt currently in your composer. Review the result before applying it; this does not send a chat message.</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-sm">{draft || "Type your draft prompt in the composer first."}</pre><Button type="button" disabled={busy || draft.trim().length < 3 || draft.length > 6000} onClick={improve}>{busy ? "Improving…" : "Improve my prompt"}</Button>{improvement && <div className="space-y-3"><textarea aria-label="Improved prompt preview" className={field} rows={8} value={improvement.improvedPrompt} onChange={e => setImprovement({ ...improvement, improvedPrompt: e.target.value })} /><ul className="list-disc pl-5 text-sm">{improvement.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>{improvement.questions.length > 0 && <p className="text-sm">Still to clarify: {improvement.questions.join(" ")}</p>}<Button type="button" onClick={() => { onApplyPrompt(improvement.improvedPrompt); onClose(); }}>Apply to composer</Button></div>}</div>}
    {tab === "history" && <div className="space-y-3"><p className="text-xs text-muted-foreground">Your 30 most recent saved answers. Open a chat to inspect or branch from its full history.</p>{drafts.length ? drafts.map(d => <a key={d.id} className="block rounded-xl border p-3 text-sm hover:bg-surface-muted" href={`/c/${d.conversation_id}`}><time className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</time><p className="mt-1 whitespace-pre-wrap">{d.content}…</p></a>) : <p className="text-sm">No saved answers yet.</p>}</div>}
    <div className="mt-5 flex justify-end"><Button type="button" onClick={onClose}>Done</Button></div>
  </Modal>;
}

export function GenerationReceipt({ receipt }: { receipt: Record<string, unknown> }) {
  const warnings = Array.isArray(receipt.warnings) ? receipt.warnings.filter((s): s is string => typeof s === "string") : [];
  return <details className="mt-3 rounded-xl border border-border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Answer details · {String(receipt.words ?? 0)} words · {String(receipt.evidenceDocuments ?? 0)} source documents{typeof receipt.overlapPercent === "number" ? ` · ${receipt.overlapPercent}% wording overlap` : ""}</summary><div className="mt-2 space-y-1"><p>Model: {String(receipt.model)} · Mode: {String(receipt.mode)}</p><p>Evidence: {String(receipt.evidenceChunks)} chunks. Citation IDs: {String(receipt.validCitations)} valid, {String(receipt.invalidCitations)} invalid. Citation ID checks do not prove that every claim is supported.</p>{receipt.creative === true && <p>Compared with {String(receipt.draftsCompared)} prior draft excerpts ({String(receipt.memoryScope)}). {receipt.revised ? "Repeated wording was revised before delivery." : ""} {receipt.targetWords ? `Word target: ${receipt.targetWords}.` : ""} Overlap measures shared five-word phrases, not global originality.</p>}<p>Layers: {Array.isArray(receipt.layers) && receipt.layers.length ? receipt.layers.join(" → ") : "Workspace and project defaults"}. Faithfulness: {String(receipt.faithfulness)}.</p>{warnings.map((w, i) => <p key={i} className="text-warning">{w}</p>)}</div></details>;
}
