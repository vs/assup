interface SignalBadgeProps {
  signal: string | null | undefined;
  confidence?: number | null;
}

export function SignalBadge({ signal, confidence }: SignalBadgeProps) {
  if (!signal) return null;

  const colorClass =
    signal === "bullish"
      ? "text-green-600 bg-green-50"
      : signal === "bearish"
        ? "text-red-600 bg-red-50"
        : "text-yellow-600 bg-yellow-50";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}
    >
      {signal}
      {confidence != null && ` ${(confidence * 100).toFixed(0)}%`}
    </span>
  );
}
