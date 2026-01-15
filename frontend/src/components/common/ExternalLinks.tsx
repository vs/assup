import { ExternalLink } from "lucide-react";

interface ExternalLinksProps {
  symbol: string;
}

export function ExternalLinks({ symbol }: ExternalLinksProps) {
  const seekingAlphaUrl = `https://seekingalpha.com/symbol/${symbol}`;

  return (
    <a
      href={seekingAlphaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center ml-1.5 text-muted-foreground hover:text-foreground transition-colors"
      title="View on Seeking Alpha"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
