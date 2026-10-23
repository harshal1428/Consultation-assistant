import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type StatusVariant = "info" | "success" | "warning" | "error";

const VARIANT_ICON: Record<StatusVariant, IconName> = {
  info: "info",
  success: "check",
  warning: "alertTriangle",
  error: "alertCircle",
};

interface StatusMessageProps {
  variant: StatusVariant;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
}

export function StatusMessage({
  variant,
  title,
  children,
  onDismiss,
}: StatusMessageProps) {
  const isError = variant === "error";
  return (
    <div
      className={`status-message status-message--${variant}`}
      role={isError ? "alert" : "status"}
    >
      <Icon name={VARIANT_ICON[variant]} size={16} className="status-message__icon" />
      <div className="status-message__body">
        {title ? <strong className="status-message__title">{title}</strong> : null}
        {children ? <div className="status-message__text">{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="status-message__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss message"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}
