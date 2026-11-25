import { useLayoutEffect, useRef, type ReactNode } from "react";
import roomUrl from "./showcase-room.jpg?inline";
import "./spatialShowcase.css";

const compactViewport = "(max-width: 760px), (pointer: coarse)";
const reducedMotion = "(prefers-reduced-motion: reduce)";
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
type Point = [number, number];

function projectQuad([ [x0, y0], [x1, y1], [x2, y2], [x3, y3] ]: Point[], width: number, height: number) {
  const dx = x0 - x1 + x2 - x3;
  const dy = y0 - y1 + y2 - y3;
  const ax = x1 - x2, bx = x3 - x2, ay = y1 - y2, by = y3 - y2;
  const determinant = ax * by - bx * ay;
  const px = (dx * by - bx * dy) / determinant;
  const py = (ax * dy - dx * ay) / determinant;
  return `matrix3d(${[
    (x1 - x0 + px * x1) / width, (y1 - y0 + px * y1) / width, 0, px / width,
    (x3 - x0 + py * x3) / height, (y3 - y0 + py * y3) / height, 0, py / height,
    0, 0, 1, 0, x0, y0, 0, 1,
  ].join(",")})`;
}

function showWorkspaceUrl() {
  history.replaceState(history.state, "", `/${location.search}${location.hash}`);
}

export function SpatialShowcase({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const screen = screenRef.current!;
    const room = roomRef.current!;
    const prompt = promptRef.current!;
    const skip = skipRef.current!;
    const compact = matchMedia(compactViewport);
    const reduced = matchMedia(reducedMotion);
    let frame = 0;
    let lastTime = 0;
    let progress = 0;
    let finished = false;

    function stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      compact.removeEventListener("change", queue);
      reduced.removeEventListener("change", queue);
      skip.removeEventListener("click", onSkip);
    }

    function finish(moveFocus = false) {
      if (finished) return;
      finished = true;
      stop();
      screen.inert = false;
      screen.removeAttribute("style");
      stage.classList.remove("is-entering");
      room.hidden = true;
      prompt.hidden = true;
      showWorkspaceUrl();
      window.scrollTo(0, 0);
      if (moveFocus) screen.focus({ preventScroll: true });
    }

    function onSkip() {
      finish(true);
    }

    function draw(now: number) {
      frame = 0;
      if (compact.matches || reduced.matches) {
        finish();
        return;
      }
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width <= 0 || height <= 0) return;
      const travel = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const target = clamp(window.scrollY / travel);
      const elapsed = lastTime ? Math.min(40, now - lastTime) : 17;
      lastTime = now;
      const distance = target - progress;
      const response = 1 - Math.exp(-elapsed / mix(53, 31, clamp(Math.abs(distance) * 5)));
      progress = Math.abs(distance) < .0005 ? target : progress + distance * response;
      if (target === 1 && progress > .9986) {
        finish();
        return;
      }

      const flight = progress * (1.10 - .10 * progress);
      const leveling = smooth(progress);
      const edge = smooth(clamp((progress - .48) / .52));
      const startWidth = Math.min(width * .443, height * .90);
      const startHeight = Math.min(height * .57, startWidth / 1.38);
      const centerX = mix(width * .568, width * .5, flight);
      const centerY = mix(height * .449, height * .5, flight);
      const halfWidth = mix(startWidth, width, leveling) / 2;
      const halfHeight = mix(startHeight, height, leveling) / 2;
      const bend = startHeight * .094 * (1 - leveling) ** 1.38;
      const left = centerX - halfWidth, right = centerX + halfWidth;
      const top = centerY - halfHeight, bottom = centerY + halfHeight;

      room.style.transform = `translate3d(${-1.8 * leveling}%,${-.6 * leveling}%,0) scale(${1 + .095 * leveling})`;
      room.style.opacity = String(1 - smooth(clamp((progress - .59) / .40)));
      screen.style.transform = projectQuad([[left, top + bend], [right, top - bend], [right, bottom + bend], [left, bottom - bend]], width, height);
      screen.style.borderRadius = `${38 * (1 - edge)}px`;
      screen.style.setProperty("--spatial-edge", String(1 - edge));
      const hint = 1 - smooth(clamp(progress / .26));
      prompt.style.opacity = String(hint);
      if (hint < .12 && prompt.contains(document.activeElement)) skip.blur();
      prompt.inert = hint < .12;
      if (progress !== target) queue();
    }

    function queue() {
      if (!finished && !frame) frame = requestAnimationFrame(draw);
    }

    if (!stage.classList.contains("is-entering")) {
      showWorkspaceUrl();
      return;
    }
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    compact.addEventListener("change", queue);
    reduced.addEventListener("change", queue);
    skip.addEventListener("click", onSkip);
    draw(performance.now());

    return stop;
  }, []);

  const play = !matchMedia(compactViewport).matches && !matchMedia(reducedMotion).matches;

  return (
    <div ref={stageRef} className={play ? "spatial-showcase is-entering" : "spatial-showcase"}>
      <div ref={roomRef} className="spatial-room" hidden={!play} aria-hidden="true">
        {play && <img src={roomUrl} alt="" width="1672" height="941" fetchPriority="high" />}
      </div>
      <div ref={screenRef} className="spatial-screen" inert={play} tabIndex={-1}>
        {children}
      </div>
      <div ref={promptRef} className="spatial-prompt" hidden={!play}>
        <span aria-hidden="true">滚动进入</span>
        <button ref={skipRef} type="button">直接进入</button>
      </div>
    </div>
  );
}
