// FICHIER : app/context/EditModeContext.tsx
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

export type ToastData = { title: string; msg: string; type: "success" | "error" | "info" };

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
  config: { threshold: number; creditAmount: number };
  setConfig: (v: { threshold: number; creditAmount: number }) => void;
  toast: ToastData | null;
  showToast: (t: ToastData) => void;
  dismissToast: () => void;
};

const EditModeContext = createContext<EditModeContextType | null>(null);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState("");
  const [lockError, setLockError] = useState("");
  const [showCodeBlock, setShowCodeBlock] = useState(true);
  const [showCABlock, setShowCABlock] = useState(false);
  const [config, setConfigState] = useState({ threshold: 500, creditAmount: 10 });

  // Lecture localStorage APRÈS hydratation (évite le mismatch SSR/client React 18)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("basilic_config");
      if (stored) setConfigState(JSON.parse(stored));
    } catch {}
  }, []);

  const setConfig = useCallback((v: { threshold: number; creditAmount: number }) => {
    setConfigState(v);
    try { localStorage.setItem("basilic_config", JSON.stringify(v)); } catch {}
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
    const adminPassword = "GestionPro";
    if (password === adminPassword) {
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
        config,
        setConfig,
        toast,
        showToast,
        dismissToast,
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
