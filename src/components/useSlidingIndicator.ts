"use client";
/**
 * One marker that slides to the active item instead of jumping (side menu, section tabs). The container holds a
 * `.ind` child and items marked `data-key`; the marker is moved with transform and only animates after its first
 * placement, so the page never opens with a slide. Reduced motion is handled in CSS.
 */
import { useLayoutEffect, type RefObject } from "react";

export function useSlidingIndicator(ref: RefObject<HTMLElement | null>, activeKey: string | null) {
  useLayoutEffect(() => {
    const box = ref.current;
    const ind = box?.querySelector<HTMLElement>(":scope > .ind");
    if (!box || !ind) return;
    const place = () => {
      const el = activeKey ? box.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`) : null;
      if (!el) { ind.style.opacity = "0"; return; }
      ind.style.opacity = "1";
      ind.style.width = `${el.offsetWidth}px`;
      ind.style.height = `${el.offsetHeight}px`;
      ind.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      // Keep the active tab in view when the strip scrolls sideways on a phone, without moving the page.
      if (box.scrollWidth > box.clientWidth) {
        const left = el.offsetLeft - 16, right = el.offsetLeft + el.offsetWidth + 16 - box.clientWidth;
        if (left < box.scrollLeft) box.scrollLeft = left; else if (right > box.scrollLeft) box.scrollLeft = right;
      }
    };
    place();
    const ready = requestAnimationFrame(() => { box.dataset.indReady = ""; });
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => { cancelAnimationFrame(ready); ro.disconnect(); };
  }, [ref, activeKey]);
}
