// Copies a link to exactly what's on screen (the address holds every choice).
import { useState } from "react";
import { Check, Link2 } from "lucide-react";

export default function ShareButton() {
  const [copied, setCopied] = useState(false);
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", window.location.href); // clipboard blocked: let them copy by hand
    }
  }
  return (
    <button type="button" className="button" onClick={share}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
