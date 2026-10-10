import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Grid2X2, LockKeyhole, Monitor, PanelLeft, Search, X } from "lucide-react";
import {
  COMPUTER_APPS, COMPUTER_DOCK_APPS, computerAppForWorkspace, computerAppIsActive,
  findComputerApps, type ComputerLayout, type ComputerWorkspace,
} from "./computerNavigation";
import "./computer.css";

export type { ComputerLayout, ComputerWorkspace } from "./computerNavigation";

type ComputerNavigationProps = { onOpenWorkspace: (workspace: ComputerWorkspace) => void };

export type ComputerShellProps = ComputerNavigationProps & {
  layout: ComputerLayout;
  activeFolder: ComputerWorkspace;
  children: ReactNode;
  overview: ReactNode;
  title: string;
};

type ComputerAppLauncherProps = ComputerNavigationProps & {
  open: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
};

function ComputerAppLauncher({ open, onClose, onOpenWorkspace, returnFocus }: ComputerAppLauncherProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const noteId = useId();
  const [query, setQuery] = useState("");
  const apps = findComputerApps(query);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    setQuery("");
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, returnFocus]);

  const openWorkspace = (workspace: ComputerWorkspace) => {
    onClose();
    onOpenWorkspace(workspace);
  };

  return (
    <dialog
      aria-labelledby={titleId}
      aria-describedby={noteId}
      className="computer-app-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Search inputs otherwise consume the first Escape to clear their value.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      ref={dialogRef}
    >
      <header className="computer-launcher-head">
        <h2 id={titleId}>Computer apps</h2>
        <button aria-label="Close apps" className="computer-launcher-close" onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="computer-launcher-content">
        <label className="computer-app-search" htmlFor={inputId}>
          <span>Find an app</span>
          <span className="computer-app-search-field">
            <Search aria-hidden="true" size={18} />
            <input autoComplete="off" id={inputId} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  dialogRef.current?.querySelector<HTMLButtonElement>(".computer-launcher-app")?.focus();
                } else if (event.key === "Enter" && apps.length === 1) {
                  event.preventDefault();
                  openWorkspace(apps[0].workspace);
                }
              }}
              placeholder="Mail, IDs, files…" ref={inputRef} type="search" value={query} />
          </span>
        </label>
        <p className="computer-launcher-note" id={noteId}>Find an app on this Computer. Open Search to discover public chain records.</p>
        <ul className="computer-launcher-results" aria-label="Matching apps">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <li key={app.workspace}>
                <button aria-label={app.label} className="computer-launcher-app" onClick={() => openWorkspace(app.workspace)} type="button">
                  <Icon aria-hidden="true" size={21} />
                  <span className="computer-launcher-app-copy"><strong>{app.label}</strong><small>{app.description}</small></span>
                </button>
              </li>
            );
          })}
        </ul>
        {apps.length === 0 ? <p className="computer-launcher-empty" role="status">No matching apps.</p> : null}
        <button className="computer-record-search" onClick={() => openWorkspace("search")} type="button">
          <Search aria-hidden="true" size={17} /><span>Search public records</span>
        </button>
      </div>
    </dialog>
  );
}

function useComputerLauncher() {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { open, show, close, returnFocus };
}

export type ComputerControlsProps = ComputerNavigationProps & {
  layout: ComputerLayout;
  onLayoutChange: (layout: ComputerLayout) => void;
  onOpenLocalData?: () => void;
};

export function ComputerControls({ layout, onLayoutChange, onOpenWorkspace, onOpenLocalData }: ComputerControlsProps) {
  const launcher = useComputerLauncher();

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      // Reviews, writers and the local navigation sheet retain keyboard and focus.
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      launcher.show();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [launcher.show]);

  return (
    <div className="computer-controls">
      <div aria-label="Computer layout" className="computer-layout-switch" role="group">
        <button aria-pressed={layout === "focus"} onClick={() => onLayoutChange("focus")} type="button">
          <PanelLeft aria-hidden="true" size={16} /><span>Focus</span>
        </button>
        <button aria-pressed={layout === "desktop"} onClick={() => onLayoutChange("desktop")} type="button">
          <Monitor aria-hidden="true" size={16} /><span>Desktop</span>
        </button>
      </div>
      <button aria-label="Find an app" aria-haspopup="dialog" className="computer-launcher-button" onClick={launcher.show} type="button">
        <Search aria-hidden="true" size={17} /><span>Apps</span><kbd>⌘ / Ctrl K</kbd>
      </button>
      {onOpenLocalData ? <button className="computer-local-data-button" onClick={onOpenLocalData} type="button"><PanelLeft aria-hidden="true" size={17} /><span>Local data</span></button> : null}
      <ComputerAppLauncher open={launcher.open} onClose={launcher.close} onOpenWorkspace={onOpenWorkspace} returnFocus={launcher.returnFocus.current} />
    </div>
  );
}

export function ComputerShell({ layout, activeFolder, onOpenWorkspace, children, overview, title }: ComputerShellProps) {
  const launcher = useComputerLauncher();
  const activeApp = computerAppForWorkspace(activeFolder);
  const ActiveIcon = activeApp.icon;

  // Layout changes only attributes and visibility: the actual workspace stays mounted.
  return (
    <section className="computer-shell-layout" data-layout={layout} data-workspace={activeFolder} data-app={activeApp.workspace}>
      <div className="computer-body">
        <nav className="computer-app-rail" aria-label="Computer apps">
          <p className="computer-rail-title">Apps</p>
          {COMPUTER_APPS.map((app) => {
            const Icon = app.icon;
            return <button aria-current={computerAppIsActive(app, activeFolder) ? "page" : undefined} className="computer-rail-app" key={app.workspace} onClick={() => onOpenWorkspace(app.workspace)} title={app.description} type="button"><Icon aria-hidden="true" size={18} /><span>{app.label}</span></button>;
          })}
          <button aria-haspopup="dialog" className="computer-rail-app computer-all-apps" onClick={launcher.show} type="button"><Grid2X2 aria-hidden="true" size={18} /><span>All apps</span></button>
          <p className="computer-rail-note">Your desktop stays local.</p>
        </nav>
        <div className="computer-stage">
          <section className="computer-window" aria-label={`${title} workspace`}>
            <header className="computer-windowbar">
              <span className="computer-window-title"><ActiveIcon aria-hidden="true" size={18} /><span>{title}</span></span>
              <span className="computer-window-meta"><LockKeyhole aria-hidden="true" size={13} /><span>Signing stays local</span></span>
            </header>
            <div className="computer-window-content">{children}</div>
          </section>
        </div>
        <aside className="computer-overview" aria-label="Account overview" hidden={layout !== "desktop"}>{overview}</aside>
      </div>
      <nav className="computer-dock" aria-label="Desktop apps">
        {COMPUTER_DOCK_APPS.map((app) => {
          const Icon = app.icon;
          return <button aria-current={computerAppIsActive(app, activeFolder) ? "page" : undefined} className="computer-dock-app" key={app.workspace} onClick={() => onOpenWorkspace(app.workspace)} title={app.description} type="button"><Icon aria-hidden="true" size={22} /><span>{app.label}</span></button>;
        })}
        <button aria-haspopup="dialog" className="computer-dock-app computer-all-apps" onClick={launcher.show} type="button"><Grid2X2 aria-hidden="true" size={22} /><span>All apps</span></button>
      </nav>
      <ComputerAppLauncher open={launcher.open} onClose={launcher.close} onOpenWorkspace={onOpenWorkspace} returnFocus={launcher.returnFocus.current} />
    </section>
  );
}
