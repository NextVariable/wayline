import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { enqueueNotification, visibleNotifications, type NotificationItem } from "../lib/toastQueue";
type ToastItem = NotificationItem;
type ToastVariant = ToastItem["variant"];

interface ToastContextValue {
  addToast: (
    message: string,
    variant?: ToastVariant,
    action?: ToastItem["action"],
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const variantIcons = { success: CheckCircle2, error: XCircle, info: Info };

export function ToastBar({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const Icon = variantIcons[toast.variant];
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(
      () => onDismiss(toast.id),
      toast.action || toast.variant === "error" ? 10000 : 3500,
    );
    return () => clearTimeout(timer);
  }, [hovered, focused, toast.id, toast.action, toast.variant, onDismiss]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
      className={`toast-notification toast-${toast.variant}`}
    >
      <Icon size={16} className="toast-status-icon" aria-hidden="true" />
      <p>
        {toast.message}
      </p>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.action?.dismissLabel ? (
        <button className="toast-action toast-decline" onClick={() => onDismiss(toast.id)}>
          {toast.action.dismissLabel}
        </button>
      ) : (
        <button
          onClick={() => onDismiss(toast.id)}
          className="toast-close"
          aria-label="关闭提示"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (
      message: string,
      variant: ToastVariant = "info",
      action?: ToastItem["action"],
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => enqueueNotification(prev, { id, message, variant, action }));
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        className="toast-stack"
        aria-live="polite"
      >
        {visibleNotifications(toasts).map((toast) => (
          <ToastBar key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
