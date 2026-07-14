import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  failed: boolean;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ProofOfWork.Me workspace render failed", error, info);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="public-app-shell">
        <section className="empty-state" role="alert">
          <h1>This workspace could not render.</h1>
          <p>
            This rendering error did not initiate a wallet action. Check UniSat
            and transaction history before retrying.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload workspace
          </button>
        </section>
      </main>
    );
  }
}
