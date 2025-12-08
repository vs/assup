import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";

interface ChartModalProps {
  symbol: string | null;
  open: boolean;
  onClose: () => void;
}

export function ChartModal({ symbol, open, onClose }: ChartModalProps) {
  if (!symbol) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[90vw] !max-w-[90vw] h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{symbol}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <AdvancedRealTimeChart
            symbol={symbol}
            theme="light"
            autosize
            interval="D"
            range="12M"
            hide_side_toolbar={false}
            allow_symbol_change={false}
            style="1"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
