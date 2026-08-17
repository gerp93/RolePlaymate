import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id, versionId } = await params;

  const character = await prisma.character.findUnique({
    where: { id },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });

  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sourceVersion = await prisma.characterVersion.findUnique({
    where: { id: versionId },
  });

  if (!sourceVersion || sourceVersion.characterId !== id) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const nextVersionNumber = (character.versions[0]?.versionNumber ?? 0) + 1;

  const [, version] = await prisma.$transaction([
    prisma.character.update({
      where: { id },
      data: {
        name: sourceVersion.name,
        imageUrl: sourceVersion.imageUrl,
      },
    }),
    prisma.characterVersion.create({
      data: {
        characterId: id,
        versionNumber: nextVersionNumber,
        name: sourceVersion.name,
        personality: sourceVersion.personality,
        greeting: sourceVersion.greeting,
        scenario: sourceVersion.scenario,
        imageUrl: sourceVersion.imageUrl,
        note: `Restored from version ${sourceVersion.versionNumber}`,
      },
    }),
  ]);

  return NextResponse.json(version, { status: 201 });
}
