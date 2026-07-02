import { useState, useRef, useEffect } from "react";
import { MONTH_NAMES_SHORT } from "./calendarUtils";

interface MonthYearPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

export function MonthYearPicker({ year, month, onChange }: MonthYearPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"month" | "year">("month");
  const [viewYear, setViewYear] = useState(year);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setView("month");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    setViewYear(year);
  }, [year]);

  const decadeStart = Math.floor(viewYear / 10) * 10;
  const now = new Date();

  const handleMonthSelect = (m: number) => {
    onChange(viewYear, m);
    setOpen(false);
    setView("month");
  };

  const handleYearSelect = (y: number) => {
    setViewYear(y);
    setView("month");
  };

  const handleToday = () => {
    onChange(now.getFullYear(), now.getMonth());
    setOpen(false);
    setView("month");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setView("month"); setViewYear(year); }}
        className="inline-flex items-center gap-1.5 bg-background border rounded-md px-3 py-1.5 text-sm font-semibold shadow-xs hover:bg-accent transition-colors"
      >
        {MONTH_NAMES_SHORT[month]} {year}
        <span className="text-[10px] text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute top-9 left-1/2 -translate-x-1/2 bg-popover border rounded-lg shadow-md p-3 z-50 w-[260px]">
          {view === "month" ? (
            <>
              <div className="flex items-center justify-between mb-2.5">
                <button
                  className="text-muted-foreground hover:text-foreground px-2 py-1"
                  onClick={() => setViewYear(viewYear - 1)}
                >←</button>
                <button
                  className="text-sm font-semibold hover:text-muted-foreground"
                  onClick={() => setView("year")}
                >{viewYear}</button>
                <button
                  className="text-muted-foreground hover:text-foreground px-2 py-1"
                  onClick={() => setViewYear(viewYear + 1)}
                >→</button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {MONTH_NAMES_SHORT.map((name, i) => {
                  const isSelected = viewYear === year && i === month;
                  const isCurrent = viewYear === now.getFullYear() && i === now.getMonth();
                  return (
                    <button
                      key={name}
                      className={`py-2 text-xs rounded-md transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground font-medium"
                          : isCurrent
                            ? "font-medium text-foreground hover:bg-muted"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      onClick={() => handleMonthSelect(i)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2.5">
                <button
                  className="text-muted-foreground hover:text-foreground px-2 py-1"
                  onClick={() => setViewYear(viewYear - 10)}
                >←</button>
                <span className="text-sm font-semibold">{decadeStart} – {decadeStart + 11}</span>
                <button
                  className="text-muted-foreground hover:text-foreground px-2 py-1"
                  onClick={() => setViewYear(viewYear + 10)}
                >→</button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => decadeStart + i).map((y) => {
                  const isSelected = y === year;
                  const isCurrent = y === now.getFullYear();
                  return (
                    <button
                      key={y}
                      className={`py-2 text-xs rounded-md transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground font-medium"
                          : isCurrent
                            ? "font-medium text-foreground hover:bg-muted"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      onClick={() => handleYearSelect(y)}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="mt-2 border-t pt-2 text-center">
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={handleToday}
            >Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
