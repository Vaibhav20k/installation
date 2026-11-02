"use client";

import { useEffect, useRef, useState } from "react";
import { tutorials, type Tutorial } from "./tutorials";
import styles from "./tutorials.module.css";

/** Temporary teaching surface. Deliberately has no server actions or writes to app data. */
export function TemporaryTutorials() {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState<Tutorial | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [speed, setSpeed] = useState(1);
  const current = tour?.steps[index];
  // Longer explanations get more reading time. Pausing preserves the current position.
  const duration = current ? Math.max(10000, current.explanation.split(/\s+/).length * 330 + 4500) : 10000;
  const demonstrated = elapsed >= 2800 || finished;

  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = previous; };
    }
    dialog.current?.close();
  }, [open]);

  useEffect(() => {
    if (!open || !playing || !tour || finished) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setElapsed(value => value + 200 * speed);
    }, 200);
    return () => window.clearInterval(timer);
  }, [open, playing, tour, finished, speed]);

  useEffect(() => {
    if (!tour || elapsed < duration || !playing) return;
    if (index === tour.steps.length - 1) { setFinished(true); setPlaying(false); }
    else { setIndex(value => value + 1); setElapsed(0); }
  }, [elapsed, duration, playing, tour, index]);

  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [index, tour]);

  function start(selected: Tutorial) {
    setTour(selected); setIndex(0); setElapsed(0); setFinished(false); setPlaying(true);
  }
  function move(next: number) {
    if (!tour) return;
    setIndex(Math.max(0, Math.min(next, tour.steps.length - 1)));
    setElapsed(0); setFinished(false);
  }
  function close() { setOpen(false); setPlaying(false); }
  function menu() { setTour(null); setPlaying(false); setFinished(false); setElapsed(0); }

  return <>
    <div className={styles.launcher}>
      <button type="button" className={styles.launch} onClick={() => { menu(); setOpen(true); }} aria-haspopup="dialog">
        <span aria-hidden="true">▷</span> See tutorial
      </button>
    </div>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="tutorial-title" onCancel={close} onClose={close}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Temporary learning guide</p><h2 id="tutorial-title">{tour?.title ?? "What would you like to learn?"}</h2></div>
        <button type="button" onClick={close} aria-label="Close tutorial" className={styles.close}>×</button>
      </header>
      <div className={styles.safety}>Demo walkthrough · No orders, approvals, punches or settings are changed.</div>
      {!tour ? <div className={styles.menu} ref={content}>
        <p>Choose a tutorial to start its automatic walkthrough. You can pause or move through the steps at your own pace.</p>
        <div className={styles.catalog}>{tutorials.map((item, i) => <button key={item.id} type="button" className={styles.choice} onClick={() => start(item)}>
          <span className={styles.number} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
          <span><strong>{item.title}</strong><span>{item.summary}</span><small>{item.steps.length} steps · Automatic demo</small></span>
          <span aria-hidden="true">▷</span>
        </button>)}</div>
      </div> : current && <>
        <div className={styles.player} ref={content}>
          <div className={styles.position}><button type="button" onClick={menu}>← All tutorials</button><span>Step {index + 1} of {tour.steps.length}</span></div>
          <div className={styles.track} role="progressbar" aria-label="Tutorial progress" aria-valuemin={0} aria-valuemax={tour.steps.length} aria-valuenow={finished ? tour.steps.length : index + 1}>
            {tour.steps.map((item, i) => <span key={item.title} data-done={i < index || finished} data-current={i === index} />)}
          </div>
          <div className={styles.scene}>
            <div className={styles.explanation}>
              <p className={styles.role}>{current.role}</p>
              <h3>{current.title}</h3>
              <p>{current.explanation}</p>
              <p className={styles.where}><strong>Where to find it</strong>{current.screen}</p>
            </div>
            <section className={styles.preview} aria-label="Simulated application screen">
              <div className={styles.previewHead}><strong>Magppie</strong><span>Example only</span></div>
              <dl>{current.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <div className={styles.demoAction} data-done={demonstrated}>
                <span aria-hidden="true">{demonstrated ? "✓" : "▷"}</span> {current.action}
                <small>{demonstrated ? "Demonstrated" : "Demonstrating…"}</small>
              </div>
              <div className={styles.result} data-ready={demonstrated}><strong>What happens next</strong><p>{demonstrated ? current.result : "Watch the example action above, then see the result here."}</p></div>
            </section>
          </div>
          {finished && <div className={styles.complete} role="status"><strong>Tutorial complete</strong><p>You have seen every step. Replay it or choose another tutorial.</p></div>}
          <p className={styles.srOnly} aria-live="polite">{finished ? "Tutorial complete" : `Step ${index + 1} of ${tour.steps.length}: ${current.title}`}</p>
        </div>
        <footer className={styles.controls}>
          <div className={styles.buttons}>
            <button type="button" onClick={() => move(index - 1)} disabled={index === 0}>Back</button>
            {finished ? <button type="button" className="primary" onClick={() => start(tour)}>Replay tutorial</button> : <button type="button" className="primary" onClick={() => setPlaying(value => !value)}>{playing ? "Pause tutorial" : "Play tutorial"}</button>}
            <button type="button" disabled={finished} onClick={() => {
              if (index === tour.steps.length - 1) { setFinished(true); setPlaying(false); }
              else move(index + 1);
            }}>{index === tour.steps.length - 1 ? "Finish" : "Next"}</button>
          </div>
          <div className={styles.playback}><label>Speed <select aria-label="Tutorial playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><span>{finished ? "Finished" : playing ? `Next in ${Math.max(0, Math.ceil((duration - elapsed) / (1000 * speed)))}s` : "Paused"}</span></div>
        </footer>
      </>}
    </dialog>
  </>;
}
