"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./Icons";

function truncate(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function HashChip({ value, href, label }: { value: string; href: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="hash-chip">
      {label && <span className="hash-chip-label">{label}</span>}
      <a href={href} target="_blank" rel="noopener noreferrer" className="hash-chip-link" title={value}>
        {truncate(value)}
      </a>
      <button
        type="button"
        className="hash-chip-copy"
        aria-label="Copy to clipboard"
        onClick={async (e) => {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            // clipboard unavailable — link + tooltip already show the full value
          }
        }}
      >
        {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
      </button>
    </span>
  );
}
