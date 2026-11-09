import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { asc, eq, inArray } from "drizzle-orm";
import { bpsToPercent, formatMoney } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import {
  criteria,
  criterionResults,
  fundings,
  getDb,
  milestones,
  payouts,
  proposals,
  settlements,
  signatures,
  submissions,
  termsVersions,
  users,
  verifications,
} from "@ahadi/db";
import { getPromiseLedger } from "./queries";
import type { Actor } from "./actor";
import { buildStatement } from "./passport";

/** PDFs (SPEC §11.3 evidence pack, §15 statement). pdfkit keeps this dependency-light on the server. */

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

const BRAND = "#0b8a5a";
const MUTED = "#4b5d57";

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
  doc.fillColor(BRAND).fontSize(10).text("AHADI", 50, 30, { characterSpacing: 2 });
  doc.fillColor("#0f1f1a").fontSize(20).text(title, 50, 48);
  doc.fillColor(MUTED).fontSize(10).text(subtitle);
  doc.moveDown();
}

function h2(doc: PDFKit.PDFDocument, t: string) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6).fillColor(BRAND).fontSize(13).text(t).moveDown(0.3).fillColor("#0f1f1a").fontSize(10);
}

function kv(doc: PDFKit.PDFDocument, k: string, v: string) {
  doc.fontSize(9).fillColor(MUTED).text(`${k}: `, { continued: true }).fillColor("#0f1f1a").text(v);
}

export async function evidencePackPdf(actor: Actor, promiseId: string): Promise<Buffer> {
  const { promise, events, verification } = await getPromiseLedger(actor, promiseId);
  const db = getDb();
  const env = getEnv();
  const [terms] = promise.currentTermsVersionId
    ? await db.select().from(termsVersions).where(eq(termsVersions.id, promise.currentTermsVersionId))
    : [];
  const sigs = terms ? await db.select().from(signatures).where(eq(signatures.termsVersionId, terms.id)) : [];
  const people = await db
    .select({ id: users.id, n: users.displayName })
    .from(users)
    .where(inArray(users.id, [promise.clientUserId, promise.workerUserId].filter(Boolean) as string[]));
  const name = (id: string | null) => people.find((p) => p.id === id)?.n ?? "—";
  const ms = await db
    .select()
    .from(milestones)
    .where(eq(milestones.promiseId, promiseId))
    .orderBy(asc(milestones.position));
  const verifyUrl = `${env.APP_URL.replace(/\/$/, "")}/api/promises/${promiseId}/ledger/verify`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220 });

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: { Title: `Ahadi evidence pack — ${promise.title}`, Author: "Ahadi" },
  });
  header(doc, "Evidence pack", `${promise.title} · generated ${new Date().toUTCString()}`);
  kv(doc, "Promise", promise.id);
  kv(doc, "Client", name(promise.clientUserId));
  kv(doc, "Worker", name(promise.workerUserId));
  kv(doc, "State", promise.state);
  kv(doc, "Category", promise.category);
  kv(
    doc,
    "Total",
    formatMoney(
      ms.reduce((s, m) => s + m.amountMinor, 0),
      promise.currency,
    ),
  );

  h2(doc, "Signed terms");
  if (terms) {
    kv(doc, "Version", String(terms.version));
    kv(doc, "Terms hash (SHA-256)", terms.bodyHash);
    for (const s of sigs)
      kv(
        doc,
        `Signed by ${s.party}`,
        `${s.signedAt.toISOString()} — hash ${s.bodyHash === terms.bodyHash ? "matches" : "MISMATCH"}`,
      );
    doc.moveDown(0.3).fontSize(9).fillColor(MUTED).text(terms.body.scopeSummary);
  }

  for (const m of ms) {
    h2(
      doc,
      `Milestone ${m.position}: ${m.title} — ${formatMoney(m.amountMinor, promise.currency)} (${m.state})`,
    );
    const crit = await db
      .select()
      .from(criteria)
      .where(eq(criteria.milestoneId, m.id))
      .orderBy(asc(criteria.key));
    const [f] = await db
      .select()
      .from(fundings)
      .where(eq(fundings.milestoneId, m.id))
      .orderBy(asc(fundings.attempt));
    if (f) {
      kv(doc, "PayPal order", f.paypalOrderId);
      kv(doc, "PayPal authorization", f.paypalAuthorizationId ?? "—");
    }
    const subs = await db
      .select()
      .from(submissions)
      .where(eq(submissions.milestoneId, m.id))
      .orderBy(asc(submissions.attempt));
    for (const s of subs) {
      doc
        .moveDown(0.3)
        .fontSize(10)
        .fillColor("#0f1f1a")
        .text(
          `Attempt ${s.attempt} — ${s.kind}: ${s.url ?? s.repoUrl ?? "text/files"}${s.commitSha ? ` @ ${s.commitSha}` : ""} (${s.createdAt.toISOString()})`,
        );
      const vs = await db.select().from(verifications).where(eq(verifications.submissionId, s.id));
      for (const v of vs) {
        const rs = await db.select().from(criterionResults).where(eq(criterionResults.verificationId, v.id));
        doc
          .fontSize(9)
          .fillColor(MUTED)
          .text(`Verification ${v.id} — ${v.status}${v.injectionFlagged ? " — INJECTION FLAGGED" : ""}`);
        for (const c of crit) {
          const r = rs.find((x) => x.criterionId === c.id);
          if (!r) continue;
          doc
            .fontSize(9)
            .fillColor("#0f1f1a")
            .text(
              `• ${c.key} ${c.spec.title} (weight ${c.weight}${c.required ? ", required" : ""}): ${r.outcome.toUpperCase()}${r.outcome === "partial" ? ` ${Math.round(r.credit * 100)}%` : ""} · ${r.decidedBy} · confidence ${Math.round(r.confidence * 100)}%`,
            );
          doc.fontSize(8).fillColor(MUTED).text(`   ${r.reasoning}`, { indent: 10 });
          if (r.evidenceArtifactIds.length)
            doc
              .fontSize(7)
              .fillColor(MUTED)
              .text(`   evidence: ${r.evidenceArtifactIds.join(", ")}`, { indent: 10 });
        }
        const ps = await db.select().from(proposals).where(eq(proposals.verificationId, v.id));
        for (const p of ps) {
          kv(
            doc,
            "Proposal",
            `${bpsToPercent(p.releaseBps)} = ${formatMoney(p.captureMinor, promise.currency)} (client ${p.clientDecision ?? "—"}, worker ${p.workerDecision ?? "—"})${p.supersededAt ? " [superseded]" : ""}`,
          );
          const [st] = await db.select().from(settlements).where(eq(settlements.proposalId, p.id));
          if (st) {
            kv(
              doc,
              "Settlement",
              `${st.status} · capture ${st.paypalCaptureId ?? "—"} · captured ${formatMoney(st.capturedMinor ?? 0, promise.currency)} · PayPal fee ${formatMoney(st.paypalFeeMinor ?? 0, promise.currency)}`,
            );
            const po = await db.select().from(payouts).where(eq(payouts.settlementId, st.id));
            for (const x of po)
              kv(
                doc,
                "Payout",
                `${x.status} · ${formatMoney(x.amountMinor, x.currency)} · batch ${x.paypalPayoutBatchId ?? "—"} · item ${x.paypalPayoutItemId ?? "—"}`,
              );
          }
        }
      }
    }
  }

  h2(
    doc,
    `Ledger (${events.length} events) — chain ${verification.valid ? "INTACT" : `BROKEN at #${(verification as { brokenAt?: number }).brokenAt}`}`,
  );
  for (const e of events) {
    if (doc.y > doc.page.height - 70) doc.addPage();
    doc
      .fontSize(8)
      .fillColor("#0f1f1a")
      .text(`#${e.seq} ${e.createdAt.toISOString()} ${e.type} (${e.actor})`);
    doc
      .fontSize(7)
      .fillColor(MUTED)
      .text(`   hash ${e.hash}  prev ${e.prevHash.slice(0, 16)}…`);
  }
  if (doc.y > doc.page.height - 260) doc.addPage();
  doc.moveDown().fontSize(9).fillColor("#0f1f1a").text("Verify this ledger independently:");
  doc.fontSize(8).fillColor(MUTED).text(verifyUrl);
  doc.image(qr, { width: 120 });
  return collect(doc);
}

export async function statementPdf(userId: string): Promise<Buffer> {
  const { doc: data, signature, kid, publicKey } = await buildStatement(userId);
  const env = getEnv();
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: { Title: `Ahadi source-of-funds statement — ${data.subject.name}`, Author: "Ahadi" },
  });
  header(doc, "Source-of-funds statement", `Issued ${data.issuedAt} · ${data.items.length} verified payouts`);
  kv(doc, "Earner", data.subject.name);
  kv(doc, "Payout account", data.subject.email);
  if (data.subject.country) kv(doc, "Country", data.subject.country);
  kv(doc, "Total paid", formatMoney(data.totalMinor));
  doc
    .moveDown()
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      "Each payment below was released through PayPal only after the work was verified against acceptance criteria both parties signed. Every entry links to a verification record and a tamper-evident ledger.",
    );
  h2(doc, "Payments");
  for (const i of data.items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc
      .fontSize(10)
      .fillColor("#0f1f1a")
      .text(`${i.date} — ${formatMoney(i.amountMinor, i.currency)} from ${i.payer}`);
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${i.promise} / ${i.milestone} · ${i.releasePct}% released · verification ${i.verificationId} · PayPal item ${i.paypalPayoutItemId ?? "—"}`,
      );
    doc.fontSize(7).text(`ledger head ${i.ledgerHead ?? "—"}`);
    doc.moveDown(0.3);
  }
  h2(doc, "Signature");
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Ed25519 signature (key ${kid}) over the canonical JSON of this statement:`);
  doc.fontSize(7).fillColor("#0f1f1a").text(signature);
  doc
    .moveDown(0.3)
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Public key: ${env.APP_URL.replace(/\/$/, "")}/.well-known/ahadi-signing-key`);
  doc.fontSize(7).text(publicKey.pem);
  return collect(doc);
}
