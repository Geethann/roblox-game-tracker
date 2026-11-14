// A small (i) button that explains something on hover, tap or keyboard focus.
//
// The explanation is placed relative to the screen (position: fixed), not to the
// page around it, so a scrolling table or a card can never cut it off. Before
// it's drawn, it measures itself and picks a spot that fits: above the button,
// or below it if the top bar is in the way, and never off the screen's edges.
// It follows its button if the page (or a table) scrolls while it's open.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

const EDGE_GAP = 8; // keep this far from the screen edges
const GAP = 6;      // space between the button and the explanation

export default function InfoTip({ text, label = "More info" }) {
  const id = useId(); // a unique id, so the button can point screen readers at its text
  const buttonRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);

  // Work out where it fits on screen, and put it there.
  function place() {
    if (!buttonRef.current || !tipRef.current) return;
    const button = buttonRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
    const left = Math.min(
      Math.max(button.left + button.width / 2 - tip.width / 2, EDGE_GAP),
      window.innerWidth - EDGE_GAP - tip.width,
    );
    const above = button.top - GAP - tip.height;
    const top = above >= headerBottom + EDGE_GAP ? above : button.bottom + GAP;
    tipRef.current.style.left = `${left}px`;
    tipRef.current.style.top = `${top}px`;
  }

  // Place it after it's laid out but before the screen updates, so it never flickers...
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  // ...and keep it next to its button if the page or a table scrolls, or the window resizes.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <span className={`info-tip${open ? " is-open" : ""}`}
          onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}>
      <button ref={buttonRef} type="button" className="info-tip-button" aria-label={label}
              aria-describedby={id} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <Info size={14} aria-hidden="true" />
      </button>
      <span ref={tipRef} role="tooltip" id={id} className="info-tip-text">
        {text}
      </span>
    </span>
  );
}
