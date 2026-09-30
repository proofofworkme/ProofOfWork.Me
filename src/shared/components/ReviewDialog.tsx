import { ReactNode, useEffect, useId, useRef } from "react";

/** Native modal semantics keep the background inert and contain keyboard focus. */
export function ReviewDialog({ title, children, onCancel, returnFocus }: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const dialog = ref.current;
    const previous = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog?.showModal();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
      )).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    dialog?.addEventListener("keydown", containFocus);
    return () => {
      dialog?.removeEventListener("keydown", containFocus);
      dialog?.close();
      // Send can still be busy for one render after dismissal.
      window.requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, []);
  return (
    <dialog ref={ref} className="review-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); cancelRef.current(); }}>
      <div className="review-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button className="secondary" type="button" autoFocus onClick={onCancel}>Cancel</button>
      </div>
      {children}
    </dialog>
  );
}
