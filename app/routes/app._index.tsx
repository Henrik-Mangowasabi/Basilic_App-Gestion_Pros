import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import React from "react";
import { authenticate } from "../shopify.server";
import {
  checkMetaobjectStatus,
  createMetaobject,
  getMetaobjectEntries,
  createMetaobjectEntry,
  updateMetaobjectEntry,
  deleteMetaobjectEntry,
} from "../lib/metaobject.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);
  
  let entries: Array<{
    id: string;
    identification?: string;
    name?: string;
    email?: string;
    code?: string;
    montant?: number;
    type?: string;
  }> = [];
  
  if (status.exists) {
    const entriesResult = await getMetaobjectEntries(admin);
    entries = entriesResult.entries;
  }
  
  return { status, entries };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  // Créer la structure du métaobjet si elle n'existe pas
  if (actionType === "create_structure") {
    const result = await createMetaobject(admin);
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return redirect("/app");
    }
    return { error: result.error || "Erreur lors de la création" };
  }

  // Créer une nouvelle entrée
  if (actionType === "create_entry") {
    let identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    // Auto-générer l'identification si elle est vide
    if (!identification || identification === "") {
      identification = `ID_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    const montant = montantStr ? parseFloat(montantStr) : NaN;

    const result = await createMetaobjectEntry(admin, {
      identification,
      name,
      email,
      code,
      montant,
      type,
    });
    if (result.success) {
      return redirect("/app");
    }
    return { error: result.error || "Erreur lors de la création de l'entrée" };
  }

  // Modifier une entrée
  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const field = formData.get("field") as string;
    const value = (formData.get("value") as string)?.trim() || "";

    // Validation : la valeur ne doit pas être vide
    if (!value || value === "") {
      return { error: `Le champ ${field} ne peut pas être vide` };
    }
    
    const updateFields: {
      identification?: string;
      name?: string;
      email?: string;
      code?: string;
      montant?: number;
      type?: string;
    } = {};
    
    if (field === "montant") {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) {
        return { error: "Le montant doit être un nombre valide" };
      }
      updateFields.montant = numValue;
    } else if (field === "identification") {
      updateFields.identification = value;
    } else if (field === "name") {
      updateFields.name = value;
    } else if (field === "email") {
      updateFields.email = value;
    } else if (field === "code") {
      updateFields.code = value;
    } else if (field === "type") {
      updateFields.type = value;
    }

    const result = await updateMetaobjectEntry(admin, id, updateFields);
    if (result.success) {
      return redirect("/app");
    }
    return { error: result.error || "Erreur lors de la modification" };
  }

  // Supprimer une entrée
  if (actionType === "delete_entry") {
    const id = formData.get("id") as string;
    const result = await deleteMetaobjectEntry(admin, id);
    if (result.success) {
      return redirect("/app");
    }
    return { error: result.error || "Erreur lors de la suppression" };
  }

  return { error: "Action inconnue" };
};

function EntryRow({ entry, index }: { 
  entry: {
    id: string;
    identification?: string;
    name?: string;
    email?: string;
    code?: string;
    montant?: number;
    type?: string;
  }; 
  index: number;
}) {
  const [editing, setEditing] = React.useState<{ field: string | null; value: string }>({ field: null, value: "" });

  const handleEdit = (field: string, currentValue: string | number | undefined) => {
    setEditing({ field, value: String(currentValue || "") });
  };

  const handleSave = (field: string) => {
    const form = document.createElement("form");
    form.method = "post";
    form.innerHTML = `
      <input type="hidden" name="action" value="update_entry" />
      <input type="hidden" name="id" value="${entry.id}" />
      <input type="hidden" name="field" value="${field}" />
      <input type="hidden" name="value" value="${editing.value}" />
    `;
    document.body.appendChild(form);
    form.submit();
  };

  return (
    <tr style={{
      borderBottom: "1px solid #eee",
      backgroundColor: index % 2 === 0 ? "white" : "#fafafa"
    }}>
      <td style={{ padding: "12px", color: "#666", fontSize: "0.9em" }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "identification" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              type="text"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            />
            <button
              onClick={() => handleSave("identification")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.identification || "-"}</span>
            <button
              onClick={() => handleEdit("identification", entry.identification)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "name" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              type="text"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            />
            <button
              onClick={() => handleSave("name")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.name || "-"}</span>
            <button
              onClick={() => handleEdit("name", entry.name)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "email" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              type="email"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            />
            <button
              onClick={() => handleSave("email")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.email || "-"}</span>
            <button
              onClick={() => handleEdit("email", entry.email)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "code" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              type="text"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            />
            <button
              onClick={() => handleSave("code")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.code || "-"}</span>
            <button
              onClick={() => handleEdit("code", entry.code)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "montant" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <input
              type="number"
              step="0.01"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            />
            <button
              onClick={() => handleSave("montant")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.montant !== undefined ? entry.montant : "-"}</span>
            <button
              onClick={() => handleEdit("montant", entry.montant)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        {editing.field === "type" ? (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <select
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              style={{ flex: 1, padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
            >
              <option value="%">%</option>
              <option value="€">€</option>
            </select>
            <button
              onClick={() => handleSave("type")}
              style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✓
            </button>
            <button
              onClick={() => setEditing({ field: null, value: "" })}
              style={{ padding: "4px 8px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>{entry.type || "-"}</span>
            <button
              onClick={() => handleEdit("type", entry.type)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.9em" }}
              title="Modifier"
            >
              ✏️
            </button>
          </div>
        )}
      </td>
      <td style={{ padding: "12px" }}>
        <Form method="post">
          <input type="hidden" name="action" value="delete_entry" />
          <input type="hidden" name="id" value={entry.id} />
          <button
            type="submit"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.2em",
              padding: "4px 8px"
            }}
            title="Supprimer"
            onClick={(e) => {
              if (!confirm("Êtes-vous sûr de vouloir supprimer cette entrée ?")) {
                e.preventDefault();
              }
            }}
          >
            🗑️
          </button>
        </Form>
      </td>
    </tr>
  );
}

export default function Index() {
  const { status, entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{
      width: "100%",
      minHeight: "100vh",
      padding: "2rem",
      backgroundColor: "#f5f5f5",
      fontFamily: "Arial, sans-serif"
    }}>
      <h1 style={{ color: "#333", marginBottom: "2rem", textAlign: "center" }}>app page web</h1>
      
      {actionData?.error && (
        <div style={{
          padding: "1rem",
          marginBottom: "1rem",
          backgroundColor: "#fee",
          color: "#c33",
          borderRadius: "4px",
          maxWidth: "800px",
          margin: "0 auto 1rem"
        }}>
          Erreur : {actionData.error}
        </div>
      )}
      
      {status.exists ? (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{
            padding: "1rem 2rem",
            backgroundColor: "#efe",
            color: "#3a3",
            borderRadius: "4px",
            fontSize: "1.2rem",
            marginBottom: "2rem",
            textAlign: "center"
          }}>
            Structure créée !
          </div>
          
          <div style={{
            backgroundColor: "white",
            borderRadius: "8px",
            padding: "1.5rem",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}>
            <h2 style={{ marginTop: 0, marginBottom: "1.5rem", color: "#333" }}>
              Entrées du métaobjet ({entries.length})
            </h2>
            
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse"
              }}>
                <thead>
                  <tr style={{ backgroundColor: "#f8f8f8" }}>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>ID</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Identification</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Name</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Email</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Code</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Montant</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Type</th>
                    <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Ligne pour ajouter une nouvelle entrée */}
                  <Form method="post">
                    <input type="hidden" name="action" value="create_entry" />
                    <tr style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #ddd" }}>
                      <td style={{ padding: "8px", color: "#666", fontSize: "0.9em" }}>Nouveau</td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          name="identification"
                          placeholder="ID (auto si vide)"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          name="name"
                          placeholder="Name"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                          required
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="email"
                          name="email"
                          placeholder="Email"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                          required
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          name="code"
                          placeholder="Code"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                          required
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="number"
                          step="0.01"
                          name="montant"
                          placeholder="Montant"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                          required
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <select
                          name="type"
                          style={{ width: "100%", padding: "4px", border: "1px solid #ddd", borderRadius: "4px" }}
                          required
                        >
                          <option value="">Type</option>
                          <option value="%">%</option>
                          <option value="€">€</option>
                        </select>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <button
                          type="submit"
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#008060",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.9em"
                          }}
                        >
                          ✓
                        </button>
                      </td>
                    </tr>
                  </Form>
                  
                  {/* Lignes existantes */}
                  {entries.map((entry, index) => (
                    <EntryRow key={entry.id} entry={entry} index={index} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <Form method="post">
            <input type="hidden" name="action" value="create_structure" />
            <button
              type="submit"
              style={{
                padding: "12px 24px",
                fontSize: "1rem",
                backgroundColor: "#008060",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "500"
              }}
            >
              Créer structure
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}