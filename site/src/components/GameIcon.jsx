// A game's square icon, with a neutral placeholder if there's no image
// or it fails to load.
import { useState } from "react";
import { Gamepad2 } from "lucide-react";

export default function GameIcon({ src, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (!src || failed) {
    return (
      <span className="game-icon game-icon-placeholder" style={style} aria-hidden="true">
        <Gamepad2 size={size * 0.5} />
      </span>
    );
  }
  // alt="" because the game's name is always shown next to its icon;
  // screen readers would otherwise read the name twice.
  return (
    <img className="game-icon" src={src} alt="" style={style} width={size} height={size}
         loading="lazy" onError={() => setFailed(true)} />
  );
}
