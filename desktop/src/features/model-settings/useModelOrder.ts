import {
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";

export function useModelOrder(
  models: ModelConfiguration[],
  setModels: Dispatch<SetStateAction<ModelConfiguration[]>>,
) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const elements = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());

  function reset() {
    setDragged(null);
    setTarget(null);
    setOffsets({});
    rects.current.clear();
  }

  function preview(id: string) {
    if (!dragged || dragged === id) return;
    const from = models.findIndex((item) => item.id === dragged);
    const to = models.findIndex((item) => item.id === id);
    const element = elements.current.get(dragged);
    const sourceRect = rects.current.get(dragged);
    const targetRect = rects.current.get(id);
    if (from < 0 || to < 0 || !element || !sourceRect || !targetRect) return;
    const gap =
      Number.parseFloat(getComputedStyle(element.parentElement!).rowGap) || 0;
    const shift = sourceRect.height + gap;
    const next: Record<string, number> = {
      [dragged]:
        from < to
          ? targetRect.bottom - sourceRect.bottom
          : targetRect.top - sourceRect.top,
    };
    models.forEach((item, index) => {
      if (from < to && index > from && index <= to) next[item.id] = -shift;
      if (from > to && index >= to && index < from) next[item.id] = shift;
    });
    setTarget(id);
    setOffsets(next);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    if (dragged && target && dragged !== target) {
      setModels((items) => {
        const next = [...items];
        const from = next.findIndex((item) => item.id === dragged);
        const to = next.findIndex((item) => item.id === target);
        if (from < 0 || to < 0) return items;
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
    }
    reset();
  }

  return {
    cardProps: (id: string) => ({
      ref: (element: HTMLElement | null) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      },
      style: {
        transform: offsets[id] ? `translateY(${offsets[id]}px)` : undefined,
      },
      "data-dragging": dragged === id || undefined,
      onDragEnter: () => preview(id),
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: drop,
    }),
    handleProps: (id: string) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        rects.current = new Map(
          [...elements.current].map(([key, element]) => [
            key,
            element.getBoundingClientRect(),
          ]),
        );
        setDragged(id);
        setTarget(id);
        setOffsets({});
      },
      onDragEnd: reset,
    }),
  };
}
