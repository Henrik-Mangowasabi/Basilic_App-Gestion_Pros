import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries, updateMetaobjectFields } from "../lib/metaobject.server";
import { getShopConfig } from "../config.server";

const CONCURRENCY = 10;

/**
 * Recalibre les accumulateurs de palier (cache_ca_remainder = CA % seuil) en masse.
 *
 * GARDE-FOU STRICT : ne touche un pro QUE si ses crédits sont déjà exactement à jour
 * (cache_credit_earned = paliers dus × montant). Impossible d'effacer un palier
 * en attente de versement. Les réglementées (limite_annee / sans_remuneration)
 * et les cas non soldés sont ignorés et comptés à part.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const config = await getShopConfig(admin);
  const { entries } = await getMetaobjectEntries(admin);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let updated = 0;
  let alreadyOk = 0;
  let skippedCreditsPending = 0;
  let skippedNonIllimite = 0;
  const errors: string[] = [];

  type Fix = { id: string; nom: string; newRemainder: number };
  const fixes: Fix[] = [];

  for (const e of entries as any[]) {
    if (!e.code) continue;
    const remType = e.remuneration_type || "illimite";
    if (remType !== "illimite") {
      skippedNonIllimite++;
      continue;
    }

    const ca = parseFloat(e.cache_revenue || "0");
    const earned = parseFloat(e.cache_credit_earned || "0");
    const remainder = parseFloat(e.cache_ca_remainder || "0");

    const crossings = Math.floor(ca / config.threshold);
    const expectedEarned = round2(crossings * config.creditAmount);
    const expectedRemainder = round2(ca - crossings * config.threshold);

    if (Math.abs(earned - expectedEarned) > 0.01) {
      // Crédits pas à jour (dépôt en attente ou sur-crédité) → on ne touche pas,
      // la modale « Recalculer les crédits » gère ces cas individuellement
      skippedCreditsPending++;
      continue;
    }
    if (Math.abs(remainder - expectedRemainder) <= 0.01) {
      alreadyOk++;
      continue;
    }

    fixes.push({
      id: e.id,
      nom: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.code,
      newRemainder: expectedRemainder,
    });
  }

  for (let i = 0; i < fixes.length; i += CONCURRENCY) {
    const chunk = fixes.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (fix) => {
      const result = await updateMetaobjectFields(admin, fix.id, [
        { key: "cache_ca_remainder", value: String(fix.newRemainder) },
      ]);
      if (result.success) {
        updated++;
      } else {
        errors.push(`${fix.nom}: ${result.error}`);
      }
    }));
  }

  return new Response(JSON.stringify({
    success: true,
    updated,
    alreadyOk,
    skippedCreditsPending,
    skippedNonIllimite,
    errors,
  }), { headers: { "Content-Type": "application/json" } });
};
