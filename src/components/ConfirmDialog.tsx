import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  /** The action throws away work the author has not saved or exported. */
  destructive?: boolean;
}

type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void };

/**
 * The app's replacement for `window.confirm`: `confirm()` opens one shared AlertDialog and resolves true only when the
 * author presses the action. Cancel and Escape resolve false; a click outside does nothing, as an alert dialog should
 * not vanish on a stray click while asking about losing work.
 */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [open, setOpen] = useState(false);
  // The request still waiting for an answer; a newer request answers it with false.
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    pendingRef.current = { ...request, resolve };
    setPending(pendingRef.current);
    setOpen(true);
  }), []);

  // The content stays mounted after settling so the closing animation does not flash an empty dialog.
  const settle = (confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setOpen(false);
  };

  const dialog = (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction variant={pending?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {pending?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [confirm, dialog];
}
