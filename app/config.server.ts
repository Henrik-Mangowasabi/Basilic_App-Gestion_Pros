// Configuration de l'app — valeurs par défaut depuis env vars, persistance via shop metafields
export const appConfig = {
  threshold: parseFloat(process.env.CREDIT_THRESHOLD || "500"),
  creditAmount: parseFloat(process.env.CREDIT_AMOUNT || "10"),
};

const CONFIG_NAMESPACE = "basilic_config";

// Lit la config depuis les shop metafields (fallback sur les env vars)
export async function getShopConfig(admin: any): Promise<{ threshold: number; creditAmount: number }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await admin.graphql(`#graphql
      query GetShopConfig {
        shop {
          threshold: metafield(namespace: "${CONFIG_NAMESPACE}", key: "credit_threshold") { value }
          creditAmount: metafield(namespace: "${CONFIG_NAMESPACE}", key: "credit_amount") { value }
        }
      }
    `);
    const data = await res.json();
    const shop = data?.data?.shop;
    return {
      threshold: shop?.threshold?.value ? parseFloat(shop.threshold.value) : appConfig.threshold,
      creditAmount: shop?.creditAmount?.value ? parseFloat(shop.creditAmount.value) : appConfig.creditAmount,
    };
  } catch {
    return appConfig;
  }
}

// Sauvegarde la config dans les shop metafields
export async function saveShopConfig(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  values: { threshold: number; creditAmount: number }
): Promise<void> {
  try {
    // Récupère le GID du shop
    const shopRes = await admin.graphql(`#graphql
      query GetShopId { shop { id } }
    `);
    const shopData = await shopRes.json();
    const shopId = shopData?.data?.shop?.id;
    if (!shopId) return;

    await admin.graphql(`#graphql
      mutation SaveShopConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metafields: [
          { namespace: CONFIG_NAMESPACE, key: "credit_threshold", type: "number_decimal", value: String(values.threshold), ownerId: shopId },
          { namespace: CONFIG_NAMESPACE, key: "credit_amount", type: "number_decimal", value: String(values.creditAmount), ownerId: shopId },
        ],
      },
    });
  } catch (e) {
    console.error("Erreur saveShopConfig:", e);
  }
}

// --- Validation defaults (code promo) ---

export type ValidationDefaults = {
  value: number;
  type: string;
  codePrefix: string;
};

const DEFAULT_VALIDATION: ValidationDefaults = { value: 5, type: "%", codePrefix: "PRO_" };

export async function getValidationDefaults(admin: any): Promise<ValidationDefaults> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await admin.graphql(`#graphql
      query GetValidationDefaults {
        shop {
          validationValue: metafield(namespace: "${CONFIG_NAMESPACE}", key: "validation_value") { value }
          validationType: metafield(namespace: "${CONFIG_NAMESPACE}", key: "validation_type") { value }
          validationCodePrefix: metafield(namespace: "${CONFIG_NAMESPACE}", key: "validation_code_prefix") { value }
        }
      }
    `);
    const data = await res.json();
    const shop = data?.data?.shop;
    return {
      value: shop?.validationValue?.value ? parseFloat(shop.validationValue.value) : DEFAULT_VALIDATION.value,
      type: shop?.validationType?.value || DEFAULT_VALIDATION.type,
      codePrefix: shop?.validationCodePrefix?.value || DEFAULT_VALIDATION.codePrefix,
    };
  } catch {
    return DEFAULT_VALIDATION;
  }
}

export async function saveValidationDefaults(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  values: ValidationDefaults
): Promise<void> {
  try {
    const shopRes = await admin.graphql(`#graphql
      query GetShopId { shop { id } }
    `);
    const shopData = await shopRes.json();
    const shopId = shopData?.data?.shop?.id;
    if (!shopId) return;

    await admin.graphql(`#graphql
      mutation SaveValidationDefaults($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        metafields: [
          { namespace: CONFIG_NAMESPACE, key: "validation_value", type: "number_decimal", value: String(values.value), ownerId: shopId },
          { namespace: CONFIG_NAMESPACE, key: "validation_type", type: "single_line_text_field", value: values.type, ownerId: shopId },
          { namespace: CONFIG_NAMESPACE, key: "validation_code_prefix", type: "single_line_text_field", value: values.codePrefix, ownerId: shopId },
        ],
      },
    });
  } catch (e) {
    console.error("Erreur saveValidationDefaults:", e);
  }
}
