import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { depositStoreCredit } from "../lib/customer.server";
import { updateMetaobjectFields } from "../lib/metaobject.server";
import { getShopConfig } from "../config.server";

// Verrou anti-double-clic : un seul recalcul de crédits à la fois par pro.
// (process unique sur Render — suffisant pour bloquer les clics simultanés)
const inFlight = new Set<string>();

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Dépôt des crédits manquants d'un pro — IDEMPOTENT.
 *
 * Le serveur relit l'état FRAIS du metaobject et recalcule lui-même l'écart dû
 * (attendus = ⌊CA/seuil⌋ × montant − déjà versés). Les montants ne viennent JAMAIS
 * du client : un double-clic ou une modale périmée dépose 0€ la deuxième fois.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const metaobjectId = formData.get("metaobjectId") as string;

  if (!metaobjectId) {
    return json({ error: "metaobjectId requis" }, 400);
  }

  if (inFlight.has(metaobjectId)) {
    return json({ error: "Un dépôt est déjà en cours pour ce pro — patientez quelques secondes." });
  }
  inFlight.add(metaobjectId);

  try {
    // 1. État FRAIS du metaobject (source de vérité)
    const r = await admin.graphql(
      `query($id: ID!) { metaobject(id: $id) { fields { key value } } }`,
      { variables: { id: metaobjectId } },
    );
    const d = (await r.json()) as any;
    if (!d.data?.metaobject) {
      return json({ error: "Pro introuvable" }, 404);
    }
    const fields: Record<string, string> = {};
    for (const f of d.data.metaobject.fields || []) fields[f.key] = f.value || "";

    // 2. Garde-fou serveur : réservé aux illimités (plafond réglementaire sinon)
    const remType = fields.remuneration_type || "illimite";
    if (remType !== "illimite") {
      return json({ error: "Recalcul par paliers réservé aux pros illimités (loi anti-cadeaux)" });
    }

    const config = await getShopConfig(admin);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const ca = parseFloat(fields.cache_revenue || "0");
    const earned = parseFloat(fields.cache_credit_earned || "0");
    const remainder = parseFloat(fields.cache_ca_remainder || "0");
    const customerId = fields.customer_id || null;

    const crossings = Math.floor(ca / config.threshold);
    const expectedEarned = round2(crossings * config.creditAmount);
    const expectedRemainder = round2(ca - crossings * config.threshold);
    const toDeposit = round2(Math.max(0, expectedEarned - earned));
    const remainderNeedsFix = Math.abs(remainder - expectedRemainder) > 0.01;

    // 3. Rien à faire ? (2e clic d'un double-clic → on sort ici, 0€ déposé)
    if (toDeposit <= 0 && !remainderNeedsFix) {
      return json({ success: true, creditsDeposited: 0, nothingToDo: true });
    }

    // 4. Sur-créditée (versés > attendus) : les crédits versés sont acquis —
    //    on ne corrige que l'accumulateur, jamais le compteur à la baisse
    if (expectedEarned < earned - 0.01) {
      if (remainderNeedsFix) {
        const upd = await updateMetaobjectFields(admin, metaobjectId, [
          { key: "cache_ca_remainder", value: String(expectedRemainder) },
        ]);
        if (!upd.success) return json({ error: `Erreur mise à jour accumulateur: ${upd.error}` });
      }
      return json({ success: true, creditsDeposited: 0, overCredited: true });
    }

    // 5. Dépôt réel (uniquement si client lié)
    let deposited = 0;
    if (toDeposit > 0) {
      if (!customerId) {
        // Pas de client à créditer : on corrige l'accumulateur, le compteur reste
        // (même règle que le webhook — aucun crédit enregistré sans virement)
        if (remainderNeedsFix) {
          const upd = await updateMetaobjectFields(admin, metaobjectId, [
            { key: "cache_ca_remainder", value: String(expectedRemainder) },
          ]);
          if (!upd.success) return json({ error: `Erreur mise à jour accumulateur: ${upd.error}` });
        }
        return json({ success: true, creditsDeposited: 0, noCustomer: true });
      }

      const dep = await depositStoreCredit(admin, customerId, toDeposit);
      if (!dep.success) {
        return json({ error: `Erreur dépôt store credit: ${dep.error || "inconnue"}` });
      }
      deposited = toDeposit;
    }

    // 6. Avancer les compteurs (uniquement de ce qui a réellement été versé)
    const upd = await updateMetaobjectFields(admin, metaobjectId, [
      ...(deposited > 0 ? [{ key: "cache_credit_earned", value: String(round2(earned + deposited)) }] : []),
      { key: "cache_ca_remainder", value: String(expectedRemainder) },
    ]);
    if (!upd.success) {
      // Cas critique : l'argent est parti mais le compteur n'a pas suivi.
      // NE PAS re-cliquer (le dépôt serait compté comme encore dû) → corriger le MO à la main.
      console.error(`[recalculate-credits] ⚠ DÉPÔT EFFECTUÉ (${deposited}€) mais échec mise à jour compteur pour ${metaobjectId}:`, upd.error);
      return json({
        error: `Dépôt de ${deposited}€ EFFECTUÉ mais échec de mise à jour du compteur (${upd.error}). NE PAS re-cliquer — corriger cache_credit_earned à ${round2(earned + deposited)} dans le metaobject.`,
      });
    }

    return json({ success: true, creditsDeposited: deposited });
  } finally {
    inFlight.delete(metaobjectId);
  }
};
