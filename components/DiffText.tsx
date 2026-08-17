"use client";

import { diffWords } from "diff";

export default function DiffText({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  if (oldText === newText) {
    return <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{newText || <span className="italic text-zinc-400">(empty)</span>}</p>;
  }

  const parts = diffWords(oldText || "", newText || "");

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span key={i} className="rounded bg-green-100 px-0.5 text-green-800 dark:bg-green-900/50 dark:text-green-300">
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span key={i} className="rounded bg-red-100 px-0.5 text-red-700 line-through dark:bg-red-900/50 dark:text-red-300">
              {part.value}
            </span>
          );
        }
        return (
          <span key={i} className="text-zinc-700 dark:text-zinc-300">
            {part.value}
          </span>
        );
      })}
    </p>
  );
}
