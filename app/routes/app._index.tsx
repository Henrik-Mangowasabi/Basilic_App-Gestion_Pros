// FICHIER : app/routes/app._index.tsx
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
  destroyMetaobjectStructure // <--- Import de la fonction nucléaire
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

  // 0. RESET TOTAL (DEV ONLY)
  if (actionType === "destroy_structure") {
    const result = await destroyMetaobjectStructure(admin);
    if (result.success) {
       // On attend un peu que Shopify propage la suppression
       await new Promise(resolve => setTimeout(resolve, 2000));
       // Redirection avec message spécifique
       return redirect("/app?success=structure_deleted"); 
    }
    return { error: result.error || "Erreur suppression totale" };
  }

  // 1. Create structure
  if (actionType === "create_structure") {
    const result = await createMetaobject(admin);
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Redirection avec message spécifique
      return redirect("/app?success=structure_created");
    }
    return { error: result.error || "Structure error" };
  }

  // 2. Create entry
  if (actionType === "create_entry") {
    let identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    if (!identification) identification = `ID_${Date.now()}`;
    const montant = montantStr ? parseFloat(montantStr) : NaN;

    const result = await createMetaobjectEntry(admin, { identification, name, email, code, montant, type });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_created");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Creation error" };
  }

  // 3. Update entry
  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    if (!id) return { error: "Missing ID" };
    
    const result = await updateMetaobjectEntry(admin, id, {
      identification, name, email, code, montant: parseFloat(montantStr), type
    });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_updated");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Update error" };
  }

  // 4. Delete entry
  if (actionType === "delete_entry") {
    const id = formData.get("id") as string;
    const result = await deleteMetaobjectEntry(admin, id);
    
    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_deleted");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Deletion error" };
  }

  return { error: "Unknown action" };
};

// --- STYLES ---
const styles = {
  cell: { padding: "10px 8px", fontSize: "0.9rem", verticalAlign: "middle" },
  input: { 
    width: "100%", padding: "6px 8px", 
    border: "1px solid #ccc", borderRadius: "4px", fontSize: "0.9rem",
    boxSizing: "border-box" as const 
  },
  btnAction: {
    padding: "6px", borderRadius: "4px", border: "none", cursor: "pointer", 
    display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px"
  }
};

// --- ROW COMPONENT ---
function EntryRow({ entry, index }: { entry: any; index: number }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  
  const getInitialFormData = () => ({
    identification: entry.identification || "",
    name: entry.name || "",
    email: entry.email || "",
    code: entry.code || "",
    montant: entry.montant !== undefined ? String(entry.montant) : "",
    type: entry.type || "",
  });

  const [formData, setFormData] = React.useState(getInitialFormData);
  const previousEntryId = React.useRef(entry.id);

  React.useEffect(() => {
    if (searchParams.get("success") === "entry_updated") setIsEditing(false);
  }, [searchParams]);

  React.useEffect(() => {
    if (previousEntryId.current !== entry.id) {
      previousEntryId.current = entry.id;
      setFormData(getInitialFormData());
      setIsEditing(false);
    }
  }, [entry.id]);

  const handleSave = () => {
    submit({
      action: "update_entry", id: entry.id, ...formData
    }, { method: "post" });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData(getInitialFormData());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
  };

  return (
    <tr style={{ borderBottom: "1px solid #eee", backgroundColor: index % 2 === 0 ? "white" : "#fcfcfc" }}>
      <td style={{ ...styles.cell, color: "#888", fontSize: "0.8rem", width: "80px" }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>
      
      {isEditing ? (
        <>
          <td style={styles.cell}><input type="text" value={formData.identification} onChange={e => setFormData({...formData, identification: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} placeholder="ID" /></td>
          <td style={styles.cell}><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={styles.cell}><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={styles.cell}><input type="text" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={{...styles.cell, width: "80px"}}><input type="number" step="0.01" value={formData.montant} onChange={e => setFormData({...formData, montant: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={{...styles.cell, width: "70px"}}>
            <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} onKeyDown={handleKeyDown} style={styles.input}>
              <option value="">-</option><option value="%">%</option><option value="€">€</option>
            </select>
          </td>
          <td style={{...styles.cell, width: "90px"}}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={handleSave} style={{...styles.btnAction, backgroundColor: "#008060", color: "white"}} title="Save">✓</button>
              <button type="button" onClick={handleCancel} style={{...styles.btnAction, backgroundColor: "#e2e2e2", color: "#333"}} title="Cancel">✕</button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td style={styles.cell}>{entry.identification}</td>
          <td style={{...styles.cell, fontWeight: "500"}}>{entry.name}</td>
          <td style={styles.cell}>{entry.email}</td>
          <td style={styles.cell}><span style={{background:"#f1f8f5", color:"#008060", padding:"2px 6px", borderRadius:"4px", fontFamily:"monospace"}}>{entry.code}</span></td>
          <td style={styles.cell}>{entry.montant}</td>
          <td style={styles.cell}>{entry.type}</td>
          <td style={styles.cell}>
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={() => setIsEditing(true)} style={{...styles.btnAction, backgroundColor: "#008060", color: "white"}} title="Edit">✎</button>
              <Form method="post" onSubmit={e => !confirm("Voulez-vous vraiment supprimer cette entrée ?") && e.preventDefault()}>
                <input type="hidden" name="action" value="delete_entry" /><input type="hidden" name="id" value={entry.id} />
                <button type="submit" style={{...styles.btnAction, backgroundColor: "#d82c0d", color: "white"}} title="Delete">🗑</button>
              </Form>
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

function NewEntryForm() {
  const [formData, setFormData] = React.useState({ identification: "", name: "", email: "", code: "", montant: "", type: "" });
  const submit = useSubmit();
  const [searchParams] = useSearchParams();

  // Reset form on success
  React.useEffect(() => {
    if (searchParams.get("success") === "entry_created") {
      setFormData({ identification: "", name: "", email: "", code: "", montant: "", type: "" });
      const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement;
      if (nameInput) nameInput.focus();
    }
  }, [searchParams]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    submit({
        action: "create_entry",
        ...formData
    }, { method: "post" });
  }

  return (
    <tr style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #ddd" }}>
      <td style={{...styles.cell, color: "#008060", fontWeight: "bold"}}>New</td>
      <td style={styles.cell}><input type="text" name="identification" placeholder="Auto" value={formData.identification} onChange={e => setFormData({...formData, identification: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input type="text" name="name" placeholder="Name *" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input type="email" name="email" placeholder="Email *" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input type="text" name="code" placeholder="Code *" required value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input type="number" step="0.01" name="montant" placeholder="Amount *" required value={formData.montant} onChange={e => setFormData({...formData, montant: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}>
        <select name="type" required value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} style={styles.input}>
          <option value="">Type</option><option value="%">%</option><option value="€">€</option>
        </select>
      </td>
      <td style={styles.cell}>
        <button type="button" onClick={handleAdd} style={{ padding: "6px 12px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", width: "100%" }}>Add</button>
      </td>
    </tr>
  );
}

// --- MAIN PAGE ---
export default function Index() {
  const { status, entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const successType = searchParams.get("success");

  // LOGIQUE DES MESSAGES
  let successMessage = "";
  if (successType === "entry_created") successMessage = "Entrée créée avec succès";
  else if (successType === "entry_updated") successMessage = "Entrée mise à jour";
  else if (successType === "entry_deleted") successMessage = "Entrée supprimée";
  else if (successType === "structure_created") successMessage = "Création réussite du métaobject";
  else if (successType === "structure_deleted") successMessage = "Suppression réussite du métaobject";

  const [showSuccess, setShowSuccess] = React.useState(!!successType);

  React.useEffect(() => {
    setShowSuccess(!!successType);
    if (successType) {
      const timer = setTimeout(() => {
        searchParams.delete("success");
        setSearchParams(searchParams, { replace: true });
        setShowSuccess(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [successType, searchParams, setSearchParams]);

  const bannerStyle = { padding: "10px 20px", marginBottom: "20px", borderRadius: "6px", maxWidth: "1200px", margin: "0 auto 20px", textAlign: "center" as const, fontWeight: "600", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" };

  return (
    <div style={{ 
      width: "100%", 
      minHeight: "100vh", 
      padding: "20px", 
      backgroundColor: "#f6f6f7", 
      fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
      boxSizing: "border-box"
    }}>
      <h1 style={{ color: "#202223", marginBottom: "20px", textAlign: "center", fontSize: "1.5rem", fontWeight: "600" }}>Pro Health Management</h1>
      
      {/* ZONE DANGER DEV */}
      {status.exists && (
        <div style={{ marginBottom: "20px", padding: "10px", border: "2px dashed red", borderRadius: "8px", backgroundColor: "#fff5f5", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: "1200px", margin: "0 auto 20px" }}>
          <span style={{ color: "#c00", fontWeight: "bold" }}>🔧 ZONE DÉVELOPPEUR</span>
          <Form method="post" onSubmit={(e) => !confirm("ATTENTION : Cela va supprimer TOUTES les entrées, TOUS les codes promos associés, retirer TOUS les tags clients et supprimer la structure. Continuer ?") && e.preventDefault()}>
            <input type="hidden" name="action" value="destroy_structure" />
            <button type="submit" style={{ backgroundColor: "#d82c0d", color: "white", border: "none", padding: "8px 16px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
              ☢️ SUPPRESSION TOTALE (RESET)
            </button>
          </Form>
        </div>
      )}
      {/* FIN ZONE DANGER */}
      
      {showSuccess && <div style={{ ...bannerStyle, backgroundColor: "#008060", color: "white" }}>✓ {successMessage}</div>}
      {actionData?.error && <div style={{ ...bannerStyle, backgroundColor: "#fee", color: "#d82c0d", border: "1px solid #fcc" }}>⚠️ {actionData.error}</div>}
      
      {status.exists ? (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ backgroundColor: "white", borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, color: "#333", fontSize: "1.1rem" }}>Entry List ({entries.length})</h2>
            </div>
            
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#fafafa", borderBottom: "2px solid #eee" }}>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555", width: "80px" }}>ID</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555" }}>Identification</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555" }}>Name</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555" }}>Email</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555" }}>Code</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555", width: "80px" }}>Amount</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555", width: "70px" }}>Type</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.85rem", color: "#555", width: "90px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <NewEntryForm />
                  {entries.map((entry, index) => <EntryRow key={entry.id} entry={entry} index={index} />)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", marginTop: "50px" }}>
          <Form method="post"><input type="hidden" name="action" value="create_structure" /><button type="submit" style={{ padding: "10px 20px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "6px", cursor: "pointer" }}>Create Structure</button></Form>
        </div>
      )}
    </div>
  );
}