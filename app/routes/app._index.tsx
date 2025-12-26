import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, redirect, useSearchParams } from "react-router";
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
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_created");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur lors de la création de l'entrée" };
  }

  // Modifier une entrée (modification globale de tous les champs)
  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    // Validation
    if (!id) {
      return { error: "ID de l'entrée manquant" };
    }
    if (!identification) {
      return { error: "Le champ Identification est requis" };
    }
    if (!name) {
      return { error: "Le champ Name est requis" };
    }
    if (!email) {
      return { error: "Le champ Email est requis" };
    }
    if (!code) {
      return { error: "Le champ Code est requis" };
    }
    if (!montantStr || isNaN(parseFloat(montantStr))) {
      return { error: "Le champ Montant est requis et doit être un nombre valide" };
    }
    if (!type) {
      return { error: "Le champ Type est requis" };
    }
    
    const updateFields: {
      identification: string;
      name: string;
      email: string;
      code: string;
      montant: number;
      type: string;
    } = {
      identification,
      name,
      email,
      code,
      montant: parseFloat(montantStr),
      type,
    };

    const result = await updateMetaobjectEntry(admin, id, updateFields);
    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_updated");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur lors de la modification" };
  }

  // Supprimer une entrée
  if (actionType === "delete_entry") {
    const id = formData.get("id") as string;
    const result = await deleteMetaobjectEntry(admin, id);
    if (result.success) {
      const url = new URL(request.url);
      return redirect(url.pathname + url.search);
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
  const [isEditing, setIsEditing] = React.useState(false);
  const [searchParams] = useSearchParams();
  
  // Fonction pour initialiser les données du formulaire
  const getInitialFormData = () => {
    return {
      identification: entry.identification || "",
      name: entry.name || "",
      email: entry.email || "",
      code: entry.code || "",
      montant: entry.montant !== undefined && entry.montant !== null ? String(entry.montant) : "",
      type: entry.type || "",
    };
  };

  const [formData, setFormData] = React.useState(getInitialFormData);
  const previousEntryId = React.useRef(entry.id);
  const isUserEditingRef = React.useRef(false);

  // Détecter si une mise à jour a réussi et réinitialiser le flag
  React.useEffect(() => {
    if (searchParams.get("success") === "entry_updated") {
      isUserEditingRef.current = false;
      setIsEditing(false);
      setFormData({
        identification: entry.identification || "",
        name: entry.name || "",
        email: entry.email || "",
        code: entry.code || "",
        montant: entry.montant !== undefined && entry.montant !== null ? String(entry.montant) : "",
        type: entry.type || "",
      });
    }
  }, [searchParams, entry]);

  // Mettre à jour formData SEULEMENT si l'ID change (nouvelle entrée ou après redirect)
  // NE JAMAIS mettre à jour si l'utilisateur est en train d'éditer
  React.useEffect(() => {
    // Ne rien faire si l'utilisateur est en train d'éditer
    if (isUserEditingRef.current) {
      return;
    }
    
    if (previousEntryId.current !== entry.id) {
      previousEntryId.current = entry.id;
      // Créer les données directement ici pour éviter les dépendances
      setFormData({
        identification: entry.identification || "",
        name: entry.name || "",
        email: entry.email || "",
        code: entry.code || "",
        montant: entry.montant !== undefined && entry.montant !== null ? String(entry.montant) : "",
        type: entry.type || "",
      });
      setIsEditing(false);
      isUserEditingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const handleEdit = () => {
    console.log("Mode édition activé pour:", entry);
    // IMPORTANT: Mettre le flag AVANT tout autre changement d'état
    // pour éviter que le useEffect ne réinitialise formData
    isUserEditingRef.current = true;
    
    // Réinitialiser formData avec les valeurs actuelles avant d'activer l'édition
    const currentData = getInitialFormData();
    console.log("Données du formulaire avant édition:", currentData);
    setFormData(currentData);
    setIsEditing(true);
  };

  const handleCancel = () => {
    isUserEditingRef.current = false;
    setIsEditing(false);
    // Réinitialiser les valeurs avec les valeurs actuelles de l'entrée
    setFormData(getInitialFormData());
  };

  return (
    <tr style={{
      borderBottom: "1px solid #eee",
      backgroundColor: index % 2 === 0 ? "white" : "#fafafa"
    }}>
      <td style={{ padding: "12px", color: "#666", fontSize: "0.9em" }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>
      {isEditing ? (
        <Form method="post" style={{ display: "contents" }}>
          <input type="hidden" name="action" value="update_entry" />
          <input type="hidden" name="id" value={entry.id} />
          <td style={{ padding: "12px" }}>
            <input
              type="text"
              name="identification"
              value={formData.identification}
              onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
              placeholder="Identification"
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
            />
          </td>
          <td style={{ padding: "12px" }}>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Name"
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
              required
            />
          </td>
          <td style={{ padding: "12px" }}>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="Email"
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
              required
            />
          </td>
          <td style={{ padding: "12px" }}>
            <input
              type="text"
              name="code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              placeholder="Code"
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
              required
            />
          </td>
          <td style={{ padding: "12px" }}>
            <input
              type="number"
              step="0.01"
              name="montant"
              value={formData.montant}
              onChange={(e) => setFormData({ ...formData, montant: e.target.value })}
              placeholder="Montant"
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
              required
            />
          </td>
          <td style={{ padding: "12px" }}>
            <select
              name="type"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              style={{ width: "100%", padding: "8px", border: "2px solid #008060", borderRadius: "4px", fontSize: "0.95em", backgroundColor: "#fff" }}
              required
            >
              <option value="">Sélectionner un type</option>
              <option value="%">%</option>
              <option value="€">€</option>
            </select>
          </td>
          <td style={{ padding: "12px" }}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                type="submit"
                style={{ padding: "6px 12px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.9em", fontWeight: "500" }}
              >
                ✓ Enregistrer
              </button>
              <button
                type="button"
                onClick={handleCancel}
                style={{ padding: "6px 12px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.9em" }}
              >
                ✕ Annuler
              </button>
            </div>
          </td>
        </Form>
      ) : (
        <>
          <td style={{ padding: "12px" }}>
            {entry.identification ? (
              <span>{entry.identification}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            {entry.name ? (
              <span>{entry.name}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            {entry.email ? (
              <span>{entry.email}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            {entry.code ? (
              <span>{entry.code}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            {entry.montant !== undefined && entry.montant !== null ? (
              <span>{entry.montant}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            {entry.type ? (
              <span>{entry.type}</span>
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>vide</span>
            )}
          </td>
          <td style={{ padding: "12px" }}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button
                type="button"
                onClick={handleEdit}
                style={{ padding: "4px 8px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.9em" }}
                title="Modifier"
              >
                ✏️
              </button>
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
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

function NewEntryForm() {
  const [formData, setFormData] = React.useState({
    identification: "",
    name: "",
    email: "",
    code: "",
    montant: "",
    type: "",
  });

  // Réinitialiser le formulaire après succès
  React.useEffect(() => {
    const checkSuccess = () => {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("success") === "entry_created") {
        setFormData({
          identification: "",
          name: "",
          email: "",
          code: "",
          montant: "",
          type: "",
        });
      }
    };
    
    checkSuccess();
    // Vérifier aussi après un court délai pour être sûr
    const timer = setTimeout(checkSuccess, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <tr style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #ddd" }}>
      <td style={{ padding: "8px", color: "#666", fontSize: "0.9em" }}>Nouveau</td>
      <td colSpan={7} style={{ padding: "8px" }}>
        <Form method="post" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="hidden" name="action" value="create_entry" />
          <input
            type="text"
            name="identification"
            value={formData.identification}
            onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
            placeholder="ID (auto si vide)"
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
          />
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Name *"
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
            required
          />
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="Email *"
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
            required
          />
          <input
            type="text"
            name="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            placeholder="Code *"
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
            required
          />
          <input
            type="number"
            step="0.01"
            name="montant"
            value={formData.montant}
            onChange={(e) => setFormData({ ...formData, montant: e.target.value })}
            placeholder="Montant *"
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
            required
          />
          <select
            name="type"
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            style={{ flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" }}
            required
          >
            <option value="">Type *</option>
            <option value="%">%</option>
            <option value="€">€</option>
          </select>
          <button
            type="submit"
            style={{
              padding: "6px 16px",
              backgroundColor: "#008060",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.9em",
              fontWeight: "500"
            }}
          >
            ✓ Ajouter
          </button>
        </Form>
      </td>
    </tr>
  );
}

export default function Index() {
  const { status, entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const successMessage = searchParams.get("success");
  const [showSuccess, setShowSuccess] = React.useState(!!successMessage);

  React.useEffect(() => {
    // Mettre à jour showSuccess quand searchParams change
    const hasSuccess = !!searchParams.get("success");
    setShowSuccess(hasSuccess);
    
    if (hasSuccess) {
      // Nettoyer l'URL après 4 secondes
      const timer = setTimeout(() => {
        searchParams.delete("success");
        setSearchParams(searchParams, { replace: true });
        setShowSuccess(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams]);

  return (
    <div style={{
      width: "100%",
      minHeight: "100vh",
      padding: "2rem",
      backgroundColor: "#f5f5f5",
      fontFamily: "Arial, sans-serif"
    }}>
      <h1 style={{ color: "#333", marginBottom: "2rem", textAlign: "center" }}>app page web</h1>
      
      {showSuccess && successMessage === "entry_created" && (
        <div style={{
          padding: "1rem 2rem",
          marginBottom: "1rem",
          backgroundColor: "#008060",
          color: "white",
          borderRadius: "6px",
          maxWidth: "800px",
          margin: "0 auto 1rem",
          textAlign: "center",
          fontWeight: "600",
          fontSize: "1.1em",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
        }}>
          ✓ Entrée créée avec succès !
        </div>
      )}

      {showSuccess && successMessage === "entry_updated" && (
        <div style={{
          padding: "1rem 2rem",
          marginBottom: "1rem",
          backgroundColor: "#008060",
          color: "white",
          borderRadius: "6px",
          maxWidth: "800px",
          margin: "0 auto 1rem",
          textAlign: "center",
          fontWeight: "600",
          fontSize: "1.1em",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
        }}>
          ✓ Entrée modifiée avec succès !
        </div>
      )}
      
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
                  <NewEntryForm />
                  
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