// FICHIER : app/lib/discount.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Recherche un discount Shopify existant par son code.
 * Utilisé en fallback quand un code est déjà pris lors d'une création.
 */
async function findDiscountIdByCode(admin: AdminApiContext, code: string): Promise<string | null> {
  const query = `
    query findDiscountByCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
      }
    }
  `;
  try {
    const r = await (admin as any).graphql(query, { variables: { code } });
    const d = await r.json() as any;
    return d.data?.codeDiscountNodeByCode?.id || null;
  } catch {
    return null;
  }
}

// ... (Garde createShopifyDiscount tel quel) ...
export async function createShopifyDiscount(
  admin: AdminApiContext,
  data: { code: string; montant: number; type: string; name: string },
): Promise<{ success: boolean; discountId?: string; error?: string; alreadyExisted?: boolean }> {
  const isPercentage = data.type === "%";
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    basicCodeDiscount: {
      title: data.name,
      code: data.code,
      startsAt: new Date().toISOString(),
      usageLimit: null,
      appliesOncePerCustomer: false,
      customerSelection: { all: true },
      customerGets: {
        value: isPercentage
          ? { percentage: data.montant / 100 }
          : {
              discountAmount: {
                amount: data.montant,
                appliesOnEachItem: true,
              },
            },
        items: { all: true },
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true,
      },
    },
  };
  try {
    const response = await admin.graphql(mutation, { variables });
    const result = (await response.json()) as any;
    if (result.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      const errMsg: string = result.data.discountCodeBasicCreate.userErrors[0].message || "";
      // Si le code existe déjà dans Shopify → supprimer l'ancien et recréer via l'app
      // pour obtenir l'attribution "Créé par [app]" dans l'admin Shopify.
      // Utile lors d'un import de masse de pros avec des codes créés manuellement avant l'app.
      if (errMsg.toLowerCase().includes("taken") || errMsg.toLowerCase().includes("already") || errMsg.toLowerCase().includes("exist")) {
        console.log(`[DISCOUNT] Code "${data.code}" déjà existant → suppression + recréation pour attribution app...`);
        const existingId = await findDiscountIdByCode(admin, data.code);
        if (existingId) {
          const deleteResult = await deleteShopifyDiscount(admin, existingId);
          if (!deleteResult.success) {
            // Impossible de supprimer → fallback : réutiliser l'ID sans attribution app
            console.warn(`[DISCOUNT] Impossible de supprimer le discount existant (${deleteResult.error}) — réutilisation de l'ID existant`);
            return { success: true, discountId: existingId, alreadyExisted: true };
          }
          // Recréer via l'app (attribution "Créé par app" garantie)
          try {
            const retryResponse = await admin.graphql(mutation, { variables });
            const retryResult = (await retryResponse.json()) as any;
            if (retryResult.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
              return { success: false, error: retryResult.data.discountCodeBasicCreate.userErrors[0].message };
            }
            console.log(`[DISCOUNT] Code "${data.code}" recréé avec attribution app ✅`);
            return { success: true, discountId: retryResult.data?.discountCodeBasicCreate?.codeDiscountNode?.id };
          } catch (retryError) {
            return { success: false, error: `Erreur recréation après suppression: ${String(retryError)}` };
          }
        }
      }
      return {
        success: false,
        error: errMsg,
      };
    }
    return {
      success: true,
      discountId: result.data?.discountCodeBasicCreate?.codeDiscountNode?.id,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ... (Garde updateShopifyDiscount tel quel) ...
export async function updateShopifyDiscount(
  admin: AdminApiContext,
  discountId: string,
  data: { code: string; montant: number; type: string; name: string },
) {
  const isPercentage = data.type === "%";
  const mutation = `
    mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
        userErrors { field message }
      }
    }
  `;
  const variables = {
    id: discountId,
    basicCodeDiscount: {
      title: data.name,
      code: data.code,
      customerGets: {
        value: isPercentage
          ? { percentage: data.montant / 100 }
          : {
              discountAmount: {
                amount: data.montant,
                appliesOnEachItem: true,
              },
            },
        items: { all: true },
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true,
      },
    },
  };
  try {
    const response = await admin.graphql(mutation, { variables });
    const result = (await response.json()) as any;
    if (result.data?.discountCodeBasicUpdate?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.data.discountCodeBasicUpdate.userErrors[0].message,
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// --- CORRECTION IMPORTANTE ICI ---
export async function toggleShopifyDiscount(
  admin: AdminApiContext,
  discountId: string,
  shouldBeActive: boolean,
) {
  const mutation = `
      mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
          userErrors { field message }
        }
      }
    `;

  // Si actif = endsAt null. Si inactif = endsAt maintenant.
  const variables = {
    id: discountId,
    basicCodeDiscount: {
      endsAt: shouldBeActive ? null : new Date().toISOString(),
    },
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const result = (await response.json()) as any;
    if (result.data?.discountCodeBasicUpdate?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.data.discountCodeBasicUpdate.userErrors[0].message,
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ... (Garde deleteShopifyDiscount tel quel) ...
export async function deleteShopifyDiscount(
  admin: AdminApiContext,
  discountId: string,
) {
  const mutation = `mutation discountCodeDelete($id: ID!) { discountCodeDelete(id: $id) { userErrors { field message } } }`;
  try {
    const response = await admin.graphql(mutation, {
      variables: { id: discountId },
    });
    const result = (await response.json()) as any;
    if (result.errors)
      return { success: false, error: "Erreur technique Shopify" };
    if (result.data?.discountCodeDelete?.userErrors?.length > 0) {
      return {
        success: false,
        error: result.data.discountCodeDelete.userErrors[0].message,
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
