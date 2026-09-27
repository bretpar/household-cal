import { useEffect } from "react";

import { hideNativeSplash } from "@/lib/native-splash";

/**
 * Full-screen startup screen. Matches the iOS LaunchScreen.storyboard exactly:
 * cream background, the same 144px logo image, centered in the full screen
 * (fixed inset-0, so body safe-area padding can't shift it). The message sits
 * below the logo without moving it. Mounting it hides the native splash.
 */
export function StartupSplash({ message = "Loading your calendar…" }: { message?: string }) {
  useEffect(() => {
    hideNativeSplash();
  }, []);

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 bg-background">
      <img
        src="/launch-logo.png"
        alt=""
        width={144}
        height={144}
        className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 object-contain"
      />
      <p className="absolute left-0 right-0 top-1/2 mt-[92px] text-center font-display text-sm font-semibold text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
