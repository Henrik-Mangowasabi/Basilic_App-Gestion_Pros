// FICHIER : app/routes/app.tutoriel.tsx
import { useLoaderData, Link } from "react-router";
import React from "react";
import { authenticate } from "../shopify.server";
import { checkMetaobjectStatus } from "../lib/metaobject.server";
import { readFileSync } from "fs";
import { join } from "path";

export const loader = async ({ request }: any) => {
  const { admin } = await authenticate.admin(request);
  const status = await checkMetaobjectStatus(admin);
  
  // Lire le fichier HTML du guide
  let guideContent = "";
  try {
    // Utiliser path.join pour gérer correctement les chemins sur Windows
    const guidePath = join(process.cwd(), "doc tech", "guide_jollymama.html");
    const fullHtml = readFileSync(guidePath, "utf-8");
    
    // Extraire le contenu entre <body> et </body>
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      guideContent = bodyMatch[1];
    } else {
      // Si pas de balise body trouvée, utiliser tout le contenu
      guideContent = fullHtml;
    }
  } catch (error) {
    console.error("Erreur lecture guide:", error);
    guideContent = `
      <div style="padding: 20px; text-align: center;">
        <h2 style="color: #d82c0d;">Erreur lors du chargement du guide</h2>
        <p>Le fichier guide_jollymama.html n'a pas pu être chargé.</p>
        <p style="color: #666; font-size: 0.9rem;">Erreur: ${error instanceof Error ? error.message : String(error)}</p>
      </div>
    `;
  }
  
  return { isInitialized: status.exists, guideContent };
};

export default function TutorielPage() {
  const { isInitialized, guideContent } = useLoaderData<typeof loader>();

  const styles = {
    wrapper: { 
      width: "100%", 
      padding: "20px", 
      backgroundColor: "#f6f6f7", 
      fontFamily: "-apple-system, sans-serif", 
      boxSizing: "border-box" as const 
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
      transition: "all 0.2s ease" 
    },
    container: {
      maxWidth: "900px",
      margin: "0 auto",
      backgroundColor: "white",
      borderRadius: "12px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
      overflow: "hidden",
      padding: "40px"
    }
  };

  if (!isInitialized) {
    return (
      <div style={{ width: "100%", height: "80vh", display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#f6f6f7" }}>
        <div style={{ backgroundColor: "white", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", maxWidth: "500px", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "15px", color: "#d82c0d" }}>Application non initialisée</h2>
          <Link to="/app" style={{ textDecoration: "none", padding: "12px 24px", backgroundColor: "#008060", color: "white", borderRadius: "8px", fontWeight: "600" }}>
            Aller sur la page principale
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <style>{`.nav-btn:hover { background-color: #f1f8f5 !important; border-color: #008060 !important; box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important; }`}</style>

      <h1 style={{ color: "#202223", marginBottom: "20px", textAlign: "center", fontSize: "1.8rem", fontWeight: "700" }}>
        Tutoriel
      </h1>

      <div style={{ display: "flex", justifyContent: "center", gap: "15px", marginBottom: "20px", flexWrap: "wrap" }}>
        <Link to="/app" className="nav-btn" style={styles.navButton}>
          <span>🏥</span> Gestion Pros de Santé →
        </Link>
        <Link to="/app/codes_promo" className="nav-btn" style={styles.navButton}>
          <span>🏷️</span> Gestion Codes Promo →
        </Link>
        <Link to="/app/clients" className="nav-btn" style={styles.navButton}>
          <span>👥</span> Gestion Clients Pros →
        </Link>
        <Link to="/app/analytique" className="nav-btn" style={styles.navButton}>
          <span>📊</span> Analytique →
        </Link>
      </div>

      <div style={styles.container}>
        {/* Inclure les styles CSS du guide */}
        <style dangerouslySetInnerHTML={{
          __html: `
            :root {
              --primary: #008060;
              --secondary: #005bd3;
              --danger: #d82c0d;
              --light: #f6f6f7;
              --border: #e1e3e5;
              --text: #202223;
            }
            h1 { margin: 0; color: var(--text); font-size: 28px; }
            .subtitle { color: #6d7175; font-size: 16px; margin-top: 5px; }
            .tag {
              background: #e3f1df; color: var(--primary); 
              padding: 2px 8px; border-radius: 4px; 
              font-size: 12px; font-weight: bold; text-transform: uppercase;
              border: 1px solid #b7eb8f;
            }
            section { margin-bottom: 40px; }
            h2 { 
              color: var(--secondary); 
              font-size: 20px; 
              border-left: 4px solid var(--secondary); 
              padding-left: 10px; margin-bottom: 15px; 
            }
            h3 { font-size: 16px; font-weight: 700; margin-top: 20px; color: #444; }
            ul { padding-left: 20px; }
            li { margin-bottom: 8px; }
            .logic-step {
              background: var(--light);
              border: 1px solid var(--border);
              border-radius: 8px;
              padding: 15px;
              margin-top: 10px;
            }
            .logic-step strong { color: var(--primary); }
            code {
              background: #f0f0f0;
              padding: 2px 5px;
              border-radius: 4px;
              font-family: monospace;
              color: #d63384;
              font-size: 0.9em;
            }
            .badge-pro { background: #e4e5e7; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-family: monospace; }
            footer {
              margin-top: 50px;
              padding-top: 20px;
              border-top: 1px solid var(--border);
              text-align: center;
              font-size: 12px;
              color: #8c9196;
            }
          `
        }} />
        <div 
          dangerouslySetInnerHTML={{ __html: guideContent }}
          style={{
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            color: "#202223",
            lineHeight: 1.6
          }}
        />
      </div>
    </div>
  );
}

