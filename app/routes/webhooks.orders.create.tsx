// FICHIER : app/routes/webhooks.orders.create.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload } = await authenticate.webhook(request);
  if (!admin) return new Response();

  const order = payload as any;
  const discountCodes = order.discount_codes || [];

  // On ne s'intéresse qu'aux commandes qui rapportent de l'argent (Scenario EARN)
  // Le Scenario BURN est géré automatiquement par Shopify (Checkout) !
  if (discountCodes.length > 0) {
    const usedCode = discountCodes[0].code;
    const orderAmount = parseFloat(order.total_price);

    console.log(`📦 Commande reçue : ${order.name} | Code : ${usedCode}`);

    const queryProByCode = `#graphql
      query findProByCode {
        metaobjects(first: 1, type: "mm_pro_de_sante", query: "code:'${usedCode}'") {
          edges { node { id, customer_id: field(key: "customer_id") { value }, fields { key value } } }
        }
      }
    `;

    try {
      const response = await admin.graphql(queryProByCode);
      const data = await response.json() as any;
      const metaobjectNode = data.data?.metaobjects?.edges?.[0]?.node;

      if (metaobjectNode) {
        // 1. Récupération des compteurs actuels
        let currentRevenue = 0;
        let previousCreditEarned = 0;
        let currentCount = 0;

        metaobjectNode.fields.forEach((f: any) => {
          if (f.key === "cache_revenue" && f.value) currentRevenue = parseFloat(f.value);
          if (f.key === "cache_credit_earned" && f.value) previousCreditEarned = parseFloat(f.value);
          if (f.key === "cache_orders_count" && f.value) currentCount = parseInt(f.value);
        });

        // 2. Calcul du NOUVEAU total théorique
        const newRevenue = currentRevenue + orderAmount;
        const newCount = currentCount + 1;
        
        // Règle : 10€ tous les 500€ de CA (Total à vie)
        const totalCreditShouldBe = Math.floor(newRevenue / 500) * 10;

        // 3. Calcul du montant à verser (Le Delta)
        const amountToDeposit = totalCreditShouldBe - previousCreditEarned;

        console.log(`💰 CA: ${currentRevenue} -> ${newRevenue} | Crédit Total dû: ${totalCreditShouldBe} | Déjà versé: ${previousCreditEarned}`);

        if (amountToDeposit > 0) {
            console.log(`🚀 VIREMENT EN COURS DE ${amountToDeposit}€ ...`);

            // A. Trouver le Compte Crédit du client Shopify
            const customerId = metaobjectNode.customer_id?.value;
            if (customerId) {
                const queryAccount = `#graphql
                    query getStoreCredit($id: ID!) {
                        customer(id: $id) {
                            storeCreditAccounts(first: 1) {
                                edges { node { id } }
                            }
                        }
                    }
                `;
                const rAccount = await admin.graphql(queryAccount, { variables: { id: customerId }});
                const dAccount = await rAccount.json();
                const accountId = dAccount.data?.customer?.storeCreditAccounts?.edges?.[0]?.node?.id;

                if (accountId) {
                    // B. Faire le virement (Mutation Native)
                    const mutationCredit = `#graphql
                        mutation creditStore($id: ID!, $amount: MoneyInput!) {
                            storeCreditAccountCredit(id: $id, creditInput: {amount: $amount}) {
                                storeCreditAccountTransaction { amount { amount } }
                                userErrors { message }
                            }
                        }
                    `;
                    
                    const rCredit = await admin.graphql(mutationCredit, { 
                        variables: { 
                            id: accountId, 
                            amount: { amount: amountToDeposit, currencyCode: "EUR" } 
                        }
                    });
                    const dCredit = await rCredit.json();

                    if (dCredit.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
                        console.error("❌ Erreur Virement:", dCredit.data.storeCreditAccountCredit.userErrors);
                    } else {
                        console.log("✅ Virement effectué avec succès sur le compte Shopify !");
                    }
                } else {
                    console.error("❌ Pas de compte Crédit trouvé pour ce client (Fonctionnalité active ?)");
                }
            }
        }

        // 4. Mettre à jour notre cache (pour ne pas le re-payer la prochaine fois)
        // On met à jour "cache_credit_earned" avec le nouveau total théorique
        await admin.graphql(`#graphql
          mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
            metaobjectUpdate(id: $id, metaobject: $metaobject) { userErrors { field message } }
          }
        `, {
          variables: {
            id: metaobjectNode.id,
            metaobject: {
              fields: [
                { key: "cache_revenue", value: String(newRevenue) },
                { key: "cache_orders_count", value: String(newCount) },
                { key: "cache_credit_earned", value: String(totalCreditShouldBe) } // Important : On stocke le nouveau palier atteint
              ]
            }
          }
        });
      }
    } catch (e) { console.error("Erreur Webhook:", e); }
  }

  return new Response();
};