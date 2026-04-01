/** Flatten the SA v3 metrics response into { field: value } */
export function flattenSAMetrics(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const json = raw as {
    data?: Array<{ attributes: { value: number }; relationships: { metric_type: { data: { id: string } } } }>;
    included?: Array<{ id: string; type: string; attributes: { field: string } }>;
  };
  if (!json.data || !json.included) return null;

  const typeMap = new Map<string, string>();
  for (const inc of json.included) {
    if (inc.type === "metric_type") {
      typeMap.set(inc.id, inc.attributes.field);
    }
  }

  const result: Record<string, number> = {};
  for (const item of json.data) {
    const field = typeMap.get(item.relationships.metric_type.data.id);
    if (field) {
      result[field] = item.attributes.value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
