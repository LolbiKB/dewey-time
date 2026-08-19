/**
 * What Telegram's back button should close, when several things are open.
 *
 * THE DEFECT THIS FIXES: the back button was bound to the day drill-in alone.
 * Open the calendar sheet or the flags sheet on top of a drilled-in day, press
 * back, and the sheet stayed exactly where it was while the DATE UNDERNEATH IT
 * silently reset — the one layer the reader could not see was the one that
 * moved. With nothing drilled in, the button was hidden entirely, so back did
 * whatever Telegram does by default with a sheet covering the screen.
 *
 * A REGISTRY RATHER THAN LIFTED STATE. The flags sheet's open flag belongs to
 * MyDayPage, which owns the day it describes; hoisting it into the shell to
 * satisfy the back button would move state away from the thing it is about and
 * put the day object there with it. Instead each layer says "while I am open,
 * this is how you close me", and the shell asks for the topmost.
 *
 * Module state, not context: `bindBackButton` talks to Telegram's SDK from an
 * effect in the shell, and the layers registering are in three different
 * subtrees. A provider would work and would add a wrapper to every one of them
 * for a stack that is at most three deep.
 */
import { useEffect, useState } from "react";

type Layer = { id: number; dismiss: () => void };

const stack: Layer[] = [];
const listeners = new Set<(depth: number) => void>();
let nextId = 1;

function notify() {
  for (const listener of listeners) listener(stack.length);
}

/**
 * Register a layer. Returns the function that removes it again.
 *
 * A plain function, not just the hook below, so the ORDER rules — which are
 * the entire value here — can be tested without a DOM. This repo renders
 * components with `renderToStaticMarkup`, which runs no effects at all, so a
 * test driven through the hook would observe an empty stack and agree with
 * the bug it exists to catch.
 */
export function pushLayer(dismiss: () => void): () => void {
  const layer: Layer = { id: nextId++, dismiss };
  stack.push(layer);
  notify();
  return () => {
    const at = stack.findIndex((entry) => entry.id === layer.id);
    if (at >= 0) stack.splice(at, 1);
    notify();
  };
}

/** Close the topmost open layer. True when there was one. */
export function dismissTopLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.dismiss();
  return true;
}

/** How many layers are open. Re-renders the caller when it changes. */
export function useLayerDepth(): number {
  const [depth, setDepth] = useState(stack.length);
  useEffect(() => {
    listeners.add(setDepth);
    // Re-read on subscribe: a layer can open before this effect runs, and the
    // missed notification would leave the back button hidden over an open sheet.
    setDepth(stack.length);
    return () => {
      listeners.delete(setDepth);
    };
  }, []);
  return depth;
}

/**
 * Register this layer while it is open.
 *
 * `dismiss` is read through a ref rather than captured, so a handler that
 * changes identity every render does not churn the stack — the ORDER is the
 * whole value here, and re-registering would move a layer to the top.
 */
export function useDismissibleLayer(open: boolean, dismiss: () => void): void {
  const [box] = useState(() => ({ dismiss }));
  box.dismiss = dismiss;

  useEffect(() => {
    if (!open) return;
    return pushLayer(() => box.dismiss());
  }, [open, box]);
}

/** Test seam: forget every registered layer. */
export function resetLayers(): void {
  stack.length = 0;
  notify();
}
