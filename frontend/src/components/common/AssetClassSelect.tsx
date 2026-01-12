import { useState, useEffect } from "react";
import { api } from "@/api";
import type { AssetClass } from "@assup/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AssetClassSelectProps {
  value?: string | null;
  onValueChange: (assetClassId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  assetClasses?: AssetClass[];
}

export function AssetClassSelect({
  value,
  onValueChange,
  placeholder = "Select class...",
  disabled = false,
  className = "w-40",
  assetClasses: externalAssetClasses,
}: AssetClassSelectProps) {
  const [internalAssetClasses, setInternalAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(!externalAssetClasses);

  const assetClasses = externalAssetClasses || internalAssetClasses;

  useEffect(() => {
    if (!externalAssetClasses) {
      loadAssetClasses();
    }
  }, [externalAssetClasses]);

  async function loadAssetClasses() {
    try {
      setLoading(true);
      const data = await api.assetClasses.list();
      setInternalAssetClasses(data);
    } catch (err) {
      console.error("Failed to load asset classes:", err);
    } finally {
      setLoading(false);
    }
  }

  const selectedClass = assetClasses.find((ac) => ac.id === value);

  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled || loading}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder}>
          {selectedClass && (
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: selectedClass.color }}
              />
              <span className="truncate">{selectedClass.name}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {assetClasses.map((ac) => (
          <SelectItem key={ac.id} value={ac.id}>
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: ac.color }}
              />
              <span>{ac.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
