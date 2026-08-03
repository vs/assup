import { useState, useCallback, useMemo } from "react";

export function useTableSort<T>(
  items: T[],
  getColumnValue: (item: T, column: string) => string | number,
  initialColumn: string | null = null,
  initialDir: "asc" | "desc" = "asc",
) {
  const [sortColumn, setSortColumn] = useState<string | null>(initialColumn);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialDir);

  const toggleSort = useCallback((column: string) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortColumn(null);
      setSortDir("asc");
    }
  }, [sortColumn, sortDir]);

  const sorted = useMemo(() => {
    if (!sortColumn) return items;
    return [...items].sort((a, b) => {
      const va = getColumnValue(a, sortColumn);
      const vb = getColumnValue(b, sortColumn);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortColumn, sortDir, getColumnValue]);

  return { sorted, sortColumn, sortDir, toggleSort };
}
