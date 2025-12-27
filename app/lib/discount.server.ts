import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Crée un code de réduction basique dans Shopify
 */
export async function createShopifyDiscount(
  admin: AdminApiContext,
  data: {
    code: string;
    montant: number;
    type: string;
    name: string; // Nom interne (ex: Code promo Pro Sante - [Code])
  }
): Promise<{ success: boolean; discountId?: string; error?: string }> {
  
  const isPercentage = data.type === "%";
  
  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        discountCodeNode {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: data.name,
      code: data.code,
      startsAt: new Date().toISOString(), // Effectif de suite
      usageLimit: null, // Illimité
      appliesOncePerCustomer: false,
      customerSelection: {
        all: true // Pour tout le monde (ou tu peux restreindre)
      },
      customerGets: {
        value: isPercentage 
          ? { percentage: data.montant / 100 } // Shopify attend 0.2 pour 20%
          : { discountAmount: { amount: data.montant, appliesOnEachItem: false } },
        items: {
          all: true // S'applique à toute la commande
        }
      }
    }
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const result = await response.json() as any;

    if (result.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      console.error("Erreur création discount:", result.data.discountCodeBasicCreate.userErrors);
      return { success: false, error: result.data.discountCodeBasicCreate.userErrors[0].message };
    }

    return { success: true, discountId: result.data?.discountCodeBasicCreate?.discountCodeNode?.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Met à jour un code de réduction existant
 */
export async function updateShopifyDiscount(
  admin: AdminApiContext,
  discountId: string,
  data: {
    code: string;
    montant: number;
    type: string;
    name: string;
  }
): Promise<{ success: boolean; error?: string }> {
  
  const isPercentage = data.type === "%";

  const mutation = `
    mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
        discountCodeNode {
          id
        }
        userErrors {
          field
          message
        }
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
          : { discountAmount: { amount: data.montant, appliesOnEachItem: false } },
        items: { all: true }
      }
    }
  };

  try {
    const response = await admin.graphql(mutation, { variables });
    const result = await response.json() as any;

    if (result.data?.discountCodeBasicUpdate?.userErrors?.length > 0) {
      return { success: false, error: result.data.discountCodeBasicUpdate.userErrors[0].message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Supprime un code de réduction
 */
export async function deleteShopifyDiscount(admin: AdminApiContext, discountId: string) {
  const mutation = `
    mutation discountCodeDelete($id: ID!) {
      discountCodeDelete(id: $id) {
        deletedDiscountCodeId
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(mutation, { variables: { id: discountId } });
    const result = await response.json() as any;
    
    if (result.data?.discountCodeDelete?.userErrors?.length > 0) {
      return { success: false, error: result.data.discountCodeDelete.userErrors[0].message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}