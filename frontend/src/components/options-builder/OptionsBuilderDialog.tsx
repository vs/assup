/**
 * Modal dialog wrapper around OptionsBuilder for use in the Wheel page.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionsBuilder } from "./OptionsBuilder";
import type { StrategyMode } from "@assup/shared";

interface OptionsBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  allowedModes?: StrategyMode[];
  defaultMode?: StrategyMode;
  onOrderPlaced?: () => void;
}

export function OptionsBuilderDialog({
  open,
  onOpenChange,
  symbol,
  allowedModes,
  defaultMode,
  onOrderPlaced,
}: OptionsBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Order — {symbol}</DialogTitle>
        </DialogHeader>
        {open && (
          <OptionsBuilder
            symbol={symbol}
            allowedModes={allowedModes}
            defaultMode={defaultMode}
            onOrderPlaced={() => {
              onOrderPlaced?.();
              onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
