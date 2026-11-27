import { describe, expect, it } from "vitest";

import { trustedAppOrigin } from "@/lib/app-origin.server";

describe("trusted app origins", () => {
  it("does not derive a callback origin from an arbitrary request host", () => {
    const request = new Request("https://attacker.example/api/server-function");
    expect(trustedAppOrigin(request)).toBe("https://ourfamilycalendar.com");
    expect(new URL("/api/public/google-calendar/manual-sync", trustedAppOrigin(request)).toString()).toBe(
      "https://ourfamilycalendar.com/api/public/google-calendar/manual-sync",
    );
  });

  it("preserves the production and project preview origins", () => {
    expect(trustedAppOrigin(new Request("https://www.ourfamilycalendar.com/settings"))).toBe(
      "https://www.ourfamilycalendar.com",
    );
    const preview = "https://id-preview--59a26a17-1a46-4d37-bcef-754fd9db6154.lovable.app/settings";
    expect(trustedAppOrigin(new Request(preview))).toBe(
      "https://id-preview--59a26a17-1a46-4d37-bcef-754fd9db6154.lovable.app",
    );
  });
});
