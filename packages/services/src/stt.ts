import { AppError } from "@ahadi/core";

/**
 * Speech-to-text for voice-note briefs (SPEC §16 POST /api/promises/voice). Whisper via the
 * OpenAI audio API or Deepgram, per STT_PROVIDER. Returns the transcript the Architect reads.
 */
export async function transcribe(audio: Buffer, mime: string, language?: "en" | "sw"): Promise<string> {
  const provider = process.env.STT_PROVIDER ?? "whisper";
  const key = process.env.STT_API_KEY;
  if (!key)
    throw new AppError(
      "CONFIG_MISSING",
      "Voice briefs need STT_API_KEY (Whisper or Deepgram). You can type the brief instead.",
    );
  if (audio.length > 24 * 1024 * 1024)
    throw new AppError("VALIDATION_FAILED", "Voice notes must be under 24 MB");
  if (provider === "deepgram") {
    const res = await fetch(
      `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true${language ? `&language=${language}` : "&detect_language=true"}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": mime || "audio/webm" },
        body: new Uint8Array(audio),
      },
    );
    const j = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
      err_msg?: string;
    };
    if (!res.ok) throw new AppError("INTERNAL", `Transcription failed: ${j.err_msg ?? res.status}`);
    return j.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: mime || "audio/webm" }),
    `brief.${(mime.split("/")[1] ?? "webm").split(";")[0]}`,
  );
  form.append("model", "whisper-1");
  if (language) form.append("language", language);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const j = (await res.json()) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw new AppError("INTERNAL", `Transcription failed: ${j.error?.message ?? res.status}`);
  return j.text?.trim() ?? "";
}
