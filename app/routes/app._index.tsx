import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useActionData,
  Form,
  redirect,
  useSearchParams,
  useSubmit,
  useNavigation,
  Link,
  useRevalidator,
} from "react-router";
import { Pagination } from "../components/Pagination";
import { useState, useEffect, useRef, useMemo, memo } from "react";
import { useEditMode } from "../context/EditModeContext";
import { authenticate } from "../shopify.server";
import {
  checkMetaobjectStatus,
  createMetaobject,
  getMetaobjectEntries,
  createMetaobjectEntry,
  updateMetaobjectEntry,
  deleteMetaobjectEntry,
  migrateMetaobjectDefinition,
} from "../lib/metaobject.server";
import { createCustomerMetafieldDefinitions } from "../lib/customer.server";

import { getShopConfig, saveShopConfig } from "../config.server";
import * as XLSX from "xlsx";

// --- LOADER ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const status = await checkMetaobjectStatus(admin);

  const config = await getShopConfig(admin);

  let entries: Array<{
    id: string;
    identification?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    email?: string;
    code?: string;
    montant?: number;
    type?: string;
    customer_id?: string;
    tags?: string[];
  }> = [];

  if (status.exists) {
    await migrateMetaobjectDefinition(admin);
    const entriesResult = await getMetaobjectEntries(admin);
    const rawEntries = entriesResult.entries;

    // OPTIMISATION : Requête groupée pour les tags
    const customerIds = rawEntries
      .map((e: any) => e.customer_id)
      .filter((id: string) => id && id.startsWith("gid://shopify/Customer/"));

    const tagsMap = new Map<string, string[]>();
    const creditBalanceMap = new Map<string, number>();

    if (customerIds.length > 0) {
      try {
        const response = await admin.graphql(
          `#graphql
          query getCustomersData($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Customer {
                id
                tags
                storeCreditAccounts(first: 1) {
                  edges {
                    node {
                      balance {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }`,
          { variables: { ids: customerIds } },
        );
        const { data } = await response.json();
        const nodes = data?.nodes || [];
        nodes.forEach((node: any) => {
          if (node && node.id) {
            tagsMap.set(node.id, node.tags || []);

            // Lire le vrai solde de store credit Shopify
            const storeCreditAccount = node.storeCreditAccounts?.edges?.[0]?.node;
            if (storeCreditAccount) {
              const balance = parseFloat(storeCreditAccount.balance.amount) || 0;
              creditBalanceMap.set(node.id, balance);
            }
          }
        });
      } catch (error) {
        console.error("Erreur récup bulk tags", error);
      }
    }

    entries = rawEntries.map((entry: any) => ({
      ...entry,
      tags: entry.customer_id ? tagsMap.get(entry.customer_id) || [] : [],
      credit_balance: entry.customer_id ? creditBalanceMap.get(entry.customer_id) || 0 : 0,
    }));

    // Calculer les statistiques de commandes pour chaque code promo
    const allowedCodes = new Set(entries.map((e: any) => e.code).filter(Boolean)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const proStats = new Map<string, { revenue: number; count: number }>();

    if (allowedCodes.size > 0) {
      try {
        const allOrdersQuery = `#graphql
          query getAllOrders($queryString: String!, $cursor: String) {
            orders(first: 250, query: $queryString, after: $cursor) {
              edges {
                node {
                  totalPriceSet { shopMoney { amount } }
                  discountCodes
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `;
        const currentYear = new Date().getFullYear();
        let hasNextPage = true;
        let cursor = null;
        while (hasNextPage) {
          const response = await admin.graphql(allOrdersQuery, {
            variables: { queryString: `created_at:>=${currentYear}-01-01 AND discount_code:*`, cursor },
          });
          const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
          for (const edge of data.data?.orders?.edges || []) {
            const revenue = parseFloat(edge.node.totalPriceSet.shopMoney.amount);
            const codesUsed: string[] = edge.node.discountCodes || [];
            const relevantCodes = codesUsed.filter((c) => allowedCodes.has(c));
            relevantCodes.forEach((code) => {
              const cur = proStats.get(code) || { revenue: 0, count: 0 };
              proStats.set(code, { revenue: cur.revenue + revenue, count: cur.count + 1 });
            });
          }
          const pageInfo = data.data?.orders?.pageInfo as any; // eslint-disable-line @typescript-eslint/no-explicit-any
          hasNextPage = pageInfo?.hasNextPage;
          cursor = pageInfo?.endCursor;
        }
      } catch (e) {
        console.error("Erreur chargement stats commandes:", e);
      }
    }

    // Attacher les stats aux entries
    entries = entries.map((entry: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const stats = proStats.get(entry.code) || { revenue: 0, count: 0 };
      const creditEarned = Math.floor(stats.revenue / config.threshold) * config.creditAmount;
      return {
        ...entry,
        cache_orders_count: String(stats.count),
        cache_revenue: String(stats.revenue.toFixed(2)),
        cache_credit_earned: String(creditEarned.toFixed(2)),
      };
    });
  }

  return { status, entries, config, shopDomain };
};

// --- ACTION ---
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "create_structure") {
    // 1. Structure Métaobjet
    const result = await createMetaobject(admin);

    // 2. Définition Médafields Clients (Profession + Adresse)
    if (result.success) {
      await createCustomerMetafieldDefinitions(admin);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return redirect("/app?success=structure_created");
    }
    return { error: result.error || "Erreur création structure" };
  }

  if (actionType === "create_entry") {
    const first_name = (formData.get("first_name") as string)?.trim() || "";
    const last_name = (formData.get("last_name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";
    const profession = (formData.get("profession") as string)?.trim() || "";
    const adresse = (formData.get("adresse") as string)?.trim() || "";
    const identification =
      (formData.get("identification") as string)?.trim() ||
      `${(first_name.slice(0, 2) + last_name.slice(0, 2)).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

    const montant = montantStr ? parseFloat(montantStr) : NaN;

    const result = await createMetaobjectEntry(admin, {
      identification,
      first_name,
      last_name,
      email,
      code,
      montant,
      type,
      profession,
      adresse,
    });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_created");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur création entrée" };
  }

  if (actionType === "toggle_status") {
    const id = formData.get("id") as string;
    const currentStatus = formData.get("current_status") === "true";
    const result = await updateMetaobjectEntry(admin, id, { status: !currentStatus });
    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "status_toggled");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur mise à jour statut" };
  }

  if (actionType === "update_config") {
    const threshold = parseFloat(formData.get("threshold") as string);
    const creditAmount = parseFloat(formData.get("creditAmount") as string);
    await saveShopConfig(admin, { threshold, creditAmount });
    return { success: "config_saved", threshold, creditAmount };
  }

  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification =
      (formData.get("identification") as string)?.trim() || "";
    const first_name = (formData.get("first_name") as string)?.trim() || "";
    const last_name = (formData.get("last_name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";
    const profession = (formData.get("profession") as string)?.trim() || "";
    const adresse = (formData.get("adresse") as string)?.trim() || "";

    if (!id) return { error: "ID manquant" };

    const result = await updateMetaobjectEntry(admin, id, {
      identification,
      first_name,
      last_name,
      email,
      code,
      montant: parseFloat(montantStr),
      type,
      profession,
      adresse,
    });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_updated");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur mise à jour" };
  }

  if (actionType === "delete_entry") {
    const id = formData.get("id") as string;
    const result = await deleteMetaobjectEntry(admin, id);

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_deleted");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur suppression" };
  }


  if (actionType === "bulk_delete_entries") {
    const idsRaw = formData.get("ids") as string;
    const ids = idsRaw ? idsRaw.split(",").filter(Boolean) : [];
    for (const id of ids) {
      await deleteMetaobjectEntry(admin, id);
    }
    const url = new URL(request.url);
    url.searchParams.set("success", "entry_deleted");
    return redirect(url.pathname + url.search);
  }

  if (actionType === "import_file") {
    console.log("📂 Démarrage Import Fichier...");
    const file = formData.get("file") as File;
    if (!file || file.size === 0) return { error: "Aucun fichier fourni." };

    try {
      const buffer = await file.arrayBuffer();
      // On lit le buffer avec XLSX
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const items: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      console.log(`📂 Fichier lu. ${items.length} lignes trouvées.`);

      // Récupération des existants pour éviter doublons (Codes et Refs internes)
      const existingResult = await getMetaobjectEntries(admin);
      const existingCodes = new Set(
        existingResult.entries.map((e: any) => e.code?.toLowerCase().trim()),
      );
      const existingRefs = new Set(
        existingResult.entries.map((e: any) =>
          e.identification?.toLowerCase().trim(),
        ),
      );

      let added = 0;
      let skipped = 0;
      let duplicates: string[] = [];
      let errors: string[] = [];

      // Nettoyage: Encodage + Suppression des sauts de ligne (interdits par Shopify)
      const cleanInput = (str: string) => {
        let res = str;
        try {
          if (res.includes("Ã©") || res.includes("Ã¨") || res.includes("Ã")) {
            res = decodeURIComponent(escape(res));
          }
        } catch (e) {}
        // Remplace les retours à la ligne par des espaces pour éviter l'erreur "single line text string"
        return res.replace(/[\r\n]+/g, " ").trim();
      };

      // Traitement Séquentiel
      for (const item of items) {
        // Normalisation des clés : On enlève les accents pour matcher "Prénom" avec "prenom"
        // On crée une map qui contient à la fois la clé brute, et la clé sans accent
        const keys = Object.keys(item).reduce((acc: any, key) => {
          const val = item[key];
          // Clé 1: minuscules + trim (ex: "prénom nom")
          acc[key.toLowerCase().trim()] = val;
          // Clé 2: sans accents (ex: "prenom nom")
          const noAccentKey = key
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
          acc[noAccentKey] = val;
          return acc;
        }, {});

        // Mapping intelligent des colonnes (Compatible avec vos en-têtes exacts)
        let ref = cleanInput(
          String(
            keys["ref interne"] ||
              keys.ref ||
              keys.reference ||
              keys.id ||
              keys.identification ||
              "",
          ),
        );
        // Support colonnes séparées Prénom / Nom, et fallback colonne combinée
        const combinedName = cleanInput(
          String(keys["prénom nom"] || keys["prenom nom"] || ""),
        );
        let first_name = cleanInput(
          String(keys.prénom || keys.prenom || keys["first name"] || keys.firstname || ""),
        );
        let last_name = cleanInput(
          String(keys.nom || keys.name || keys["last name"] || keys.lastname || ""),
        );
        // Si colonnes séparées vides mais colonne combinée présente, on découpe
        if (!first_name && !last_name && combinedName) {
          const parts = combinedName.split(" ");
          first_name = parts[0] || "";
          last_name = parts.slice(1).join(" ") || "";
        }
        const displayName = `${first_name} ${last_name}`.trim() || "Sans nom";

        const email = String(
          keys.email || keys.mail || keys.courriel || "",
        ).trim();
        const code = String(
          keys.code || keys["code promo"] || keys.promo || "",
        ).trim();

        const montantRaw = keys.montant || keys.amount || keys.valeur || "0";
        const typeRaw = String(keys.type || "%");

        const profession = cleanInput(
          String(
            keys.profession || keys.job || keys.métier || keys.metier || "",
          ),
        );
        const adresse = cleanInput(
          String(keys.adresse || keys.address || keys.ville || ""),
        );

        // Vérif données minimales — si pas de ref, on en génère une automatiquement
        if (!ref) {
          if (!first_name && !last_name && !email && !code) continue;
          const prefix = ((first_name.slice(0, 2) + last_name.slice(0, 2)).toUpperCase() || "XX");
          ref = `${prefix}${Date.now().toString(36).slice(-4).toUpperCase()}`;
        }
        if ((!first_name && !last_name) || !email || !code) {
          errors.push(
            `Données incomplètes pour Ref ${ref} : ${(!first_name && !last_name) ? "Nom manquant" : ""} ${!email ? "Email manquant" : ""} ${!code ? "Code manquant" : ""}`,
          );
          continue;
        }

        // Vérification doublons stricte (Ref ou Code)
        if (existingCodes.has(code.toLowerCase())) {
          skipped++;
          duplicates.push(`${displayName} (Code existant: ${code})`);
          continue;
        }
        if (existingRefs.has(ref.toLowerCase())) {
          skipped++;
          duplicates.push(`${displayName} (Ref existante: ${ref})`);
          continue;
        }

        // Préparation des valeurs
        const montant = parseFloat(String(montantRaw).replace(",", "."));
        const type =
          typeRaw.includes("€") || typeRaw.toLowerCase().includes("eur")
            ? "€"
            : "%";

        console.log(`➕ Import en cours : ${displayName} (${code})`);

        // Appel de création
        const result = await createMetaobjectEntry(admin, {
          identification: ref,
          first_name,
          last_name,
          email,
          code,
          montant,
          type,
          profession,
          adresse,
        });

        if (result.success) {
          added++;
          existingCodes.add(code.toLowerCase());
          existingRefs.add(ref.toLowerCase());
        } else {
          let niceError = String(result.error);
          if (niceError.includes("single line text string")) {
            niceError =
              "Format invalide (Sauts de ligne interdits). L'adresse ou la profession doit être sur une seule ligne.";
          }
          errors.push(`Erreur pour ${name} : ${niceError}`);
        }
      }

      return {
        success: "import_completed",
        report: { added, skipped, duplicates, errors },
      };
    } catch (e) {
      console.error("Erreur Import:", e);
      return { error: "Erreur lecture fichier : " + String(e) };
    }
  }

  if (actionType === "api_create_partner") {
    const identification = String(formData.get("identification"));
    const first_name = String(formData.get("first_name") || "");
    const last_name = String(formData.get("last_name") || "");
    const email = String(formData.get("email"));
    const code = String(formData.get("code"));
    const montant = parseFloat(String(formData.get("montant")));
    const type = String(formData.get("type"));
    const profession = String(formData.get("profession") || "");
    const adresse = String(formData.get("adresse") || "");

    const result = await createMetaobjectEntry(admin, {
      identification,
      first_name,
      last_name,
      email,
      code,
      montant,
      type,
      profession,
      adresse,
    });

    // Retour direct pour RR7
    return result;
  }

  return { error: "Action inconnue" };
};

// --- COMPOSANT SPINNER ---
const Spinner = ({
  color = "white",
  size = "16px",
}: {
  color?: string;
  size?: string;
}) => (
  <div
    style={{
      width: size,
      height: size,
      border: `2px solid rgba(0,0,0,0.1)`,
      borderTop: `2px solid ${color}`,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      display: "inline-block",
    }}
  >
    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
  </div>
);


// --- FOCUS TRAP HOOK ---
function useFocusTrap(containerRef: React.RefObject<HTMLDivElement | null>, isActive: boolean, onEscape?: () => void) {
  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;
    const sel = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(sel));
    focusable[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onEscape?.(); return; }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps
}

// --- COMPOSANT LIGNE (ROW) ---
const EntryRow = memo(function EntryRow({
  entry,
  index,
  isLocked,
}: {
  entry: any;
  index: number;
  isLocked: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const nav = useNavigation();

  const isUpdatingThis =
    nav.formData?.get("action") === "update_entry" &&
    nav.formData?.get("id") === entry.id;
  const isDeletingThis =
    nav.formData?.get("action") === "delete_entry" &&
    nav.formData?.get("id") === entry.id;
  const isBusy = isUpdatingThis || isDeletingThis;

  const getInitialFormData = () => ({
    identification: entry.identification || "",
    first_name: entry.first_name || "",
    last_name: entry.last_name || "",
    email: entry.email || "",
    code: entry.code || "",
    montant: entry.montant !== undefined ? String(entry.montant) : "",
    type: entry.type || "%",
    profession: entry.profession || "",
    adresse: entry.adresse || "",
  });

  const [formData, setFormData] = useState(getInitialFormData);

  useEffect(() => {
    if (searchParams.get("success") === "entry_updated") setIsEditing(false);
  }, [searchParams]);

  const handleSave = () => {
    submit(
      { action: "update_entry", id: entry.id, ...formData },
      { method: "post" },
    );
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData(getInitialFormData());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  };

  const bgStandard = index % 2 === 0 ? "white" : "#fafafa";
  const bgPromo = index % 2 === 0 ? "#f7fbf9" : "#eef6f3";

  return (
    <tr style={{ opacity: isBusy ? 0.5 : 1 }}>
      <td className="tbl-cell tbl-cell--id" style={{ backgroundColor: bgStandard }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>

      {isEditing ? (
        <>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="text" value={formData.identification} onChange={(e) => setFormData({ ...formData, identification: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" placeholder="ID" />
          </td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="text" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" placeholder="Prénom" />
          </td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="text" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" placeholder="Nom" />
          </td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" />
          </td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="text" value={formData.profession} onChange={(e) => setFormData({ ...formData, profession: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" placeholder="Profession" />
          </td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>
            <input disabled={isBusy} type="text" value={formData.adresse} onChange={(e) => setFormData({ ...formData, adresse: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" placeholder="Adresse" />
          </td>

          <td className="tbl-cell--promo tbl-cell--sep-left" style={{ backgroundColor: bgPromo }}>
            <input disabled={isBusy} type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" />
          </td>
          <td className="tbl-cell--promo tbl-cell--promo-sm" style={{ backgroundColor: bgPromo }}>
            <input disabled={isBusy} type="number" step="0.01" value={formData.montant} onChange={(e) => setFormData({ ...formData, montant: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input" />
          </td>
          <td className="tbl-cell--promo tbl-cell--promo-sm" style={{ backgroundColor: bgPromo }}>
            <select disabled={isBusy} value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} onKeyDown={handleKeyDown} className="tbl-input">
              <option value="%">%</option>
              <option value="€">€</option>
            </select>
          </td>

          <td className="tbl-cell tbl-cell--actions-edit tbl-cell--sep-left" style={{ backgroundColor: bgStandard }}>
            <div className="tbl-actions-group">
              <button type="button" onClick={handleSave} disabled={isBusy} className="tbl-btn-action" style={{ backgroundColor: "#008060", color: "white" }} title="Enregistrer">
                {isUpdatingThis ? <Spinner /> : "✓"}
              </button>
              <button type="button" onClick={handleCancel} disabled={isBusy} className="tbl-btn-action" style={{ backgroundColor: "white", color: "#333", border: "1px solid #ddd" }} title="Annuler">
                ✕
              </button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>{entry.identification}</td>
          <td className="tbl-cell tbl-cell--name" style={{ backgroundColor: bgStandard }}>{entry.first_name}</td>
          <td className="tbl-cell tbl-cell--name" style={{ backgroundColor: bgStandard }}>{entry.last_name}</td>
          <td className="tbl-cell" style={{ backgroundColor: bgStandard }}>{entry.email}</td>
          <td className="tbl-cell tbl-cell--profession" style={{ backgroundColor: bgStandard }}>{entry.profession || "-"}</td>
          <td className="tbl-cell tbl-cell--adresse" style={{ backgroundColor: bgStandard }}>{entry.adresse || "-"}</td>

          <td className="tbl-cell--promo tbl-cell--sep-left" style={{ backgroundColor: bgPromo }}>
            <span className="tbl-code-badge">{entry.code}</span>
          </td>
          <td className="tbl-cell--promo" style={{ backgroundColor: bgPromo }}>{entry.montant}</td>
          <td className="tbl-cell--promo" style={{ backgroundColor: bgPromo }}>{entry.type}</td>

          <td className="tbl-cell--promo tbl-cell--sep-left" style={{ backgroundColor: bgStandard }}>
            <div className="tbl-actions-group">
              <button
                type="button"
                disabled={isBusy || isLocked}
                onClick={() => setIsEditing(true)}
                className="tbl-btn-action"
                style={{ backgroundColor: isLocked ? "#f4f6f8" : "white", border: "1px solid #ccc", color: isLocked ? "#ccc" : "#555", cursor: isLocked ? "not-allowed" : "pointer" }}
                title={isLocked ? "Verrouillé" : "Modifier"}
              >
                ✎
              </button>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (isLocked) { e.preventDefault(); return; }
                  const confirm1 = confirm("ATTENTION : \n\nVous allez supprimer ce partenaire et son code promo. Continuer ?");
                  if (!confirm1) { e.preventDefault(); return; }
                }}
              >
                <input type="hidden" name="action" value="delete_entry" />
                <input type="hidden" name="id" value={entry.id} />
                <button
                  type="submit"
                  disabled={isBusy || isLocked}
                  className="tbl-btn-action"
                  style={{ backgroundColor: isLocked ? "#f4f6f8" : "#fff0f0", border: isLocked ? "1px solid #eee" : "1px solid #fcc", color: isLocked ? "#ccc" : "#d82c0d", cursor: isLocked ? "not-allowed" : "pointer" }}
                  title={isLocked ? "Verrouillé" : "Supprimer"}
                >
                  {isDeletingThis ? <Spinner color="#d82c0d" /> : "🗑"}
                </button>
              </Form>
            </div>
          </td>
        </>
      )}
    </tr>
  );
});

// --- FORMULAIRE NOUVELLE ENTRÉE ---
function NewEntryForm() {
  const [formData, setFormData] = useState({
    identification: "",
    first_name: "",
    last_name: "",
    email: "",
    code: "",
    montant: "",
    type: "%",
    profession: "",
    adresse: "",
  });
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const nav = useNavigation();

  const isCreating = nav.formData?.get("action") === "create_entry";

  useEffect(() => {
    if (searchParams.get("success") === "entry_created") {
      setFormData({
        identification: "",
        first_name: "",
        last_name: "",
        email: "",
        code: "",
        montant: "",
        type: "%",
        profession: "",
        adresse: "",
      });
    }
  }, [searchParams]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    submit({ action: "create_entry", ...formData }, { method: "post" });
  };

  return (
    <tr className="tbl-row--new">
      <td className="tbl-cell tbl-cell--new-label">Nouveau</td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="text" name="identification" placeholder="Ref *" required value={formData.identification} onChange={(e) => setFormData({ ...formData, identification: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="text" name="first_name" placeholder="Prénom *" required value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="text" name="last_name" placeholder="Nom *" required value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="email" name="email" placeholder="Email *" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="text" name="profession" placeholder="Profession" value={formData.profession} onChange={(e) => setFormData({ ...formData, profession: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell">
        <input disabled={isCreating} type="text" name="adresse" placeholder="Adresse" value={formData.adresse} onChange={(e) => setFormData({ ...formData, adresse: e.target.value })} className="tbl-input" />
      </td>

      <td className="tbl-cell--promo tbl-cell--sep-left" style={{ borderLeftColor: "#b8d0eb" }}>
        <input disabled={isCreating} type="text" name="code" placeholder="Code *" required value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell--promo tbl-cell--promo-sm">
        <input disabled={isCreating} type="number" step="0.01" name="montant" placeholder="Val *" required value={formData.montant} onChange={(e) => setFormData({ ...formData, montant: e.target.value })} className="tbl-input" />
      </td>
      <td className="tbl-cell--promo tbl-cell--promo-sm">
        <select disabled={isCreating} name="type" required value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="tbl-input">
          <option value="%">%</option>
          <option value="€">€</option>
        </select>
      </td>
      <td className="tbl-cell--promo tbl-cell--actions-edit tbl-cell--sep-left" style={{ borderLeftColor: "#b8d0eb" }}>
        <button type="button" disabled={isCreating} onClick={handleAdd} className="tbl-add-btn">
          {isCreating ? <><Spinner /> ...</> : "Ajouter"}
        </button>
      </td>
    </tr>
  );
}

// --- COMPOSANT IMPORT RESULT ---
function ImportResult({ report }: { report: any }) {
  if (!report) return null;
  return (
    <div className="import-result">
      <div className="import-result__header">
        <span className="import-result__title">Rapport d&apos;import</span>
        <div className="import-result__stats">
          <div className="import-result__stat--added">✅ {report.added} importés</div>
          <div className="import-result__stat--skipped">⚠️ {report.skipped} doublons</div>
          {report.errors.length > 0 && (
            <div className="import-result__stat--error">❌ {report.errors.length} erreurs</div>
          )}
        </div>
      </div>

      {report.duplicates.length > 0 && (
        <details className="import-result__details">
          <summary className="import-result__summary">
            Voir les doublons ({report.duplicates.length})
          </summary>
          <ul className="import-result__list">
            {report.duplicates.map((d: string, i: number) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      {report.errors.length > 0 && (
        <details open>
          <summary className="import-result__summary--error">
            Voir les erreurs ({report.errors.length})
          </summary>
          <ul className="import-result__list--error">
            {report.errors.map((e: string, i: number) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// --- FORMULAIRE D'IMPORT ---
// --- FORMULAIRE D'IMPORT ---
// --- FORMULAIRE D'IMPORT (Client-Side Logic pour barre de progression) ---
function ImportForm({ existingEntries, onClose }: { existingEntries: any[]; onClose: () => void }) {
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<any[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0); // Nombre traités
  const [totalToProcess, setTotalToProcess] = useState(0);

  const [report, setReport] = useState<any>(null);

  // Helper de nettoyage (identique au serveur)
  const cleanInput = (str: string) => {
    let res = str;
    try {
      if (res.includes("Ã©") || res.includes("Ã¨") || res.includes("Ã")) {
        res = decodeURIComponent(escape(res)); // Réparation encodage
      }
    } catch (e) {}
    return res.replace(/[\r\n]+/g, " ").trim(); // Suppression sauts de ligne
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileCount(null);
      setFileName(null);
      setParsedItems([]);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      setFileCount(json.length);
      setFileName(file.name);
      setParsedItems(json);
      setReport(null); // Reset report
    } catch (err) {
      console.error("Erreur lecture pré-import", err);
      setFileCount(null);
    }
  };

  const runImport = async () => {
    if (!parsedItems.length) return;

    setIsProcessing(true);
    setReport(null);

    let added = 0;
    let skipped = 0;
    let duplicates: string[] = [];
    let errors: string[] = [];

    // Préparation Sets Locaux pour check rapide
    const existingCodes = new Set(
      existingEntries.map((e: any) => e.code?.toLowerCase().trim()),
    );
    const existingRefs = new Set(
      existingEntries.map((e: any) => e.identification?.toLowerCase().trim()),
    );

    const itemsToProcess = [];

    // 1. Parsing & Filtrage Local
    for (const item of parsedItems) {
      const keys = Object.keys(item).reduce((acc: any, key) => {
        const val = item[key];
        const cleanKey = key
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
        acc[cleanKey] = val;
        // mapping fallback pour vieux formats
        acc[key.toLowerCase().trim()] = val;
        return acc;
      }, {});

      let ref = cleanInput(
        String(
          keys["ref interne"] ||
            keys.ref ||
            keys.reference ||
            keys.id ||
            keys.identification ||
            "",
        ),
      );
      // Support colonnes séparées Prénom / Nom, et fallback colonne combinée
      const combinedName = cleanInput(
        String(keys["prénom nom"] || keys["prenom nom"] || ""),
      );
      let first_name = cleanInput(
        String(keys.prénom || keys.prenom || keys["first name"] || keys.firstname || ""),
      );
      let last_name = cleanInput(
        String(keys.nom || keys.name || keys["last name"] || keys.lastname || ""),
      );
      if (!first_name && !last_name && combinedName) {
        const parts = combinedName.split(" ");
        first_name = parts[0] || "";
        last_name = parts.slice(1).join(" ") || "";
      }
      const displayName = `${first_name} ${last_name}`.trim() || "Sans nom";

      const email = String(
        keys.email || keys.mail || keys.courriel || "",
      ).trim();
      const code = String(
        keys.code || keys["code promo"] || keys.promo || "",
      ).trim();

      const montantRaw = keys.montant || keys.amount || keys.valeur || "0";
      const typeRaw = String(keys.type || "%");
      const montant = parseFloat(String(montantRaw).replace(",", "."));
      const type =
        typeRaw.includes("€") || typeRaw.toLowerCase().includes("eur")
          ? "€"
          : "%";

      const profession = cleanInput(
        String(keys.profession || keys.job || keys.métier || keys.metier || ""),
      );
      const adresse = cleanInput(
        String(keys.adresse || keys.address || keys.ville || ""),
      );

      // Validations de base — si pas de ref, on en génère une automatiquement
      if (!ref) {
        if (!first_name && !last_name && !email && !code) continue;
        const prefix = ((first_name.slice(0, 2) + last_name.slice(0, 2)).toUpperCase() || "XX");
        ref = `${prefix}${Date.now().toString(36).slice(-4).toUpperCase()}`;
      }
      if (existingCodes.has(code.toLowerCase())) {
        skipped++;
        duplicates.push(`${displayName} (Code existant: ${code})`);
        continue;
      }
      if (existingRefs.has(ref.toLowerCase())) {
        skipped++;
        duplicates.push(`${displayName} (Ref existante: ${ref})`);
        continue;
      }

      itemsToProcess.push({
        identification: ref,
        first_name,
        last_name,
        email,
        code,
        montant,
        type,
        profession,
        adresse,
      });
    }

    setTotalToProcess(itemsToProcess.length);
    setProgress(0);

    // 2. Envoi par Batch (5 items en parallèle pour optimiser)
    const BATCH_SIZE = 5;
    for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
      const batch = itemsToProcess.slice(i, i + BATCH_SIZE);

      // Traitement parallèle du batch
      const batchPromises = batch.map(async (item) => {
        const fd = new FormData();
        fd.append("action", "api_create_partner");
        Object.keys(item).forEach((k) => fd.append(k, (item as any)[k]));

        try {
          const res = await fetch("/app/api/import", {
            method: "POST",
            body: fd,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 50)}...`);
          }

          const json = await res.json();

          if (json.success) {
            added++;
            existingCodes.add(item.code.toLowerCase());
            existingRefs.add(item.identification.toLowerCase());
            return { success: true, item };
          } else {
            let niceError = String(json.error);
            if (niceError.includes("single line text string"))
              niceError = "Format invalide (Sauts de ligne).";
            const itemName = `${(item as any).first_name || ""} ${(item as any).last_name || ""}`.trim() || item.identification;
            errors.push(`Erreur pour ${itemName} : ${niceError}`);
            return { success: false, item, error: niceError };
          }
        } catch (e) {
          const itemName = `${(item as any).first_name || ""} ${(item as any).last_name || ""}`.trim() || item.identification;
          errors.push(`Erreur réseau pour ${itemName} : ${String(e)}`);
          return { success: false, item, error: String(e) };
        }
      });

      // Attendre que tout le batch soit terminé
      await Promise.all(batchPromises);

      // Mise à jour de la progression après chaque batch
      setProgress(Math.min(i + BATCH_SIZE, itemsToProcess.length));

      // Petit délai entre les batchs pour respecter les rate limits Shopify
      if (i + BATCH_SIZE < itemsToProcess.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    setIsProcessing(false);
    setReport({ added, skipped, duplicates, errors });

    // Retourner un flag pour que le composant parent revalide
    return added;
  };

  const revalidator = useRevalidator();

  const handleImportClick = async () => {
    const addedCount = await runImport();
    // Revalider les données au lieu de recharger la page
    if (addedCount && addedCount > 0) {
      revalidator.revalidate();
    }
  };

  // Clavier : Escape = fermer, Enter = importer (si fichier prêt)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && !isProcessing && fileCount) {
        handleImportClick();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isProcessing, fileCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="bsl-modal__body--import">
        {report && <ImportResult report={report} />}

        <p className="import-form__desc">
          Importez une liste de partenaires depuis un fichier Excel (.xlsx, .xls) ou CSV.
          <br />
          <em className="import-form__hint">
            Format attendu : <strong>Nom<span style={{ color: "#e53e3e" }}>*</span>, Email<span style={{ color: "#e53e3e" }}>*</span>, Code<span style={{ color: "#e53e3e" }}>*</span>, Montant<span style={{ color: "#e53e3e" }}>*</span>, Type<span style={{ color: "#e53e3e" }}>*</span></strong>, Profession, Adresse.<br />
            <span style={{ color: "#e53e3e" }}>* champs obligatoires</span><br />
            Traitement optimisé par batch de 5 items.
          </em>
        </p>

        <div className="import-form__file-row">
          <label className={`import-form__file-label${isProcessing ? " import-form__file-label--disabled" : ""}`}>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              disabled={isProcessing}
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            Choisir un fichier
          </label>
          {fileName && (
            <span className="import-form__file-name">
              {fileName}
            </span>
          )}
        </div>
      </div>

      <div className="bsl-modal__footer">
        <button
          type="button"
          onClick={onClose}
          className="bsl-modal__btn bsl-modal__btn--cancel"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={isProcessing || !fileCount}
          className="bsl-modal__btn bsl-modal__btn--primary"
          style={{
            background: isProcessing || !fileCount ? "var(--color-gray-300)" : "#008060",
            cursor: isProcessing || !fileCount ? "not-allowed" : "pointer",
            color: isProcessing || !fileCount ? "var(--color-gray-500)" : "white",
            opacity: !fileCount && !isProcessing ? 0.6 : 1,
          }}
        >
          {isProcessing ? (
            <><Spinner /> Traitement {progress} / {totalToProcess}</>
          ) : (
            <>⚡ {fileCount !== null ? `Importer (${fileCount})` : "Importer"}</>
          )}
        </button>
      </div>
    </>
  );
}

// --- HELPER: Generate unique promo code ---
function generatePromoCode(
  firstName: string,
  lastName: string,
  prefix: string,
  existingCodes: Set<string>,
): string {
  const lastPart = lastName.slice(0, 2).toUpperCase() || "XX";
  const firstPart = firstName.slice(0, 2).toUpperCase() || "XX";
  let baseCode = `${prefix}${lastPart}${firstPart}`;

  let finalCode = baseCode;
  let counter = 1;
  while (existingCodes.has(finalCode)) {
    finalCode = `${baseCode}${counter}`;
    counter++;
  }

  return finalCode;
}

// --- PARTNER MODAL (Create / Edit) ---
function PartnerModal({ mode, entry, onClose, entries }: { mode: "create" | "edit"; entry?: any; onClose: () => void; entries?: any[] }) {
  const isEdit = mode === "edit";
  const submitFn = useSubmit();
  const nav = useNavigation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);
  const [searchParams] = useSearchParams();

  // Load validation defaults for auto-code generation
  const getInitialFormData = () => {
    if (isEdit) {
      return {
        identification: entry?.identification || "",
        first_name: entry?.first_name || "",
        last_name: entry?.last_name || "",
        email: entry?.email || "",
        code: entry?.code || "",
        montant: entry?.montant !== undefined ? String(entry.montant) : "",
        type: entry?.type || "%",
        profession: entry?.profession || "",
        adresse: entry?.adresse || "",
      };
    }

    // For new partners, load defaults and auto-generate code
    let valDefaults = { value: 5, type: "%", codePrefix: "PRO_" };
    try {
      const stored = localStorage.getItem("validation_defaults");
      if (stored) valDefaults = JSON.parse(stored);
    } catch {}

    const existingCodes = new Set((entries || []).map((e: any) => e.code));
    const autoCode = generatePromoCode("", "", valDefaults.codePrefix, existingCodes);

    return {
      identification: "",
      first_name: "",
      last_name: "",
      email: "",
      code: autoCode,
      montant: String(valDefaults.value),
      type: valDefaults.type,
      profession: "",
      adresse: "",
    };
  };

  const [fd, setFd] = useState(getInitialFormData());
  const [hasManuallyEditedCode, setHasManuallyEditedCode] = useState(false);

  const isBusy = isEdit
    ? nav.formData?.get("action") === "update_entry" && nav.formData?.get("id") === entry?.id
    : nav.formData?.get("action") === "create_entry";

  useEffect(() => {
    const key = isEdit ? "entry_updated" : "entry_created";
    if (searchParams.get("success") === key) onClose();
  }, [searchParams, isEdit, onClose]);

  // Auto-regenerate code when name changes (only for new partners and if not manually edited)
  useEffect(() => {
    if (!isEdit && !hasManuallyEditedCode && (fd.first_name || fd.last_name)) {
      let valDefaults = { value: 5, type: "%", codePrefix: "PRO_" };
      try {
        const stored = localStorage.getItem("validation_defaults");
        if (stored) valDefaults = JSON.parse(stored);
      } catch {}

      const existingCodes = new Set((entries || []).map((e: any) => e.code));
      const newCode = generatePromoCode(fd.first_name, fd.last_name, valDefaults.codePrefix, existingCodes);

      if (newCode !== fd.code) {
        setFd((prev) => ({ ...prev, code: newCode }));
      }
    }
  }, [fd.first_name, fd.last_name, isEdit, entries, fd.code, hasManuallyEditedCode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && !isBusy) {
        const tag = (document.activeElement as HTMLElement)?.tagName?.toUpperCase();
        if (tag !== "SELECT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
          if (isEdit) {
            submitFn({ action: "update_entry", id: entry.id, ...fd }, { method: "post" });
          } else {
            submitFn({ action: "create_entry", ...fd }, { method: "post" });
          }
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isBusy, fd, isEdit, entry, submitFn]);

  const handleSubmit = () => {
    if (isEdit) {
      submitFn({ action: "update_entry", id: entry.id, ...fd }, { method: "post" });
    } else {
      submitFn({ action: "create_entry", ...fd }, { method: "post" });
    }
  };

  return (
    <div role="presentation" className="bsl-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Partenaire" className="bsl-modal__dialog bsl-modal__dialog--md">
        <div className="bsl-modal__header">
          <h2 className="bsl-modal__title">
            {isEdit ? "Modifier le Partenaire" : "Nouveau Partenaire"}
          </h2>
          <button type="button" onClick={onClose} className="bsl-modal__close">✕</button>
        </div>
        <div className="bsl-modal__body">
          <div className="bsl-modal__grid2">
            <div>
              <label className="bsl-modal__label">Prénom *</label>
              <input className="bsl-modal__input" placeholder="Prénom" value={fd.first_name} onChange={(e) => setFd({ ...fd, first_name: e.target.value })} disabled={isBusy} />
            </div>
            <div>
              <label className="bsl-modal__label">Nom *</label>
              <input className="bsl-modal__input" placeholder="Nom" value={fd.last_name} onChange={(e) => setFd({ ...fd, last_name: e.target.value })} disabled={isBusy} />
            </div>
          </div>
          <div>
            <label className="bsl-modal__label">Email *</label>
            <input className="bsl-modal__input" type="email" placeholder="email@exemple.com" value={fd.email} onChange={(e) => setFd({ ...fd, email: e.target.value })} disabled={isBusy} />
          </div>
          <div>
            <label className="bsl-modal__label">Adresse</label>
            <input className="bsl-modal__input" placeholder="Ville, Code postal..." value={fd.adresse} onChange={(e) => setFd({ ...fd, adresse: e.target.value })} disabled={isBusy} />
          </div>
          <div>
            <label className="bsl-modal__label">Profession</label>
            <input className="bsl-modal__input" placeholder="Ex: Médecin généraliste" value={fd.profession} onChange={(e) => setFd({ ...fd, profession: e.target.value })} disabled={isBusy} />
          </div>
          <div className="bsl-modal__promo-section">
            <div>
              <label className="bsl-modal__label">Code Promo *</label>
              <input className="bsl-modal__input bsl-modal__input--code" placeholder="Ex: MEDECIN10" value={fd.code} onChange={(e) => { setFd({ ...fd, code: e.target.value.toUpperCase() }); setHasManuallyEditedCode(true); }} disabled={isBusy} />
            </div>
            <div className="bsl-modal__grid2">
              <div>
                <label className="bsl-modal__label">Montant *</label>
                <input className="bsl-modal__input" type="number" placeholder="10" value={fd.montant} onChange={(e) => setFd({ ...fd, montant: e.target.value })} disabled={isBusy} />
              </div>
              <div>
                <label className="bsl-modal__label">Type</label>
                <select className="bsl-modal__input bsl-modal__select" value={fd.type} onChange={(e) => setFd({ ...fd, type: e.target.value })} disabled={isBusy}>
                  <option value="%">% (Pourcentage)</option>
                  <option value="€">€ (Montant fixe)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="bsl-modal__footer">
          <button type="button" onClick={onClose} className="bsl-modal__btn bsl-modal__btn--cancel">
            Annuler
          </button>
          <button type="button" onClick={handleSubmit} disabled={isBusy} className="bsl-modal__btn bsl-modal__btn--primary" style={{ opacity: isBusy ? 0.7 : 1 }}>
            {isBusy ? "En cours..." : isEdit ? "Sauvegarder" : "Créer le Partenaire"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- SORT ICON ---
function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" | null }) {
  if (!active) return (
    <svg className="sort-icon sort-icon--idle" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <path d="M5 0L9 5H1L5 0Z" opacity="0.35"/>
      <path d="M5 14L1 9H9L5 14Z" opacity="0.35"/>
    </svg>
  );
  if (dir === "asc") return (
    <svg className="sort-icon sort-icon--active" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <path d="M5 0L9 5H1L5 0Z"/>
      <path d="M5 14L1 9H9L5 14Z" opacity="0.25"/>
    </svg>
  );
  return (
    <svg className="sort-icon sort-icon--active" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <path d="M5 0L9 5H1L5 0Z" opacity="0.25"/>
      <path d="M5 14L1 9H9L5 14Z"/>
    </svg>
  );
}

// --- FONCTION D'EXPORT ---
function exportToExcel(entries: Array<{
  id: string;
  identification?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  code?: string;
  montant?: number;
  type?: string;
  profession?: string;
  adresse?: string;
  customer_id?: string;
  tags?: string[];
}>) {
  // Préparer les données pour l'export
  const exportData = entries.map((entry) => {
    // Séparer le nom complet en prénom et nom
    let firstName = "";
    let lastName = "";

    if (entry.first_name && entry.last_name) {
      firstName = entry.first_name;
      lastName = entry.last_name;
    } else if (entry.name) {
      const nameParts = entry.name.split(" ");
      firstName = nameParts[0] || "";
      lastName = nameParts.slice(1).join(" ") || "";
    }

    return {
      "Prénom": firstName,
      "Nom": lastName,
      "Email": entry.email || "",
      "Adresse": entry.adresse || "",
      "Profession": entry.profession || "",
      "Code": entry.code || "",
      "Montant": entry.montant || "",
      "Type": entry.type || "%",
    };
  });

  // Créer le workbook et la worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);

  // Définir la largeur des colonnes
  ws["!cols"] = [
    { wch: 15 }, // Prénom
    { wch: 15 }, // Nom
    { wch: 30 }, // Email
    { wch: 30 }, // Adresse
    { wch: 20 }, // Profession
    { wch: 15 }, // Code
    { wch: 10 }, // Montant
    { wch: 8 },  // Type
  ];

  // Ajouter la feuille au workbook
  XLSX.utils.book_append_sheet(wb, ws, "Partenaires");

  // Générer le fichier et le télécharger
  const today = new Date().toISOString().split("T")[0];
  const fileName = `partenaires_${today}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// --- PAGE PRINCIPALE ---
export default function Index() {
  const { status, entries, config: serverConfig, shopDomain } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigation();
  const successType = searchParams.get("success");

  // PAGINATION
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  const isInitializing = nav.formData?.get("action") === "create_structure";

  const [showImport, setShowImport] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const { showCodeBlock, setShowCodeBlock, showCABlock, setShowCABlock, isLocked, showToast, setConfig } = useEditMode();

  // Synchroniser le config serveur vers le context client (au chargement de la page)
  useEffect(() => {
    if (serverConfig && serverConfig.threshold && serverConfig.creditAmount) {
      setConfig({ threshold: serverConfig.threshold, creditAmount: serverConfig.creditAmount });
    }
  }, [serverConfig?.threshold, serverConfig?.creditAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (key: string) => {
    const labels: Record<string, string> = { name: "Nom", profession: "Profession", status: "État", orders: "Commandes", revenue: "CA généré" };
    setSortConfig(prev => {
      if (prev?.key === key) {
        if (prev.dir === "asc") {
          showToast({ title: "Tri décroissant", msg: `${labels[key] ?? key} — Z→A`, type: "info" });
          return { key, dir: "desc" };
        }
        showToast({ title: "Tri supprimé", msg: "Retour à l'ordre par défaut.", type: "info" });
        return null;
      }
      showToast({ title: "Tri croissant", msg: `${labels[key] ?? key} — A→Z`, type: "info" });
      return { key, dir: "asc" };
    });
  };

  const filteredEntries = useMemo(() => entries.filter(e => {
    const q = searchQuery.toLowerCase();
    return !q || [e.first_name, e.last_name, e.email, e.code, (e as { profession?: string }).profession].some(v => v && String(v).toLowerCase().includes(q));
  }), [entries, searchQuery]);

  const sortedEntries = useMemo(() => sortConfig ? [...filteredEntries].sort((a, b) => {
    const dir = sortConfig.dir === "asc" ? 1 : -1;
    switch (sortConfig.key) {
      case "name": {
        const na = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.name || "";
        const nb = [b.first_name, b.last_name].filter(Boolean).join(" ") || b.name || "";
        return dir * na.localeCompare(nb, "fr");
      }
      case "profession": {
        const pa = (a as any).profession || ""; // eslint-disable-line @typescript-eslint/no-explicit-any
        const pb = (b as any).profession || ""; // eslint-disable-line @typescript-eslint/no-explicit-any
        return dir * pa.localeCompare(pb, "fr");
      }
      case "status": {
        const sa = ((a as any).status ?? true) ? 1 : 0; // eslint-disable-line @typescript-eslint/no-explicit-any
        const sb = ((b as any).status ?? true) ? 1 : 0; // eslint-disable-line @typescript-eslint/no-explicit-any
        return dir * (sa - sb);
      }
      case "orders": {
        const oa = parseInt((a as any).cache_orders_count || "0", 10); // eslint-disable-line @typescript-eslint/no-explicit-any
        const ob = parseInt((b as any).cache_orders_count || "0", 10); // eslint-disable-line @typescript-eslint/no-explicit-any
        return dir * (oa - ob);
      }
      case "revenue": {
        const ra = parseFloat((a as any).cache_revenue || "0"); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rb = parseFloat((b as any).cache_revenue || "0"); // eslint-disable-line @typescript-eslint/no-explicit-any
        return dir * (ra - rb);
      }
      default: return 0;
    }
  }) : filteredEntries, [filteredEntries, sortConfig]);

  const totalPages = Math.ceil(sortedEntries.length / itemsPerPage);
  const paginatedEntries = sortedEntries.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  useEffect(() => { setCurrentPage(1); }, [searchQuery]);
  const [searchShortcut, setSearchShortcut] = useState("Ctrl ⇧ K");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableBlockRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const codePromoThRef = useRef<HTMLTableCellElement>(null);
  const caThRef = useRef<HTMLTableCellElement>(null);
  const [badgeLeft, setBadgeLeft] = useState<{ code: number; ca: number } | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{ id: string; x: number; y: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [partnerModal, setPartnerModal] = useState<{ mode: "create" | "edit"; entry?: any } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string; ids?: string[]; count?: number } | null>(null);
  const deleteModalRef = useRef<HTMLDivElement>(null);
  const importModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(deleteModalRef, !!deleteModal, () => setDeleteModal(null));
  useFocusTrap(importModalRef, showImport, () => setShowImport(false));

  const submit = useSubmit();

  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    setSearchShortcut(isMac ? "⌘ ⇧ K" : "Ctrl ⇧ K");
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setBadgeLeft(null);
    const compute = () => {
      const block = tableBlockRef.current;
      const scroll = tableScrollRef.current;
      if (!block) return;
      const bLeft = block.getBoundingClientRect().left;
      const scrollLeft = scroll?.scrollLeft ?? 0;
      const next = { code: 0, ca: 0 };
      if (codePromoThRef.current)
        next.code = codePromoThRef.current.getBoundingClientRect().left - bLeft + scrollLeft;
      if (caThRef.current)
        next.ca = caThRef.current.getBoundingClientRect().left - bLeft + scrollLeft;
      setBadgeLeft(next);
    };
    // requestAnimationFrame garantit que le DOM est peint avant de mesurer
    const raf = requestAnimationFrame(compute);
    window.addEventListener("resize", compute);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", compute); };
  }, [showCodeBlock, showCABlock]);

  const handleDeleteEntry = (id: string, name: string) => {
    setDeleteModal({ id, name });
  };

  const confirmDelete = () => {
    if (!deleteModal) return;
    if (deleteModal.ids && deleteModal.ids.length > 0) {
      submit({ action: "bulk_delete_entries", ids: deleteModal.ids.join(",") }, { method: "post" });
      setSelectedIds(new Set());
    } else {
      submit({ action: "delete_entry", id: deleteModal.id }, { method: "post" });
    }
    setDeleteModal(null);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteModal({ id: "", name: "", ids: Array.from(selectedIds), count: selectedIds.size });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedIds(new Set(entries.map((e) => e.id)));
    else setSelectedIds(new Set());
  };
  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Toast : messages depuis URL params (après redirect serveur)
  useEffect(() => {
    if (!successType) return;
    const msgs: Record<string, [string, string]> = {
      entry_created: ["Partenaire ajouté", "Code promo créé avec succès."],
      entry_updated: ["Partenaire mis à jour", "Informations synchronisées."],
      entry_deleted: ["Supprimé", "Pro supprimé et nettoyé."],
      structure_created: ["Initialisé", "Application prête à l'emploi."],
      structure_deleted: ["Reset effectué", "Tout a été effacé."],
      config_updated: ["Réglages sauvegardés", "Paramètres de crédit mis à jour."],
      status_toggled: ["Statut mis à jour", "Le code promo a été modifié."],
    };
    const [title, msg] = msgs[successType] ?? ["Succès", "Action effectuée."];
    showToast({ title, msg, type: "success" });
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("success");
    setSearchParams(newParams, { replace: true });
  }, [successType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toast : messages depuis actionData (retours directs sans redirect)
  useEffect(() => {
    if (!actionData) return;
    if ((actionData as any).success === "import_completed") { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { added, skipped, duplicates, errors } = (actionData as any).report; // eslint-disable-line @typescript-eslint/no-explicit-any
      const hasErrors = errors?.length > 0;
      showToast({
        title: hasErrors ? "Import partiel" : "Import réussi",
        msg: `${added} ajouté(s), ${skipped} ignoré(s), ${duplicates} doublon(s)${hasErrors ? `, ${errors.length} erreur(s)` : ""}`,
        type: hasErrors ? "error" : "success",
      });
    } else if ((actionData as any).error) { // eslint-disable-line @typescript-eslint/no-explicit-any
      showToast({ title: "Erreur", msg: (actionData as any).error, type: "error" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete modal : Escape = fermer, Enter = confirmer
  useEffect(() => {
    if (!deleteModal) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDeleteModal(null); return; }
      if (e.key === "Enter" && !isLocked) {
        if (deleteModal.ids && deleteModal.ids.length > 0) {
          submit({ action: "bulk_delete_entries", ids: deleteModal.ids.join(",") }, { method: "post" });
          setSelectedIds(new Set());
        } else {
          submit({ action: "delete_entry", id: deleteModal.id }, { method: "post" });
        }
        setDeleteModal(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [deleteModal, isLocked, submit]);

  const thStyle = {
    padding: "12px",
    textAlign: "left" as const,
    fontSize: "0.8rem",
    textTransform: "uppercase" as const,
    color: "#888",
  };
  const thPromoStyle = {
    ...thStyle,
    textAlign: "center" as const,
    backgroundColor: "#f1f8f5",
    color: "#008060",
    borderBottom: "2px solid #e1e3e5",
  };
  const thPromoBorder = { borderLeft: "2px solid #e1e3e5" };
  const thActionStyle = {
    ...thStyle,
    textAlign: "center" as const,
    borderLeft: "2px solid #eee",
  };

  return (
    <div className="page-wrapper">
      {/* BANDEAU HEADER */}
      <div className="page-header">
        <h1 className="page-header__title">
          {showCABlock ? "Gestion Chiffre d'affaires" : showCodeBlock ? "Gestion Code Promo" : "Gestion des Pros de Santé"}
        </h1>

      </div>

      {/* MODALE IMPORT */}
      {showImport && (
        <div role="presentation" className="bsl-modal" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }} onKeyDown={(e) => e.key === "Escape" && setShowImport(false)}>
          <div ref={importModalRef} role="dialog" aria-modal="true" aria-label="Importer des Partenaires" className="bsl-modal__dialog bsl-modal__dialog--md">
            <div className="bsl-modal__header">
              <h2 className="bsl-modal__title">Importer des Partenaires</h2>
              <button type="button" onClick={() => setShowImport(false)} className="bsl-modal__close">✕</button>
            </div>
            <ImportForm existingEntries={entries} onClose={() => setShowImport(false)} />
          </div>
        </div>
      )}

      {status.exists ? (
        <div className="page-container" onClick={() => setContextMenuState(null)}>

          {/* PARTNER MODAL */}
          {partnerModal && (
            <PartnerModal
              mode={partnerModal.mode}
              entry={partnerModal.entry}
              onClose={() => setPartnerModal(null)}
              entries={entries}
            />
          )}

          {/* DELETE MODAL */}
          {deleteModal && (
            <div role="presentation" className="bsl-modal" onClick={(e) => { if (e.target === e.currentTarget) setDeleteModal(null); }} onKeyDown={(e) => e.key === "Escape" && setDeleteModal(null)}>
              <div ref={deleteModalRef} role="dialog" aria-modal="true" aria-label="Supprimer le partenaire" className="bsl-modal__dialog bsl-modal__dialog--sm">
                <div className="bsl-modal__header">
                  <h2 className="bsl-modal__title">
                    {deleteModal.ids ? `Supprimer ${deleteModal.count} partenaire${(deleteModal.count ?? 0) > 1 ? "s" : ""}` : "Supprimer le partenaire"}
                  </h2>
                  <button type="button" onClick={() => setDeleteModal(null)} className="bsl-modal__close">✕</button>
                </div>
                <div className="bsl-modal__body--text">
                  {deleteModal.ids
                    ? <>Vous êtes sur le point de supprimer <strong className="text-strong">{deleteModal.count} partenaire{(deleteModal.count ?? 0) > 1 ? "s" : ""}</strong>.<br /></>
                    : <>Vous êtes sur le point de supprimer <strong className="text-strong">{deleteModal.name}</strong>.<br /></>
                  }
                  Les codes promo seront supprimés et les tags retirés des clients. Cette action est irréversible.
                </div>
                <div className="bsl-modal__footer">
                  <button type="button" onClick={() => setDeleteModal(null)} className="bsl-modal__btn bsl-modal__btn--cancel">
                    Annuler
                  </button>
                  <button type="button" onClick={confirmDelete} disabled={isLocked} className="bsl-modal__btn bsl-modal__btn--danger" style={{ background: isLocked ? "var(--color-gray-300)" : undefined, cursor: isLocked ? "not-allowed" : "pointer", color: isLocked ? "var(--color-gray-500)" : undefined, opacity: isLocked ? 0.7 : 1 }}>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TOOLBAR */}
          <div className="toolbar">
            <button type="button" className="dev-toggle" onClick={(e) => { e.stopPropagation(); setShowCodeBlock(!showCodeBlock); if (!showCodeBlock) setShowCABlock(false); }}>
              <span className="dev-toggle__icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293l-7-7a1 1 0 00-1.414 0l-7 7A.997.997 0 002 10v5a3 3 0 003 3h5c.256 0 .512-.098.707-.293l7-7a1 1 0 000-1.414zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg></span>
              <span className="dev-toggle__label">Code Promo</span>
              <div className={`dev-toggle__switch${showCodeBlock ? " dev-toggle__switch--on" : ""}`}><div className="dev-toggle__switch-thumb" /></div>
            </button>
            <button type="button" className="dev-toggle" onClick={(e) => { e.stopPropagation(); setShowCABlock(!showCABlock); if (!showCABlock) setShowCodeBlock(false); }}>
              <span className="dev-toggle__icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg></span>
              <span className="dev-toggle__label">Chiffre d&apos;affaire</span>
              <div className={`dev-toggle__switch${showCABlock ? " dev-toggle__switch--on" : ""}`}><div className="dev-toggle__switch-thumb" /></div>
            </button>
            <div className="grow" />
            <div className="search-container">
              <div className="basilic-search">
                <div className="basilic-search__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </div>
                <input ref={searchInputRef} type="text" className="basilic-search__input" placeholder="Rechercher..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <div className="basilic-search__shortcut"><span className="basilic-search__shortcut-key">{searchShortcut}</span></div>
              </div>
            </div>
          </div>

          {/* TABLE CARD */}
          <div className="table-card">
            {/* Header */}
            <div className="table-card__header">
              <span className="table-card__title">Liste des Partenaires ({entries.length})</span>
              <div className="table-header-actions">
                <button
                  type="button"
                  className={`btn btn--secondary table-card__new-btn${showImport ? " btn--secondary-active" : ""}`}
                  onClick={() => setShowImport(!showImport)}
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Importer
                </button>
                <button
                  type="button"
                  className="btn btn--secondary table-card__new-btn"
                  onClick={() => exportToExcel(entries)}
                  disabled={entries.length === 0}
                  title="Exporter tous les partenaires en Excel"
                >
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  Exporter
                </button>
                <button
                  type="button"
                  className="btn table-card__new-btn"
                  onClick={(e) => { e.stopPropagation(); setPartnerModal({ mode: "create" }); }}
                >
                  + Nouveau
                </button>
              </div>
            </div>

            {/* Table */}
            <div ref={tableBlockRef} className={`table-block${(showCodeBlock || showCABlock) ? " table-block--padded" : ""}`}>
              {showCodeBlock && badgeLeft !== null && <div className="block-badge block-badge--green" style={{ left: `${badgeLeft.code}px` }}><svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg> Code Promo</div>}
              {showCABlock && badgeLeft !== null && <div className="block-badge block-badge--blue" style={{ left: `${badgeLeft.ca}px` }}><svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" /></svg> Chiffre d&apos;Affaires</div>}
              <div ref={tableScrollRef} className="table-scroll">
              <table className="ui-table" style={{ tableLayout: "fixed", width: "100%", minWidth: `${(showCodeBlock || showCABlock ? 272 : 532) + (showCodeBlock ? 550 : 0) + (showCABlock ? 550 : 0)}px` }}>
                <colgroup>
                  <col style={{ width: "40px" }} />
                  <col />
                  {!(showCodeBlock || showCABlock) && <col />}
                  {!(showCodeBlock || showCABlock) && <col />}
                  <col />
                  {!(showCodeBlock || showCABlock) && <col style={{ width: "60px" }} />}
                  {showCodeBlock && <><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /></>}
                  {showCABlock && <><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /><col style={{ width: "110px" }} /></>}
                  <col style={{ width: "52px" }} />
                </colgroup>
                <thead className="ui-table__thead">
                  <tr className="ui-table__header-row">
                    <th className="ui-table__th ui-table__th--checkbox ui-table__th--base">
                      <input type="checkbox" className="ui-checkbox__input" checked={selectedIds.size === entries.length && entries.length > 0} onChange={(e) => toggleSelectAll(e.target.checked)} />
                    </th>
                    <th className="ui-table__th ui-table__th--base ui-table__th--sortable" onClick={() => handleSort("name")}>
                      Prénom Nom
                      <SortIcon active={sortConfig?.key === "name"} dir={sortConfig?.key === "name" ? sortConfig.dir : null} />
                    </th>
                    {!(showCodeBlock || showCABlock) && <th className="ui-table__th ui-table__th--base">Email</th>}
                    {!(showCodeBlock || showCABlock) && <th className="ui-table__th ui-table__th--base">Adresse</th>}
                    <th className="ui-table__th ui-table__th--base ui-table__th--sortable" onClick={() => handleSort("profession")}>
                      Profession
                      <SortIcon active={sortConfig?.key === "profession"} dir={sortConfig?.key === "profession" ? sortConfig.dir : null} />
                    </th>
                    {!(showCodeBlock || showCABlock) && <th className="ui-table__th ui-table__th--center ui-table__th--base">Lien</th>}
                    {showCodeBlock && (<>
                      <th ref={codePromoThRef} className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--block-start ui-table__th--center">Nom</th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center">Code</th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center">Valeur</th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center ui-table__th--sortable" onClick={() => handleSort("status")}>
                        Etat
                        <SortIcon active={sortConfig?.key === "status"} dir={sortConfig?.key === "status" ? sortConfig.dir : null} />
                      </th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--green ui-table__th--center">Lien</th>
                    </>)}
                    {showCABlock && (<>
                      <th ref={caThRef} className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--block-start ui-table__th--center ui-table__th--sortable" onClick={() => handleSort("orders")}>
                        Com.
                        <SortIcon active={sortConfig?.key === "orders"} dir={sortConfig?.key === "orders" ? sortConfig.dir : null} />
                      </th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center ui-table__th--sortable" onClick={() => handleSort("revenue")}>
                        CA Gén.
                        <SortIcon active={sortConfig?.key === "revenue"} dir={sortConfig?.key === "revenue" ? sortConfig.dir : null} />
                      </th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center">Gagné</th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center">Utilisé</th>
                      <th className="ui-table__th mf-th--dev mf-th--dev--blue ui-table__th--center">Restant</th>
                    </>)}
                    <th className="ui-table__th ui-table__th--actions" />
                  </tr>
                </thead>
                <tbody className="ui-table__tbody">
                  {(() => {
                    if (sortedEntries.length === 0) return (
                      <tr><td colSpan={4 + (!(showCodeBlock || showCABlock) ? 3 : 0) + (showCodeBlock ? 5 : 0) + (showCABlock ? 5 : 0)} className="ui-table__td ui-table__td--empty">Aucun partenaire trouvé</td></tr>
                    );
                    return paginatedEntries.map((entry) => {
                      const isSelected = selectedIds.has(entry.id);
                      const entryStatus = (entry as { status?: boolean }).status ?? true;
                      const nom = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.name || "—";
                      const valeur = entry.montant != null ? `${entry.montant}${(entry as any).type === "%" ? "%" : "€"}` : "—";
                      return (
                        <tr key={entry.id} className={`ui-table__row${isSelected ? " ui-table__row--selected" : ""}`}>
                          <td className="ui-table__td ui-table__td--checkbox" >
                            <input type="checkbox" className="ui-checkbox__input" checked={isSelected} onChange={() => toggleSelectOne(entry.id)} />
                          </td>
                          <td className="ui-table__td">
                            <div className="mf-cell mf-cell--multi">
                                <span className="mf-text--title">{nom}</span>
                            </div>
                          </td>
                          {!(showCodeBlock || showCABlock) && (
                          <td className="ui-table__td">
                            <div className="mf-cell mf-cell--start">
                              <span className="mf-text--title">{entry.email || "—"}</span>
                            </div>
                          </td>
                          )}
                          {!(showCodeBlock || showCABlock) && (
                          <td className="ui-table__td">
                            <div className="mf-cell mf-cell--start">
                              <span className="mf-text--title">{(entry as { adresse?: string }).adresse || "—"}</span>
                            </div>
                          </td>
                          )}
                          <td className="ui-table__td">
                            <div className="mf-cell mf-cell--start">
                              <span className="mf-text--title">{(entry as { profession?: string }).profession || "—"}</span>
                            </div>
                          </td>
                          {!(showCodeBlock || showCABlock) && (
                          <td className="ui-table__td ui-table__td--center">
                            {entry.customer_id
                              ? <a href={`https://${shopDomain}/admin/customers/${entry.customer_id.split("/").pop()}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Voir la fiche client" className="customer-link">
                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                  <path d="M8.372 11.6667C7.11703 10.4068 7.23007 8.25073 8.62449 6.8509L12.6642 2.79552C14.0586 1.39569 16.2064 1.28221 17.4613 2.54205C18.7163 3.8019 18.6033 5.95797 17.2088 7.35779L15.189 9.3855" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                  <path opacity="0.5" d="M11.6278 8.33334C12.8828 9.59318 12.7698 11.7492 11.3753 13.1491L9.3555 15.1768L7.33566 17.2045C5.94124 18.6043 3.79348 18.7178 2.53851 17.4579C1.28353 16.1981 1.39658 14.042 2.79099 12.6422L4.81086 10.6145" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              </a>
                              : <span className="cell-empty">—</span>}
                          </td>
                          )}
                          {showCodeBlock && (<>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--green ui-table__td--block-start">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{(entry as any).identification || "—"}</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--green">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-chip mf-chip--mono">{entry.code || "—"}</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--green">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{valeur}</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--green">
                              <div className="mf-cell mf-cell--center">
                                {!isLocked ? (
                                  <button
                                    type="button"
                                    className={`mf-badge mf-badge--toggle${entryStatus ? " mf-badge--found" : ""}`}
                                    onClick={(e) => { e.stopPropagation(); submit({ action: "toggle_status", id: entry.id, current_status: String(entryStatus) }, { method: "post" }); }}
                                    title={entryStatus ? "Cliquer pour désactiver" : "Cliquer pour activer"}
                                  >
                                    {entryStatus ? "Actif" : "Inactif"}
                                  </button>
                                ) : (
                                  <span className={`mf-badge${entryStatus ? " mf-badge--found" : ""}`}>
                                    {entryStatus ? "Actif" : "Inactif"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--green ui-table__td--center">
                              <div className="mf-cell mf-cell--center">
                                {(entry as { discount_id?: string }).discount_id
                                  ? <a href={`https://${shopDomain}/admin/discounts/${(entry as { discount_id?: string }).discount_id!.split("/").pop()}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Voir le code promo" className="customer-link">
                                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                                      <path d="M8.372 11.6667C7.11703 10.4068 7.23007 8.25073 8.62449 6.8509L12.6642 2.79552C14.0586 1.39569 16.2064 1.28221 17.4613 2.54205C18.7163 3.8019 18.6033 5.95797 17.2088 7.35779L15.189 9.3855" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                      <path opacity="0.5" d="M11.6278 8.33334C12.8828 9.59318 12.7698 11.7492 11.3753 13.1491L9.3555 15.1768L7.33566 17.2045C5.94124 18.6043 3.79348 18.7178 2.53851 17.4579C1.28353 16.1981 1.39658 14.042 2.79099 12.6422L4.81086 10.6145" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                    </svg>
                                  </a>
                                  : <span className="cell-empty">—</span>}
                              </div>
                            </td>
                          </>)}
                          {showCABlock && (<>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--blue ui-table__td--block-start">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{parseInt((entry as { cache_orders_count?: string }).cache_orders_count || "0", 10)}</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--blue">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{parseFloat((entry as { cache_revenue?: string }).cache_revenue || "0")}€</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--blue">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{parseFloat((entry as { cache_credit_earned?: string }).cache_credit_earned || "0").toFixed(2)}€</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--blue">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{(() => {
                                  const earned = parseFloat((entry as { cache_credit_earned?: string }).cache_credit_earned || "0");
                                  const remaining = (entry as { credit_balance?: number }).credit_balance || 0;
                                  const used = Math.max(0, earned - remaining);
                                  return used.toFixed(2);
                                })()}€</span>
                              </div>
                            </td>
                            <td className="ui-table__td mf-cell--devmode mf-cell--devmode--blue">
                              <div className="mf-cell mf-cell--center">
                                <span className="mf-text--title">{((entry as { credit_balance?: number }).credit_balance || 0).toFixed(2)}€</span>
                              </div>
                            </td>
                          </>)}
                          <td className="ui-table__td ui-table__td--actions">
                            <button type="button"
                              className={`row-actions-btn${contextMenuState?.id === entry.id ? " row-actions-btn--active" : ""}`}
                              onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setContextMenuState(contextMenuState?.id === entry.id ? null : { id: entry.id, x: rect.right, y: rect.bottom }); }}>···</button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
              </div>
            </div>
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", padding: "12px 0", borderTop: "1px solid #e4e4e7" }}>
                <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: "5px 12px", border: "1px solid #e4e4e7", borderRadius: "6px", background: currentPage === 1 ? "#f4f4f5" : "white", cursor: currentPage === 1 ? "not-allowed" : "pointer", color: currentPage === 1 ? "#a1a1aa" : "#18181b", fontSize: "13px", fontWeight: 500 }}>← Précédent</button>
                <span style={{ fontSize: "13px", color: "#71717a" }}>Page {currentPage} / {totalPages} <span style={{ color: "#a1a1aa" }}>({filteredEntries.length} résultats)</span></span>
                <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: "5px 12px", border: "1px solid #e4e4e7", borderRadius: "6px", background: currentPage === totalPages ? "#f4f4f5" : "white", cursor: currentPage === totalPages ? "not-allowed" : "pointer", color: currentPage === totalPages ? "#a1a1aa" : "#18181b", fontSize: "13px", fontWeight: 500 }}>Suivant →</button>
              </div>
            )}
          </div>

          {/* CONTEXT MENU GLOBAL (position: fixed pour échapper aux overflow) */}
          {contextMenuState && (() => {
            const ctxEntry = entries.find((e) => e.id === contextMenuState.id);
            if (!ctxEntry) return null;
            return (
              <div onClick={(e) => e.stopPropagation()} className="mf-dropdown-content" style={{ position: "fixed", left: `${contextMenuState.x}px`, top: `${contextMenuState.y + 4}px`, transform: "translateX(-100%)", zIndex: 200 }}>
                <button type="button" className="mf-dropdown-item"
                  onClick={() => { setPartnerModal({ mode: "edit", entry: ctxEntry }); setContextMenuState(null); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none" className="mf-dropdown-item__icon">
                    <path d="M12.739 2.62648L11.9666 3.39888L4.86552 10.4999C4.38456 10.9809 4.14407 11.2214 3.93725 11.4865C3.69328 11.7993 3.48412 12.1378 3.31346 12.4959C3.16878 12.7994 3.06123 13.1221 2.84614 13.7674L1.93468 16.5017L1.71188 17.1701C1.60603 17.4877 1.68867 17.8378 1.92536 18.0745C2.16205 18.3112 2.51215 18.3938 2.8297 18.288L3.4981 18.0652L6.23249 17.1537C6.87777 16.9386 7.20042 16.8311 7.50398 16.6864C7.86208 16.5157 8.20052 16.3066 8.51331 16.0626C8.77847 15.8558 9.01895 15.6153 9.49992 15.1343L16.601 8.03328L17.3734 7.26088C18.6531 5.98113 18.6531 3.90624 17.3734 2.62648C16.0936 1.34673 14.0187 1.34673 12.739 2.62648Z" stroke="#71717A" strokeWidth="1.5"/>
                    <path d="M11.9665 3.39884C11.9665 3.39884 12.063 5.04019 13.5113 6.48844C14.9595 7.93669 16.6008 8.03324 16.6008 8.03324M3.498 18.0651L1.93457 16.5017" stroke="#71717A" strokeWidth="1.5"/>
                  </svg>
                  <span className="mf-dropdown-item__title">Editer</span>
                </button>
                <button type="button" className="mf-dropdown-item mf-dropdown-item--delete"
                  onClick={() => { setContextMenuState(null); handleDeleteEntry(ctxEntry.id, `${ctxEntry.first_name} ${ctxEntry.last_name}`); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="none" className="mf-dropdown-item__icon mf-dropdown-item__icon--delete">
                    <path d="M17.0832 5H2.9165" stroke="#C20E4D" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M15.6946 7.08333L15.3113 12.8326C15.1638 15.045 15.09 16.1512 14.3692 16.8256C13.6483 17.5 12.5397 17.5 10.3223 17.5H9.67787C7.46054 17.5 6.35187 17.5 5.63103 16.8256C4.91019 16.1512 4.83644 15.045 4.68895 12.8326L4.30566 7.08333" stroke="#C20E4D" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M7.9165 9.16667L8.33317 13.3333" stroke="#C20E4D" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M12.0832 9.16667L11.6665 13.3333" stroke="#C20E4D" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M5.4165 5C5.46307 5 5.48635 5 5.50746 4.99947C6.19366 4.98208 6.79902 4.54576 7.03252 3.90027C7.0397 3.88041 7.04706 3.85832 7.06179 3.81415L7.14269 3.57143C7.21176 3.36423 7.24629 3.26063 7.2921 3.17267C7.47485 2.82173 7.81296 2.57803 8.20368 2.51564C8.30161 2.5 8.41082 2.5 8.62922 2.5H11.3705C11.5889 2.5 11.6981 2.5 11.796 2.51564C12.1867 2.57803 12.5248 2.82173 12.7076 3.17267C12.7534 3.26063 12.7879 3.36423 12.857 3.57143L12.9379 3.81415C12.9526 3.85826 12.96 3.88042 12.9672 3.90027C13.2007 4.54576 13.806 4.98208 14.4922 4.99947C14.5133 5 14.5366 5 14.5832 5" stroke="#C20E4D" strokeWidth="1.5"/>
                  </svg>
                  <span className="mf-dropdown-item__title">Supprimer</span>
                </button>
              </div>
            );
          })()}

          {/* FLOATING SELECTION BAR */}
          {selectedIds.size > 0 && (
            <div className="selection-bar-wrapper">
              <div className="selection-bar">
                <div className="selection-bar__info">
                  <span className="selection-bar__count">{selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
                  <button type="button" className="selection-bar__clear" onClick={() => setSelectedIds(new Set())}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                <div className="selection-bar__divider" />
                <div className="selection-bar__actions">
                  <button
                    type="button"
                    className="selection-bar__btn selection-bar__btn--danger"
                    onClick={handleBulkDelete}
                    disabled={nav.state === "submitting" && (nav.formData?.get("action") === "bulk_delete_entries" || nav.formData?.get("action") === "delete_entry")}
                  >
                    {nav.state === "submitting" && (nav.formData?.get("action") === "bulk_delete_entries" || nav.formData?.get("action") === "delete_entry") ? (
                      <Spinner size="14px" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                    )}
                    supprimer
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : (
        // CARD INITIALISATION SEULE
        <div className="init-screen">
          <div className="init-card">
            <h2 className="init-title">Bienvenue !</h2>
            <p className="init-text">
              L&apos;application n&apos;est pas encore initialisée. Cliquez
              ci-dessous pour créer la structure de base dans Shopify.
            </p>
            <Form method="post">
              <input type="hidden" name="action" value="create_structure" />
              <button
                type="submit"
                disabled={isInitializing}
                className="init-btn"
                style={{ opacity: isInitializing ? 0.7 : 1 }}
              >
                {isInitializing ? (
                  <><Spinner /> Initialisation...</>
                ) : (
                  "🚀 Initialiser l&apos;application"
                )}
              </button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
