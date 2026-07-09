import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const metaobjectId = formData.get("metaobjectId") as string;
  const customerId = formData.get("customerId") as string | null;
  const creditsToDeposit = parseFloat(formData.get("creditsToDeposit") as string || "0");
  const newCreditEarned = parseFloat(formData.get("newCreditEarned") as string || "0");
  const newCaRemainder = parseFloat(formData.get("newCaRemainder") as string || "0");

  if (!metaobjectId) {
    return new Response(JSON.stringify({ error: "metaobjectId requis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let creditDeposited = false;

  // 1. Déposer store credit si besoin
  if (creditsToDeposit > 0 && customerId) {
    try {
      // Récupérer la devise du shop
      const rShop = await admin.graphql(`#graphql query { shop { currencyCode } }`);
      const dShop = await rShop.json() as any;
      const currencyCode: string = dShop.data?.shop?.currencyCode || "EUR";

      // Récupérer l'ID du compte store credit du client
      const rAccount = await admin.graphql(`#graphql
        query getStoreCredit($id: ID!) {
          customer(id: $id) {
            storeCreditAccounts(first: 1) {
              edges { node { id } }
            }
          }
        }
      `, { variables: { id: customerId } });
      const dAccount = await rAccount.json() as any;

      if (dAccount.errors) {
        const permErr = dAccount.errors.find((e: any) =>
          e.message?.includes("storeCreditAccounts") || e.message?.includes("Access denied")
        );
        if (permErr) {
          console.error("[recalculate-credits] Permissions store credit manquantes.");
        } else {
          throw new Error(dAccount.errors.map((e: any) => e.message).join(", "));
        }
      } else {
        const accountId = dAccount.data?.customer?.storeCreditAccounts?.edges?.[0]?.node?.id;
        const creditTargetId = accountId || customerId;

        const rCredit = await admin.graphql(`#graphql
          mutation creditStore($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
            storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
              storeCreditAccountTransaction { amount { amount currencyCode } }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            id: creditTargetId,
            creditInput: { creditAmount: { amount: String(creditsToDeposit), currencyCode } },
          },
        });
        const dCredit = await rCredit.json() as any;

        if (dCredit.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
          return new Response(JSON.stringify({
            error: "Erreur dépôt store credit",
            details: dCredit.data.storeCreditAccountCredit.userErrors,
          }), { headers: { "Content-Type": "application/json" } });
        }
        creditDeposited = true;
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: `Erreur store credit: ${String(e)}` }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 2. Mettre à jour le metaobject (cache_credit_earned + cache_ca_remainder)
  const rMO = await admin.graphql(`#graphql
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      id: metaobjectId,
      metaobject: {
        fields: [
          { key: "cache_credit_earned", value: String(newCreditEarned) },
          { key: "cache_ca_remainder", value: String(newCaRemainder) },
        ],
      },
    },
  });

  const dMO = await rMO.json() as any;
  if (dMO.data?.metaobjectUpdate?.userErrors?.length > 0) {
    return new Response(JSON.stringify({
      error: "Erreur mise à jour metaobject",
      details: dMO.data.metaobjectUpdate.userErrors,
    }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ success: true, creditDeposited, creditsDeposited: creditsToDeposit }), {
    headers: { "Content-Type": "application/json" },
  });
};
