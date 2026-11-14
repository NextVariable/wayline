import { Component, createElement, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

export function preloadableWorkflow<P extends object>(load: () => Promise<(props: P) => ReactNode>) {
  let loaded: ((props: P) => ReactNode) | undefined;
  let pending: Promise<{ default: (props: P) => ReactNode }> | undefined;
  const preload = () => pending ??= load().then(component => {
    loaded = component;
    return { default: component };
  }).catch(error => { pending = undefined; throw error; });
  const Lazy = lazy(preload);
  return { View: (props: P) => createElement(loaded ?? Lazy, props), preload, ready: () => !!loaded };
}
class WorkflowBoundary extends Component<{ active: boolean; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return this.props.active ? <section className="workspace-panel workflow-recovery" role="alert">
      <p>页面未能打开，重新载入后再试。</p>
      <button className="text-action" onClick={() => window.location.reload()}>重新载入</button>
    </section> : null;
    return this.props.children;
  }
}
/** Load secondary code on first use, while retaining unfinished form state afterward. */
export function DeferredWorkflow({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  if (!active && !visited) return null;
  return (
    <WorkflowBoundary active={active}>
    <Suspense
      fallback={
        active ? (
          <section className="workspace-panel workflow-loading" role="status">
            正在打开…
          </section>
        ) : null
      }
    >
      {children}
    </Suspense>
    </WorkflowBoundary>
  );
}
