import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** "09:30" -> "9:30 AM"; blank/partial values fall back to a prompt. */
export function formatTimeValue(value: string): string {
  const parsed = parseTimeInput(value);
  if (!parsed) return "Choose time";
  const [hours, minutes] = parsed.split(":").map(Number);
  return format(new Date(2000, 0, 1, hours ?? 0, minutes ?? 0), "h:mm a");
}

/**
 * Normalizes free text into "HH:mm", or null when it isn't a valid time.
 * Accepts 9, 9:5, 930, 9pm, 9:30 PM, 21:30.
 */
export function parseTimeInput(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const meridiem = /(am|pm)$/.exec(text.replace(/\s|\./g, ""))?.[1] ?? null;
  const digits = text.replace(/[^0-9:]/g, "");
  if (!digits) return null;
  let hours: number;
  let minutes: number;
  if (digits.includes(":")) {
    const [h = "", m = ""] = digits.split(":");
    hours = Number(h);
    minutes = m === "" ? 0 : Number(m);
  } else if (digits.length <= 2) {
    hours = Number(digits);
    minutes = 0;
  } else {
    hours = Number(digits.slice(0, digits.length - 2));
    minutes = Number(digits.slice(-2));
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59 || hours < 0 || minutes < 0) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Every 15 minutes across the day. */
const OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const hours = Math.floor(i / 4);
  const minutes = (i % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

function useCoarsePointer() {
  const [coarse, setCoarse] = useState<boolean | null>(null);
  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return coarse;
}

/**
 * Time entry that keeps the polished mobile native picker while giving desktop
 * a real 15-minute picker with typed-value validation, so half-typed text can
 * never be committed.
 */
export function TimeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const coarse = useCoarsePointer();

  // Mobile/tablet: the native wheel picker, unchanged.
  if (coarse !== false) {
    return (
      <div className="group relative h-11 w-full min-w-0 max-w-full">
        <div
          aria-hidden="true"
          className="flex h-11 w-full min-w-0 items-center overflow-hidden rounded-xl border border-input bg-transparent px-3 text-base shadow-sm transition-colors group-focus-within:ring-1 group-focus-within:ring-ring md:text-sm"
        >
          <span className="min-w-0 truncate">{formatTimeValue(value)}</span>
        </div>
        <input
          id={id}
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 z-10 block h-full w-full cursor-pointer opacity-0"
        />
      </div>
    );
  }

  return <DesktopTimeField id={id} value={value} onChange={onChange} />;
}

function DesktopTimeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const normalized = useMemo(() => parseTimeInput(value), [value]);

  // Show the current value when opening and scroll it into view.
  useEffect(() => {
    if (!open) return;
    setDraft(formatTimeValue(value) === "Choose time" ? "" : formatTimeValue(value));
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector("[data-selected='true']")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, value]);

  const commit = (raw: string) => {
    const parsed = parseTimeInput(raw);
    if (!parsed) {
      // Invalid/partial text is discarded — the stored value stays valid.
      setDraft(formatTimeValue(value) === "Choose time" ? "" : formatTimeValue(value));
      return;
    }
    onChange(parsed);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="flex h-11 w-full min-w-0 max-w-full items-center rounded-xl border border-input bg-transparent px-3 text-left text-base shadow-sm transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
        >
          <span className="min-w-0 truncate">{formatTimeValue(value)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="pointer-events-auto w-56 p-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            }
          }}
          placeholder="e.g. 9:30 AM"
          className="h-10 rounded-lg"
          aria-label="Type a time"
        />
        <div ref={listRef} className="mt-2 max-h-56 overflow-y-auto pr-1">
          {OPTIONS.map((option) => {
            const selected = option === normalized;
            return (
              <button
                key={option}
                type="button"
                data-selected={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={cn(
                  "block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary",
                  selected && "bg-primary/10 font-semibold text-primary",
                )}
              >
                {formatTimeValue(option)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
