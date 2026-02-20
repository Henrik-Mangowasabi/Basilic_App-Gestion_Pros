import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHmac } from "crypto";
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
  // Filtrer les webhooks d'autres shops (vieux retries d'un autre store)
  const shop = request.headers.get("X-Shopify-Shop-Domain") || "";
  const expectedShop = (process.env.SHOPIFY_APP_URL || "")
    .replace("https://", "")
    .replace("http://", "")
    .split(".")[0]; // extrait le nom du service Render
  // On vérifie via le HMAC plutôt que le nom du shop (plus fiable)

  console.log(`🚨 ===== WEBHOOK ORDERS/CREATE APPELÉ (${shop}) =====`);

  // 1. Lire le body brut AVANT tout traitement (crucial pour le HMAC)
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") || "";
  const topic = request.headers.get("X-Shopify-Topic") || "";

  // 2. Validation HMAC manuelle (remplace authenticate.webhook qui pose problème)
  const secret = process.env.SHOPIFY_API_SECRET?.trim() || "";
  const computedHmac = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const hmacValid = computedHmac === hmacHeader;

  if (!hmacValid) {
    // HMAC invalide = webhook d'un autre store ou requête non autorisée → ignorer silencieusement
    return new Response("OK", { status: 200 });
  }

  console.log(`✅ HMAC validé pour ${shop}`);

  // 3. Parser le payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`❌ Body n'est pas du JSON valide !`);
    return new Response("Invalid JSON", { status: 200 });
  }

  console.log(`📥 Webhook reçu - Shop: ${shop}, Topic: ${topic}, HMAC: ${hmacValid ? "VALIDE" : "BYPASS"}`);

  // 4. Récupérer un admin context via session stockée
  let adminContext: any;
  try {
    const { admin } = await unauthenticated.admin(shop);
    adminContext = admin;
    console.log(`✅ Admin récupéré via unauthenticated.admin`);
  } catch (unauthError) {
    console.error(`❌ unauthenticated.admin échoué:`, unauthError);
    console.log(`⛔ Pas de session admin pour ${shop}. Retour 200 pour stopper les retries.`);
    console.log(`💡 Ouvre l'app dans l'admin Shopify pour créer une session, puis réessaie.`);
    return new Response(JSON.stringify({ error: "No admin session" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

    // IMPORTANT: Récupérer la config depuis les shop metafields
    const config = await getShopConfig(adminContext);
    console.log(`⚙️ Config utilisée - Seuil: ${config.threshold}€, Crédit: ${config.creditAmount}€`);

  const order = payload as any;
  
  // Log complet du payload pour debug
  console.log(`📦 Webhook orders/create déclenché pour la commande: ${order.name || order.id}`);
  console.log(`🔍 Structure du payload:`, JSON.stringify({
    name: order.name,
    id: order.id,
    subtotal_price: order.subtotal_price,
    total_price: order.total_price,
    discount_codes: order.discount_codes,
    discount_applications: order.discount_applications,
    subtotal_price_set: order.subtotal_price_set,
    total_price_set: order.total_price_set
  }, null, 2));
  
  // Essayer différentes façons d'extraire les codes promo
  const discountCodes = order.discount_codes || [];
  const discountApplications = order.discount_applications || [];
  
  // Récupérer le code promo original depuis l'ID du discount
  let usedCode: string | null = null;
  
  // Méthode 1: Essayer depuis discount_codes (format simple)
  if (discountCodes.length > 0 && discountCodes[0].code) {
    usedCode = discountCodes[0].code;
    console.log(`📋 Code promo trouvé dans discount_codes: ${usedCode}`);
  } 
  // Méthode 2: Récupérer depuis discount_applications via GraphQL
  else if (discountApplications.length > 0) {
    const discountApp = discountApplications[0];
    const discountId = discountApp.discount_id || discountApp.code || null;
    
    if (discountId) {
      console.log(`🔍 Récupération du code original depuis l'ID: ${discountId}`);
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
          console.log(`✅ Code promo original récupéré: ${usedCode}`);
        } else {
          // Fallback: utiliser le code directement s'il est présent
          usedCode = discountApp.code || discountApp.title || null;
          console.log(`⚠️ Code original non trouvé, utilisation du code direct: ${usedCode}`);
        }
      } catch (error) {
        console.error(`❌ Erreur lors de la récupération du code:`, error);
        // Fallback: utiliser le code directement
        usedCode = discountApp.code || discountApp.title || null;
      }
    } else {
      // Fallback: utiliser le code directement
      usedCode = discountApp.code || discountApp.title || null;
    }
  }
  
  console.log(`📋 Code promo final à utiliser: ${usedCode || "Aucun"}`);

  // On ne s'intéresse qu'aux commandes qui rapportent de l'argent (Scenario EARN)
  // Le Scenario BURN est géré automatiquement par Shopify (Checkout) !
  if (usedCode) {
    
    // Calculer le sous-total AVANT réduction pour le CA généré
    let orderAmount = 0;
    
    // Log détaillé pour debug
    console.log(`🔍 Extraction du sous-total - Valeurs disponibles:`, {
      subtotal_price: order.subtotal_price,
      subtotal_price_set: order.subtotal_price_set,
      discount_codes: order.discount_codes,
      discount_applications: order.discount_applications,
      line_items: order.line_items?.length || 0
    });
    
    // Méthode 1: Calculer depuis les line_items (sous-total avant réduction)
    if (order.line_items && order.line_items.length > 0) {
      orderAmount = order.line_items.reduce((sum: number, item: any) => {
        const price = parseFloat(item.price || item.original_price || "0");
        const quantity = parseInt(item.quantity || "1");
        return sum + (price * quantity);
      }, 0);
      console.log(`✅ Sous-total calculé depuis line_items (avant réduction): ${orderAmount}€`);
    }
    // Méthode 2: Sous-total après réduction + montant de la réduction
    else if (order.subtotal_price_set?.shop_money?.amount) {
      const subtotalAfterDiscount = parseFloat(String(order.subtotal_price_set.shop_money.amount));
      // Calculer le montant total des réductions
      let totalDiscount = 0;
      if (order.discount_codes && order.discount_codes.length > 0) {
        totalDiscount = order.discount_codes.reduce((sum: number, dc: any) => {
          return sum + parseFloat(dc.amount || "0");
        }, 0);
      } else if (order.discount_applications && order.discount_applications.length > 0) {
        // Pour les réductions en pourcentage, on doit calculer différemment
        // On utilise la différence entre le total des items et le subtotal
        totalDiscount = 0; // Sera calculé si nécessaire
      }
      orderAmount = subtotalAfterDiscount + totalDiscount;
      console.log(`✅ Sous-total calculé: ${subtotalAfterDiscount}€ (après réduction) + ${totalDiscount}€ (réduction) = ${orderAmount}€ (avant réduction)`);
    }
    // Méthode 3: Fallback - utiliser subtotal_price directement
    else if (order.subtotal_price) {
      const subtotalAfterDiscount = parseFloat(String(order.subtotal_price));
      // Essayer d'ajouter la réduction si disponible
      let totalDiscount = 0;
      if (order.discount_codes && order.discount_codes.length > 0) {
        totalDiscount = order.discount_codes.reduce((sum: number, dc: any) => {
          return sum + parseFloat(dc.amount || "0");
        }, 0);
      }
      orderAmount = subtotalAfterDiscount + totalDiscount;
      console.log(`✅ Sous-total calculé: ${subtotalAfterDiscount}€ + ${totalDiscount}€ (réduction) = ${orderAmount}€`);
    }
    // Méthode 4: Fallback - utiliser total_price (moins frais de port et taxes)
    else if (order.total_price_set?.shop_money?.amount) {
      const total = parseFloat(String(order.total_price_set.shop_money.amount));
      // Soustraire les frais de port et taxes si disponibles
      const shipping = parseFloat(order.total_shipping_price_set?.shop_money?.amount || order.total_shipping_price || "0");
      const tax = parseFloat(order.total_tax_set?.shop_money?.amount || order.total_tax || "0");
      orderAmount = total - shipping - tax;
      console.log(`⚠️ Sous-total estimé: ${total}€ - ${shipping}€ (port) - ${tax}€ (taxes) = ${orderAmount}€`);
    }
    
    if (orderAmount === 0) {
      console.error(`❌ ERREUR: Impossible d'extraire le sous-total ! Structure complète:`, JSON.stringify(order, null, 2));
    }

    console.log(`🔍 Recherche du pro avec le code: ${usedCode}`);
    console.log(`💰 Montant de la commande (sous-total AVANT réduction): ${orderAmount}€`);
    console.log(`ℹ️ Note: Le sous-total avant réduction (${orderAmount}€) est utilisé pour calculer le CA généré.`);

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

        // 2. RECHERCHE EXHAUSTIVE (Pagination si le Pro n'est pas trouvé)
        // Utile si l'indexation Shopify est en retard ou si le nombre de Pros est important
        if (!metaobjectNode) {
          console.log("⚠️ Pro non trouvé via index. Lancement de la recherche exhaustive (pagination)...");
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
                console.log(`✅ Pro trouvé via recherche exhaustive (${totalChecked} pros vérifiés) !`);
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
          console.warn(`❌ ÉCHEC FINAL : Impossible de trouver le Pro pour le code: ${usedCode}`);
          return new Response("Pro non trouvé", { status: 200 });
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

      console.log(`📊 État actuel - CA: ${currentRevenue}€ | Commandes: ${currentCount} | Crédit déjà versé: ${previousCreditEarned}€ | Reste: ${currentRemainder}€`);

      // 2. Logique incrémentale par paliers
      const newRevenue = currentRevenue + orderAmount;
      const newCount = currentCount + 1;

      // Le remainder = CA accumulé depuis le dernier palier + montant de cette commande
      let remainder = currentRemainder + orderAmount;
      let creditsToAdd = 0;

      // Tant que le remainder dépasse le seuil, on ajoute un palier
      while (remainder >= config.threshold) {
        creditsToAdd += config.creditAmount;
        remainder -= config.threshold;
      }

      const newCreditEarned = previousCreditEarned + creditsToAdd;
      const amountToDeposit = creditsToAdd;

      console.log(`💰 Nouveau CA: ${newRevenue}€ | Nouveau nombre de commandes: ${newCount}`);
      console.log(`💳 Paliers franchis: ${creditsToAdd > 0 ? creditsToAdd / config.creditAmount : 0} | Crédits à verser: ${amountToDeposit}€ | Nouveau total gagné: ${newCreditEarned}€ | Reste avant prochain palier: ${remainder.toFixed(2)}€`);

      if (amountToDeposit > 0) {
        console.log(`🚀 VIREMENT EN COURS DE ${amountToDeposit}€ ...`);

        // A. Trouver le Compte Crédit du client Shopify
        if (customerIdValue) {
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
            const rAccount = await adminContext.graphql(queryAccount, { variables: { id: customerIdValue }});
            const dAccount = await rAccount.json() as any;
            
            // Vérifier s'il y a des erreurs de permissions
            if (dAccount.errors) {
              const permissionError = dAccount.errors.find((e: any) => e.message?.includes("storeCreditAccounts") || e.message?.includes("Access denied"));
              if (permissionError) {
                console.error(`❌ Permissions Store Credit manquantes. Erreur: ${permissionError.message}`);
                console.error(`⚠️ L'application doit être réinstallée avec les scopes: read_store_credit_accounts, write_store_credit_account_transactions`);
                console.log(`ℹ️ Le metaobject sera mis à jour mais le crédit ne sera pas versé. Réinstallez l'application pour activer le crédit.`);
                // Continuer sans créditer le compte
              } else {
                throw new Error(dAccount.errors.map((e: any) => e.message).join(", "));
              }
            } else {
              const accountId = dAccount.data?.customer?.storeCreditAccounts?.edges?.[0]?.node?.id;

              if (accountId) {
                // B. Faire le virement (Mutation Native)
                const mutationCredit = `#graphql
                  mutation creditStore($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
                    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
                      storeCreditAccountTransaction { 
                        amount { 
                          amount 
                          currencyCode 
                        } 
                      }
                      userErrors { 
                        field 
                        message 
                      }
                    }
                  }
                `;
                
                const creditInput = {
                  creditAmount: {
                    amount: String(amountToDeposit),
                    currencyCode: "EUR"
                  }
                };
                
                console.log(`💳 Tentative de crédit de ${amountToDeposit}€ sur le compte ${accountId}`);
                console.log(`💳 Paramètres:`, JSON.stringify({ id: accountId, creditInput }, null, 2));
                
                const rCredit = await adminContext.graphql(mutationCredit, { 
                  variables: { 
                    id: accountId, 
                    creditInput: creditInput
                  }
                });
                const dCredit = await rCredit.json() as any;

                if (dCredit.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
                  console.error("❌ Erreur Virement:", dCredit.data.storeCreditAccountCredit.userErrors);
                } else {
                  console.log("✅ Virement effectué avec succès sur le compte Shopify !");
                }
              } else {
                console.error("❌ Pas de compte Crédit trouvé pour ce client (Fonctionnalité active ?)");
              }
            }
          } catch (creditError: any) {
            // Si c'est une erreur de permissions, on continue quand même
            if (creditError?.message?.includes("storeCreditAccounts") || creditError?.message?.includes("Access denied")) {
              console.error(`❌ Permissions Store Credit manquantes: ${creditError.message}`);
              console.error(`⚠️ L'application doit être réinstallée avec les scopes: read_store_credit_accounts, write_store_credit_account_transactions`);
              console.log(`ℹ️ Le metaobject sera mis à jour mais le crédit ne sera pas versé. Réinstallez l'application pour activer le crédit.`);
            } else {
              console.error(`❌ Erreur lors de la récupération du compte Store Credit:`, creditError);
            }
          }
        } else {
          console.warn(`⚠️ Aucun customer_id trouvé pour ce metaobject, impossible de créditer le compte`);
        }
      }

      // 4. Mettre à jour notre cache (incrémental avec remainder)
      console.log(`🔄 Mise à jour du metaobject ${metaobjectNode.id}...`);
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
              { key: "cache_ca_remainder", value: String(remainder) }
            ]
          }
        }
      });

      const updateData = await updateResponse.json() as any;
      if (updateData.errors) {
        console.error("❌ Erreur GraphQL lors de la mise à jour:", updateData.errors);
      } else if (updateData.data?.metaobjectUpdate?.userErrors?.length > 0) {
        console.error("❌ Erreur lors de la mise à jour du metaobject:", updateData.data.metaobjectUpdate.userErrors);
      } else {
        console.log(`✅ Metaobject mis à jour avec succès ! Nouveau CA: ${newRevenue}€ | Nouvelles commandes: ${newCount}`);
        console.log(`📝 Détails de la mise à jour:`);
        console.log(`   - cache_revenue: ${currentRevenue} → ${newRevenue}`);
        console.log(`   - cache_orders_count: ${currentCount} → ${newCount}`);
        console.log(`   - cache_credit_earned: ${previousCreditEarned} → ${newCreditEarned}`);
        console.log(`   - cache_ca_remainder: ${currentRemainder} → ${remainder}`);

        // Mise à jour dynamique du metafield ca_genere sur la fiche client
        if (customerIdValue) {
          try {
            await updateCustomerProMetafields(adminContext, customerIdValue, {
              ca_genere: newRevenue,
            });
            console.log(`✅ Metafield ca_genere mis à jour : ${newRevenue}€`);
          } catch (mfError) {
            console.warn("⚠️ Echec mise à jour ca_genere (non bloquant):", mfError);
          }
        }
      }
    } catch (e) {
      console.error("❌ Erreur Webhook:", e);
      if (e instanceof Error) {
        console.error("❌ Message d'erreur:", e.message);
        console.error("❌ Stack:", e.stack);
      }
      // Retourner une réponse valide même en cas d'erreur pour éviter que Shopify réessaie
      return new Response(JSON.stringify({ error: String(e) }), { 
        status: 200, 
        headers: { "Content-Type": "application/json" } 
      });
    }
  } else {
    console.log("ℹ️ Aucun code promo détecté dans cette commande, webhook ignoré");
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};