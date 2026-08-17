import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const characters = await prisma.character.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { versions: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
    },
  });

  const result = characters.map((c) => ({
    id: c.id,
    name: c.name,
    imageUrl: c.imageUrl,
    updatedAt: c.updatedAt,
    versionCount: c._count.versions,
    personality: c.versions[0]?.personality ?? "",
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, personality, greeting, scenario, imageUrl, note } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const character = await prisma.character.create({
    data: {
      name: name.trim(),
      imageUrl: imageUrl || null,
      versions: {
        create: {
          versionNumber: 1,
          name: name.trim(),
          personality: personality ?? "",
          greeting: greeting ?? "",
          scenario: scenario ?? "",
          imageUrl: imageUrl || null,
          note: note || "Initial version",
        },
      },
    },
    include: { versions: true },
  });

  return NextResponse.json(character, { status: 201 });
}
