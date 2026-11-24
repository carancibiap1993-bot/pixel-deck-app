import { useEffect, useRef, useState } from 'react';

// Lista que solo dibuja las filas visibles (miles de canciones sin trabarse)
export default function VirtualList({ items, rowHeight, renderRow, onVisible, scrollKey, empty, onScrollPos, listRef }) {
  const ref = useRef(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (ref.current) { ref.current.scrollTop = 0; setScroll(0); onScrollPos && onScrollPos(0); } }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (listRef) listRef.current = ref.current;

  const start = Math.max(0, Math.floor(scroll / rowHeight) - 6);
  const end = Math.min(items.length, Math.ceil((scroll + height) / rowHeight) + 6);

  useEffect(() => {
    if (!onVisible) return;
    const id = setTimeout(() => onVisible(items.slice(start, end)), 250);
    return () => clearTimeout(id);
  }, [start, end, items, onVisible]);

  return (
    <div className="vlist" ref={ref} onScroll={(e) => { const y = e.currentTarget.scrollTop; setScroll(y); onScrollPos && onScrollPos(y); }}>
      {items.length === 0 ? empty : (
        <div style={{ height: items.length * rowHeight, position: 'relative' }}>
          {items.slice(start, end).map((it, k) => (
            <div key={it.key} className="vrow" style={{ top: (start + k) * rowHeight, height: rowHeight }}>
              {renderRow(it, start + k)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
