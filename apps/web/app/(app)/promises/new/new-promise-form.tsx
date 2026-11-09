"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, ApiError, detailLines } from "@/lib/client";

const CATEGORIES = [
  ["web", "Website"],
  ["code", "Code / software"],
  ["design", "Design"],
  ["writing", "Writing"],
  ["research", "Research"],
  ["data", "Data"],
] as const;

type Errors = Partial<Record<"brief" | "budgetUsd" | "deadline" | "workerEmail" | "form", string>>;

export function NewPromiseForm({
  service,
  voiceEnabled,
}: {
  service: { id: string; category: string; priceUsd: number; title: string } | null;
  voiceEnabled: boolean;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState(service ? service.title : "");
  const [category, setCategory] = useState(service?.category ?? "web");
  const [budget, setBudget] = useState(service ? String(service.priceUsd) : "");
  const [deadline, setDeadline] = useState("");
  const [workerEmail, setWorkerEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  // Voice note
  const [recState, setRecState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function startRecording() {
    setErrors({});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecState("transcribing");
        try {
          const form = new FormData();
          form.append("audio", new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }), "brief.webm");
          form.append("language", language);
          const { transcript } = await api<{ transcript: string }>("/api/promises/voice", { form });
          setBrief((b) => (b ? `${b}\n\n${transcript}` : transcript));
        } catch (e) {
          setErrors({ brief: (e as Error).message });
        } finally {
          setRecState("idle");
        }
      };
      mr.start();
      rec.current = mr;
      setRecState("recording");
    } catch {
      setErrors({ brief: "Microphone access was blocked. Allow it in your browser, or type the brief." });
    }
  }

  function validate(): boolean {
    const e: Errors = {};
    if (brief.trim().length < 20) e.brief = "Describe the job in at least a sentence or two.";
    const b = Number(budget);
    if (!budget || !Number.isFinite(b) || b <= 0) e.budgetUsd = "Enter a budget in US dollars.";
    else if (b > 100_000) e.budgetUsd = "Budgets above $100,000 aren't supported in the sandbox.";
    if (deadline && new Date(deadline).getTime() < Date.now() + 3600_000)
      e.deadline = "Pick a date in the future.";
    if (workerEmail && !/^\S+@\S+\.\S+$/.test(workerEmail))
      e.workerEmail = "Enter a valid email or leave it empty.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const { promiseId } = await api<{ promiseId: string }>("/api/promises", {
        body: {
          title: title.trim() || undefined,
          brief,
          category,
          budgetUsd: Number(budget),
          deadline: deadline ? new Date(deadline).toISOString() : undefined,
          workerEmail: workerEmail.trim() || undefined,
          serviceId: service?.id,
        },
      });
      router.push(`/promises/${promiseId}`);
    } catch (e) {
      const lines = e instanceof ApiError ? detailLines(e.details) : [];
      setErrors({ form: [(e as Error).message, ...lines].join(" · ") });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Title (optional)" hint="We'll suggest one from the brief if you leave it empty.">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Landing page for my bakery"
        />
      </Field>

      <Field
        label="What do you need done?"
        error={errors.brief}
        hint="Who is it for, what must it include, what does “done” look like? Plain words are fine — English or Swahili."
      >
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={7}
          maxLength={8000}
          aria-invalid={Boolean(errors.brief)}
          placeholder="Landing page for my bakery in Nairobi. Show our cakes and prices, people should be able to contact us. Must work well on phones."
        />
      </Field>

      {voiceEnabled ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-3">
          <span className="text-sm text-ink-muted">Or record a voice note</span>
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "sw")}
            className="h-9 w-auto text-sm"
            aria-label="Voice note language"
            disabled={recState !== "idle"}
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </Select>
          {recState === "recording" ? (
            <Button type="button" variant="danger" size="sm" onClick={() => rec.current?.stop()}>
              ● Stop recording
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={recState === "transcribing"}
              onClick={() => void startRecording()}
            >
              {recState === "transcribing" ? "Transcribing…" : "🎙 Record"}
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={Boolean(service)}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget (USD)" error={errors.budgetUsd}>
          <Input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="400"
            aria-invalid={Boolean(errors.budgetUsd)}
          />
        </Field>
        <Field label="Deadline (optional)" error={errors.deadline}>
          <Input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-invalid={Boolean(errors.deadline)}
          />
        </Field>
        {!service ? (
          <Field
            label="Worker's email (optional)"
            error={errors.workerEmail}
            hint="You can invite them after reviewing the terms."
          >
            <Input
              type="email"
              value={workerEmail}
              onChange={(e) => setWorkerEmail(e.target.value)}
              placeholder="developer@example.com"
              aria-invalid={Boolean(errors.workerEmail)}
            />
          </Field>
        ) : null}
      </div>

      {errors.form ? (
        <Alert tone="danger" title="Couldn't create the promise">
          {errors.form}
        </Alert>
      ) : null}
      <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">
        Draft the contract
      </Button>
    </form>
  );
}
