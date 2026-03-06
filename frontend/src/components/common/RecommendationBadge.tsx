import type { Recommendation } from "@assup/shared";

interface RecommendationBadgeProps {
  recommendation: Recommendation;
  confidence?: number; // 0 to 1
}

const colorMap: Record<Recommendation, string> = {
  buy: "bg-green-500/15 text-green-700 border-green-500/20",
  sell: "bg-red-500/15 text-red-700 border-red-500/20",
  wheel: "bg-blue-500/15 text-blue-700 border-blue-500/20",
  hold: "bg-amber-500/15 text-amber-700 border-amber-500/20",
  avoid: "bg-gray-500/15 text-gray-700 border-gray-500/20",
};

export function RecommendationBadge({
  recommendation,
  confidence,
}: RecommendationBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${colorMap[recommendation]}`}
    >
      <span className="uppercase">{recommendation}</span>
      {confidence != null && (
        <span className="opacity-70">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
