"use client";
/**
 * Wraps the stage stepper so that on a phone, where the steps scroll sideways, the current step is brought into
 * view on load instead of the first one. Sideways only: it never scrolls the page.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function StepperScroll({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = box.current?.querySelector<HTMLElement>(".flow-stepper");
    const on = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !on || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = on.offsetLeft - (list.clientWidth - on.offsetWidth) / 2;
  }, []);
  return <div ref={box} className="flow-stepper-box">{children}</div>;
}
