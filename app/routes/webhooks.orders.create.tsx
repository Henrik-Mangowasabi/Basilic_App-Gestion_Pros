import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { unauthenticated } from "../shopify.server";
import { getShopConfig } from "../config.server";
import { updateCustomerProMetafields } from "../lib/customer.server";

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

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";

  // 1. Lire le body brut AVANT tout traitement (crucial pour le HMAC)
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const topic = request.headers.get("X-Shopify-Topic") || "";

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

  // 4. Récupérer un admin context via session stockée
  let adminContext: any;
  try {
    const { admin } = await unauthenticated.admin(shop);
    adminContext = admin;
  } catch (unauthError) {
    console.error(`[webhook] Pas de session admin pour ${shop}:`, unauthError);
    return new Response(JSON.stringify({ error: "No admin session" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

    // IMPORTANT: Récupérer la config depuis les shop metafields
    const config = await getShopConfig(adminContext);

  const order = payload as any;
  const shopCurrency: string = order.total_price_set?.shop_money?.currency_code || "EUR";

  // Essayer différentes façons d'extraire les codes promo
  const discountCodes = order.discount_codes || [];
  const discountApplications = order.discount_applications || [];
  
  // Récupérer le code promo original depuis l'ID du discount
  let usedCode: string | null = null;
  
  // Méthode 1: Essayer depuis discount_codes (format simple)
  if (discountCodes.length > 0 && discountCodes[0].code) {
    usedCode = discountCodes[0].code;
  }
  // Méthode 2: Récupérer depuis discount_applications via GraphQL
  else if (discountApplications.length > 0) {
    const discountApp = discountApplications[0];
    const discountId = discountApp.discount_id || discountApp.code || null;

    if (discountId) {
      try {
        // Récupérer le code original depuis l'ID du discount
        const discountQuery = `#graphql
          query getDiscountCode($id: ID!) {
            codeDiscountNode(id: $id) {
              codeDiscount {
                ... on DiscountCodeBasic {
                  codes(first: 1) {
                    edges {
                      node {
                        code
                      }
                    }
                  }
                }
                ... on DiscountCodeBxgy {
                  codes(first: 1) {
                    edges {
                      node {
                        code
                      }
                    }
                  }
                }
                ... on DiscountCodeFreeShipping {
                  codes(first: 1) {
                    edges {
                      node {
                        code
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        
        const discountResponse = await adminContext.graphql(discountQuery, { 
          variables: { id: discountId } 
        });
        const discountData = await discountResponse.json() as any;
        
        if (discountData.data?.codeDiscountNode?.codeDiscount?.codes?.edges?.[0]?.node?.code) {
          usedCode = discountData.data.codeDiscountNode.codeDiscount.codes.edges[0].node.code;
        } else {
          usedCode = discountApp.code || discountApp.title || null;
        }
      } catch (error) {
        console.error(`[webhook] Erreur récupération code discount:`, error);
        usedCode = discountApp.code || discountApp.title || null;
      }
    } else {
      usedCode = discountApp.code || discountApp.title || null;
    }
  }

  // On ne s'intéresse qu'aux commandes qui rapportent de l'argent (Scenario EARN)
  // Le Scenario BURN est géré automatiquement par Shopify (Checkout) !
  if (usedCode) {
    
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

      // 0. Initialisation des variables
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

      try {
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

          while (hasNextPage && !metaobjectNode && totalChecked < 1000) { // On limite à 1000 par sécurité
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
                // Pro trouvé via recherche exhaustive
                break;
              }
            }
            hasNextPage = dList.data?.metaobjects?.pageInfo?.hasNextPage || false;
            cursor = dList.data?.metaobjects?.pageInfo?.endCursor || null;
          }
        }

        if (metaobjectNode) {
          const customerIdField = metaobjectNode.fields.find((f: any) => f.key === "customer_id");
          customerIdValue = customerIdField?.value || null;
        }

        if (!metaobjectNode) {
          return new Response("OK", { status: 200 });
        }

      // 1. Récupération des compteurs actuels
      let currentRevenue = 0;
      let previousCreditEarned = 0;
      let currentCount = 0;
      let currentRemainder = 0;

      metaobjectNode.fields.forEach((f: any) => {
        if (f.key === "cache_revenue" && f.value) currentRevenue = parseFloat(f.value);
        if (f.key === "cache_credit_earned" && f.value) previousCreditEarned = parseFloat(f.value);
        if (f.key === "cache_orders_count" && f.value) currentCount = parseInt(f.value);
        if (f.key === "cache_ca_remainder" && f.value) currentRemainder = parseFloat(f.value);
      });

      // 2. Logique incrémentale par paliers
      const newRevenue = currentRevenue + orderAmount;
      const newCount = currentCount + 1;

      // Calculer les paliers potentiels
      let potentialRemainder = currentRemainder + orderAmount;
      let creditsToAdd = 0;
      while (potentialRemainder >= config.threshold) {
        creditsToAdd += config.creditAmount;
        potentialRemainder -= config.threshold;
      }

      // 3. Virement du crédit (si palier franchi)
      // IMPORTANT: on ne met à jour cache_credit_earned et remainder QUE si le virement réussit.
      // Si le virement échoue, le remainder reste inchangé pour que le prochain webhook puisse réessayer.
      let actualCreditsDeposited = 0;
      let finalRemainder = currentRemainder + orderAmount; // par défaut : pas d'avancement de palier

      if (creditsToAdd > 0 && customerIdValue) {
        try {
          const queryAccount = `#graphql
            query getStoreCredit($id: ID!) {
              customer(id: $id) {
                storeCreditAccounts(first: 1) {
                  edges { node { id } }
                }
              }
            }
          `;
          const rAccount = await adminContext.graphql(queryAccount, { variables: { id: customerIdValue } });
          const dAccount = await rAccount.json() as any;

          if (dAccount.errors) {
            const permErr = dAccount.errors.find((e: any) => e.message?.includes("storeCreditAccounts") || e.message?.includes("Access denied"));
            if (!permErr) throw new Error(dAccount.errors.map((e: any) => e.message).join(", "));
            console.error(`[webhook] Permissions Store Credit manquantes — réinstallez l'app avec les bons scopes.`);
          } else {
            const accountId = dAccount.data?.customer?.storeCreditAccounts?.edges?.[0]?.node?.id;
            // Si pas de compte trouvé, on tente avec le customer ID directement (crée le compte automatiquement)
            const creditTargetId = accountId || customerIdValue;
            if (creditTargetId) {
              const mutationCredit = `#graphql
                mutation creditStore($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
                  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
                    storeCreditAccountTransaction { amount { amount currencyCode } }
                    userErrors { field message }
                  }
                }
              `;
              const rCredit = await adminContext.graphql(mutationCredit, {
                variables: { id: creditTargetId, creditInput: { creditAmount: { amount: String(creditsToAdd), currencyCode: shopCurrency } } }
              });
              const dCredit = await rCredit.json() as any;
              if (dCredit.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
                console.error("[webhook] Erreur virement store credit:", dCredit.data.storeCreditAccountCredit.userErrors);
              } else {
                // Virement réussi : on avance le remainder et on enregistre le crédit versé
                actualCreditsDeposited = creditsToAdd;
                finalRemainder = potentialRemainder;
              }
            }
          }
        } catch (creditError: any) {
          console.error(`[webhook] Erreur store credit:`, creditError?.message || creditError);
        }
      } else if (creditsToAdd > 0 && !customerIdValue) {
        // Pas de client lié — on avance quand même le remainder (le pro n'a pas de compte à créditer)
        finalRemainder = potentialRemainder;
      }

      const newCreditEarned = previousCreditEarned + actualCreditsDeposited;

      // 4. Mettre à jour le cache dans le metaobject
      const updateResponse = await adminContext.graphql(`#graphql
        mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            metaobject { id }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          id: metaobjectNode.id,
          metaobject: {
            fields: [
              { key: "cache_revenue", value: String(newRevenue) },
              { key: "cache_orders_count", value: String(newCount) },
              { key: "cache_credit_earned", value: String(newCreditEarned) },
              { key: "cache_ca_remainder", value: String(finalRemainder) }
            ]
          }
        }
      });

      const updateData = await updateResponse.json() as any;
      if (updateData.errors || updateData.data?.metaobjectUpdate?.userErrors?.length > 0) {
        console.error("[webhook] Erreur mise à jour metaobject:", updateData.errors || updateData.data?.metaobjectUpdate?.userErrors);
      } else {
        // Mise à jour du metafield ca_genere sur la fiche client
        if (customerIdValue) {
          try {
            await updateCustomerProMetafields(adminContext, customerIdValue, { ca_genere: newRevenue });
          } catch (mfError) {
            console.warn("[webhook] Echec mise à jour ca_genere (non bloquant):", mfError);
          }
        }
      }
    } catch (e) {
      console.error("[webhook] Erreur:", e);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 200, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};