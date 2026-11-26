import { useEffect, useState } from "react";
import { Download, Mail, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { summarySecondaryAction } from "@/components/BabysitterTimesheetPresentation";
import { buildTimesheetPdf, pdfFileName, timesheetShareMessage, timesheetShareSubject, type TimesheetDoc } from "@/lib/caregiver-timesheet-pdf";
import { canShareNativeFile, canShareWebFile, shareNativePdf } from "@/lib/native-file-share";

/** Presentation-only export: the caller provides its already-authorized, saved rows. */
export function BabysitterTimesheetPdfActions({ doc, statusKey, scopeKey, disabled = false, email = "" }: {
  doc: TimesheetDoc | null; statusKey: string; scopeKey: string; disabled?: boolean; email?: string;
}) {
  const [native, setNative] = useState(false);
  const [webShare, setWebShare] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [ready, setReady] = useState<{ doc: TimesheetDoc; statusKey: string; scopeKey: string; file: File } | null>(null);
  const [failedPreparation, setFailedPreparation] = useState(false);
  const [retry, setRetry] = useState(0);
  const prepared = ready?.doc === doc && ready.statusKey === statusKey && ready.scopeKey === scopeKey ? ready.file : null;
  useEffect(() => { setNative(canShareNativeFile()); setWebShare(!canShareNativeFile() && canShareWebFile()); }, []);
  useEffect(() => { setSharing(null); }, [scopeKey]);
  useEffect(() => {
    setReady(null); setFailedPreparation(false);
    if (!webShare || !doc) return;
    let live = true;
    const timer = setTimeout(() => {
      void buildTimesheetPdf(doc).then(pdf => {
        if (live) setReady({ doc, statusKey, scopeKey, file: new File([pdf.output("blob")], pdfFileName(doc), { type: "application/pdf" }) });
      }).catch(() => { if (live) setFailedPreparation(true); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [doc, statusKey, scopeKey, webShare, retry]);
  const download = async () => {
    if (!doc || disabled) return false;
    try {
      const pdf = await buildTimesheetPdf(doc);
      if (native) {
        // Save to Files through the existing system sheet, not an inaccessible app-private directory.
        await shareNativePdf(pdf.output("datauristring").split(",")[1] ?? "", pdfFileName(doc), "Save PDF");
      } else pdf.save(pdfFileName(doc));
      return true;
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not download the PDF"); return false; }
  };
  const failure = (e: unknown) => {
    if ((e as DOMException)?.name === "AbortError" || /cancel/i.test(e instanceof Error ? e.message : String(e))) return;
    if ((e as DOMException)?.name === "NotAllowedError") { toast("PDF is ready. Tap Share PDF again to open the share sheet."); return; }
    toast.error(e instanceof Error ? e.message : "Could not share the PDF");
  };
  const share = () => {
    if (!doc || disabled) return;
    if (native) {
      void buildTimesheetPdf(doc).then(pdf => shareNativePdf(pdf.output("datauristring").split(",")[1] ?? "", pdfFileName(doc), timesheetShareSubject(doc), timesheetShareMessage(doc))).catch(failure);
    } else if (prepared) {
      // Invoke synchronously from the tap; never rebuild the file here.
      try { void navigator.share({ files: [prepared], title: timesheetShareSubject(doc), text: timesheetShareMessage(doc) }).catch(failure); } catch (e) { failure(e); }
    }
  };
  return <>
    <div className="grid grid-cols-2 gap-2">
      <Button variant="ghost" disabled={!doc || disabled} className={summarySecondaryAction} onClick={() => void download()}><Download className="size-4 shrink-0" />Download PDF</Button>
      {native || webShare ? <Button variant="ghost" className={summarySecondaryAction} disabled={!doc || disabled || (!native && !prepared)} onClick={share}><Share className="size-4 shrink-0" />Share PDF</Button>
        : <Button variant="ghost" className={summarySecondaryAction} disabled={!doc || disabled} onClick={() => setSharing(email)}><Mail className="size-4 shrink-0" />Email PDF</Button>}
    </div>
    {failedPreparation && <Button variant="ghost" className="w-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => setRetry(n => n + 1)}>Retry preparing PDF</Button>}
    <Dialog open={sharing !== null} onOpenChange={open => { if (!open) setSharing(null); }}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}><DialogHeader><DialogTitle>Email PDF</DialogTitle><DialogDescription>This browser cannot attach files automatically. Download the PDF, then attach it to the email draft before sending.</DialogDescription></DialogHeader>
        {doc && sharing !== null && <form className="space-y-4" onSubmit={async e => {
          e.preventDefault(); if (!await download()) return;
          window.location.href = `mailto:${encodeURIComponent(sharing.trim())}?subject=${encodeURIComponent(timesheetShareSubject(doc))}&body=${encodeURIComponent(timesheetShareMessage(doc))}`;
          setSharing(null);
        }}><div className="space-y-1"><Label htmlFor="timesheet-share-email">Send to</Label><Input id="timesheet-share-email" type="email" required value={sharing} onChange={e => setSharing(e.target.value)} /></div><Button type="submit" className="w-full" disabled={disabled}>Download PDF and open email</Button><p className="text-xs text-muted-foreground">Attach {pdfFileName(doc)} from Downloads.</p></form>}
      </DialogContent>
    </Dialog>
  </>;
}