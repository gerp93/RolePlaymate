import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const character = await prisma.character.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });

  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(character);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const character = await prisma.character.findUnique({ where: { id } });
  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.character.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
