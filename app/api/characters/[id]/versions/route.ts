import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, personality, greeting, scenario, imageUrl, note } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const character = await prisma.character.findUnique({
    where: { id },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });

  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const nextVersionNumber = (character.versions[0]?.versionNumber ?? 0) + 1;
  const resolvedImageUrl = imageUrl !== undefined ? imageUrl || null : character.imageUrl;

  const [, version] = await prisma.$transaction([
    prisma.character.update({
      where: { id },
      data: {
        name: name.trim(),
        imageUrl: resolvedImageUrl,
      },
    }),
    prisma.characterVersion.create({
      data: {
        characterId: id,
        versionNumber: nextVersionNumber,
        name: name.trim(),
        personality: personality ?? "",
        greeting: greeting ?? "",
        scenario: scenario ?? "",
        imageUrl: resolvedImageUrl,
        note: note || null,
      },
    }),
  ]);

  return NextResponse.json(version, { status: 201 });
}
