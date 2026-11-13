import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`ui-btn ui-btn--${variant} ui-btn--size-${size} ${className}`.trim()}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    return <input ref={ref} className={`ui-input ${className}`.trim()} {...props} />;
  }
);
Input.displayName = "Input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <select ref={ref} className={`ui-select ${className}`.trim()} {...props}>
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ id, checked, onCheckedChange, disabled, label }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={`ui-switch ${checked ? "ui-switch--checked" : ""}`}
    >
      <span className="ui-switch__thumb" />
    </button>
  );
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "destructive";
}

export function Badge({ className = "", variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={`ui-badge ui-badge--${variant} ${className}`.trim()}
      {...props}
    />
  );
}

export interface ProgressProps {
  value: number;
  className?: string;
  ariaLabel?: string;
}

export function Progress({ value, className = "", ariaLabel = "Transfer progress" }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`ui-progress ${className}`.trim()}
    >
      <div
        className="ui-progress__indicator"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </div>
  );
}

export function Separator({
  orientation = "horizontal",
  className = "",
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={`ui-separator ui-separator--${orientation} ${className}`.trim()}
    />
  );
}
