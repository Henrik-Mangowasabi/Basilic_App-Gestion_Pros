import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, redirect, useSearchParams, useSubmit } from "react-router";
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

// --- LOADER ---
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

// --- ACTION ---
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  // 1. Créer la structure du métaobjet
  if (actionType === "create_structure") {
    const result = await createMetaobject(admin);
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return redirect("/app");
    }
    return { error: result.error || "Erreur lors de la création de la structure" };
  }

  // 2. Créer une nouvelle entrée
  if (actionType === "create_entry") {
    let identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    // Auto-générer l'identification si elle est vide
    if (!identification) {
      identification = `ID_${Date.now()}`;
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

  // 3. Modifier une entrée
  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    if (!id) return { error: "ID manquant" };
    if (!name) return { error: "Le champ Name est requis" };
    if (!email) return { error: "Le champ Email est requis" };
    if (!montantStr || isNaN(parseFloat(montantStr))) return { error: "Montant invalide" };
    
    const result = await updateMetaobjectEntry(admin, id, {
      identification,
      name,
      email,
      code,
      montant: parseFloat(montantStr),
      type,
    });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_updated");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur lors de la modification" };
  }

  // 4. Supprimer une entrée
  if (actionType === "delete_entry") {
    const id = formData.get("id") as string;
    const result = await deleteMetaobjectEntry(admin, id);
    
    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_deleted");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur lors de la suppression" };
  }

  return { error: "Action inconnue" };
};

// --- COMPOSANT LIGNE (Row) ---
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
  const submit = useSubmit(); // Hook pour soumettre le formulaire manuellement
  
  // Initialisation des données
  const getInitialFormData = () => ({
    identification: entry.identification || "",
    name: entry.name || "",
    email: entry.email || "",
    code: entry.code || "",
    montant: entry.montant !== undefined && entry.montant !== null ? String(entry.montant) : "",
    type: entry.type || "",
  });

  const [formData, setFormData] = React.useState(getInitialFormData);
  const isUserEditingRef = React.useRef(false);
  const previousEntryId = React.useRef(entry.id);

  // Gestion de la fin d'édition après succès
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

  // Réinitialisation si l'entrée change
  React.useEffect(() => {
    if (previousEntryId.current !== entry.id) {
      previousEntryId.current = entry.id;
      setFormData(getInitialFormData());
      setIsEditing(false);
      isUserEditingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const handleEdit = () => {
    isUserEditingRef.current = true;
    setFormData(getInitialFormData());
    setIsEditing(true);
  };

  const handleCancel = () => {
    isUserEditingRef.current = false;
    setIsEditing(false);
    setFormData(getInitialFormData());
  };

  // --- CORRECTION MAJEURE ICI : Utilisation de submit() au lieu d'un <Form> ---
  const handleSave = () => {
    // On construit les données à envoyer
    const dataToSubmit = {
      action: "update_entry",
      id: entry.id,
      identification: formData.identification,
      name: formData.name,
      email: formData.email,
      code: formData.code,
      montant: formData.montant,
      type: formData.type
    };

    // On soumet via le hook useSubmit
    submit(dataToSubmit, { method: "post" });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    }
    if (e.key === "Enter") {
        e.preventDefault(); // Empêcher comportement par défaut
        handleSave();
    }
  };

  const cellStyle = { padding: "12px" };
  const inputStyle = { 
    width: "100%", 
    padding: "8px", 
    border: "2px solid #008060", 
    borderRadius: "4px", 
    fontSize: "0.95em" 
  };

  return (
    <tr style={{
      borderBottom: "1px solid #eee",
      backgroundColor: index % 2 === 0 ? "white" : "#fafafa"
    }}>
      <td style={{ ...cellStyle, color: "#666", fontSize: "0.9em" }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>
      
      {isEditing ? (
        // --- MODE ÉDITION (Sans <Form> autour des td) ---
        <>
          <td style={cellStyle}>
            <input type="text" value={formData.identification}
              onChange={(e) => setFormData({ ...formData, identification: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="Identification" autoFocus
            />
          </td>
          <td style={cellStyle}>
            <input type="text" value={formData.name} required
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="Name"
            />
          </td>
          <td style={cellStyle}>
            <input type="email" value={formData.email} required
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="Email"
            />
          </td>
          <td style={cellStyle}>
            <input type="text" value={formData.code} required
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="Code"
            />
          </td>
          <td style={cellStyle}>
            <input type="number" step="0.01" value={formData.montant} required
              onChange={(e) => setFormData({ ...formData, montant: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="Montant"
            />
          </td>
          <td style={cellStyle}>
            <select value={formData.type} required
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              onKeyDown={handleKeyDown}
              style={inputStyle}
            >
              <option value="">Sélectionner</option>
              <option value="%">%</option>
              <option value="€">€</option>
            </select>
          </td>
          <td style={cellStyle}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={handleSave} title="Sauvegarder (Entrée)"
                style={{ padding: "6px 12px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                ✓
              </button>
              <button type="button" onClick={handleCancel} title="Annuler (Échap)"
                style={{ padding: "6px 12px", backgroundColor: "#ccc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                ✕
              </button>
            </div>
          </td>
        </>
      ) : (
        // --- MODE AFFICHAGE ---
        <>
          <td style={cellStyle}>{entry.identification || <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>{entry.name || <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>{entry.email || <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>{entry.code || <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>{entry.montant ?? <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>{entry.type || <i style={{color:"#999"}}>vide</i>}</td>
          <td style={cellStyle}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={handleEdit} title="Modifier"
                style={{ padding: "6px 10px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                ✏️
              </button>
              
              <Form method="post" 
                onSubmit={(e) => {
                  if (!confirm("Êtes-vous sûr de vouloir supprimer définitivement cette entrée ?")) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="action" value="delete_entry" />
                <input type="hidden" name="id" value={entry.id} />
                <button type="submit" title="Supprimer"
                  style={{ padding: "6px 10px", backgroundColor: "#d82c0d", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
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

// --- FORMULAIRE NOUVELLE ENTRÉE ---
function NewEntryForm() {
  const [formData, setFormData] = React.useState({
    identification: "", name: "", email: "", code: "", montant: "", type: "",
  });

  // Reset form after success
  React.useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("success") === "entry_created") {
      setFormData({ identification: "", name: "", email: "", code: "", montant: "", type: "" });
    }
  }, []);

  const inputStyle = { flex: "1", padding: "6px", border: "1px solid #ddd", borderRadius: "4px" };

  return (
    <tr style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #ddd" }}>
      <td style={{ padding: "8px", color: "#666", fontSize: "0.9em" }}>Nouveau</td>
      <td colSpan={7} style={{ padding: "8px" }}>
        <Form method="post" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="hidden" name="action" value="create_entry" />
          <input type="text" name="identification" placeholder="ID (auto)" value={formData.identification}
            onChange={e => setFormData({...formData, identification: e.target.value})} style={inputStyle} />
          
          <input type="text" name="name" placeholder="Name *" required value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
          
          <input type="email" name="email" placeholder="Email *" required value={formData.email}
            onChange={e => setFormData({...formData, email: e.target.value})} style={inputStyle} />
          
          <input type="text" name="code" placeholder="Code *" required value={formData.code}
            onChange={e => setFormData({...formData, code: e.target.value})} style={inputStyle} />
          
          <input type="number" step="0.01" name="montant" placeholder="Montant *" required value={formData.montant}
            onChange={e => setFormData({...formData, montant: e.target.value})} style={inputStyle} />
          
          <select name="type" required value={formData.type}
            onChange={e => setFormData({...formData, type: e.target.value})} style={inputStyle}>
            <option value="">Type *</option>
            <option value="%">%</option>
            <option value="€">€</option>
          </select>
          
          <button type="submit" style={{ padding: "6px 16px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
            Ajouter
          </button>
        </Form>
      </td>
    </tr>
  );
}

// --- PAGE PRINCIPALE ---
export default function Index() {
  const { status, entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const successType = searchParams.get("success");
  const [showSuccess, setShowSuccess] = React.useState(!!successType);

  React.useEffect(() => {
    setShowSuccess(!!successType);
    if (successType) {
      const timer = setTimeout(() => {
        searchParams.delete("success");
        setSearchParams(searchParams, { replace: true });
        setShowSuccess(false);
      }, 4000); // Disparait après 4 secondes
      return () => clearTimeout(timer);
    }
  }, [successType, searchParams, setSearchParams]);

  const bannerStyle = {
    padding: "1rem 2rem", marginBottom: "1rem", borderRadius: "6px",
    maxWidth: "800px", margin: "0 auto 1rem", textAlign: "center" as const,
    fontWeight: "600", boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
  };

  return (
    <div style={{ width: "100%", minHeight: "100vh", padding: "2rem", backgroundColor: "#f5f5f5", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ color: "#333", marginBottom: "2rem", textAlign: "center" }}>Gestion Pro de santé</h1>
      
      {/* MESSAGES DE SUCCÈS */}
      {showSuccess && successType === "entry_created" && (
        <div style={{ ...bannerStyle, backgroundColor: "#008060", color: "white" }}>
          ✓ Entrée créée avec succès !
        </div>
      )}
      {showSuccess && successType === "entry_updated" && (
        <div style={{ ...bannerStyle, backgroundColor: "#008060", color: "white" }}>
          ✓ Entrée modifiée avec succès !
        </div>
      )}
      {showSuccess && successType === "entry_deleted" && (
        <div style={{ ...bannerStyle, backgroundColor: "#d82c0d", color: "white" }}>
          ✓ Entrée supprimée avec succès !
        </div>
      )}
      
      {/* MESSAGE D'ERREUR */}
      {actionData?.error && (
        <div style={{ ...bannerStyle, backgroundColor: "#fee", color: "#c33", border: "1px solid #fcc" }}>
          ⚠️ Erreur : {actionData.error}
        </div>
      )}
      
      {status.exists ? (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ backgroundColor: "white", borderRadius: "8px", padding: "1.5rem", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
            <h2 style={{ marginTop: 0, marginBottom: "1.5rem", color: "#333" }}>
              Liste des entrées ({entries.length})
            </h2>
            
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                  <NewEntryForm />
                  {entries.map((entry, index) => (
                    <EntryRow key={entry.id} entry={entry} index={index} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", marginTop: "50px" }}>
          <div style={{ marginBottom: "20px", color: "#666" }}>La structure de données n'existe pas encore.</div>
          <Form method="post">
            <input type="hidden" name="action" value="create_structure" />
            <button type="submit" style={{ padding: "12px 24px", fontSize: "1rem", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>
              Créer la structure maintenant
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}