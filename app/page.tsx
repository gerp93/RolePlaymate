import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CharacterCard from "@/components/CharacterCard";
import type { CharacterSummaryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const characters = await prisma.character.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { versions: true } },
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });

  const summaries: CharacterSummaryDTO[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    imageUrl: c.imageUrl,
    updatedAt: c.updatedAt.toISOString(),
    versionCount: c._count.versions,
    personality: c.versions[0]?.personality ?? "",
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Character Library</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Build and version your AI chatbot characters.
          </p>
        </div>
        <Link
          href="/characters/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + New Character
        </Link>
      </div>

      {summaries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-24 text-center dark:border-zinc-700">
          <p className="text-zinc-500 dark:text-zinc-400">No characters yet.</p>
          <Link
            href="/characters/new"
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Create your first character
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summaries.map((c) => (
            <CharacterCard key={c.id} character={c} />
          ))}
        </div>
      )}
    </div>
  );
}
