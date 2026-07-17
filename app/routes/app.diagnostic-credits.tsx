import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getMetaobjectEntries } from "../lib/metaobject.server";
import { queryOrderStatsByCodeBatches } from "../lib/orders.server";
import { getShopConfig } from "../config.server";

// Date de lancement du programme (go-live réel) — modifiable via ?appDate=YYYY-MM-DD
const DEFAULT_APP_DATE = "2026-03-03";

/**
 * Page de diagnostic crédits — répond à « pourquoi ce pro a X€ de crédits ? ».
 * Recompte le CA réel depuis TOUT l'historique de commandes (l'app a read_all_orders),
 * le découpe avant/depuis la mise en ligne de l'app, et compare aux compteurs en cache.
 *
 * Usage (depuis l'admin Shopify, app ouverte) :
 *   /app/diagnostic-credits                          → tous les pros
 *   /app/diagnostic-credits?codes=AF_DEMNO,PRO_XX    → pros ciblés
 *   /app/diagnostic-credits?appDate=2026-01-15       → autre date de référence
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const codesParam = (url.searchParams.get("codes") || "").trim();
  const requestedCodes = codesParam
    ? new Set(codesParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean))
    : null;
  const appDate = (url.searchParams.get("appDate") || DEFAULT_APP_DATE).trim();

  const config = await getShopConfig(admin);
  const { entries } = await getMetaobjectEntries(admin);
  const pros = entries.filter((e: any) => e.code);
  const allCodes = [...new Set<string>(pros.map((e: any) => e.code.toUpperCase()))];

  // Deux passes batch (astuce OR avec TOUS les codes pour des résultats complets) :
  // totaux sur tout l'historique, puis uniquement depuis la mise en ligne
  const statsTotal = await queryOrderStatsByCodeBatches(admin, allCodes);
  const statsDepuisApp = await queryOrderStatsByCodeBatches(admin, allCodes, `created_at:>="${appDate}"`);

  const now = new Date();
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const prosFiltered = pros.filter((e: any) => !requestedCodes || requestedCodes.has(e.code.toUpperCase()));

  // Détection des codes en double (2 fiches metaobject sur le même code = compteurs incohérents)
  const codeCounts = new Map<string, number>();
  for (const e of pros) {
    const cu = e.code.toUpperCase();
    codeCounts.set(cu, (codeCounts.get(cu) || 0) + 1);
  }

  // Détection des crédits fantômes : pour chaque pro avec des crédits enregistrés,
  // on compare le compteur cache_credit_earned aux transactions store credit RÉELLES.
  // (une ancienne version du webhook enregistrait le crédit même si le virement échouait)
  const creditedCustomerIds: string[] = [
    ...new Set<string>(
      prosFiltered
        .filter((e: any) => parseFloat(e.cache_credit_earned || "0") > 0 && e.customer_id?.startsWith("gid://shopify/Customer/"))
        .map((e: any) => e.customer_id as string),
    ),
  ];

  const storeCreditMap = new Map<string, { solde: number; totalCredite: number; totalDebite: number; nbTransactions: number }>();
  const SC_CHUNK = 20; // transactions imbriquées → petits lots pour rester sous le coût max GraphQL
  for (let i = 0; i < creditedCustomerIds.length; i += SC_CHUNK) {
    const chunk = creditedCustomerIds.slice(i, i + SC_CHUNK);
    try {
      const r = await admin.graphql(`#graphql
        query getStoreCreditDetails($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Customer {
              id
              storeCreditAccounts(first: 3) {
                edges {
                  node {
                    id
                    balance { amount currencyCode }
                    transactions(first: 50) {
                      edges {
                        node {
                          __typename
                          createdAt
                          amount { amount currencyCode }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, { variables: { ids: chunk } });
      const d = (await r.json()) as any;
      for (const node of d.data?.nodes || []) {
        if (!node?.id) continue;
        let solde = 0;
        let totalCredite = 0;
        let totalDebite = 0;
        let nbTransactions = 0;
        for (const accEdge of node.storeCreditAccounts?.edges || []) {
          solde += parseFloat(accEdge.node?.balance?.amount || "0");
          for (const txEdge of accEdge.node?.transactions?.edges || []) {
            nbTransactions++;
            const amt = Math.abs(parseFloat(txEdge.node?.amount?.amount || "0"));
            if (txEdge.node?.__typename === "StoreCreditAccountCreditTransaction") totalCredite += amt;
            if (txEdge.node?.__typename === "StoreCreditAccountDebitTransaction") totalDebite += amt;
          }
        }
        storeCreditMap.set(node.id, { solde: round2(solde), totalCredite: round2(totalCredite), totalDebite: round2(totalDebite), nbTransactions });
      }
    } catch (scErr) {
      console.warn("[DIAGNOSTIC] Erreur lecture store credit (lot ignoré):", scErr);
    }
  }

  const results = prosFiltered
    .map((e: any) => {
      const codeUpper = e.code.toUpperCase();
      const total = statsTotal.get(codeUpper) ?? { revenue: 0, count: 0 };
      const depuis = statsDepuisApp.get(codeUpper) ?? { revenue: 0, count: 0 };
      const avant = {
        revenue: Math.max(0, total.revenue - depuis.revenue),
        count: Math.max(0, total.count - depuis.count),
      };

      const cacheRevenue = parseFloat(e.cache_revenue || "0");
      const cacheOrders = parseInt(e.cache_orders_count || "0", 10);
      const creditsVerses = parseFloat(e.cache_credit_earned || "0");
      const accumulateur = parseFloat(e.cache_ca_remainder || "0");

      const remType = e.remuneration_type || "illimite";
      const unlockDate = e.limitation_unlock_date || "";
      const isBlocked = remType === "limite_annee" && !!unlockDate && new Date(unlockDate) > now;

      // Base opérationnelle = CA en cache (aligné sur le Réglage Date par le recalcul global).
      // C'est la même base que la modale « Recalculer les crédits ».
      const creditsAttendusSurCache = round2(Math.floor(cacheRevenue / config.threshold) * config.creditAmount);
      const creditsAttendusToutHistorique = round2(Math.floor(total.revenue / config.threshold) * config.creditAmount);
      // CA réellement passé par les paliers (déduit des compteurs — valable si la config n'a pas changé)
      const caPasseParPaliers = round2((creditsVerses / config.creditAmount) * config.threshold + accumulateur);

      const sc = e.customer_id ? storeCreditMap.get(e.customer_id) : undefined;

      const verdicts: string[] = [];
      if ((codeCounts.get(codeUpper) || 0) > 1) {
        verdicts.push(`🚨 CODE EN DOUBLE : ${codeCounts.get(codeUpper)} fiches partagent ce code → supprimer le doublon via Contenu → Metaobjects (PAS via l'app, qui supprimerait aussi le code promo)`);
      }
      if (sc && creditsVerses - sc.totalCredite > 0.01) {
        verdicts.push(`👻 CRÉDITS FANTÔMES : ${round2(creditsVerses)}€ enregistrés mais seulement ${sc.totalCredite}€ réellement versés (écart ${round2(creditsVerses - sc.totalCredite)}€) → corriger Cache Credit Earned à ${sc.totalCredite} dans le metaobject`);
      }
      if (creditsVerses > 0 && e.customer_id && !sc) {
        verdicts.push(`👻 CRÉDITS FANTÔMES probables : ${round2(creditsVerses)}€ enregistrés mais aucun compte store credit lisible pour ce client`);
      }
      if (creditsVerses > 0 && !e.customer_id) {
        verdicts.push(`👻 ${round2(creditsVerses)}€ enregistrés mais AUCUN client lié — jamais versés`);
      }
      // Tolérance 5€ : les remboursements partiels sont déduits différemment entre le
      // recalcul individuel (REST, lignes remboursées) et ce diagnostic (GraphQL, montant
      // réellement remboursé) → micro-écarts d'arrondi normaux, sans impact sur les paliers
      if (Math.abs(cacheRevenue - depuis.revenue) > 5) {
        verdicts.push(`⚠ CA en cache (${round2(cacheRevenue)}€) ≠ CA depuis la mise en ligne (${round2(depuis.revenue)}€) → lancer « Recalculer le CA » (Réglage Date actif)`);
      }
      if (avant.revenue > 1) {
        verdicts.push(`ℹ ${round2(avant.revenue)}€ de CA (${avant.count} cmd) datent d'AVANT le ${appDate} — hors base de calcul des crédits (choix : seul le CA depuis le lancement compte)`);
      }
      if (isBlocked) {
        verdicts.push(`🔒 Réglementée BLOQUÉE jusqu'au ${unlockDate} — aucun crédit d'ici là, l'accumulateur (${round2(accumulateur)}€) continue de monter`);
      } else if (remType === "limite_annee") {
        verdicts.push(`Réglementée non bloquée : prochain franchissement de ${config.threshold}€ → bon unique de ${config.regulatedCreditAmount}€ puis blocage 1 an`);
      } else if (remType === "sans_remuneration") {
        verdicts.push(`Sans rémunération : aucun crédit ne sera jamais versé (CA compté pour les stats uniquement)`);
      } else {
        const manque = round2(creditsAttendusSurCache - creditsVerses);
        if (manque > 0.01) {
          verdicts.push(`Illimitée : ${creditsAttendusSurCache}€ attendus sur le CA en cache vs ${round2(creditsVerses)}€ versés → « Recalculer les crédits » déposera +${manque}€`);
        } else if (manque < -0.01) {
          verdicts.push(`Illimitée SUR-créditée de ${round2(-manque)}€ par rapport au CA en cache (versements sous une ancienne config/base — acquis, rien à faire)`);
        } else {
          verdicts.push(`Illimitée : crédits à jour ✓`);
        }
      }
      if (verdicts.length === 0) verdicts.push("RAS ✓");

      return {
        nom: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.name || "?",
        code: e.code,
        statut: remType,
        bloque: isBlocked,
        deblocage_le: unlockDate || null,
        cache: {
          ca: round2(cacheRevenue),
          commandes: cacheOrders,
          credits_verses: round2(creditsVerses),
          accumulateur: round2(accumulateur),
          prochain_palier_dans: round2(Math.max(0, config.threshold - accumulateur)),
        },
        reel: {
          ca_total: round2(total.revenue),
          commandes_total: total.count,
          ca_avant_app: round2(avant.revenue),
          commandes_avant_app: avant.count,
          ca_depuis_app: round2(depuis.revenue),
          commandes_depuis_app: depuis.count,
        },
        store_credit_reel: sc
          ? {
              solde: sc.solde,
              total_credite: sc.totalCredite,
              total_debite: sc.totalDebite,
              nb_transactions: sc.nbTransactions,
            }
          : null,
        analyse: {
          credits_attendus_sur_ca_cache: creditsAttendusSurCache,
          credits_attendus_si_tout_historique: creditsAttendusToutHistorique,
          ca_passe_par_les_paliers_estime: caPasseParPaliers,
          verdicts,
        },
      };
    })
    .sort((a: any, b: any) => b.reel.ca_total - a.reel.ca_total);

  // Liste compacte des dépôts à faire (illimitées uniquement) — la to-do de régularisation
  const listeDepots = results
    .filter((r: any) => r.statut === "illimite" && !r.bloque)
    .map((r: any) => ({
      code: r.code,
      nom: r.nom,
      a_deposer: round2(Math.max(0, r.analyse.credits_attendus_sur_ca_cache - r.cache.credits_verses)),
    }))
    .filter((d: any) => d.a_deposer > 0.01)
    .sort((a: any, b: any) => b.a_deposer - a.a_deposer);

  return {
    genere_le: now.toISOString(),
    date_mise_en_ligne_app: appDate,
    config: {
      seuil: config.threshold,
      montant_illimite: config.creditAmount,
      montant_reglemente_annuel: config.regulatedCreditAmount,
    },
    nb_pros: results.length,
    depots_a_faire: {
      nb: listeDepots.length,
      total: round2(listeDepots.reduce((s: number, d: any) => s + d.a_deposer, 0)),
      liste: listeDepots,
    },
    pros: results,
  };
};

export default function DiagnosticCredits() {
  const data = useLoaderData<typeof loader>();
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback : sélection manuelle du <pre>
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>🔎 Diagnostic crédits</h1>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "none",
            background: copied ? "#008060" : "#1a1a1a",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copied ? "Copié ✓" : "📋 Copier le JSON"}
        </button>
      </div>
      <p style={{ fontSize: "13px", color: "#666", margin: "0 0 16px" }}>
        {data.nb_pros} pro(s) analysé(s) · CA recompté sur tout l&apos;historique de commandes · découpage avant/depuis le {data.date_mise_en_ligne_app}.
        Paramètres : <code>?codes=CODE1,CODE2</code> pour cibler, <code>?appDate=YYYY-MM-DD</code> pour changer la date de référence.
      </p>
      <pre
        style={{
          background: "#f6f6f7",
          border: "1px solid #e1e3e5",
          borderRadius: "8px",
          padding: "16px",
          fontSize: "12px",
          lineHeight: 1.5,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {json}
      </pre>
    </div>
  );
}
