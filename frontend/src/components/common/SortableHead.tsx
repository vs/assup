import { TableHead } from "@/components/ui/table";

interface SortableHeadProps {
  column: string;
  sortColumn: string | null;
  sortDir: "asc" | "desc";
  toggleSort: (column: string) => void;
  className?: string;
  children: React.ReactNode;
  // Allow extra props from hook spread (e.g. sorted) without error
  [key: string]: unknown;
}

export function SortableHead({
  column,
  sortColumn,
  sortDir,
  toggleSort,
  className,
  children,
  ...rest
}: SortableHeadProps) {
  void rest; // ignore extra props from hook spread
  return (
    <TableHead
      className={`cursor-pointer select-none hover:text-foreground ${className || ""}`}
      onClick={() => toggleSort(column)}
    >
      {children}
      {sortColumn === column ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </TableHead>
  );
}
