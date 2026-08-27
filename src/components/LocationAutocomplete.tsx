import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";

import { Input } from "@/components/ui/input";
import { suggestPlaces, type PlaceSuggestion } from "@/lib/places.functions";

/**
 * Location field with Google Places suggestions. Suggestions are optional —
 * anything typed (like "Grandma's house") is kept exactly as entered.
 */
export function LocationAutocomplete({
  id,
  value,
  onChange,
  placeholder = "Riverside Fields",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const fetchSuggestions = useServerFn(suggestPlaces);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const pickedRef = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3 || pickedRef.current === query) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchSuggestions({ data: { query } })
        .then((results) => {
          if (cancelled) return;
          setSuggestions(results);
          if (results.length > 0) setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, fetchSuggestions]);

  return (
    <div className="relative min-w-0">
      <Input
        id={id}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          pickedRef.current = null;
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="h-11 w-full min-w-0 rounded-xl"
      />
      {open && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-soft">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.title}-${suggestion.subtitle}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  pickedRef.current = suggestion.value.trim();
                  onChange(suggestion.value);
                  setSuggestions([]);
                  setOpen(false);
                }}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{suggestion.title}</span>
                  {suggestion.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {suggestion.subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
