// Configuration de l'app — valeurs par défaut depuis env vars, persistance via shop metafields
export const appConfig = {
  threshold: parseFloat(process.env.CREDIT_THRESHOLD || "500"),
  creditAmount: parseFloat(process.env.CREDIT_AMOUNT || "10"),
  // Loi anti-cadeaux : plafond annuel pour les professions réglementées (statut "Limité annuel")
  regulatedCreditAmount: parseFloat(process.env.REGULATED_CREDIT_AMOUNT || "60"),
};

export type ShopConfig = {
  threshold: number;
  creditAmount: number;
  regulatedCreditAmount: number;
};

const CONFIG_NAMESPACE = "basilic_config";

// --- Helpers internes (shop id + écriture de metafields) ---

async function getShopId(admin: any): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const shopRes = await admin.graphql(`#graphql
    query GetShopId { shop { id } }
  `);
  const shopData = await shopRes.json();
  return shopData?.data?.shop?.id || null;
}

async function setShopMetafields(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  entries: { key: string; type: string; value: string }[],
): Promise<void> {
  const shopId = await getShopId(admin);
  if (!shopId) return;

  const res = await admin.graphql(`#graphql
    mutation SetShopConfigMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: entries.map((e) => ({ namespace: CONFIG_NAMESPACE, ownerId: shopId, ...e })),
    },
  });
  const data = await res.json();
  const userErrors = data?.data?.metafieldsSet?.userErrors;
  if (userErrors?.length > 0) {
    console.error("[CONFIG] Erreur metafieldsSet:", userErrors);
  }
}

// Lit la config depuis les shop metafields (fallback sur les env vars)
export async function getShopConfig(admin: any): Promise<ShopConfig> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await admin.graphql(`#graphql
      query GetShopConfig {
        shop {
          threshold: metafield(namespace: "${CONFIG_NAMESPACE}", key: "credit_threshold") { value }
          creditAmount: metafield(namespace: "${CONFIG_NAMESPACE}", key: "credit_amount") { value }
          regulatedCreditAmount: metafield(namespace: "${CONFIG_NAMESPACE}", key: "regulated_credit_amount") { value }
        }
      }
    `);
    const data = await res.json();
    const shop = data?.data?.shop;
    return {
      threshold: shop?.threshold?.value ? parseFloat(shop.threshold.value) : appConfig.threshold,
      creditAmount: shop?.creditAmount?.value ? parseFloat(shop.creditAmount.value) : appConfig.creditAmount,
      regulatedCreditAmount: shop?.regulatedCreditAmount?.value ? parseFloat(shop.regulatedCreditAmount.value) : appConfig.regulatedCreditAmount,
    };
  } catch {
    return appConfig;
  }
}

// Sauvegarde la config dans les shop metafields
export async function saveShopConfig(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  values: ShopConfig
): Promise<void> {
  try {
    await setShopMetafields(admin, [
      { key: "credit_threshold", type: "number_decimal", value: String(values.threshold) },
      { key: "credit_amount", type: "number_decimal", value: String(values.creditAmount) },
      { key: "regulated_credit_amount", type: "number_decimal", value: String(values.regulatedCreditAmount) },
    ]);
  } catch (e) {
    console.error("Erreur saveShopConfig:", e);
  }
}

// --- Date de recalcul globale (Réglage Date) ---
// Persistée en shop metafield pour que les webhooks (orders/cancelled, refunds/create)
// appliquent le même filtre de date que les recalculs manuels.

export async function getRecalcFromDate(admin: any): Promise<string | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await admin.graphql(`#graphql
      query GetRecalcFromDate {
        shop {
          recalcFromDate: metafield(namespace: "${CONFIG_NAMESPACE}", key: "recalc_from_date") { value }
        }
      }
    `);
    const data = await res.json();
    return data?.data?.shop?.recalcFromDate?.value || null;
  } catch {
    return null;
  }
}

export async function saveRecalcFromDate(admin: any, date: string | null): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    if (date) {
      await setShopMetafields(admin, [
        { key: "recalc_from_date", type: "single_line_text_field", value: date },
      ]);
    } else {
      // Effacement : metafieldsSet refuse les valeurs vides → suppression du metafield
      const shopId = await getShopId(admin);
      if (!shopId) return;
      await admin.graphql(`#graphql
        mutation DeleteRecalcFromDate($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            userErrors { field message }
          }
        }
      `, {
        variables: {
          metafields: [{ ownerId: shopId, namespace: CONFIG_NAMESPACE, key: "recalc_from_date" }],
        },
      });
    }
  } catch (e) {
    console.error("Erreur saveRecalcFromDate:", e);
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
    await setShopMetafields(admin, [
      { key: "validation_value", type: "number_decimal", value: String(values.value) },
      { key: "validation_type", type: "single_line_text_field", value: values.type },
      { key: "validation_code_prefix", type: "single_line_text_field", value: values.codePrefix },
    ]);
  } catch (e) {
    console.error("Erreur saveValidationDefaults:", e);
  }
}
