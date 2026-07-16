import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { unauthenticated } from "../shopify.server";
import { getShopConfig } from "../config.server";
import { updateCustomerProMetafields, depositStoreCredit } from "../lib/customer.server";
import { updateMetaobjectFields } from "../lib/metaobject.server";
import { computeCreditsForOrder } from "../lib/credits";

// Loader pour gérer les requêtes GET (tests de connectivité)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const loader = async (_args: LoaderFunctionArgs) => {
  console.log(`ℹ️ Requête GET reçue sur le webhook orders/create. Ceci est normal pour un test de connectivité.`);
  return new Response(JSON.stringify({
    message: "Webhook orders/create endpoint",
    method: "Use POST to trigger webhook",
    registered: true
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

/**
 * Traite un code promo d'une commande (Scenario EARN) :
 * retrouve le pro, applique la logique de paliers selon son type de rémunération,
 * dépose le store credit si un palier est franchi, puis met à jour le cache du metaobject.
 * IMPORTANT: cache_credit_earned et cache_ca_remainder n'avancent QUE si le virement réussit —
 * en cas d'échec, le remainder reste inchangé pour que le prochain webhook puisse réessayer.
 */
async function processEarnForCode(
  adminContext: any,
  config: { threshold: number; creditAmount: number; regulatedCreditAmount: number },
  order: any,
  usedCode: string,
  orderAmount: number,
) {
  let metaobjectNode: any = null;
  let customerIdValue: string | null = null;
  const usedCodeLower = usedCode.toLowerCase().trim();

  // 1. RECHERCHE RAPIDE (Indexée)
  console.log(`🔍 Recherche indexée pour le code: ${usedCodeLower}`);
  const querySearchMetaobject = `#graphql
    query searchPro($query: String!) {
      metaobjects(first: 10, type: "mm_pro_de_sante", query: $query) {
        edges {
          node {
            id
            fields { key value }
          }
        }
      }
    }
  `;

  const response = await adminContext.graphql(querySearchMetaobject, {
    variables: { query: usedCodeLower }
  });
  const data = await response.json() as any;
  const foundMetaobjects = data.data?.metaobjects?.edges || [];

  for (const edge of foundMetaobjects) {
    const codeField = edge.node.fields.find((f: any) => f.key === "code");
    if (codeField?.value?.toLowerCase() === usedCodeLower) {
      metaobjectNode = edge.node;
      break;
    }
  }

  // 2. RECHERCHE EXHAUSTIVE (Pagination si le Pro n'est pas trouvé via index)
  if (!metaobjectNode) {
    let hasNextPage = true;
    let cursor: string | null = null;
    let totalChecked = 0;

    while (hasNextPage && !metaobjectNode && totalChecked < 5000) { // Couverture jusqu'à 5 000 pros
      const listQuery = `#graphql
        query listAll($cursor: String) {
          metaobjects(first: 250, type: "mm_pro_de_sante", after: $cursor) {
            edges {
              node { h: id fields { k: key v: value } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      const rList = await adminContext.graphql(listQuery, { variables: { cursor } });
      const dList = await rList.json() as any;
      const edges = dList.data?.metaobjects?.edges || [];

      for (const edge of edges) {
        totalChecked++;
        const node = edge.node;
        const codeF = node.fields.find((f: any) => f.k === "code");
        if (codeF?.v?.toLowerCase() === usedCodeLower) {
          // Reformattage pour correspondre à la structure attendue
          metaobjectNode = {
            id: node.h,
            fields: node.fields.map((f: any) => ({ key: f.k, value: f.v }))
          };
          break;
        }
      }
      hasNextPage = dList.data?.metaobjects?.pageInfo?.hasNextPage || false;
      cursor = dList.data?.metaobjects?.pageInfo?.endCursor || null;
    }
  }

  if (!metaobjectNode) {
    console.log(`[AUDIT][WEBHOOK][NO_MATCH] ${new Date().toISOString()} | order=${order.id} | code=${usedCodeLower} | aucun pro trouvé`);
    return;
  }

  const customerIdField = metaobjectNode.fields.find((f: any) => f.key === "customer_id");
  customerIdValue = customerIdField?.value || null;
  const nameField = metaobjectNode.fields.find((f: { key: string; value: string }) => f.key === "first_name");
  const lastNameField = metaobjectNode.fields.find((f: { key: string; value: string }) => f.key === "last_name");
  console.log(`[AUDIT][WEBHOOK][MATCH] ${new Date().toISOString()} | order=${order.id} | code=${usedCodeLower} | pro_id=${metaobjectNode.id} | pro="${nameField?.value || ""} ${lastNameField?.value || ""}" | montant=${orderAmount}€`);

  // 3. Récupération des compteurs actuels
  let currentRevenue = 0;
  let previousCreditEarned = 0;
  let currentCount = 0;
  let currentRemainder = 0;
  let remunerationType = "illimite";
  let limitationUnlockDate = "";

  metaobjectNode.fields.forEach((f: any) => {
    if (f.key === "cache_revenue" && f.value) currentRevenue = parseFloat(f.value);
    if (f.key === "cache_credit_earned" && f.value) previousCreditEarned = parseFloat(f.value);
    if (f.key === "cache_orders_count" && f.value) currentCount = parseInt(f.value);
    if (f.key === "cache_ca_remainder" && f.value) currentRemainder = parseFloat(f.value);
    if (f.key === "remuneration_type" && f.value) remunerationType = f.value;
    if (f.key === "limitation_unlock_date" && f.value) limitationUnlockDate = f.value;
  });

  // 4. Logique incrémentale par paliers selon le type de rémunération (logique pure testée)
  const newRevenue = currentRevenue + orderAmount;
  const newCount = currentCount + 1;

  const computation = computeCreditsForOrder({
    remunerationType,
    limitationUnlockDate,
    currentRemainder,
    orderAmount,
    threshold: config.threshold,
    creditAmount: config.creditAmount,
    regulatedCreditAmount: config.regulatedCreditAmount,
  });

  // 5. Virement du crédit (si palier franchi)
  let actualCreditsDeposited = 0;
  let finalRemainder = computation.remainderIfNotDeposited; // par défaut : pas d'avancement de palier

  if (computation.creditsToAdd > 0 && customerIdValue) {
    const deposit = await depositStoreCredit(adminContext, customerIdValue, computation.creditsToAdd);
    if (deposit.success) {
      // Virement réussi : on avance le remainder et on enregistre le crédit versé
      actualCreditsDeposited = computation.creditsToAdd;
      finalRemainder = computation.remainderIfDeposited;
    } else {
      console.error(`[webhook] Virement store credit échoué — compteurs inchangés:`, deposit.error);
    }
  } else if (computation.creditsToAdd > 0 && !customerIdValue) {
    // Pas de client lié — on avance quand même le remainder (le pro n'a pas de compte à créditer)
    finalRemainder = computation.remainderIfDeposited;
  }

  const newCreditEarned = previousCreditEarned + actualCreditsDeposited;

  // 6. Mettre à jour le cache dans le metaobject
  const updateResult = await updateMetaobjectFields(adminContext, metaobjectNode.id, [
    { key: "cache_revenue", value: String(newRevenue) },
    { key: "cache_orders_count", value: String(newCount) },
    { key: "cache_credit_earned", value: String(newCreditEarned) },
    { key: "cache_ca_remainder", value: String(finalRemainder) },
    ...(actualCreditsDeposited > 0 && computation.newLimitationDate
      ? [
          { key: "limitation_date", value: computation.newLimitationDate },
          { key: "limitation_unlock_date", value: computation.newLimitationUnlockDate! },
        ]
      : []),
  ]);

  if (!updateResult.success) {
    console.error("[webhook] Erreur mise à jour metaobject:", updateResult.error);
    return;
  }

  // Mise à jour du metafield ca_genere sur la fiche client
  if (customerIdValue) {
    try {
      await updateCustomerProMetafields(adminContext, customerIdValue, { ca_genere: newRevenue });
    } catch (mfError) {
      console.warn("[webhook] Echec mise à jour ca_genere (non bloquant):", mfError);
    }
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";

  // 1. Lire le body brut AVANT tout traitement (crucial pour le HMAC)
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";

  // 2. Validation HMAC manuelle (comparaison à temps constant pour éviter les timing attacks)
  const secret = process.env.SHOPIFY_API_SECRET?.trim() || "";
  const computedHmac = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const trusted = Buffer.from(computedHmac);
    const received = Buffer.from(hmacHeader);
    if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
      return new Response("OK", { status: 200 });
    }
  } catch {
    return new Response("OK", { status: 200 });
  }

  // 3. Parser le payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`❌ Body n'est pas du JSON valide !`);
    return new Response("Invalid JSON", { status: 200 });
  }

  // 4. Répondre immédiatement et traiter en tâche de fond :
  // Shopify exige une réponse en < 5s, sinon il re-livre le webhook (risque de
  // double comptage). La recherche exhaustive (jusqu'à 5 000 metaobjects par code
  // inconnu) peut dépasser ce délai sur une grosse base de pros.
  processOrderWebhook(shop, payload).catch((e) => {
    console.error("[webhook] Erreur traitement asynchrone orders/create:", e);
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

/** Traitement complet du webhook orders/create, exécuté après la réponse HTTP. */
async function processOrderWebhook(shop: string, payload: any) {
  // Récupérer un admin context via session stockée
  let adminContext: any;
  try {
    const { admin } = await unauthenticated.admin(shop);
    adminContext = admin;
  } catch (unauthError) {
    console.error(`[webhook] Pas de session admin pour ${shop}:`, unauthError);
    return;
  }

  // IMPORTANT: Récupérer la config depuis les shop metafields
  const config = await getShopConfig(adminContext);

  const order = payload as any;

  // Collecter TOUS les codes promo de la commande — une commande peut combiner
  // plusieurs réductions, et chaque pro correspondant doit être crédité
  // (même logique que les recalculs batch)
  const discountCodes = order.discount_codes || [];
  const discountApplications = order.discount_applications || [];
  const usedCodes: string[] = [];

  // Méthode 1: depuis discount_codes (format simple)
  for (const dc of discountCodes) {
    if (dc?.code) usedCodes.push(String(dc.code));
  }

  // Méthode 2: résoudre chaque code depuis discount_applications via GraphQL
  if (usedCodes.length === 0 && discountApplications.length > 0) {
    const discountQuery = `#graphql
      query getDiscountCode($id: ID!) {
        codeDiscountNode(id: $id) {
          codeDiscount {
            ... on DiscountCodeBasic {
              codes(first: 1) { edges { node { code } } }
            }
            ... on DiscountCodeBxgy {
              codes(first: 1) { edges { node { code } } }
            }
            ... on DiscountCodeFreeShipping {
              codes(first: 1) { edges { node { code } } }
            }
          }
        }
      }
    `;

    for (const discountApp of discountApplications) {
      // Fallback par défaut ; écrasé uniquement si la résolution GraphQL réussit
      let resolvedCode: string | null = discountApp.code || discountApp.title || null;

      if (discountApp.discount_id) {
        try {
          const discountResponse = await adminContext.graphql(discountQuery, {
            variables: { id: discountApp.discount_id }
          });
          const discountData = await discountResponse.json() as any;
          const gqlCode = discountData.data?.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code;
          if (gqlCode) resolvedCode = gqlCode;
        } catch (error) {
          console.error(`[webhook] Erreur récupération code discount:`, error);
        }
      }

      if (resolvedCode) usedCodes.push(String(resolvedCode));
    }
  }

  const uniqueCodes = [...new Set(usedCodes.map((c) => c.trim()).filter(Boolean))];

  // On ne s'intéresse qu'aux commandes qui rapportent de l'argent (Scenario EARN)
  // Le Scenario BURN est géré automatiquement par Shopify (Checkout) !
  if (uniqueCodes.length > 0) {

    // CA = sous-total APRÈS réduction, SANS frais de livraison ni taxes
    let orderAmount = 0;

    if (order.subtotal_price_set?.shop_money?.amount) {
      orderAmount = parseFloat(String(order.subtotal_price_set.shop_money.amount));
    } else if (order.subtotal_price) {
      orderAmount = parseFloat(String(order.subtotal_price));
    } else if (order.total_price_set?.shop_money?.amount) {
      const total = parseFloat(String(order.total_price_set.shop_money.amount));
      const shipping = parseFloat(order.total_shipping_price_set?.shop_money?.amount || order.total_shipping_price || "0");
      const tax = parseFloat(order.total_tax_set?.shop_money?.amount || order.total_tax || "0");
      orderAmount = total - shipping - tax;
    }

    if (orderAmount === 0) {
      console.error(`[webhook] Impossible d'extraire le sous-total pour la commande ${order.id}`);
    }

    // Traiter chaque code de la commande — une erreur sur un code
    // ne doit pas empêcher le traitement des autres codes
    for (const usedCode of uniqueCodes) {
      try {
        await processEarnForCode(adminContext, config, order, usedCode, orderAmount);
      } catch (e) {
        console.error(`[webhook] Erreur traitement code ${usedCode}:`, e);
      }
    }
  }
}
