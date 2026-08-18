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
      <DialogContent className="!w-[95vw] !max-w-[95vw] h-[92vh] max-h-[92vh] overflow-y-auto !top-[4vh] !translate-y-0 content-start">
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
