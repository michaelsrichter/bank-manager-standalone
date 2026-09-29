import { Component, type ReactNode } from "react";
import { t } from "../i18n";

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="alert error" role="alert">
          {t().errors.boundary}
        </div>
      );
    }
    return this.props.children;
  }
}
