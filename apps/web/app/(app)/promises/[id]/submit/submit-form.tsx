"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { api } from "@/lib/client";

type Kind = "url" | "repo" | "text" | "files";
const KINDS: Record<string, Kind[]> = {
  web: ["url"],
  code: ["repo"],
  design: ["files"],
  writing: ["text", "url", "files"],
  research: ["text", "url", "files"],
  data: ["files"],
};
const LABEL: Record<Kind, string> = {
  url: "Link",
  repo: "Repository",
  text: "Paste text",
  files: "Upload files",
};

export function SubmitForm({
  milestoneId,
  promiseId,
  category,
}: {
  milestoneId: string;
  promiseId: string;
  category: string;
}) {
  const router = useRouter();
  const kinds = KINDS[category] ?? ["url", "text", "files"];
  const [kind, setKind] = useState<Kind>(kinds[0]!);
  const [url, setUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [sha, setSha] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (kind === "url" && !/^https?:\/\/\S+\.\S+/.test(url))
      return "Enter the full public URL, starting with https://";
    if (kind === "repo" && !/github\.com\/[\w.-]+\/[\w.-]+/.test(repoUrl) && !/^https?:\/\//.test(repoUrl))
      return "Enter the repository URL";
    if (kind === "repo" && !/^[0-9a-f]{7,40}$/i.test(sha))
      return "Enter the commit SHA you want verified (7–40 hex characters)";
    if (kind === "text" && text.trim().length < 20) return "Paste the full text";
    if (kind === "files" && (!files || files.length === 0)) return "Choose at least one file";
    if (kind === "files" && files && [...files].some((f) => f.size > 10 * 1024 * 1024))
      return "Each file must be 10 MB or smaller";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    if (!window.confirm("Submit this for verification? It uses one of your attempts.")) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "files") {
        const form = new FormData();
        [...files!].forEach((f) => form.append("files", f));
        if (note) form.append("note", note);
        await api(`/api/milestones/${milestoneId}/submissions`, { form });
      } else {
        await api(`/api/milestones/${milestoneId}/submissions`, {
          body:
            kind === "url"
              ? { kind, url, note: note || undefined }
              : kind === "repo"
                ? { kind, repoUrl, commitSha: sha, note: note || undefined }
                : { kind, text, note: note || undefined },
        });
      }
      router.push(`/promises/${promiseId}/verify?milestone=${milestoneId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "h-9 rounded-lg border px-3 text-sm font-medium",
                kind === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line text-ink-muted",
              )}
            >
              {LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}
      {kind === "url" ? (
        <Field
          label="Public URL"
          hint="Verification loads this exact URL in desktop and mobile browsers. Keep it online until settlement."
        >
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mama-njeri-bakery.example.com"
          />
        </Field>
      ) : null}
      {kind === "repo" ? (
        <>
          <Field label="Repository URL" hint="Public GitHub repositories work out of the box.">
            <Input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/you/project"
            />
          </Field>
          <Field
            label="Commit SHA"
            hint="Verification is pinned to this commit, so later pushes don't change the result."
          >
            <Input
              value={sha}
              onChange={(e) => setSha(e.target.value.trim())}
              placeholder="9f1c2a4…"
              className="font-mono"
            />
          </Field>
        </>
      ) : null}
      {kind === "text" ? (
        <Field label="Deliverable text" hint="Markdown is fine. Include your Sources list with full URLs.">
          <Textarea
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-sm"
          />
        </Field>
      ) : null}
      {kind === "files" ? (
        <Field label="Files" hint="Up to 10 files, 10 MB each (images, PDF, CSV, JSON, Markdown).">
          <Input type="file" multiple onChange={(e) => setFiles(e.target.files)} className="h-auto py-2" />
        </Field>
      ) : null}
      <Field label="Note to the client (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
      {error ? (
        <Alert tone="danger" title="Not submitted">
          {error}
        </Alert>
      ) : null}
      <Button type="submit" size="lg" loading={busy}>
        Submit for verification
      </Button>
    </form>
  );
}
