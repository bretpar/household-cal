import { useRef, useState, type DragEvent } from "react";

const proposalType = "application/x-ofc-schedule-proposal";

/** Browser transport only: the editor supplies the shared private-draft move command. */
export function useScheduleDrag(onMove: (id: string, date: string) => void) {
  const dragging = useRef<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);
  const end = () => { dragging.current = null; setDropDate(null); };
  return {
    dropDate,
    start: (event: DragEvent, id: string) => {
      dragging.current = id;
      event.dataTransfer.setData(proposalType, id);
      event.dataTransfer.effectAllowed = "move";
    },
    over: (event: DragEvent, date: string) => {
      if (!dragging.current || !event.dataTransfer.types.includes(proposalType)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropDate(date);
    },
    drop: (event: DragEvent, date: string) => {
      const id = dragging.current;
      if (!id || event.dataTransfer.getData(proposalType) !== id) return;
      event.preventDefault(); end(); onMove(id, date);
    },
    end,
  };
}