"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import CharacterForm from "@/components/CharacterForm";
import type { CharacterFormValues } from "@/lib/types";

export default function NewCharacterPage() {
  const router = useRouter();

  async function handleSubmit(values: CharacterFormValues) {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to create character");
    }
    router.push(`/characters/${data.id}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        ← Back to library
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">New Character</h1>
      <CharacterForm
        initialValues={{ name: "", personality: "", greeting: "", scenario: "", imageUrl: null }}
        submitLabel="Create Character"
        onSubmit={handleSubmit}
        onCancel={() => router.push("/")}
      />
    </div>
  );
}
