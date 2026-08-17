"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CharacterSummaryDTO } from "@/lib/types";

export default function CharacterCard({ character }: { character: CharacterSummaryDTO }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${character.name}"? This removes all of its version history.`)) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
      alert("Failed to delete character.");
    }
  }

  return (
    <Link
      href={`/characters/${character.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <div className="flex h-40 items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {character.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.imageUrl}
            alt={character.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-4xl text-zinc-400">?</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{character.name}</h3>
        <p className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
          {character.personality || <span className="italic">No personality set</span>}
        </p>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
          <span>
            v{character.versionCount} · {new Date(character.updatedAt).toLocaleDateString()}
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded px-2 py-1 text-red-500 opacity-0 transition hover:bg-red-50 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-950"
          >
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
    </Link>
  );
}
