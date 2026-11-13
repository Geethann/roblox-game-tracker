// A small (i) button that explains something on hover, tap or keyboard focus.
import { useId, useRef, useState } from "react";
import { Info } from "lucide-react";

const MAX_WIDTH = 240;
const EDGE_GAP = 8;

export default function InfoTip({ text, label = "More info" }) {
  const id = useId(); // a unique id, so the button can point screen readers at its text
  const buttonRef = useRef(null);
  const [shift, setShift] = useState(0);

  // Just before showing, check the tooltip will fit on screen. If it would
  // hang off the left or right edge (e.g. on a phone), slide it sideways.
  function placeTooltip() {
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(MAX_WIDTH, window.innerWidth - EDGE_GAP * 2);
    const centredLeft = rect.left + rect.width / 2 - width / 2;
    const fittedLeft = Math.min(Math.max(centredLeft, EDGE_GAP), window.innerWidth - EDGE_GAP - width);
    setShift(fittedLeft - centredLeft);
  }

  return (
    <span className="info-tip" onPointerEnter={placeTooltip}>
      <button ref={buttonRef} type="button" className="info-tip-button" aria-label={label}
              aria-describedby={id} onFocus={placeTooltip}>
        <Info size={14} aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="info-tip-text" style={{ "--shift": `${shift}px` }}>
        {text}
      </span>
    </span>
  );
}
