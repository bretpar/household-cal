import { Capacitor } from "@capacitor/core";

export const canShareNativeFile = () => Capacitor.isNativePlatform();

/** Writes a PDF to the app cache and opens the iOS Share Sheet with the actual file attached. */
export async function shareNativePdf(base64: string, fileName: string, title: string) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
  try { await Share.share({ title, files: [written.uri], dialogTitle: title }); }
  catch (e) { if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e; }
}
