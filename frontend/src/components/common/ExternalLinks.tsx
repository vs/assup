import { ExternalLink } from "lucide-react";

interface ExternalLinksProps {
  symbol: string;
}

export function ExternalLinks({ symbol }: ExternalLinksProps) {
  const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=${symbol}`;
  const seekingAlphaUrl = `https://seekingalpha.com/symbol/${symbol}`;

  return (
    <div className="flex items-center gap-1.5 ml-2">
      {/* TradingView */}
      <a
        href={tradingViewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center hover:opacity-70 transition-opacity"
        title="View on TradingView"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
        >
          <path d="M5.5 3A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 18.5 3h-13zm11.97 5.03l-3.28 6.56a.5.5 0 0 1-.89 0l-1.97-3.93-1.47 2.93a.5.5 0 0 1-.89 0L6.53 8.03a.5.5 0 0 1 .45-.73h10.04a.5.5 0 0 1 .45.73z"/>
        </svg>
      </a>

      {/* Seeking Alpha */}
      <a
        href={seekingAlphaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center hover:opacity-70 transition-opacity"
        title="View on Seeking Alpha"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      </a>

      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </div>
  );
}
