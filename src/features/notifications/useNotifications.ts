import { useEffect, useRef, useState } from "react";
import { createVisibleReadLoop } from "../../shared/api/useVisibleReadLoop";
import { appendNotificationPage, emptyNotificationReadState, notificationStorageKey, reconcileNotificationReadStorage, setNotificationsRead, setAllNotificationsRead, type NotificationReadState } from "./notificationState.mjs";
import { notificationQueryKey } from "./notificationScope.mjs";
import { fetchNotifications, type NotificationQuery, type NotificationsResponse } from "./notificationsApi";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Notifications are temporarily unavailable."; }
export function useNotificationReadState(network: string, scope: string | null) {
  const key = scope === null ? null : notificationStorageKey(network, scope);
  const [saved, setSaved] = useState<{ key: string | null; state: NotificationReadState; warning: string }>({ key: "", state: emptyNotificationReadState(), warning: "" });
  const memory = useRef(saved);
  const currentKey = useRef(key);
  currentKey.current = key;
  const current = saved.key === key ? saved : { key, state: emptyNotificationReadState(), warning: "" };
  const update = (change?: (state: NotificationReadState) => NotificationReadState) => {
    if (key === null || currentKey.current !== key) return;
    const previous = memory.current.key === key ? memory.current.state : emptyNotificationReadState();
    let next;
    try { next = reconcileNotificationReadStorage(window.localStorage, key, previous, change); }
    catch { next = { state: change ? change(previous) : previous, warning: "Read status is available for this session. Browser storage is unavailable." }; }
    memory.current = { key, ...next };
    setSaved(memory.current);
  };
  useEffect(() => {
    if (key === null) return;
    const onStorage = (event: StorageEvent) => {
      if (currentKey.current !== key || (event.key !== key && event.key !== null)) return;
      // An explicit removal/clear in another tab is an intentional preference reset.
      if (event.newValue === null) {
        memory.current = { key, state: emptyNotificationReadState(), warning: "" };
        setSaved(memory.current);
      } else update();
    };
    update(); window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  return { state: current.state, warning: current.warning,
    mark: (ids: string[], read: boolean) => update(state => setNotificationsRead(state, ids, read)),
    markAll: (items: { id: string }[], firstSeenAt: string, maxEventId: number) => update(state => setAllNotificationsRead(state, items, firstSeenAt, maxEventId)),
  };
}

export function useNotifications(query: NotificationQuery, open: boolean) {
  const key = notificationQueryKey(query);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; value: NotificationsResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const generation = useRef(0);
  const pageController = useRef<AbortController>();
  const firstPageSignal = useRef<AbortSignal>();
  const loadedMore = useRef(false);
  const isOpen = useRef(open);
  isOpen.current = open;
  const active = result?.key === key ? result.value : null;
  const error = failure?.key === key ? failure.message : "";
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    const epoch = ++generation.current;
    pageController.current?.abort();
    loadedMore.current = false;
    setLoadingMore(false); setPageError(""); setFailure(null); setReading(Boolean(query.id ?? query.address));
    if (!(query.id ?? query.address)) return;
    const stop = createVisibleReadLoop(async signal => {
      // Keep an expanded history stable while it is being read. Explicit refresh
      // restarts at the newest page; hidden tabs never poll.
      if (pageController.current || (loadedMore.current && isOpen.current)) return;
      firstPageSignal.current = signal;
      setReading(true);
      try {
        const value = await fetchNotifications(query, signal);
        if (signal.aborted || epoch !== generation.current || currentKey.current !== key) return;
        setResult({ key, value }); setFailure(null); setPageError(""); loadedMore.current = false;
      } catch (reason) {
        if (!signal.aborted && epoch === generation.current && currentKey.current === key) setFailure({ key, message: errorMessage(reason) });
      } finally {
        if (firstPageSignal.current === signal) firstPageSignal.current = undefined;
        if (epoch === generation.current && currentKey.current === key) setReading(false);
      }
    }, 60_000);
    return () => { stop(); firstPageSignal.current = undefined; pageController.current?.abort(); pageController.current = undefined; };
  // Query is exactly the network and address or ID scope; local view filters never narrow coverage.
  }, [key, refresh]);

  const loadMore = async () => {
    const cursor = active?.nextCursor;
    if (!active || !cursor || reading || firstPageSignal.current || pageController.current) return;
    const epoch = generation.current;
    const controller = new AbortController();
    pageController.current = controller;
    setLoadingMore(true); setPageError("");
    try {
      const page = await fetchNotifications(query, controller.signal, cursor);
      if (controller.signal.aborted || epoch !== generation.current || currentKey.current !== key) return;
      const merged = appendNotificationPage(active, page, cursor);
      setResult({ key, value: merged }); loadedMore.current = true;
    } catch (reason) {
      if (!controller.signal.aborted && epoch === generation.current && currentKey.current === key) setPageError(errorMessage(reason));
    } finally {
      if (pageController.current === controller) pageController.current = undefined;
      if (epoch === generation.current && currentKey.current === key) setLoadingMore(false);
    }
  };
  return { response: active, error, reading, loadingMore, pageError, loadMore, refresh: () => setRefresh(value => value + 1) };
}
