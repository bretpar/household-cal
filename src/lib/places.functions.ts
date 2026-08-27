import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface PlaceSuggestion {
  /** Primary label, e.g. "Riverside Fields" */
  title: string;
  /** Secondary label, e.g. "123 Main St, Springfield, IL" */
  subtitle: string;
  /** The value written into the Location field when picked. */
  value: string;
}

/**
 * Google Places (New) autocomplete. Purely a typing aid for the Location
 * field — freeform text is always allowed and nothing here touches calendar
 * sync. Returns an empty list when no API key is configured.
 */
export const suggestPlaces = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ query: z.string().max(200) }).parse(data))
  .handler(async ({ data }): Promise<PlaceSuggestion[]> => {
    const query = data.query.trim();
    const key = process.env["GOOGLE_PLACES_API_KEY"];
    if (!key || query.length < 3) return [];

    try {
      const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
        },
        body: JSON.stringify({ input: query }),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        suggestions?: {
          placePrediction?: {
            text?: { text?: string };
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }[];
      };
      return (body.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => {
          const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
          const secondary = p.structuredFormat?.secondaryText?.text ?? "";
          return {
            title: main,
            subtitle: secondary,
            value: p.text?.text ?? [main, secondary].filter(Boolean).join(", "),
          };
        })
        .filter((s) => s.value.length > 0)
        .slice(0, 6);
    } catch {
      return [];
    }
  });
