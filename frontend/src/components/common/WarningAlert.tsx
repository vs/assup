import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

interface WarningAlertProps {
  messages: string[];
}

export function WarningAlert({ messages }: WarningAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || messages.length === 0) return null;

  return (
    <div className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 px-4 py-3 rounded-lg flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {messages.map((msg, i) => (
          <p key={i} className="text-sm">{msg}</p>
        ))}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 hover:bg-yellow-500/20 rounded"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
