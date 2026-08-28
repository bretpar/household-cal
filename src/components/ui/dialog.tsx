"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Hides the built-in top-right X close button. */
  hideClose?: boolean;
  /** Enables drag-down-to-dismiss on the mobile bottom sheet. */
  onSwipeClose?: () => void;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose, onSwipeClose, ...props }, ref) => {
  const [dragY, setDragY] = React.useState(0);
  const startY = React.useRef<number | null>(null);

  const canDrag = (target: EventTarget | null) => {
    // Only start a sheet drag when no inner scroller is scrolled down.
    let node = target as HTMLElement | null;
    while (node) {
      if (node.scrollTop > 0) return false;
      node = node.parentElement;
    }
    return true;
  };

  const touchHandlers = onSwipeClose
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          startY.current = canDrag(e.target) ? (e.touches[0]?.clientY ?? null) : null;
        },
        onTouchMove: (e: React.TouchEvent) => {
          if (startY.current === null) return;
          const delta = (e.touches[0]?.clientY ?? 0) - startY.current;
          setDragY(delta > 0 ? delta : 0);
        },
        onTouchEnd: () => {
          if (dragY > 110) onSwipeClose();
          startY.current = null;
          setDragY(0);
        },
      }
    : {};

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex w-full max-w-lg max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-hidden overscroll-contain border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg",
          // Mobile: anchored bottom sheet that never floats away from the viewport.
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-b-0 max-sm:p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:max-h-[calc(100dvh-2.5rem)] max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...touchHandlers}
        {...props}
      >
        {onSwipeClose ? (
          <div
            aria-hidden
            className="mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden"
          />
        ) : null}
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;


const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
