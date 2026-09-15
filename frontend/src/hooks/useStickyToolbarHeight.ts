import { useEffect, useRef } from 'react';

/**
 * Measures a sticky toolbar's real rendered height and writes it as
 * `--report-toolbar-h` on the wrapping container, so a sticky table
 * header (`.report-table thead th`, see App.css) sticks flush beneath
 * the toolbar instead of overlapping it or leaving a gap — robust to
 * the toolbar wrapping onto two lines on a narrow viewport.
 */
export function useStickyToolbarHeight<T extends HTMLElement>() {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<T>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const container = containerRef.current;
    if (!toolbar || !container) return;

    const apply = () => container.style.setProperty('--report-toolbar-h', `${toolbar.offsetHeight}px`);
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  return { containerRef, toolbarRef };
}
