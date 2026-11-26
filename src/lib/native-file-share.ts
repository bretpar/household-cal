import { Capacitor } from "@capacitor/core";

export const canShareNativeFile = () => Capacitor.isNativePlatform();

/** Writes a PDF to the app cache and opens the iOS Share Sheet with the actual file attached. */
export async function shareNativePdf(base64: string, fileName: string, title: string) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
  try { await Share.share({ title, files: [written.uri], dialogTitle: title }); }
  catch (e) { if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e; }
}

const probe = () => { try { return new File([new Uint8Array(1)], "probe.pdf", { type: "application/pdf" }); } catch { return null; } };

/** True when the browser's Web Share API can share an actual PDF file (e.g. mobile Safari). */
export function canShareWebFile() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  const f = probe();
  try { return !!f && navigator.canShare({ files: [f] }); } catch { return false; }
}

/** Opens the system share sheet with the PDF attached. Returns "shared", "cancelled" or "blocked" (activation lost; retry from a fresh tap). */
export async function shareWebPdf(blob: Blob, fileName: string, title: string, text: string): Promise<"shared" | "cancelled" | "blocked"> {
  const file = new File([blob], fileName, { type: "application/pdf" });
  try { await navigator.share({ files: [file], title, text }); return "shared"; }
  catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "blocked";
    throw e;
  }
}
