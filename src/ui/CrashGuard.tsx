import { Component, type ReactNode } from 'react';

/** If a screen throws, show a calm recovery card instead of a blank page. Recordings are on disk, so nothing is lost. */
export class CrashGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('Earshot UI error', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash">
        <div className="crash__card">
          <strong>Something hiccuped.</strong>
          <p>Your recordings are safe. Tap below to pick up where you left off.</p>
          <button type="button" className="btn btn--primary" onClick={() => this.setState({ failed: false })}>Try again</button>
          <button type="button" className="btn btn--ghost" onClick={() => location.reload()}>Restart app</button>
        </div>
      </div>
    );
  }
}
