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
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
  checkMetaobjectStatus,
  createMetaobject,
  getMetaobjectEntries,
  createMetaobjectEntry,
  updateMetaobjectEntry,
  deleteMetaobjectEntry,
  destroyMetaobjectStructure,
} from "../lib/metaobject.server";
import { createCustomerMetafieldDefinitions } from "../lib/customer.server";

import prisma from "../db.server";
import * as XLSX from "xlsx";

// --- LOADER ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);

  // Charger la config (seuil de crédit) ou la créer si inexistante (store unique, id=1)
  const config = await prisma.config.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, threshold: 500.0, creditAmount: 10.0 },
  });

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
    const entriesResult = await getMetaobjectEntries(admin);
    const rawEntries = entriesResult.entries;

    // OPTIMISATION : Requête groupée pour les tags
    const customerIds = rawEntries
      .map((e: any) => e.customer_id)
      .filter((id: string) => id && id.startsWith("gid://shopify/Customer/"));

    const tagsMap = new Map<string, string[]>();

    if (customerIds.length > 0) {
      try {
        const response = await admin.graphql(
          `#graphql
          query getCustomersTags($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Customer {
                id
                tags
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
          }
        });
      } catch (error) {
        console.error("Erreur récup bulk tags", error);
      }
    }

    entries = rawEntries.map((entry: any) => ({
      ...entry,
      tags: entry.customer_id ? tagsMap.get(entry.customer_id) || [] : [],
    }));
  }

  return { status, entries, config };
};

// --- ACTION ---
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "destroy_structure") {
    const result = await destroyMetaobjectStructure(admin);
    if (result.success) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return redirect("/app?success=structure_deleted");
    }
    return { error: result.error || "Erreur suppression totale" };
  }

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

    if (!identification)
      return { error: "La référence interne est obligatoire." };

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

  if (actionType === "update_config") {
    const threshold = parseFloat(formData.get("threshold") as string);
    const creditAmount = parseFloat(formData.get("creditAmount") as string);

    await prisma.config.upsert({
      where: { id: 1 },
      update: { threshold, creditAmount },
      create: { id: 1, threshold, creditAmount },
    });
    return { success: "config_updated" };
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
        const ref = cleanInput(
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

        // Vérif données minimales
        if (!ref) {
          if (!first_name && !last_name && !email && !code) continue;
          errors.push(`Ligne ignorée (Ref manquante) : ${displayName}`);
          continue;
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

// --- STYLES ---
const styles = {
  wrapper: {
    width: "100%",
    padding: "20px",
    backgroundColor: "#f6f6f7",
    fontFamily: "-apple-system, sans-serif",
    boxSizing: "border-box" as const,
  },
  cell: {
    padding: "16px 12px",
    fontSize: "0.9rem",
    verticalAlign: "middle",
    borderBottom: "1px solid #eee",
  },
  cellPromo: {
    padding: "16px 12px",
    fontSize: "0.9rem",
    verticalAlign: "middle",
    borderBottom: "1px solid #e1e3e5",
    textAlign: "center" as const,
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "0.9rem",
    boxSizing: "border-box" as const,
    transition: "border-color 0.2s",
    textAlign: "left" as const,
  },
  btnAction: {
    padding: "0",
    borderRadius: "4px",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    fontSize: "1.1rem",
    transition: "opacity 0.2s",
  },
  navButton: {
    textDecoration: "none",
    color: "#008060",
    fontWeight: "600",
    backgroundColor: "white",
    border: "1px solid #c9cccf",
    padding: "8px 16px",
    borderRadius: "4px",
    fontSize: "0.9rem",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.2s ease",
  },
  infoDetails: {
    marginBottom: "20px",
    backgroundColor: "white",
    borderRadius: "8px",
    border: "1px solid #e1e3e5",
    borderLeft: "4px solid #008060",
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
    overflow: "hidden",
  },
  infoSummary: {
    padding: "12px 20px",
    cursor: "pointer",
    fontWeight: "600",
    color: "#444",
    outline: "none",
    listStyle: "none",
  },
  paginationContainer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "15px",
    gap: "15px",
    backgroundColor: "white",
    borderTop: "1px solid #eee",
  },
  pageBtn: {
    padding: "6px 12px",
    border: "1px solid #ccc",
    backgroundColor: "white",
    borderRadius: "4px",
    cursor: "pointer",
    color: "#333",
    fontWeight: "500",
    fontSize: "0.9rem",
  },
  pageBtnDisabled: {
    padding: "6px 12px",
    border: "1px solid #eee",
    backgroundColor: "#f9fafb",
    borderRadius: "4px",
    cursor: "not-allowed",
    color: "#ccc",
    fontWeight: "500",
    fontSize: "0.9rem",
  },
};

// --- COMPOSANT LIGNE (ROW) ---
function EntryRow({
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
  const borderLeftSep = { borderLeft: "2px solid #e1e3e5" };

  return (
    <tr style={{ opacity: isBusy ? 0.5 : 1 }}>
      <td
        style={{
          ...styles.cell,
          backgroundColor: bgStandard,
          color: "#666",
          fontSize: "0.8rem",
          width: "80px",
        }}
      >
        {entry.id.split("/").pop()?.slice(-8)}
      </td>

      {isEditing ? (
        <>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="text"
              value={formData.identification}
              onChange={(e) =>
                setFormData({ ...formData, identification: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
              placeholder="ID"
            />
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="text"
              value={formData.first_name}
              onChange={(e) =>
                setFormData({ ...formData, first_name: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
              placeholder="Prénom"
            />
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="text"
              value={formData.last_name}
              onChange={(e) =>
                setFormData({ ...formData, last_name: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
              placeholder="Nom"
            />
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
            />
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="text"
              value={formData.profession}
              onChange={(e) =>
                setFormData({ ...formData, profession: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
              placeholder="Profession"
            />
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            <input
              disabled={isBusy}
              type="text"
              value={formData.adresse}
              onChange={(e) =>
                setFormData({ ...formData, adresse: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
              placeholder="Adresse"
            />
          </td>

          <td
            style={{
              ...styles.cellPromo,
              backgroundColor: bgPromo,
              ...borderLeftSep,
            }}
          >
            <input
              disabled={isBusy}
              type="text"
              value={formData.code}
              onChange={(e) =>
                setFormData({ ...formData, code: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
            />
          </td>
          <td
            style={{
              ...styles.cellPromo,
              backgroundColor: bgPromo,
              width: "60px",
            }}
          >
            <input
              disabled={isBusy}
              type="number"
              step="0.01"
              value={formData.montant}
              onChange={(e) =>
                setFormData({ ...formData, montant: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
            />
          </td>
          <td
            style={{
              ...styles.cellPromo,
              backgroundColor: bgPromo,
              width: "60px",
            }}
          >
            <select
              disabled={isBusy}
              value={formData.type}
              onChange={(e) =>
                setFormData({ ...formData, type: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
            >
              <option value="%">%</option>
              <option value="€">€</option>
            </select>
          </td>

          <td
            style={{
              ...styles.cell,
              backgroundColor: bgStandard,
              width: "100px",
              ...borderLeftSep,
            }}
          >
            <div
              style={{ display: "flex", gap: "6px", justifyContent: "center" }}
            >
              <button
                type="button"
                onClick={handleSave}
                disabled={isBusy}
                style={{
                  ...styles.btnAction,
                  backgroundColor: "#008060",
                  color: "white",
                }}
                title="Enregistrer"
              >
                {isUpdatingThis ? <Spinner /> : "✓"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isBusy}
                style={{
                  ...styles.btnAction,
                  backgroundColor: "white",
                  color: "#333",
                  border: "1px solid #ddd",
                }}
                title="Annuler"
              >
                ✕
              </button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            {entry.identification}
          </td>
          <td
            style={{
              ...styles.cell,
              backgroundColor: bgStandard,
              fontWeight: "600",
              color: "#333",
            }}
          >
            {entry.first_name}
          </td>
          <td
            style={{
              ...styles.cell,
              backgroundColor: bgStandard,
              fontWeight: "600",
              color: "#333",
            }}
          >
            {entry.last_name}
          </td>
          <td style={{ ...styles.cell, backgroundColor: bgStandard }}>
            {entry.email}
          </td>
          <td
            style={{
              ...styles.cell,
              backgroundColor: bgStandard,
              fontSize: "0.85rem",
              color: "#666",
            }}
          >
            {entry.profession || "-"}
          </td>
          <td
            style={{
              ...styles.cell,
              backgroundColor: bgStandard,
              fontSize: "0.8rem",
              color: "#888",
            }}
          >
            {entry.adresse || "-"}
          </td>

          <td
            style={{
              ...styles.cellPromo,
              backgroundColor: bgPromo,
              ...borderLeftSep,
            }}
          >
            <span
              style={{
                background: "#e3f1df",
                color: "#008060",
                padding: "4px 8px",
                borderRadius: "4px",
                fontFamily: "monospace",
                fontWeight: "bold",
              }}
            >
              {entry.code}
            </span>
          </td>
          <td style={{ ...styles.cellPromo, backgroundColor: bgPromo }}>
            {entry.montant}
          </td>
          <td style={{ ...styles.cellPromo, backgroundColor: bgPromo }}>
            {entry.type}
          </td>

          <td
            style={{
              ...styles.cellPromo,
              backgroundColor: bgStandard,
              ...borderLeftSep,
            }}
          >
            <div
              style={{ display: "flex", gap: "6px", justifyContent: "center" }}
            >
              <button
                type="button"
                disabled={isBusy || isLocked}
                onClick={() => setIsEditing(true)}
                style={{
                  ...styles.btnAction,
                  backgroundColor: isLocked ? "#f4f6f8" : "white",
                  border: "1px solid #ccc",
                  color: isLocked ? "#ccc" : "#555",
                  cursor: isLocked ? "not-allowed" : "pointer",
                }}
                title={isLocked ? "Verrouillé" : "Modifier"}
              >
                ✎
              </button>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (isLocked) {
                    e.preventDefault();
                    return;
                  }
                  const confirm1 = confirm(
                    "ATTENTION : \n\nVous allez supprimer ce partenaire et son code promo. Continuer ?",
                  );
                  if (!confirm1) {
                    e.preventDefault();
                    return;
                  }
                  // Plus de prompt "DELETE" ici, le mot de passe global suffit
                }}
              >
                <input type="hidden" name="action" value="delete_entry" />
                <input type="hidden" name="id" value={entry.id} />
                <button
                  type="submit"
                  disabled={isBusy || isLocked}
                  style={{
                    ...styles.btnAction,
                    backgroundColor: isLocked ? "#f4f6f8" : "#fff0f0",
                    border: isLocked ? "1px solid #eee" : "1px solid #fcc",
                    color: isLocked ? "#ccc" : "#d82c0d",
                    cursor: isLocked ? "not-allowed" : "pointer",
                  }}
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
}

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

  const promoInputBg = { backgroundColor: "white" };
  const borderLeftSep = { borderLeft: "2px solid #b8d0eb" };

  return (
    <tr
      style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #cce5ff" }}
    >
      <td
        style={{
          ...styles.cell,
          color: "#005bd3",
          fontWeight: "bold",
          borderLeft: "4px solid #005bd3",
        }}
      >
        Nouveau
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="text"
          name="identification"
          placeholder="Ref *"
          required
          value={formData.identification}
          onChange={(e) =>
            setFormData({ ...formData, identification: e.target.value })
          }
          style={styles.input}
        />
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="text"
          name="first_name"
          placeholder="Prénom *"
          required
          value={formData.first_name}
          onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
          style={styles.input}
        />
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="text"
          name="last_name"
          placeholder="Nom *"
          required
          value={formData.last_name}
          onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
          style={styles.input}
        />
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="email"
          name="email"
          placeholder="Email *"
          required
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          style={styles.input}
        />
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="text"
          name="profession"
          placeholder="Profession"
          value={formData.profession}
          onChange={(e) =>
            setFormData({ ...formData, profession: e.target.value })
          }
          style={styles.input}
        />
      </td>
      <td style={styles.cell}>
        <input
          disabled={isCreating}
          type="text"
          name="adresse"
          placeholder="Adresse"
          value={formData.adresse}
          onChange={(e) =>
            setFormData({ ...formData, adresse: e.target.value })
          }
          style={styles.input}
        />
      </td>

      <td style={{ ...styles.cellPromo, ...borderLeftSep }}>
        <input
          disabled={isCreating}
          type="text"
          name="code"
          placeholder="Code *"
          required
          value={formData.code}
          onChange={(e) => setFormData({ ...formData, code: e.target.value })}
          style={{ ...styles.input, ...promoInputBg }}
        />
      </td>
      <td style={{ ...styles.cellPromo, width: "60px" }}>
        <input
          disabled={isCreating}
          type="number"
          step="0.01"
          name="montant"
          placeholder="Val *"
          required
          value={formData.montant}
          onChange={(e) =>
            setFormData({ ...formData, montant: e.target.value })
          }
          style={{ ...styles.input, ...promoInputBg }}
        />
      </td>
      <td style={{ ...styles.cellPromo, width: "60px" }}>
        <select
          disabled={isCreating}
          name="type"
          required
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          style={{ ...styles.input, ...promoInputBg }}
        >
          <option value="%">%</option>
          <option value="€">€</option>
        </select>
      </td>
      <td style={{ ...styles.cellPromo, width: "100px", ...borderLeftSep }}>
        <button
          type="button"
          disabled={isCreating}
          onClick={handleAdd}
          style={{
            padding: "8px 12px",
            backgroundColor: isCreating ? "#ccc" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isCreating ? "not-allowed" : "pointer",
            fontWeight: "bold",
            width: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "5px",
          }}
        >
          {isCreating ? (
            <>
              <Spinner /> ...
            </>
          ) : (
            "Ajouter"
          )}
        </button>
      </td>
    </tr>
  );
}

// --- SOUS-COMPOSANT SETTINGS ---
interface ConfigType {
  threshold: number;
  creditAmount: number;
}

function SettingsForm({
  config,
  isLocked,
}: {
  config: ConfigType | null;
  isLocked: boolean;
}) {
  return (
    <>
      <p style={{ margin: "0 0 15px 0", fontSize: "0.9rem", color: "#666" }}>
        Modifiez ici les règles de calcul globales pour les crédits offerts aux
        Pros.
      </p>

      <Form
        method="post"
        style={{
          display: "flex",
          gap: "20px",
          alignItems: "flex-end",
          flexWrap: "wrap",
          opacity: isLocked ? 0.6 : 1,
        }}
      >
        <input type="hidden" name="action" value="update_config" />
        <div style={{ flex: 1, minWidth: "200px" }}>
          <label
            htmlFor="threshold"
            style={{
              display: "block",
              fontSize: "0.85rem",
              color: "#666",
              marginBottom: "5px",
            }}
          >
            Seuil de Gains (CA généré)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="number"
              id="threshold"
              name="threshold"
              defaultValue={config?.threshold}
              step="0.01"
              disabled={isLocked}
              style={{ ...styles.input, flex: 1 }}
            />
            <span style={{ fontWeight: "bold" }}>€</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <label
            htmlFor="creditAmount"
            style={{
              display: "block",
              fontSize: "0.85rem",
              color: "#666",
              marginBottom: "5px",
            }}
          >
            Montant du Crédit Offert
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="number"
              id="creditAmount"
              name="creditAmount"
              defaultValue={config?.creditAmount}
              step="0.01"
              disabled={isLocked}
              style={{ ...styles.input, flex: 1 }}
            />
            <span style={{ fontWeight: "bold" }}>€</span>
          </div>
        </div>
        <button
          type="submit"
          disabled={isLocked}
          style={{
            padding: "10px 20px",
            backgroundColor: isLocked ? "#ccc" : "#008060",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: isLocked ? "not-allowed" : "pointer",
            fontWeight: "600",
            transition: "opacity 0.2s",
          }}
        >
          Enregistrer les réglages
        </button>
      </Form>
      <p style={{ margin: "15px 0 0 0", fontSize: "0.85rem", color: "#888" }}>
        Exemple : Le partenaire gagnera <strong>{config?.creditAmount}€</strong>{" "}
        tous les <strong>{config?.threshold}€</strong> de CA généré.
      </p>
    </>
  );
}

// --- COMPOSANT IMPORT RESULT ---
function ImportResult({ report }: { report: any }) {
  if (!report) return null;
  return (
    <div
      style={{
        padding: "15px",
        backgroundColor: "white",
        borderRadius: "8px",
        border: "1px solid #c9cccf",
        marginBottom: "20px",
        boxShadow: "0 2px 5px rgba(0,0,0,0.05)",
      }}
    >
      <h3
        style={{
          marginTop: 0,
          fontSize: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        📊 Rapport d&apos;import
      </h3>

      <div
        style={{
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          marginBottom: "15px",
        }}
      >
        <div style={{ color: "#008060", fontWeight: "bold" }}>
          ✅ {report.added} importés
        </div>
        <div style={{ color: "#d97900", fontWeight: "bold" }}>
          ⚠️ {report.skipped} doublons ignorés
        </div>
        {report.errors.length > 0 && (
          <div style={{ color: "#d82c0d", fontWeight: "bold" }}>
            ❌ {report.errors.length} erreurs
          </div>
        )}
      </div>

      {report.duplicates.length > 0 && (
        <details style={{ marginBottom: "10px" }}>
          <summary
            style={{ cursor: "pointer", color: "#666", fontSize: "0.9rem" }}
          >
            Voir les doublons ({report.duplicates.length})
          </summary>
          <ul
            style={{
              fontSize: "0.85rem",
              color: "#666",
              backgroundColor: "#fafafa",
              padding: "10px 25px",
              borderRadius: "4px",
              maxHeight: "150px",
              overflowY: "auto",
            }}
          >
            {report.duplicates.map((d: string, i: number) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      {report.errors.length > 0 && (
        <details open>
          <summary
            style={{
              cursor: "pointer",
              color: "#d82c0d",
              fontSize: "0.9rem",
              fontWeight: "bold",
            }}
          >
            Voir les erreurs ({report.errors.length})
          </summary>
          <ul
            style={{
              fontSize: "0.85rem",
              color: "#d82c0d",
              backgroundColor: "#fff5f5",
              padding: "10px 25px",
              borderRadius: "4px",
            }}
          >
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
function ImportForm({ existingEntries }: { existingEntries: any[] }) {
  const [fileCount, setFileCount] = useState<number | null>(null);
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
      setParsedItems([]);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      setFileCount(json.length);
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

      const ref = cleanInput(
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

      // Validations de base
      if (!ref) {
        if (first_name || last_name || email || code)
          errors.push(`Ligne ignorée (Ref manquante) : ${displayName}`);
        continue;
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

  return (
    <div>
      {report && <ImportResult report={report} />}

      <p style={{ margin: "0 0 15px 0", fontSize: "0.9rem", color: "#666" }}>
        Importez une liste de partenaires depuis un fichier Excel (.xlsx, .xls)
        ou CSV.
        <br />
        <em style={{ fontSize: "0.8rem" }}>
          Format attendu :{" "}
          <strong>
            Ref, Nom, Email, Code, Montant, Type, Profession, Adresse
          </strong>
          . Traitement optimisé par batch de 5 items.
        </em>
      </p>

      <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
        <input
          type="file"
          accept=".xlsx, .xls, .csv"
          disabled={isProcessing}
          onChange={handleFileChange}
          style={{ fontSize: "0.9rem" }}
        />

        <button
          type="button"
          onClick={handleImportClick}
          disabled={isProcessing || !fileCount}
          style={{
            padding: "8px 16px",
            backgroundColor: isProcessing ? "#ccc" : "#005bd3",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: isProcessing || !fileCount ? "not-allowed" : "pointer",
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "180px",
            justifyContent: "center",
            transition: "all 0.2s",
          }}
        >
          {isProcessing ? (
            <>
              <Spinner /> Traitement {progress} / {totalToProcess}
            </>
          ) : (
            `⚡ Importer ${fileCount !== null ? `(${fileCount})` : ""}`
          )}
        </button>
      </div>
    </div>
  );
}

// --- PAGE PRINCIPALE ---
export default function Index() {
  const { status, entries, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigation();
  const successType = searchParams.get("success");

  // PAGINATION
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  const totalPages = Math.ceil(entries.length / itemsPerPage);

  const currentEntries = entries.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const isDestroying = nav.formData?.get("action") === "destroy_structure";
  const isInitializing = nav.formData?.get("action") === "create_structure";

  let successMessage = "";
  if (successType === "entry_created")
    successMessage = "Nouveau Pro ajouté & Code promo créé !";
  else if (successType === "entry_updated")
    successMessage = "Informations mises à jour (et synchronisées) !";
  else if (successType === "entry_deleted")
    successMessage = "Pro supprimé et nettoyé avec succès.";
  else if (successType === "structure_created")
    successMessage = "Application initialisée avec succès.";
  else if (successType === "structure_deleted")
    successMessage = "Tout a été effacé (Reset complet).";
  else if (successType === "config_updated")
    successMessage = "Réglages de crédit mis à jour !";
  // On ne gère plus le success URL param pour l'import car on utilise actionData.report
  else if (actionData?.success === "config_updated")
    successMessage = "Réglages de crédit mis à jour !";

  const [showSuccess, setShowSuccess] = useState(
    !!successType || actionData?.success === "config_updated",
  );

  useEffect(() => {
    setShowSuccess(!!successType || actionData?.success === "config_updated");
    if (successType || actionData?.success === "config_updated") {
      const timer = setTimeout(() => {
        if (successType) {
          searchParams.delete("success");
          setSearchParams(searchParams, { replace: true });
        }
        setShowSuccess(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successType, actionData?.success, searchParams, setSearchParams]);

  const containerMaxWidth = "1600px";
  const bannerStyle = {
    padding: "12px 20px",
    marginBottom: "20px",
    borderRadius: "8px",
    maxWidth: containerMaxWidth,
    margin: "0 auto 20px",
    textAlign: "center" as const,
    fontWeight: "600",
    boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
  };

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

  // --- GESTION DU VERROU GLOBAL ---
  const [isLocked, setIsLocked] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = () => {
    // Utilisation de la variable d'environnement ou fallback sur "GestionPro"
    const adminPassword =
      typeof process !== "undefined" && process.env?.ADMIN_PASSWORD
        ? process.env.ADMIN_PASSWORD
        : "GestionPro";

    if (password === adminPassword) {
      setIsLocked(false);
      setShowPass(false);
      setError("");
    } else {
      setError("Code incorrect");
    }
  };

  return (
    <div style={styles.wrapper}>
      <style>{`
        .nav-btn:hover {
          background-color: #f1f8f5 !important;
          border-color: #008060 !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
        }
      `}</style>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "20px",
          marginBottom: "20px",
          position: "relative",
        }}
      >
        <h1
          style={{
            color: "#202223",
            margin: 0,
            fontSize: "1.8rem",
            fontWeight: "700",
          }}
        >
          Gestion des Pros de Santé
        </h1>

        {actionData?.report && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "0",
              right: "0",
              zIndex: 100,
            }}
          >
            {/* Le rapport est affiché plus bas dans le flux principal pour ne pas cacher le titre */}
          </div>
        )}

        {status.exists && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {isLocked && !showPass && (
              <button
                type="button"
                onClick={() => setShowPass(true)}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "white",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                🔒 Modifier
              </button>
            )}

            {showPass && (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  backgroundColor: "white",
                  padding: "4px 8px",
                  borderRadius: "8px",
                  border: "1px solid #c9cccf",
                }}
              >
                <input
                  type="password"
                  autoFocus
                  placeholder="Code d'accès"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                  style={{
                    ...styles.input,
                    width: "120px",
                    padding: "4px 8px",
                    border: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleUnlock}
                  style={{
                    padding: "4px 10px",
                    backgroundColor: "#008060",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Valider
                </button>
                {error && (
                  <span
                    style={{
                      color: "#d82c0d",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                    }}
                  >
                    {error}
                  </span>
                )}
              </div>
            )}

            {!isLocked && (
              <button
                type="button"
                onClick={() => setIsLocked(true)}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#008060",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                🔓 Mode édition activé (Clic pour verrouiller)
              </button>
            )}
          </div>
        )}
      </div>

      {status.exists && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "15px",
              marginBottom: "20px",
              flexWrap: "wrap",
            }}
          >
            <Link
              to="/app/codes_promo"
              className="nav-btn"
              style={styles.navButton}
            >
              <span>🏷️</span> Gestion Codes Promo →
            </Link>
            <Link
              to="/app/clients"
              className="nav-btn"
              style={styles.navButton}
            >
              <span>👥</span> Gestion Clients Pros →
            </Link>
            <Link
              to="/app/analytique"
              className="nav-btn"
              style={styles.navButton}
            >
              <span>📊</span> Analytique →
            </Link>
          </div>
        </>
      )}

      {showSuccess && (
        <div
          style={{ ...bannerStyle, backgroundColor: "#008060", color: "white" }}
        >
          ✓ {successMessage}
        </div>
      )}
      {actionData?.error && (
        <div
          style={{
            ...bannerStyle,
            backgroundColor: "#fff5f5",
            color: "#d82c0d",
            border: "1px solid #fcc",
          }}
        >
          ⚠️ {actionData.error}
        </div>
      )}

      {/* (L'affichage du rapport d'import global est retiré d'ici car géré localement dans ImportForm) */}

      {status.exists && (
        <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
          <details style={styles.infoDetails}>
            <summary style={styles.infoSummary}>
              ℹ️ Guide d&apos;utilisation (Cliquez pour dérouler)
            </summary>
            <div
              style={{
                padding: "0 20px 20px 20px",
                color: "#555",
                fontSize: "0.95rem",
                lineHeight: "1.5",
              }}
            >
              <p style={{ marginTop: 0 }}>
                <strong>Bienvenue sur le tableau de bord principal.</strong>{" "}
                Ici, vous pouvez :
              </p>
              <ul style={{ paddingLeft: "20px", margin: "10px 0" }}>
                <li>
                  <strong>Ajout d&apos;un partenaire :</strong> Création du code
                  promo. Synchronisation du nom, email,{" "}
                  <strong>profession et adresse postale</strong> vers les
                  métafields du client Shopify.
                </li>
                <li>
                  <strong>Modification :</strong> Synchronisation complète en
                  temps réel. Toutes les infos (y compris profession/adresse)
                  sont mises à jour dans Shopify.
                </li>
                <li>
                  <strong>Réglages Crédits :</strong> Définissez votre propre
                  seuil de CA et le montant du crédit offert. Le système
                  s&apos;adapte automatiquement.
                </li>
                <li>
                  <strong>Suppression :</strong> Le code promo est supprimé et
                  le tag est retiré du client. Les fiches clients sont
                  conservées.
                </li>
              </ul>
              <p style={{ marginBottom: 0 }}>
                <em>
                  Note : La référence interne doit être unique pour faciliter
                  votre gestion.
                </em>
              </p>
            </div>
          </details>

          <details
            style={{ ...styles.infoDetails, borderLeft: "4px solid #9c6ade" }}
          >
            <summary style={styles.infoSummary}>
              ⚙️ Réglages des Crédits Gains (Cliquez pour dérouler)
            </summary>
            <div style={{ padding: "0 20px 20px 20px" }}>
              <SettingsForm config={config} isLocked={isLocked} />
            </div>
          </details>

          <details
            style={{ ...styles.infoDetails, borderLeft: "4px solid #005bd3" }}
          >
            <summary style={styles.infoSummary}>
              📥 Importer des Partenaires
            </summary>
            <div style={{ padding: "20px" }}>
              <ImportForm existingEntries={entries} />
            </div>
          </details>
        </div>
      )}

      {status.exists ? (
        <div style={{ maxWidth: containerMaxWidth, margin: "0 auto" }}>
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #eee",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#fafafa",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  color: "#444",
                  fontSize: "1.1rem",
                  fontWeight: "600",
                }}
              >
                Liste des Partenaires ({entries.length})
              </h2>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: "900px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: "white",
                      borderBottom: "2px solid #eee",
                    }}
                  >
                    <th style={{ ...thStyle, width: "80px" }}>ID</th>
                    <th style={thStyle}>Ref Interne</th>
                    <th style={thStyle}>Prénom</th>
                    <th style={thStyle}>Nom</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Profession</th>
                    <th style={thStyle}>Adresse</th>

                    <th style={{ ...thPromoStyle, ...thPromoBorder }}>
                      Code Promo
                    </th>
                    <th style={{ ...thPromoStyle, width: "60px" }}>Montant</th>
                    <th style={{ ...thPromoStyle, width: "60px" }}>Type</th>

                    <th style={{ ...thActionStyle, width: "100px" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <NewEntryForm />
                  {currentEntries.map((entry, index) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={index}
                      isLocked={isLocked}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {entries.length > itemsPerPage && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            )}
          </div>

          <div
            style={{
              marginTop: "60px",
              padding: "20px",
              borderTop: "1px solid #eee",
              textAlign: "center",
              opacity: isLocked ? 0.5 : 1,
            }}
          >
            <details>
              <summary
                style={{ cursor: "pointer", color: "#666", fontSize: "0.9rem" }}
              >
                Afficher les options développeur (Zone Danger)
              </summary>
              <div
                style={{
                  marginTop: "15px",
                  padding: "15px",
                  border: "1px dashed #d82c0d",
                  borderRadius: "8px",
                  backgroundColor: "#fff5f5",
                  display: "inline-block",
                }}
              >
                <p
                  style={{
                    color: "#d82c0d",
                    fontWeight: "bold",
                    fontSize: "0.9rem",
                    margin: "0 0 10px 0",
                  }}
                >
                  ⚠️ ATTENTION : SUPPRESSION TOTALE DE L&apos;APPLICATION
                </p>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (isLocked) {
                      e.preventDefault();
                      return;
                    }
                    if (
                      !confirm(
                        "ATTENTION ULTIME : \n\nVous allez supprimer :\n1. Tous les Pro de santé enregistrés\n2. Tous les codes promo liés\n3. Retirer le tag de tous les clients\n4. Détruire la définition du Métaobjet\n\nÊtes-vous sûr ?",
                      )
                    ) {
                      e.preventDefault();
                      return;
                    }
                    const validation = prompt(
                      "Pour confirmer la DESTRUCTION TOTALE, tapez le mot 'DELETE' en majuscules ci-dessous :",
                    );
                    if (validation !== "DELETE") {
                      e.preventDefault();
                      alert("Annulé : Code de sécurité incorrect.");
                    }
                  }}
                >
                  <input
                    type="hidden"
                    name="action"
                    value="destroy_structure"
                  />
                  <button
                    type="submit"
                    disabled={isDestroying || isLocked}
                    style={{
                      backgroundColor: isLocked ? "#ccc" : "#d82c0d",
                      color: "white",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "4px",
                      cursor:
                        isDestroying || isLocked ? "not-allowed" : "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      opacity: isDestroying || isLocked ? 0.7 : 1,
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      margin: "0 auto",
                    }}
                  >
                    {isDestroying ? (
                      <>
                        <Spinner /> Suppression en cours...
                      </>
                    ) : isLocked ? (
                      "🔒 Section Verrouillée"
                    ) : (
                      "☢️ TOUT SUPPRIMER & RÉINITIALISER"
                    )}
                  </button>
                </Form>
              </div>
            </details>
          </div>
        </div>
      ) : (
        // CARD INITIALISATION SEULE
        <div style={{ textAlign: "center", marginTop: "100px" }}>
          <div
            style={{
              backgroundColor: "white",
              padding: "40px",
              borderRadius: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
              maxWidth: "500px",
              margin: "0 auto",
            }}
          >
            <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>
              Bienvenue !
            </h2>
            <p style={{ color: "#666", marginBottom: "30px" }}>
              L&apos;application n&apos;est pas encore initialisée. Cliquez
              ci-dessous pour créer la structure de base dans Shopify.
            </p>
            <Form method="post">
              <input type="hidden" name="action" value="create_structure" />
              <button
                type="submit"
                disabled={isInitializing}
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#008060",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "1rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  margin: "0 auto",
                  opacity: isInitializing ? 0.7 : 1,
                }}
              >
                {isInitializing ? (
                  <>
                    <Spinner /> Initialisation...
                  </>
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
