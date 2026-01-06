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
} from "react-router";
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

// --- LOADER ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);

  // Charger la config (seuil de crédit) ou la créer si inexistante
  const config = await prisma.config.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop, threshold: 500.0, creditAmount: 10.0 },
  });

  let entries: Array<{
    id: string;
    identification?: string;
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
    const name = (formData.get("name") as string)?.trim() || "";
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
      name,
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
    const { session } = await authenticate.admin(request);

    await prisma.config.upsert({
      where: { shop: session.shop },
      update: { threshold, creditAmount },
      create: { shop: session.shop, threshold, creditAmount },
    });
    return { success: "config_updated" };
  }

  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification =
      (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";
    const profession = (formData.get("profession") as string)?.trim() || "";
    const adresse = (formData.get("adresse") as string)?.trim() || "";

    if (!id) return { error: "ID manquant" };

    const result = await updateMetaobjectEntry(admin, id, {
      identification,
      name,
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
    name: entry.name || "",
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
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              onKeyDown={handleKeyDown}
              style={styles.input}
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
            {entry.name}
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
                    "ATTENTION ULTIME : \n\nVous allez supprimer ce partenaire et son code promo.",
                  );
                  if (!confirm1) {
                    e.preventDefault();
                    return;
                  }
                  const validation = prompt(
                    "Pour confirmer, tapez le mot 'DELETE' en majuscules ci-dessous :",
                  );
                  if (validation !== "DELETE") {
                    e.preventDefault();
                  }
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
    name: "",
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
        name: "",
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
          name="name"
          placeholder="Prénom NOM *"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
    if (password === "GestionPro") {
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
                    <th style={thStyle}>Prénom NOM</th>
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
              <div style={styles.paginationContainer}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={
                    currentPage === 1 ? styles.pageBtnDisabled : styles.pageBtn
                  }
                >
                  ← Précédent
                </button>
                <span style={{ fontSize: "0.9rem", color: "#555" }}>
                  Page <strong>{currentPage}</strong> sur{" "}
                  <strong>{totalPages || 1}</strong>
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                  style={
                    currentPage === totalPages
                      ? styles.pageBtnDisabled
                      : styles.pageBtn
                  }
                >
                  Suivant →
                </button>
              </div>
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
                    )
                      e.preventDefault();
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
