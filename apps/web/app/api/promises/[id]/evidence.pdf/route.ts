import { evidencePackPdf } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** SPEC §11.3 evidence pack. */
export const GET = withUser<{ id: string }>(async ({ actor, params }) => {
  const pdf = await evidencePackPdf(actor, params.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="ahadi-evidence-${params.id.slice(0, 8)}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
});
