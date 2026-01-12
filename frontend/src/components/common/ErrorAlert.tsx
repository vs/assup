/**
 * Reusable error alert component
 * Displays error messages consistently across all pages
 */

import { AlertCircle, X } from "lucide-react";

interface ErrorAlertProps {
  /** Error message to display */
  message: string;
  /** Optional callback to dismiss the error */
  onDismiss?: () => void;
  /** Optional title (defaults to "Error") */
  title?: string;
}

/**
 * Styled error alert with optional dismiss button
 */
export function ErrorAlert({ message, onDismiss, title = "Error" }: ErrorAlertProps) {
  return (
    <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg flex items-start gap-3">
      <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-sm">{message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 hover:bg-destructive/20 rounded"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Inline error message (smaller, for form fields)
 */
export function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="text-sm text-destructive flex items-center gap-1">
      <AlertCircle className="h-3.5 w-3.5" />
      {message}
    </p>
  );
}
