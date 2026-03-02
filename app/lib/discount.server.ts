// FICHIER : app/lib/discount.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// ... (Garde createShopifyDiscount tel quel) ...
export async function createShopifyDiscount(
  admin: AdminApiContext,
  data: { code: string; montant: number; type: string; name: string },
) {
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
      return {
        success: false,
        error: result.data.discountCodeBasicCreate.userErrors[0].message,
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
