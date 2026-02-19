// FICHIER : app/routes/app.validation.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation, redirect } from "react-router";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { createMetaobjectEntry, getMetaobjectEntries } from "../lib/metaobject.server";
import { updateCustomerInShopify } from "../lib/customer.server";
import { useEditMode } from "../context/EditModeContext";

// ────────────────────────────────────────────────────────────────────────────────
// LOADER
// ────────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const query = `#graphql
    query getCustomersPending($cursor: String) {
      customers(first: 250, after: $cursor) {
        edges {
          node {
            id
            firstName
            lastName
            email
            defaultAddress {
              address1
              city
              zip
              country
            }
            proMeta: metafield(namespace: "custom", key: "pro_en_attente_de_validation") {
              value
            }
            professionMeta: metafield(namespace: "custom", key: "profession") {
              value
            }
            adresseMeta: metafield(namespace: "custom", key: "adresse") {
              value
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const customers: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    address: string;
    profession: string;
    metafieldValue: string;
  }[] = [];

  let hasNextPage = true;
  let cursor: string | null = null;
  let pages = 0;

  try {
    while (hasNextPage && pages < 20) {
      const response = await admin.graphql(query, { // eslint-disable-line @typescript-eslint/no-explicit-any
        variables: { cursor },
      });
      const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const edges = data.data?.customers?.edges || [];

      for (const edge of edges) {
        const c = edge.node;
        const metaValue: string = c.proMeta?.value ?? "";
        if (metaValue.trim() && metaValue !== "rejeté") {
          const addr = c.defaultAddress;
          const adresseMeta = c.adresseMeta?.value || "";
          customers.push({
            id: c.id,
            firstName: c.firstName || "",
            lastName: c.lastName || "",
            email: c.email || "",
            address: adresseMeta || (addr
              ? [addr.address1, addr.city, addr.zip, addr.country].filter(Boolean).join(", ")
              : "—"),
            profession: c.professionMeta?.value || "—",
            metafieldValue: metaValue,
          });
        }
      }

      hasNextPage = !!data.data?.customers?.pageInfo?.hasNextPage;
      cursor = data.data?.customers?.pageInfo?.endCursor ?? null;
      pages++;
    }
  } catch (e) {
    console.error("Erreur chargement validations:", e);
  }

  // Fetch existing codes for uniqueness check
  const entriesResult = await getMetaobjectEntries(admin);
  const existingCodes = entriesResult.entries.map((e: any) => e.code).filter(Boolean);

  return { customers, existingCodes, shopDomain };
};

// ────────────────────────────────────────────────────────────────────────────────
// ACTION
// ────────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("action");

  // ─── ACCEPT PRO ───
  if (actionType === "accept_pro") {
    const customerId = formData.get("customerId") as string;
    const firstName = (formData.get("firstName") as string)?.trim() || "";
    const lastName = (formData.get("lastName") as string)?.trim() || "";
    const email = (formData.get("email") as string)?.trim() || "";
    const profession = (formData.get("profession") as string)?.trim() || "";
    const adresse = (formData.get("adresse") as string)?.trim() || "";
    const code = (formData.get("code") as string)?.trim() || "";
    const value = parseFloat(formData.get("value") as string);
    const type = (formData.get("type") as string)?.trim() || "%";

    const identification = `${(firstName.slice(0, 2) + lastName.slice(0, 2)).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

    // Create metaobject entry
    const result = await createMetaobjectEntry(admin, {
      identification,
      first_name: firstName,
      last_name: lastName,
      email,
      code,
      montant: value,
      type,
      profession,
      adresse,
    });

    if (!result.success) {
      return { error: result.error || "Erreur création pro" };
    }

    // Delete metafield
    try {
      const deleteMetaMutation = `#graphql
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              ownerId
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      await admin.graphql(deleteMetaMutation, {
        variables: {
          metafields: [
            {
              ownerId: customerId,
              namespace: "custom",
              key: "pro_en_attente_de_validation",
            },
          ],
        },
      });
    } catch (e) {
      console.error("Erreur suppression metafield:", e);
    }

    return redirect("/app/validation?success=pro_accepted");
  }

  // ─── REJECT PRO ───
  if (actionType === "reject_pro") {
    const customerId = formData.get("customerId") as string;

    try {
      const updateMetaMutation = `#graphql
        mutation customerUpdate($input: CustomerInput!) {
          customerUpdate(input: $input) {
            customer { id }
            userErrors { field message }
          }
        }
      `;
      await admin.graphql(updateMetaMutation, {
        variables: {
          input: {
            id: customerId,
            metafields: [
              {
                namespace: "custom",
                key: "pro_en_attente_de_validation",
                value: "rejeté",
                type: "single_line_text_field",
              },
            ],
          },
        },
      });
    } catch (e) {
      console.error("Erreur reject:", e);
      return { error: "Erreur lors du rejet" };
    }

    return redirect("/app/validation?success=pro_rejected");
  }

  // ─── UPDATE CUSTOMER ───
  if (actionType === "update_customer") {
    const customerId = formData.get("customerId") as string;
    const firstName = (formData.get("firstName") as string) || undefined;
    const lastName = (formData.get("lastName") as string) || undefined;
    const email = (formData.get("email") as string) || undefined;
    const profession = (formData.get("profession") as string) || undefined;
    const adresse = (formData.get("adresse") as string) || undefined;

    const result = await updateCustomerInShopify(
      admin,
      customerId,
      email,
      firstName,
      lastName,
      profession,
      adresse,
    );

    if (!result.success) {
      return { error: result.error || "Erreur mise à jour client" };
    }

    return redirect("/app/validation?success=customer_updated");
  }

  // ─── BULK ACCEPT ───
  if (actionType === "bulk_accept") {
    const idsRaw = formData.get("customerIds") as string;
    const value = parseFloat(formData.get("value") as string);
    const type = (formData.get("type") as string)?.trim() || "%";
    const codePrefix = (formData.get("codePrefix") as string)?.trim() || "PRO_";

    const ids = idsRaw ? idsRaw.split(",").filter(Boolean) : [];

    // Fetch existing codes
    const entriesResult = await getMetaobjectEntries(admin);
    const existingCodes = new Set(
      entriesResult.entries.map((e: any) => e.code).filter(Boolean),
    );

    let succeeded = 0;
    let failed = 0;

    for (const customerId of ids) {
      try {
        // Fetch customer details
        const customerQuery = `#graphql
          query getCustomer($id: ID!) {
            customer(id: $id) {
              id
              firstName
              lastName
              email
              professionMeta: metafield(namespace: "custom", key: "profession") { value }
              adresseMeta: metafield(namespace: "custom", key: "adresse") { value }
            }
          }
        `;
        const response = await admin.graphql(customerQuery, { variables: { id: customerId } });
        const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const customer = data.data?.customer;

        if (!customer) {
          failed++;
          continue;
        }

        const firstName = customer.firstName || "";
        const lastName = customer.lastName || "";
        const email = customer.email || "";
        const profession = customer.professionMeta?.value || "";
        const adresse = customer.adresseMeta?.value || "";

        // Generate unique code
        const code = generatePromoCode(firstName, lastName, codePrefix, existingCodes);
        existingCodes.add(code);

        const identification = `${(firstName.slice(0, 2) + lastName.slice(0, 2)).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

        // Create entry
        const result = await createMetaobjectEntry(admin, {
          identification,
          first_name: firstName,
          last_name: lastName,
          email,
          code,
          montant: value,
          type,
          profession,
          adresse,
        });

        if (!result.success) {
          failed++;
          continue;
        }

        // Clear metafield
        const updateMetaMutation = `#graphql
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer { id }
              userErrors { field message }
            }
          }
        `;
        await admin.graphql(updateMetaMutation, {
          variables: {
            input: {
              id: customerId,
              metafields: [
                {
                  namespace: "custom",
                  key: "pro_en_attente_de_validation",
                  value: "",
                  type: "single_line_text_field",
                },
              ],
            },
          },
        });

        succeeded++;
      } catch (e) {
        console.error("Erreur bulk accept:", e);
        failed++;
      }
    }

    return redirect(`/app/validation?success=bulk_accept&count=${succeeded}`);
  }

  // ─── BULK REJECT ───
  if (actionType === "bulk_reject") {
    const idsRaw = formData.get("customerIds") as string;
    const ids = idsRaw ? idsRaw.split(",").filter(Boolean) : [];

    let count = 0;

    for (const customerId of ids) {
      try {
        const updateMetaMutation = `#graphql
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer { id }
              userErrors { field message }
            }
          }
        `;
        await admin.graphql(updateMetaMutation, {
          variables: {
            input: {
              id: customerId,
              metafields: [
                {
                  namespace: "custom",
                  key: "pro_en_attente_de_validation",
                  value: "rejeté",
                  type: "single_line_text_field",
                },
              ],
            },
          },
        });
        count++;
      } catch (e) {
        console.error("Erreur bulk reject:", e);
      }
    }

    return redirect(`/app/validation?success=bulk_reject&count=${count}`);
  }

  return { error: "Action inconnue" };
};

// ────────────────────────────────────────────────────────────────────────────────
// COMPONENT: Spinner
// ────────────────────────────────────────────────────────────────────────────────
function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// HELPER: Generate unique promo code
// ────────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────────
// COMPONENT: Accept Modal
// ────────────────────────────────────────────────────────────────────────────────
function AcceptModal({
  customer,
  onClose,
  defaultSettings,
  existingCodes,
  isLocked,
  setProcessingCustomerId,
}: {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profession: string;
    address: string;
  };
  onClose: () => void;
  defaultSettings: { value: number; type: string; codePrefix: string };
  existingCodes: Set<string>;
  isLocked: boolean;
  setProcessingCustomerId: (id: string) => void;
}) {
  const submit = useSubmit();
  const autoCode = generatePromoCode(
    customer.firstName,
    customer.lastName,
    defaultSettings.codePrefix,
    existingCodes,
  );

  const [firstName, setFirstName] = useState(customer.firstName);
  const [lastName, setLastName] = useState(customer.lastName);
  const [email, setEmail] = useState(customer.email);
  const [address, setAddress] = useState(customer.address);
  const [profession, setProfession] = useState(customer.profession);
  const [code, setCode] = useState(autoCode);
  const [value, setValue] = useState(defaultSettings.value);
  const [type, setType] = useState(defaultSettings.type);

  const handleSubmit = () => {
    setProcessingCustomerId(customer.id);
    const formData = new FormData();
    formData.append("action", "accept_pro");
    formData.append("customerId", customer.id);
    formData.append("firstName", firstName);
    formData.append("lastName", lastName);
    formData.append("email", email);
    formData.append("profession", profession);
    formData.append("adresse", address);
    formData.append("code", code);
    formData.append("value", String(value));
    formData.append("type", type);
    submit(formData, { method: "post" });
    onClose();
  };

  return (
    <div role="presentation" className="bsl-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Accepter Professionnel" className="bsl-modal__dialog bsl-modal__dialog--md" onClick={(e) => e.stopPropagation()}>
        <div className="bsl-modal__header">
          <h2 className="bsl-modal__title">
            Accepter {customer.firstName} {customer.lastName}
          </h2>
          <button type="button" onClick={onClose} className="bsl-modal__close">✕</button>
        </div>
        <div className="bsl-modal__body">
          <div className="bsl-modal__grid2">
            <div>
              <label className="bsl-modal__label">Prénom *</label>
              <input
                className="bsl-modal__input"
                placeholder="Prénom"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className="bsl-modal__label">Nom *</label>
              <input
                className="bsl-modal__input"
                placeholder="Nom"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="bsl-modal__label">Email *</label>
            <input
              className="bsl-modal__input"
              type="email"
              placeholder="email@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="bsl-modal__label">Adresse</label>
            <input
              className="bsl-modal__input"
              placeholder="Ville, Code postal..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div>
            <label className="bsl-modal__label">Profession</label>
            <input
              className="bsl-modal__input"
              placeholder="Ex: Médecin généraliste"
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
            />
          </div>
          <div className="bsl-modal__promo-section">
            <div>
              <label className="bsl-modal__label">Code Promo *</label>
              <input
                className="bsl-modal__input bsl-modal__input--code"
                placeholder="Ex: MEDECIN10"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="bsl-modal__grid2">
              <div>
                <label className="bsl-modal__label">Montant *</label>
                <input
                  className="bsl-modal__input"
                  type="number"
                  placeholder="10"
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  step="0.01"
                />
              </div>
              <div>
                <label className="bsl-modal__label">Type</label>
                <select
                  className="bsl-modal__input bsl-modal__select"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLocked}
            className="bsl-modal__btn bsl-modal__btn--primary"
            style={{ opacity: isLocked ? 0.7 : 1 }}
          >
            Créer le Partenaire
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// COMPONENT: Bulk Confirmation Modal
// ────────────────────────────────────────────────────────────────────────────────
function BulkConfirmModal({
  count,
  action,
  onConfirm,
  onClose,
  isLocked,
  customerName,
}: {
  count: number;
  action: "accept" | "reject";
  onConfirm: () => void;
  onClose: () => void;
  isLocked: boolean;
  customerName?: string;
}) {
  const title = action === "accept" ? "Accepter" : "Rejeter";
  const message =
    action === "accept"
      ? `Voulez-vous accepter ${count} professionnel(s) avec les paramètres par défaut ?`
      : customerName
        ? `Voulez-vous rejeter la demande de ${customerName} ?`
        : `Voulez-vous rejeter ${count} demande(s) ?`;
  const confirmLabel = action === "accept" ? "Accepter" : "Rejeter";
  const btnClass = action === "accept" ? "bsl-modal__btn--primary" : "bsl-modal__btn--danger";

  return (
    <div className="bsl-modal" onClick={onClose}>
      <div className="bsl-modal__dialog bsl-modal__dialog--sm" onClick={(e) => e.stopPropagation()}>
        <div className="bsl-modal__header">
          <h3 className="bsl-modal__title">{title}</h3>
          <button type="button" onClick={onClose} className="bsl-modal__close" aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="bsl-modal__body">
          <p>{message}</p>
        </div>
        <div className="bsl-modal__footer">
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isLocked}
            className={`bsl-modal__btn ${btnClass}`}
            style={{
              opacity: isLocked ? 0.5 : 1,
              cursor: isLocked ? "not-allowed" : "pointer",
              background: isLocked ? "var(--color-gray-300)" : undefined,
              color: isLocked ? "var(--color-gray-500)" : undefined,
            }}
          >
            {confirmLabel}
          </button>
          <button type="button" onClick={onClose} className="bsl-modal__btn">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────────
export default function ValidationPage() {
  const { customers, existingCodes: rawExistingCodes, shopDomain } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { isLocked, showToast } = useEditMode();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [acceptingCustomer, setAcceptingCustomer] = useState<any>(null);
  const [bulkModal, setBulkModal] = useState<"accept" | "reject" | null>(null);
  const [rejectingCustomer, setRejectingCustomer] = useState<{ id: string; name: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ customerId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [processingCustomerId, setProcessingCustomerId] = useState<string | null>(null);

  const [defaultSettings, setDefaultSettings] = useState({
    value: 5,
    type: "%",
    codePrefix: "PRO_",
  });

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("validation_defaults");
      if (stored) setDefaultSettings(JSON.parse(stored));
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  }, []);

  // Store validation count for navbar badge
  useEffect(() => {
    try {
      localStorage.setItem("validation_pending_count", String(customers.length));
    } catch (e) {
      console.error("Error storing validation count:", e);
    }
  }, [customers.length]);

  // Toast notifications
  useEffect(() => {
    const url = new URL(window.location.href);
    const success = url.searchParams.get("success");
    if (success === "pro_accepted") {
      showToast({ title: "Succès", msg: "Professionnel accepté avec succès.", type: "success" });
    } else if (success === "pro_rejected") {
      showToast({ title: "Succès", msg: "Demande rejetée.", type: "info" });
    } else if (success === "customer_updated") {
      showToast({ title: "Succès", msg: "Client mis à jour.", type: "success" });
    } else if (success === "bulk_accept") {
      const count = url.searchParams.get("count") || "0";
      showToast({ title: "Succès", msg: `${count} professionnel(s) accepté(s).`, type: "success" });
    } else if (success === "bulk_reject") {
      const count = url.searchParams.get("count") || "0";
      showToast({ title: "Succès", msg: `${count} demande(s) rejetée(s).`, type: "info" });
    }
  }, [showToast]);

  // Reset processing state when navigation completes
  useEffect(() => {
    if (navigation.state === "idle") {
      setProcessingCustomerId(null);
    }
  }, [navigation.state]);

  const filtered = searchQuery
    ? customers.filter((c) =>
        `${c.firstName} ${c.lastName} ${c.email} ${c.profession} ${c.metafieldValue}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
      )
    : customers;

  const existingCodes = new Set(rawExistingCodes);

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBulkAccept = () => {
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.append("action", "bulk_accept");
    formData.append("customerIds", Array.from(selectedIds).join(","));
    formData.append("value", String(defaultSettings.value));
    formData.append("type", defaultSettings.type);
    formData.append("codePrefix", defaultSettings.codePrefix);
    submit(formData, { method: "post" });
    setSelectedIds(new Set());
  };

  const handleBulkReject = () => {
    if (selectedIds.size === 0) return;
    const formData = new FormData();
    formData.append("action", "bulk_reject");
    formData.append("customerIds", Array.from(selectedIds).join(","));
    submit(formData, { method: "post" });
    setSelectedIds(new Set());
  };

  const handleReject = (customer: any) => {
    setRejectingCustomer({
      id: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
    });
  };

  const confirmSingleReject = () => {
    if (!rejectingCustomer) return;
    const formData = new FormData();
    formData.append("action", "reject_pro");
    formData.append("customerId", rejectingCustomer.id);
    submit(formData, { method: "post" });
    setRejectingCustomer(null);
  };

  const handleSaveEdit = (customer: any) => {
    if (!editValue.trim()) {
      setEditingCell(null);
      return;
    }

    const formData = new FormData();
    formData.append("action", "update_customer");
    formData.append("customerId", customer.id);

    if (editingCell?.field === "firstName") {
      formData.append("firstName", editValue);
      formData.append("lastName", customer.lastName);
    } else if (editingCell?.field === "lastName") {
      formData.append("firstName", customer.firstName);
      formData.append("lastName", editValue);
    } else if (editingCell?.field === "email") {
      formData.append("email", editValue);
    } else if (editingCell?.field === "profession") {
      formData.append("profession", editValue);
    } else if (editingCell?.field === "address") {
      formData.append("adresse", editValue);
    }

    formData.append("email", customer.email);
    formData.append("profession", customer.profession);
    formData.append("adresse", customer.address);

    submit(formData, { method: "post" });
    setEditingCell(null);
  };

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <h1 className="page-header__title">Validation Pros Santés</h1>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="grow" />
        <div className="search-container">
          <div className="basilic-search">
            <div className="basilic-search__icon">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <input
              type="text"
              className="basilic-search__input"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Rechercher un professionnel en attente"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="table-card">
        <div className="table-card__header">
          <span className="table-card__title">
            Professionnels en attente de validation
            {filtered.length !== customers.length && (
              <span className="val-table-count">
                {" "}
                — {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>
        <div className="table-scroll">
          <table className="ui-table">
            <thead className="ui-table__thead">
              <tr className="ui-table__header-row">
                <th className="ui-table__th ui-table__th--checkbox ui-table__th--base">
                  <input
                    type="checkbox"
                    className="ui-checkbox__input"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th className="ui-table__th ui-table__th--base">Prénom Nom</th>
                <th className="ui-table__th ui-table__th--base">Email</th>
                <th className="ui-table__th ui-table__th--base">Adresse</th>
                <th className="ui-table__th ui-table__th--base">Profession</th>
                <th className="ui-table__th ui-table__th--center ui-table__th--base" style={{ width: "60px" }}>Lien</th>
                <th className="ui-table__th ui-table__th--center ui-table__th--base val-th--etat">État</th>
                <th className="ui-table__th ui-table__th--center ui-table__th--base">Actions</th>
              </tr>
            </thead>
            <tbody className="ui-table__tbody">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="ui-table__td ui-table__td--empty">
                    {searchQuery
                      ? "Aucun résultat pour cette recherche."
                      : "Aucun professionnel en attente de validation."}
                  </td>
                </tr>
              ) : (
                filtered.map((customer) => {
                  const isEditing = editingCell?.customerId === customer.id;
                  return (
                    <tr key={customer.id} className={`ui-table__row${selectedIds.has(customer.id) ? " ui-table__row--selected" : ""}`}>
                      <td className="ui-table__td ui-table__td--checkbox">
                        <input
                          type="checkbox"
                          className="ui-checkbox__input"
                          checked={selectedIds.has(customer.id)}
                          onChange={() => toggleSelect(customer.id)}
                          aria-label={`Sélectionner ${customer.firstName} ${customer.lastName}`}
                        />
                      </td>
                      <td className="ui-table__td">
                        {isEditing && editingCell?.field === "firstName" && !isLocked ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleSaveEdit(customer)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(customer)}
                            className="val-edit-input"
                          />
                        ) : (
                          <div className="mf-cell mf-cell--multi">
                            <span
                              className="mf-text--title val-editable-cell"
                              onDoubleClick={() => {
                                if (!isLocked) {
                                  setEditingCell({ customerId: customer.id, field: "firstName" });
                                  setEditValue(customer.firstName);
                                }
                              }}
                            >
                              {customer.firstName} {customer.lastName}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="ui-table__td">
                        {isEditing && editingCell?.field === "email" && !isLocked ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleSaveEdit(customer)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(customer)}
                            className="val-edit-input"
                          />
                        ) : (
                          <div className="mf-cell mf-cell--start">
                            <span
                              className="mf-text--title val-editable-cell"
                              onDoubleClick={() => {
                                if (!isLocked) {
                                  setEditingCell({ customerId: customer.id, field: "email" });
                                  setEditValue(customer.email);
                                }
                              }}
                            >
                              {customer.email || "—"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="ui-table__td">
                        {isEditing && editingCell?.field === "address" && !isLocked ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleSaveEdit(customer)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(customer)}
                            className="val-edit-input"
                          />
                        ) : (
                          <div className="mf-cell mf-cell--start">
                            <span
                              className="mf-text--title val-editable-cell"
                              onDoubleClick={() => {
                                if (!isLocked) {
                                  setEditingCell({ customerId: customer.id, field: "address" });
                                  setEditValue(customer.address);
                                }
                              }}
                            >
                              {customer.address || "—"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="ui-table__td">
                        {isEditing && editingCell?.field === "profession" && !isLocked ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleSaveEdit(customer)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(customer)}
                            className="val-edit-input"
                          />
                        ) : (
                          <div className="mf-cell mf-cell--start">
                            <span
                              className="mf-text--title val-editable-cell"
                              onDoubleClick={() => {
                                if (!isLocked) {
                                  setEditingCell({ customerId: customer.id, field: "profession" });
                                  setEditValue(customer.profession);
                                }
                              }}
                            >
                              {customer.profession || "—"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="ui-table__td ui-table__td--center">
                        <a
                          href={`https://${shopDomain}/admin/customers/${customer.id.split("/").pop()}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Voir la fiche client Shopify"
                          className="customer-link"
                        >
                          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                            <path
                              d="M8.372 11.6667C7.11703 10.4068 7.23007 8.25073 8.62449 6.8509L12.6642 2.79552C14.0586 1.39569 16.2064 1.28221 17.4613 2.54205C18.7163 3.8019 18.6033 5.95797 17.2088 7.35779L15.189 9.3855"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                            <path
                              opacity="0.5"
                              d="M11.6278 8.33334C12.8828 9.59318 12.7698 11.7492 11.3753 13.1491L9.3555 15.1768L7.33566 17.2045C5.94124 18.6043 3.79348 18.7178 2.53851 17.4579C1.28353 16.1981 1.39658 14.042 2.79099 12.6422L4.81086 10.6145"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </a>
                      </td>
                      <td className="ui-table__td ui-table__td--center">
                        <span className="val-metafield-value">{customer.metafieldValue}</span>
                      </td>
                      <td className="ui-table__td ui-table__td--center">
                        <div className="val-actions">
                          <button
                            onClick={() => setAcceptingCustomer(customer)}
                            className="val-action-btn val-action-btn--accept"
                            title="Accepter"
                            disabled={processingCustomerId === customer.id}
                            style={{ opacity: processingCustomerId === customer.id ? 0.6 : 1 }}
                          >
                            {processingCustomerId === customer.id ? <Spinner size={12} /> : "✓"}
                          </button>
                          <button
                            onClick={() => {
                              setProcessingCustomerId(customer.id);
                              handleReject(customer);
                            }}
                            className="val-action-btn val-action-btn--reject"
                            title="Rejeter"
                            disabled={processingCustomerId === customer.id}
                            style={{ opacity: processingCustomerId === customer.id ? 0.6 : 1 }}
                          >
                            {processingCustomerId === customer.id ? <Spinner size={12} /> : "✕"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Actions Bar (Bottom) */}
      {selectedIds.size > 0 && (
        <div className="selection-bar-wrapper">
          <div className="selection-bar">
            <div className="selection-bar__info">
              <span className="selection-bar__count">{selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
              <button type="button" className="selection-bar__clear" onClick={() => setSelectedIds(new Set())}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="selection-bar__divider" />
            <div className="selection-bar__actions">
              <button type="button" className="selection-bar__btn selection-bar__btn--accept" onClick={() => setBulkModal("accept")}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                accepter
              </button>
              <button type="button" className="selection-bar__btn selection-bar__btn--danger" onClick={() => setBulkModal("reject")}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                rejeter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accept Modal */}
      {acceptingCustomer && (
        <AcceptModal
          customer={acceptingCustomer}
          onClose={() => setAcceptingCustomer(null)}
          defaultSettings={defaultSettings}
          existingCodes={existingCodes}
          isLocked={isLocked}
          setProcessingCustomerId={setProcessingCustomerId}
        />
      )}

      {/* Bulk Confirmation Modal */}
      {bulkModal && (
        <BulkConfirmModal
          count={selectedIds.size}
          action={bulkModal}
          onConfirm={bulkModal === "accept" ? handleBulkAccept : handleBulkReject}
          onClose={() => setBulkModal(null)}
          isLocked={isLocked}
        />
      )}

      {/* Single Reject Confirmation Modal */}
      {rejectingCustomer && (
        <BulkConfirmModal
          count={1}
          action="reject"
          onConfirm={confirmSingleReject}
          onClose={() => setRejectingCustomer(null)}
          isLocked={isLocked}
          customerName={rejectingCustomer.name}
        />
      )}
    </div>
  );
}
