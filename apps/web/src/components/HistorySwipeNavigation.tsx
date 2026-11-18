import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn, isMacPlatform } from "../lib/utils";
import { canNavigateHistory, navigateHistory, type HistoryDirection } from "../navigationHistory";

const SWIPE_TRIGGER_DISTANCE = 120;
// Movement needed before the gesture picks an axis; first events are often diagonal.
const SWIPE_AXIS_LOCK_DISTANCE = 8;
// Vertical scrolls drift sideways, so a swipe's horizontal travel must clearly dominate once
// it has moved far enough for its direction to be more than noise.
const SWIPE_HORIZONTAL_DOMINANCE = 2;
const SWIPE_DOMINANCE_DISTANCE = 30;
const MOMENTUM_SAMPLE_SIZE = 5;
// A swipe over a target steps as the fingers travel: one step after a short pull, then one per
// stretch, so a flick takes one step and a long swipe several. Stepping back needs some slack.
const TARGET_FIRST_STEP_DISTANCE = 80;
const TARGET_STEP_DISTANCE = 200;
const TARGET_STEP_BACK_SLACK = 40;
// A held mouse tilt repeats; it steps again only after its events pause this long (ms).
const MOUSE_TILT_REPEAT_GAP = 200;

type SwipeBounds = { left: number; top: number; width: number; height: number };

/** An element that claims swipes made over it, instead of history navigation, one step at a time. */
export interface SwipeTarget {
  canSwipe: (direction: HistoryDirection) => boolean;
  swipe: (direction: HistoryDirection) => void;
}
const swipeTargets = new WeakMap<Element, SwipeTarget>();

/** Returns the unregister function, so it can be a ref callback's cleanup. */
export function registerSwipeTarget(element: Element, target: SwipeTarget): () => void {
  swipeTargets.set(element, target);
  return () => {
    if (swipeTargets.get(element) === target) swipeTargets.delete(element);
  };
}

type SwipeGesture =
  | { kind: "pending"; path: EventTarget[]; y: number; sumX: number; sumY: number }
  | {
      kind: "tracking";
      direction: HistoryDirection;
      // Looked up per step: a step re-renders the target, which registers fresh handlers.
      targetElement: Element | null;
      steps: number;
      distance: number;
      deltas: number[];
      travelX: number;
      travelY: number;
      y: number;
      bounds: SwipeBounds;
    }
  // Not a swipe, or one already decided: the rest of its events are ignored.
  | { kind: "ignored" };
type SwipeIndicatorState = {
  direction: HistoryDirection;
  progress: number;
  y: number;
  bounds: SwipeBounds;
  tracking: boolean;
};

function readMainContentBounds(): SwipeBounds {
  const main = document.querySelector('[data-slot="sidebar-inset"]');
  if (!main) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const { left, top, width, height } = main.getBoundingClientRect();
  return { left, top, width, height };
}

// `event.target` stops at a shadow host; the composed path also reaches scrollers inside it.
function canScrollHorizontally(path: readonly EventTarget[], deltaX: number): boolean {
  for (const element of path) {
    if (!(element instanceof Element) || element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    const canScroll =
      deltaX < 0
        ? element.scrollLeft > 0
        : element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    if (canScroll) return true;
  }
  return false;
}

function isVerticalScroll(travelX: number, travelY: number): boolean {
  return (
    travelX + travelY >= SWIPE_DOMINANCE_DISTANCE && travelX <= SWIPE_HORIZONTAL_DOMINANCE * travelY
  );
}

function lockSwipeAxis(
  pending: Extract<SwipeGesture, { kind: "pending" }>,
): Exclude<SwipeGesture, { kind: "pending" }> {
  const { path, sumX, sumY } = pending;
  if (Math.abs(sumX) <= Math.abs(sumY) || isVerticalScroll(Math.abs(sumX), Math.abs(sumY))) {
    return { kind: "ignored" };
  }
  if (path.some((node) => node instanceof Element && node.matches('[role="dialog"]'))) {
    return { kind: "ignored" };
  }
  if (canScrollHorizontally(path, sumX)) return { kind: "ignored" };
  const direction = sumX < 0 ? "back" : "forward";
  const targetElement = findSwipeTargetElement(path);
  const target = targetElement ? swipeTargets.get(targetElement)! : null;
  if (!(target ? target.canSwipe(direction) : canNavigateHistory(direction))) {
    return { kind: "ignored" };
  }
  return {
    kind: "tracking",
    direction,
    targetElement: targetElement ?? null,
    steps: 0,
    distance: Math.abs(sumX),
    deltas: [],
    travelX: Math.abs(sumX),
    travelY: Math.abs(sumY),
    y: pending.y,
    bounds: readMainContentBounds(),
  };
}

function findSwipeTargetElement(path: readonly EventTarget[]): Element | undefined {
  return path.find((node): node is Element => node instanceof Element && swipeTargets.has(node));
}

// Chromium gives a trackpad's wheel events wheelDeltaX = -3 × deltaX (truncated), and a mouse
// wheel's its raw notches, which breaks that ratio. So a tilt click is a horizontal event that does.
function mouseTiltDirection(event: WheelEvent): HistoryDirection | null {
  const { wheelDeltaX = 0 } = event as WheelEvent & { wheelDeltaX?: number };
  if (event.ctrlKey || wheelDeltaX === 0) return null;
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return null;
  if (Math.abs(wheelDeltaX + 3 * event.deltaX) < 1) return null;
  return event.deltaX < 0 ? "back" : "forward";
}

/** Steps a swipe over a target has taken once its fingers travelled `distance`. */
function swipeTargetSteps(distance: number): number {
  if (distance < TARGET_FIRST_STEP_DISTANCE) return 0;
  return 1 + Math.floor((distance - TARGET_FIRST_STEP_DISTANCE) / TARGET_STEP_DISTANCE);
}

// One step per wheel event, so each step sees the target's handlers from after the last one.
function stepSwipeTarget(gesture: Extract<SwipeGesture, { kind: "tracking" }>) {
  const target = gesture.targetElement ? swipeTargets.get(gesture.targetElement) : undefined;
  if (!target) return;
  if (swipeTargetSteps(gesture.distance) > gesture.steps) {
    target.swipe(gesture.direction);
    gesture.steps += 1;
  } else if (swipeTargetSteps(gesture.distance + TARGET_STEP_BACK_SLACK) < gesture.steps) {
    target.swipe(gesture.direction === "back" ? "forward" : "back");
    gesture.steps -= 1;
  }
}

/**
 * macOS momentum after the fingers lift decays by a near-constant ratio per
 * event; finger movement is noisier. Deltas are signed along the swipe.
 */
export function isMomentumTail(deltas: readonly number[]): boolean {
  if (deltas.length < MOMENTUM_SAMPLE_SIZE) return false;
  const recent = deltas.slice(-MOMENTUM_SAMPLE_SIZE);
  if (recent.some((delta) => delta <= 0)) return false;
  const ratios = recent.slice(1).map((delta, index) => delta / recent[index]!);
  return (
    ratios.every((ratio) => ratio >= 0.7 && ratio < 1) &&
    Math.max(...ratios) - Math.min(...ratios) < 0.1
  );
}

/**
 * Two-finger horizontal trackpad swipes go back and forward, like a browser,
 * unless they start over a registered swipe target, which steps instead. A mouse tilt click
 * over a target steps it once.
 * macOS only: on Windows and Linux a mouse tilt wheel is indistinguishable from a trackpad swipe.
 */
export function HistorySwipeNavigation() {
  const [swipe, setSwipe] = useState<SwipeIndicatorState | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window wheel and desktop gesture listeners track trackpad swipes
  useEffect(() => {
    if (!isMacPlatform(navigator.platform)) return;
    let gesture: SwipeGesture | null = null;
    let lastTilt: { direction: HistoryDirection; at: number } | null = null;
    const hideIndicator = () =>
      setSwipe((current) => (current === null ? null : { ...current, tracking: false }));
    // The fingers lifted: navigate if the swipe went far enough, then ignore its momentum.
    // A target already stepped while the fingers moved.
    const release = () => {
      if (
        gesture?.kind === "tracking" &&
        gesture.targetElement === null &&
        gesture.distance >= SWIPE_TRIGGER_DISTANCE
      ) {
        navigateHistory(gesture.direction);
      }
      gesture = { kind: "ignored" };
      hideIndicator();
    };
    // Chromium brackets each trackpad scroll, momentum included, with these.
    const unsubscribeScrollBegin = window.desktopBridge?.onTrackpadScrollBegin(() => {
      if (gesture?.kind === "ignored") gesture = null;
    });
    const unsubscribeScrollEnd = window.desktopBridge?.onTrackpadScrollEnd(() => {
      if (gesture?.kind === "tracking") release();
      gesture = null;
    });
    // A mouse tilt click over a target steps it once; elsewhere it scrolls like any wheel event.
    const tiltSwipeTarget = (event: WheelEvent): boolean => {
      const direction = mouseTiltDirection(event);
      if (direction === null) return false;
      const path = event.composedPath();
      const element = findSwipeTargetElement(path);
      if (!element) return false;
      const held =
        direction === lastTilt?.direction && event.timeStamp - lastTilt.at < MOUSE_TILT_REPEAT_GAP;
      lastTilt = { direction, at: event.timeStamp };
      const target = swipeTargets.get(element)!;
      if (!held && !canScrollHorizontally(path, event.deltaX) && target.canSwipe(direction)) {
        target.swipe(direction);
      }
      return true;
    };
    const onWheel = (event: WheelEvent) => {
      if (tiltSwipeTarget(event)) return;
      if (gesture === null) {
        gesture =
          event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
            ? { kind: "ignored" }
            : { kind: "pending", path: event.composedPath(), y: event.clientY, sumX: 0, sumY: 0 };
      }
      if (gesture.kind === "ignored") return;
      if (gesture.kind === "pending") {
        gesture.sumX += event.deltaX;
        gesture.sumY += event.deltaY;
        if (Math.abs(gesture.sumX) + Math.abs(gesture.sumY) < SWIPE_AXIS_LOCK_DISTANCE) return;
        gesture = lockSwipeAxis({ ...gesture, path: [...gesture.path, ...event.composedPath()] });
        if (gesture.kind === "ignored") return;
      } else {
        const delta = gesture.direction === "back" ? -event.deltaX : event.deltaX;
        if (event.deltaX === 0 && event.deltaY === 0) return release();
        gesture.travelX += Math.abs(event.deltaX);
        gesture.travelY += Math.abs(event.deltaY);
        if (isVerticalScroll(gesture.travelX, gesture.travelY)) {
          gesture = { kind: "ignored" };
          return hideIndicator();
        }
        gesture.deltas = [...gesture.deltas.slice(1 - MOMENTUM_SAMPLE_SIZE), delta];
        if (isMomentumTail(gesture.deltas)) return release();
        gesture.distance = Math.max(0, gesture.distance + delta);
      }
      if (gesture.targetElement !== null) return stepSwipeTarget(gesture);
      setSwipe({
        direction: gesture.direction,
        progress: Math.min(1, gesture.distance / SWIPE_TRIGGER_DISTANCE),
        y: gesture.y,
        bounds: gesture.bounds,
        tracking: true,
      });
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      unsubscribeScrollBegin?.();
      unsubscribeScrollEnd?.();
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);

  return swipe === null ? null : <SwipeIndicator {...swipe} />;
}

// A circle pinned to the edge of the main content that peeks in up to half its width.
function SwipeIndicator({ direction, progress, y, bounds, tracking }: SwipeIndicatorState) {
  const armed = progress >= 1;
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  const hidden = 100 - progress * 50;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-100 overflow-hidden"
      style={bounds}
    >
      <div
        className={cn(
          "absolute flex size-14 items-center rounded-full bg-muted text-foreground dark:bg-black dark:text-white",
          direction === "back" ? "left-0 justify-end pr-2" : "right-0 justify-start pl-2",
          !tracking && "transition-[opacity,transform] duration-200 ease-out",
        )}
        style={{
          top: `clamp(0px, calc(${y - bounds.top}px - 1.75rem), calc(100% - 3.5rem))`,
          opacity: tracking ? 1 : 0,
          transform: `translateX(${direction === "back" ? -hidden : hidden}%)`,
        }}
      >
        <Icon
          className={cn(
            "size-4 transition-opacity duration-100",
            armed ? "opacity-100" : "opacity-40",
          )}
        />
      </div>
    </div>
  );
}
