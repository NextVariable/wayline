import { Component, type ReactNode } from "react";
import { MapPin, RotateCcw } from "lucide-react";

/** Keep a map SDK failure from taking down saved places and the trip draft. */
export class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="map-recovery" role="alert">
          <MapPin size={32} strokeWidth={1.4} />
          <h2>地图暂时没有打开</h2>
          <p>你的地点与行程草稿仍然保留，可以继续在侧栏整理。</p>
          <button
            className="secondary-action"
            onClick={() =>
              this.setState((state) => ({
                failed: false,
                attempt: state.attempt + 1,
              }))
            }
          >
            <RotateCcw size={15} />
            重新加载地图
          </button>
        </div>
      );
    return (
      <div key={this.state.attempt} className="map-boundary-content">
        {this.props.children}
      </div>
    );
  }
}
