// FICHIER : app/context/EditModeContext.tsx
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

export type ToastData = { title: string; msg: string; type: "success" | "error" | "info" };
export type ValidationDefaults = { value: number; type: string; codePrefix: string };

type EditModeContextType = {
  isLocked: boolean;
  setIsLocked: (v: boolean) => void;
  showPass: boolean;
  setShowPass: (v: boolean) => void;
  password: string;
  setPassword: (v: string) => void;
  lockError: string;
  handleUnlock: () => void;
  showCodeBlock: boolean;
  setShowCodeBlock: (v: boolean) => void;
  showCABlock: boolean;
  setShowCABlock: (v: boolean) => void;
  showLimitationBlock: boolean;
  setShowLimitationBlock: (v: boolean) => void;
  config: { threshold: number; creditAmount: number };
  setConfig: (v: { threshold: number; creditAmount: number }) => void;
  validationDefaults: ValidationDefaults;
  setValidationDefaults: (v: ValidationDefaults) => void;
  toast: ToastData | null;
  showToast: (t: ToastData) => void;
  dismissToast: () => void;
  recalcFromDate: string | null;
  setRecalcFromDate: (v: string | null) => void;
};

const EditModeContext = createContext<EditModeContextType | null>(null);

export function EditModeProvider({
  children,
  adminPassword,
  initialConfig,
  initialValidationDefaults,
}: {
  children: ReactNode;
  adminPassword?: string;
  initialConfig?: { threshold: number; creditAmount: number };
  initialValidationDefaults?: ValidationDefaults;
}) {
  const [isLocked, setIsLockedState] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("basilic_unlocked") !== "1";
    }
    return true;
  });
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState("");
  const [lockError, setLockError] = useState("");
  const [showCodeBlock, setShowCodeBlock] = useState(true);
  const [showCABlock, setShowCABlock] = useState(false);
  const [showLimitationBlock, setShowLimitationBlock] = useState(false);
  const [config, setConfigState] = useState(initialConfig ?? { threshold: 500, creditAmount: 10 });
  const [validationDefaults, setValidationDefaultsState] = useState<ValidationDefaults>(initialValidationDefaults ?? { value: 5, type: "%", codePrefix: "PRO_" });
  const [recalcFromDate, setRecalcFromDateState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("basilic_recalculate_from_date") ?? null;
    }
    return null;
  });

  const setIsLocked = useCallback((v: boolean) => {
    setIsLockedState(v);
    try { sessionStorage.setItem("basilic_unlocked", v ? "0" : "1"); } catch {}
  }, []);

  const setConfig = useCallback((v: { threshold: number; creditAmount: number }) => {
    setConfigState(v);
  }, []);

  const setValidationDefaults = useCallback((v: ValidationDefaults) => {
    setValidationDefaultsState(v);
  }, []);

  const setRecalcFromDate = useCallback((v: string | null) => {
    setRecalcFromDateState(v);
    try {
      if (v) localStorage.setItem("basilic_recalculate_from_date", v);
      else localStorage.removeItem("basilic_recalculate_from_date");
    } catch {}
  }, []);

  const [toast, setToast] = useState<ToastData | null>(null);

  const showToast = useCallback((t: ToastData) => setToast(t), []);
  const dismissToast = useCallback(() => setToast(null), []);

  // Auto-dismiss après 5s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleUnlock = () => {
    const expectedPassword = adminPassword || "GestionPro";
    if (password === expectedPassword) {
      setIsLocked(false);
      setShowPass(false);
      setPassword("");
      setLockError("");
    } else {
      setLockError("Code incorrect");
    }
  };

  return (
    <EditModeContext.Provider
      value={{
        isLocked,
        setIsLocked,
        showPass,
        setShowPass,
        password,
        setPassword,
        lockError,
        handleUnlock,
        showCodeBlock,
        setShowCodeBlock,
        showCABlock,
        setShowCABlock,
        showLimitationBlock,
        setShowLimitationBlock,
        config,
        setConfig,
        validationDefaults,
        setValidationDefaults,
        toast,
        showToast,
        dismissToast,
        recalcFromDate,
        setRecalcFromDate,
      }}
    >
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error("useEditMode must be used inside EditModeProvider");
  return ctx;
}
