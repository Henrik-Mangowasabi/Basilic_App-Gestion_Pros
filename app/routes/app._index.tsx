// FICHIER : app/routes/app._index.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Form, redirect, useSearchParams, useSubmit, useNavigation } from "react-router"; // <--- Ajout de useNavigation
import React from "react";
import { authenticate } from "../shopify.server";
import {
  checkMetaobjectStatus,
  createMetaobject,
  getMetaobjectEntries,
  createMetaobjectEntry,
  updateMetaobjectEntry,
  deleteMetaobjectEntry,
  destroyMetaobjectStructure
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
    customer_id?: string;
    tags?: string[];
  }> = [];
  
  if (status.exists) {
    const entriesResult = await getMetaobjectEntries(admin);
    const rawEntries = entriesResult.entries;

    entries = await Promise.all(rawEntries.map(async (entry: any) => {
        if (!entry.customer_id) {
            return { ...entry, tags: [] };
        }
        try {
            const response = await admin.graphql(
                `#graphql
                query getCustomerTags($id: ID!) {
                    customer(id: $id) {
                        tags
                    }
                }`,
                { variables: { id: entry.customer_id } }
            );
            const { data } = await response.json();
            return { ...entry, tags: data?.customer?.tags || [] };
        } catch (error) {
            console.error("Erreur récup tags pour", entry.name, error);
            return { ...entry, tags: [] };
        }
    }));
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
       await new Promise(resolve => setTimeout(resolve, 2000));
       return redirect("/app?success=structure_deleted"); 
    }
    return { error: result.error || "Erreur suppression totale" };
  }

  // 1. Création de la structure
  if (actionType === "create_structure") {
    const result = await createMetaobject(admin);
    if (result.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return redirect("/app?success=structure_created");
    }
    return { error: result.error || "Erreur création structure" };
  }

  // 2. Création d'une entrée (Ajout Pro)
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
    return { error: result.error || "Erreur création entrée" };
  }

  // 3. Mise à jour d'une entrée
  if (actionType === "update_entry") {
    const id = formData.get("id") as string;
    const identification = (formData.get("identification") as string)?.trim() || "";
    const name = (formData.get("name") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const montantStr = (formData.get("montant") as string)?.trim() || "";
    const type = (formData.get("type") as string)?.trim() || "";

    if (!id) return { error: "ID manquant" };
    
    const result = await updateMetaobjectEntry(admin, id, {
      identification, name, email, code, montant: parseFloat(montantStr), type
    });

    if (result.success) {
      const url = new URL(request.url);
      url.searchParams.set("success", "entry_updated");
      return redirect(url.pathname + url.search);
    }
    return { error: result.error || "Erreur mise à jour" };
  }

  // 4. Suppression d'une entrée
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

// --- PETIT COMPOSANT SPINNER (CSS IN-JS) ---
const Spinner = ({ color = "white", size = "16px" }) => (
  <div style={{
    width: size, height: size,
    border: `2px solid rgba(0,0,0,0.1)`,
    borderTop: `2px solid ${color}`,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    display: "inline-block"
  }}>
    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
  </div>
);

// --- STYLES ---
const styles = {
  cell: { padding: "12px 10px", fontSize: "0.9rem", verticalAlign: "middle", borderBottom: "1px solid #eee" },
  input: { 
    width: "100%", padding: "8px 10px", 
    border: "1px solid #ccc", borderRadius: "4px", fontSize: "0.9rem",
    boxSizing: "border-box" as const,
    transition: "border-color 0.2s"
  },
  btnAction: {
    padding: "0", borderRadius: "4px", border: "none", cursor: "pointer", 
    display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px",
    fontSize: "1.1rem", transition: "opacity 0.2s"
  }
};

// --- COMPOSANT LIGNE (ROW) ---
function EntryRow({ entry, index }: { entry: any; index: number }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const nav = useNavigation(); // <--- Hook pour savoir ce qui charge
  
  // On détecte si CETTE ligne est en cours de modification ou suppression
  const isUpdatingThis = nav.formData?.get("action") === "update_entry" && nav.formData?.get("id") === entry.id;
  const isDeletingThis = nav.formData?.get("action") === "delete_entry" && nav.formData?.get("id") === entry.id;
  const isBusy = isUpdatingThis || isDeletingThis;

  const getInitialFormData = () => ({
    identification: entry.identification || "",
    name: entry.name || "",
    email: entry.email || "",
    code: entry.code || "",
    montant: entry.montant !== undefined ? String(entry.montant) : "",
    type: entry.type || "",
  });

  const [formData, setFormData] = React.useState(getInitialFormData);
  
  React.useEffect(() => {
    if (searchParams.get("success") === "entry_updated") setIsEditing(false);
  }, [searchParams]);

  const handleSave = () => {
    submit({ action: "update_entry", id: entry.id, ...formData }, { method: "post" });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setFormData(getInitialFormData());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
  };

  const rowStyle = { backgroundColor: index % 2 === 0 ? "white" : "#f9fafb", opacity: isBusy ? 0.5 : 1 };

  return (
    <tr style={rowStyle}>
      <td style={{ ...styles.cell, color: "#666", fontSize: "0.8rem", width: "80px" }}>
        {entry.id.split("/").pop()?.slice(-8)}
      </td>
      
      {isEditing ? (
        <>
          <td style={styles.cell}><input disabled={isBusy} type="text" value={formData.identification} onChange={e => setFormData({...formData, identification: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} placeholder="ID" /></td>
          <td style={styles.cell}><input disabled={isBusy} type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={styles.cell}><input disabled={isBusy} type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={styles.cell}><input disabled={isBusy} type="text" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={{...styles.cell, width: "100px"}}><input disabled={isBusy} type="number" step="0.01" value={formData.montant} onChange={e => setFormData({...formData, montant: e.target.value})} onKeyDown={handleKeyDown} style={styles.input} /></td>
          <td style={{...styles.cell, width: "80px"}}>
            <select disabled={isBusy} value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} onKeyDown={handleKeyDown} style={styles.input}>
              <option value="%">%</option><option value="€">€</option>
            </select>
          </td>
          <td style={{...styles.cell, width: "100px"}}>
            <div style={{ display: "flex", gap: "6px" }}>
              <button type="button" onClick={handleSave} disabled={isBusy} style={{...styles.btnAction, backgroundColor: "#008060", color: "white"}} title="Enregistrer">
                {isUpdatingThis ? <Spinner /> : "✓"}
              </button>
              <button type="button" onClick={handleCancel} disabled={isBusy} style={{...styles.btnAction, backgroundColor: "#f4f4f4", color: "#333", border: "1px solid #ddd"}} title="Annuler">✕</button>
            </div>
          </td>
        </>
      ) : (
        <>
          <td style={styles.cell}>{entry.identification}</td>
          <td style={{...styles.cell, fontWeight: "600", color: "#333"}}>{entry.name}</td>
          <td style={styles.cell}>{entry.email}</td>
          <td style={styles.cell}><span style={{background:"#e3f1df", color:"#008060", padding:"4px 8px", borderRadius:"4px", fontFamily:"monospace", fontWeight: "bold"}}>{entry.code}</span></td>
          <td style={styles.cell}>{entry.montant}</td>
          <td style={styles.cell}>{entry.type}</td>
          <td style={styles.cell}>
            <div style={{ display: "flex", gap: "6px" }}>
              <button type="button" disabled={isBusy} onClick={() => setIsEditing(true)} style={{...styles.btnAction, backgroundColor: "white", border: "1px solid #ccc", color: "#555"}} title="Modifier">
                 ✎
              </button>
              <Form method="post" onSubmit={e => !confirm("Voulez-vous vraiment supprimer ce Pro ? \n\nCela supprimera aussi :\n- Le code promo associé\n- Le tag 'pro_sante' sur le client") && e.preventDefault()}>
                <input type="hidden" name="action" value="delete_entry" /><input type="hidden" name="id" value={entry.id} />
                <button type="submit" disabled={isBusy} style={{...styles.btnAction, backgroundColor: "#fff0f0", border: "1px solid #fcc", color: "#d82c0d"}} title="Supprimer">
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
  const [formData, setFormData] = React.useState({ identification: "", name: "", email: "", code: "", montant: "", type: "" });
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const nav = useNavigation();

  // On détecte si on est en train de créer une entrée
  const isCreating = nav.formData?.get("action") === "create_entry";

  React.useEffect(() => {
    if (searchParams.get("success") === "entry_created") {
      setFormData({ identification: "", name: "", email: "", code: "", montant: "", type: "" });
    }
  }, [searchParams]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    submit({ action: "create_entry", ...formData }, { method: "post" });
  }

  return (
    <tr style={{ backgroundColor: "#f0f8ff", borderBottom: "2px solid #cce5ff" }}>
      <td style={{...styles.cell, color: "#005bd3", fontWeight: "bold", borderLeft: "4px solid #005bd3"}}>Nouveau</td>
      <td style={styles.cell}><input disabled={isCreating} type="text" name="identification" placeholder="Auto" value={formData.identification} onChange={e => setFormData({...formData, identification: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input disabled={isCreating} type="text" name="name" placeholder="Nom *" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input disabled={isCreating} type="email" name="email" placeholder="Email *" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input disabled={isCreating} type="text" name="code" placeholder="Code *" required value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}><input disabled={isCreating} type="number" step="0.01" name="montant" placeholder="Valeur *" required value={formData.montant} onChange={e => setFormData({...formData, montant: e.target.value})} style={styles.input} /></td>
      <td style={styles.cell}>
        <select disabled={isCreating} name="type" required value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} style={styles.input}>
          <option value="">Type</option><option value="%">%</option><option value="€">€</option>
        </select>
      </td>
      <td style={styles.cell}>
        <button type="button" disabled={isCreating} onClick={handleAdd} style={{ padding: "8px 12px", backgroundColor: isCreating ? "#8bcbb6" : "#008060", color: "white", border: "none", borderRadius: "4px", cursor: isCreating ? "default" : "pointer", fontWeight: "bold", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: "5px" }}>
          {isCreating ? <><Spinner /> Ajout...</> : "Ajouter"}
        </button>
      </td>
    </tr>
  );
}

// --- PAGE PRINCIPALE ---
export default function Index() {
  const { status, entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigation();
  const successType = searchParams.get("success");

  // Détection des états globaux
  const isDestroying = nav.formData?.get("action") === "destroy_structure";
  const isInitializing = nav.formData?.get("action") === "create_structure";

  // Messages de succès
  let successMessage = "";
  if (successType === "entry_created") successMessage = "Nouveau Pro ajouté & Code promo créé !";
  else if (successType === "entry_updated") successMessage = "Informations mises à jour (et synchronisées) !";
  else if (successType === "entry_deleted") successMessage = "Pro supprimé et nettoyé avec succès.";
  else if (successType === "structure_created") successMessage = "Application initialisée avec succès.";
  else if (successType === "structure_deleted") successMessage = "Tout a été effacé (Reset complet).";

  const [showSuccess, setShowSuccess] = React.useState(!!successType);

  React.useEffect(() => {
    setShowSuccess(!!successType);
    if (successType) {
      const timer = setTimeout(() => {
        searchParams.delete("success");
        setSearchParams(searchParams, { replace: true });
        setShowSuccess(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successType, searchParams, setSearchParams]);

  const bannerStyle = { padding: "12px 20px", marginBottom: "20px", borderRadius: "8px", maxWidth: "1200px", margin: "0 auto 20px", textAlign: "center" as const, fontWeight: "600", boxShadow: "0 2px 5px rgba(0,0,0,0.1)" };

  return (
    <div style={{ 
      width: "100%", minHeight: "100vh", padding: "30px", 
      backgroundColor: "#f6f6f7", fontFamily: "-apple-system, sans-serif"
    }}>
      <h1 style={{ color: "#202223", marginBottom: "30px", textAlign: "center", fontSize: "1.8rem", fontWeight: "700" }}>
        Gestion des Pros de Santé
      </h1>
      
      {/* Messages d'alerte */}
      {showSuccess && <div style={{ ...bannerStyle, backgroundColor: "#008060", color: "white" }}>✓ {successMessage}</div>}
      {actionData?.error && <div style={{ ...bannerStyle, backgroundColor: "#fff5f5", color: "#d82c0d", border: "1px solid #fcc" }}>⚠️ {actionData.error}</div>}
      
      {status.exists ? (
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          
          {/* Tableau */}
          <div style={{ backgroundColor: "white", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fafafa" }}>
              <h2 style={{ margin: 0, color: "#444", fontSize: "1.1rem", fontWeight: "600" }}>Liste des Partenaires ({entries.length})</h2>
            </div>
            
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr style={{ backgroundColor: "white", borderBottom: "2px solid #eee" }}>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888", width: "80px" }}>ID</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888" }}>Ref Interne</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888" }}>Nom</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888" }}>Email</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888" }}>Code Promo</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888", width: "100px" }}>Montant</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888", width: "80px" }}>Type</th>
                    <th style={{ padding: "12px", textAlign: "left", fontSize: "0.8rem", textTransform: "uppercase", color: "#888", width: "100px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <NewEntryForm />
                  {entries.map((entry, index) => <EntryRow key={entry.id} entry={entry} index={index} />)}
                </tbody>
              </table>
            </div>
          </div>

          {/* ZONE DANGER */}
          <div style={{ marginTop: "60px", padding: "20px", borderTop: "1px solid #eee", textAlign: "center" }}>
             <details>
               <summary style={{ cursor: "pointer", color: "#666", fontSize: "0.9rem" }}>Afficher les options développeur (Zone Danger)</summary>
               <div style={{ marginTop: "15px", padding: "15px", border: "1px dashed #d82c0d", borderRadius: "8px", backgroundColor: "#fff5f5", display: "inline-block" }}>
                 <p style={{ color: "#d82c0d", fontWeight: "bold", fontSize: "0.9rem", margin: "0 0 10px 0" }}>⚠️ ATTENTION : SUPPRESSION TOTALE DE L'APPLICATION</p>
                 <Form method="post" onSubmit={(e) => !confirm("ATTENTION ULTIME : \n\nVous allez supprimer :\n1. Tous les Pro de santé enregistrés\n2. Tous les codes promo liés\n3. Retirer le tag de tous les clients\n4. Détruire la définition du Métaobjet\n\nÊtes-vous sûr ?") && e.preventDefault()}>
                   <input type="hidden" name="action" value="destroy_structure" />
                   <button type="submit" disabled={isDestroying} style={{ backgroundColor: "#d82c0d", color: "white", border: "none", padding: "8px 16px", borderRadius: "4px", cursor: isDestroying ? "default" : "pointer", fontWeight: "bold", fontSize: "0.85rem", opacity: isDestroying ? 0.7 : 1, display: "flex", alignItems: "center", gap: "10px", margin: "0 auto" }}>
                     {isDestroying ? <><Spinner /> Suppression en cours...</> : "☢️ TOUT SUPPRIMER & RÉINITIALISER"}
                   </button>
                 </Form>
               </div>
             </details>
          </div>

        </div>
      ) : (
        <div style={{ textAlign: "center", marginTop: "100px" }}>
          <div style={{ backgroundColor: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", maxWidth: "500px", margin: "0 auto" }}>
             <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>Bienvenue !</h2>
             <p style={{ color: "#666", marginBottom: "30px" }}>L'application n'est pas encore initialisée. Cliquez ci-dessous pour créer la structure de base dans Shopify.</p>
             <Form method="post">
                <input type="hidden" name="action" value="create_structure" />
                <button type="submit" disabled={isInitializing} style={{ padding: "12px 24px", backgroundColor: "#008060", color: "white", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "1rem", fontWeight: "600", display: "flex", alignItems: "center", gap: "10px", margin: "0 auto", opacity: isInitializing ? 0.7 : 1 }}>
                   {isInitializing ? <><Spinner /> Initialisation...</> : "🚀 Initialiser l'application"}
                </button>
             </Form>
          </div>
        </div>
      )}
    </div>
  );
}