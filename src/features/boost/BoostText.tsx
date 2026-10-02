import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { parseBoostText } from "../../shared/protocol/boostText.mjs";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { createInFlightRequestPool } from "../../shared/api/inFlightRequestPool";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { ProfileImage } from "./BoostProfileImages";
import { boostRouteHref, type BoostFeedPayload } from "./boostProtocol";
import { isValidBitcoinAddress } from "./boostWallet";

type TextContext = {
  embedded: boolean;
  network: BitcoinNetwork;
  snapshotId: string;
  activePreview: string | null;
  selectPreview: (id: string | null) => void;
};
const BoostTextContext = createContext<TextContext | undefined>(undefined);

// One active preview per surface bounds lazy profile and Files reads.
export function BoostTextProvider({ embedded, network, snapshotId = "", children }: {
  embedded: boolean;
  network: BitcoinNetwork;
  snapshotId?: string;
  children: ReactNode;
}) {
  const scope = JSON.stringify([embedded, network, snapshotId]);
  const [selection, setSelection] = useState<{ scope: string; id: string | null }>({ scope, id: null });
  const context = useMemo<TextContext>(() => ({
    embedded, network, snapshotId,
    activePreview: selection.scope === scope ? selection.id : null,
    selectPreview: id => setSelection({ scope, id }),
  }), [embedded, network, snapshotId, scope, selection]);
  return <BoostTextContext.Provider value={context}>{children}</BoostTextContext.Provider>;
}

type PreviewSubject = NonNullable<BoostFeedPayload["profileSubject"]>;
type PreviewRead = { resolved: boolean; subject?: PreviewSubject };
const previewReads = createInFlightRequestPool<PreviewRead>();
const previewCache = new Map<string, { at: number; value: PreviewRead }>();

async function readPreview(value: string, context: TextContext, signal: AbortSignal) {
  const key = JSON.stringify([context.network, context.snapshotId, value]);
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  return previewReads.request(key, signal, async requestSignal => {
    const params = new URLSearchParams({ profile: value, limit: "1" });
    const payload = await fetchProofApiJson<BoostFeedPayload>(`/api/v1/boost?${params}`, context.network,
      { signal: requestSignal, timeoutMs: 30_000 });
    if (payload.complete !== true || !payload.snapshotId || (payload.network && payload.network !== context.network)) {
      throw new Error("Complete confirmed profile evidence is unavailable.");
    }
    const subject = payload.profileSubject;
    if (!subject || subject.query !== value) throw new Error("The profile response does not match this mention.");
    if (subject.resolved === true && !isValidBitcoinAddress(subject.address ?? "", context.network)) {
      throw new Error("The confirmed profile address is invalid.");
    }
    const resolved = subject.resolved === true;
    const result: PreviewRead = resolved ? { resolved: true, subject } : { resolved: false };
    if (requestSignal.aborted) throw requestSignal.reason;
    // Snapshot-scoped entries cannot survive a feed refresh or network change.
    if (previewCache.size >= 64) previewCache.delete(previewCache.keys().next().value!);
    previewCache.set(key, { at: Date.now(), value: result });
    return result;
  });
}

function textRoute(context: TextContext, params: Record<string, string>) {
  return boostRouteHref("/", {
    ...(context.embedded ? { folder: "boost" } : { boost: "1" }),
    network: context.network,
    ...params,
  });
}

function previewName(subject: PreviewSubject, value: string) {
  const generatedName = `${subject.id}@proofofwork.me`.toLowerCase();
  const names = [subject.profile?.name?.trim(), subject.displayName?.trim()].filter(Boolean);
  return names.find(name => name!.toLowerCase() !== generatedName) || subject.id || names[0] || value;
}

function connectionCount(count: number | undefined) {
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString() : "—";
}

function MentionLink({ text, value, context }: { text: string; value: string; context: TextContext }) {
  const id = useId();
  const previewId = `boost-mention-preview-${id}`;
  const scope = JSON.stringify([context.network, context.snapshotId, value]);
  const open = context.activePreview === id;
  const currentContext = useRef(context);
  currentContext.current = context;
  const trigger = useRef<HTMLAnchorElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();
  const dismissed = useRef(false);
  const [state, setState] = useState<{ scope: string; status: "loading" | "ready" | "unresolved" | "unavailable"; subject?: PreviewSubject }>({ scope, status: "loading" });
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>();

  function clearTimers() {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }
  function close(suppress = false) {
    clearTimers();
    if (suppress) dismissed.current = true;
    context.selectPreview(null);
  }
  function scheduleOpen(delay: number) {
    clearTimers();
    if (dismissed.current || open) return;
    openTimer.current = window.setTimeout(() => {
      setState({ scope, status: "loading" });
      context.selectPreview(id);
    }, delay);
  }
  function scheduleClose() {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      if (document.activeElement === trigger.current || card.current?.contains(document.activeElement)) return;
      if (currentContext.current.activePreview === id) currentContext.current.selectPreview(null);
    }, 180);
  }

  useEffect(() => () => clearTimers(), [scope]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let current = true;
    setState({ scope, status: "loading" });
    void readPreview(value, context, controller.signal).then(result => {
      if (current && !controller.signal.aborted) setState({ scope, status: result.resolved ? "ready" : "unresolved", subject: result.subject });
    }, () => {
      if (current && !controller.signal.aborted) setState({ scope, status: "unavailable" });
    });
    return () => {
      current = false;
      // A short lease lets focus move between spellings of the same ID without
      // restarting its shared read. Obsolete consumers can never publish state.
      window.setTimeout(() => controller.abort(), 200);
    };
  }, [open, scope]);

  useLayoutEffect(() => {
    if (!open) { setPosition(undefined); return; }
    const place = () => {
      if (!trigger.current || !card.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(320, Math.max(0, window.innerWidth - 24));
      const maxHeight = Math.max(44, window.innerHeight - 24);
      const height = Math.min(card.current.getBoundingClientRect().height, maxHeight);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = Math.max(12, Math.min(below + height <= window.innerHeight - 12 ? below : rect.top - height - 8, window.innerHeight - height - 12));
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        context.selectPreview(null);
      } else setPosition({ left, top, width, maxHeight });
    };
    place();
    const resize = new ResizeObserver(place);
    if (card.current) resize.observe(card.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, scope]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const restoreFocus = card.current?.contains(document.activeElement);
      close(true);
      if (restoreFocus) trigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !card.current?.contains(event.target)) close(true);
    };
    // Capture Escape before the surrounding Boost detail dialog can dismiss.
    window.addEventListener("keydown", escape, true);
    window.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("pointerdown", outside, true);
    };
  }, [open, scope]);

  const currentState = state.scope === scope ? state : { status: "loading" as const };
  const subject = currentState.status === "ready" ? currentState.subject : undefined;
  // Keep the card inside an existing modal's focus boundary when used in threads.
  const portalRoot = trigger.current?.closest("[role='dialog']") ?? document.body;
  return <>
    <a ref={trigger} className="boost-text-link boost-mention-link" href={textRoute(context, { profile: value })}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? previewId : undefined}
      onClick={event => event.stopPropagation()}
      onPointerDown={event => { if (event.pointerType === "touch") dismissed.current = true; }}
      onPointerEnter={event => { if (event.pointerType !== "touch") scheduleOpen(350); }}
      onPointerLeave={() => { dismissed.current = false; scheduleClose(); }}
      onFocus={() => scheduleOpen(150)}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && card.current?.contains(event.relatedTarget)) return;
        dismissed.current = false;
        scheduleClose();
      }}
      onKeyDown={event => {
        if (open && (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey))) {
          event.preventDefault();
          (card.current?.querySelector<HTMLElement>("a[href]") ?? card.current?.querySelector<HTMLElement>("button"))?.focus();
        }
      }}>{text}</a>
    {open ? createPortal(<div ref={card} id={previewId} className="boost-mention-preview" data-testid="boost-mention-preview"
      role="dialog" aria-label={`Profile preview for ${text}`} style={{ ...position, visibility: position ? "visible" : "hidden" }}
      onClick={event => event.stopPropagation()}
      onPointerEnter={() => clearTimers()} onPointerLeave={() => scheduleClose()}
      onFocus={() => clearTimers()} onBlur={event => {
        if (event.relatedTarget instanceof Node && (card.current?.contains(event.relatedTarget) || trigger.current?.contains(event.relatedTarget))) return;
        scheduleClose();
      }} onKeyDown={event => {
        const first = card.current?.querySelector("a[href]") ?? card.current?.querySelector("button");
        if (event.key === "Tab" && event.shiftKey && event.target === first) {
          event.preventDefault(); trigger.current?.focus();
        }
      }}>
      <div className="boost-mention-preview-head">
        {subject ? <ProfileImage pointer={subject.profile?.image} network={context.network} className="boost-avatar"
          fallback={previewName(subject, value).slice(0, 2).toUpperCase()} alt="Profile picture" /> : <strong>Profile preview</strong>}
        <button className="secondary small" type="button" aria-label="Close profile preview" onClick={() => {
          const restoreFocus = card.current?.contains(document.activeElement); close(true); if (restoreFocus) trigger.current?.focus();
        }}><X size={18} aria-hidden="true" /></button>
      </div>
      {subject ? <>
        <strong className="boost-mention-preview-name">{previewName(subject, value)}</strong>
        {subject.id ? <span className="boost-mention-preview-handle">@{subject.id}</span> : null}
        <span className="boost-mention-preview-address">{subject.address}</span>
        <div className="boost-mention-preview-counts"><span><strong>{connectionCount(subject.followingCount)}</strong> Following</span>
          <span><strong>{connectionCount(subject.followerCount)}</strong> Followers</span></div>
        <a className="secondary" href={textRoute(context, { profile: subject.address! })}>Open profile</a>
      </> : <p role="status">{currentState.status === "loading" ? "Loading confirmed profile…" : currentState.status === "unresolved"
        ? "No confirmed profile resolves this mention." : "Profile preview unavailable."}</p>}
    </div>, portalRoot) : null}
  </>;
}

export function BoostText({ text }: { text: string }) {
  const context = useContext(BoostTextContext);
  const segments = useMemo(() => parseBoostText(text), [text]);
  if (!context) return <>{text}</>;
  return <>{segments.map((segment, index) => segment.kind === "text" ||
      (segment.kind === "mention" && segment.identityKind === "address" && !isValidBitcoinAddress(segment.value, context.network))
    ? <Fragment key={index}>{segment.text}</Fragment>
    : segment.kind === "mention" ? <MentionLink key={`${index}:${segment.value}`} text={segment.text}
      value={segment.identityKind === "address" ? segment.value : `${segment.value}@proofofwork.me`} context={context} />
      : <a key={index} className="boost-text-link" href={textRoute(context, { q: segment.value })}
        onClick={event => event.stopPropagation()}>{segment.text}</a>)}</>;
}
