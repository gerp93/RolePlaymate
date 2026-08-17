import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CharacterDetail from "@/components/CharacterDetail";
import type { CharacterDTO } from "@/lib/types";

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const character = await prisma.character.findUnique({
    where: { id },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });

  if (!character) {
    notFound();
  }

  const dto: CharacterDTO = {
    id: character.id,
    name: character.name,
    imageUrl: character.imageUrl,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
    versions: character.versions.map((v) => ({
      id: v.id,
      characterId: v.characterId,
      versionNumber: v.versionNumber,
      name: v.name,
      personality: v.personality,
      greeting: v.greeting,
      scenario: v.scenario,
      imageUrl: v.imageUrl,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
    })),
  };

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        ← Back to library
      </Link>
      <CharacterDetail character={dto} />
    </div>
  );
}
