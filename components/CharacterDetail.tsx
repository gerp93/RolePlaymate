"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CharacterForm from "./CharacterForm";
import DiffText from "./DiffText";
import type { CharacterDTO, CharacterFormValues, CharacterVersionDTO } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CharacterDetail({ character }: { character: CharacterDTO }) {
  const router = useRouter();
  const versions = character.versions; // sorted newest -> oldest
  const latest = versions[0];

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [selectedVersionId, setSelectedVersionId] = useState(latest.id);
  const [restoring, setRestoring] = useState(false);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? latest,
    [versions, selectedVersionId, latest]
  );

  const previousVersion = useMemo(() => {
    const idx = versions.findIndex((v) => v.id === selectedVersion.id);
    return idx >= 0 && idx < versions.length - 1 ? versions[idx + 1] : null;
  }, [versions, selectedVersion]);

  const isLatestSelected = selectedVersion.id === latest.id;

  async function handleSaveNewVersion(values: CharacterFormValues & { note?: string }) {
    const res = await fetch(`/api/characters/${character.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to save version");
    }
    setMode("view");
    setSelectedVersionId(data.id);
    router.refresh();
  }

  async function handleRestore(version: CharacterVersionDTO) {
    if (!confirm(`Restore version ${version.versionNumber}? This creates a new version with its content.`)) {
      return;
    }
    setRestoring(true);
    try {
      const res = await fetch(
        `/api/characters/${character.id}/versions/${version.id}/restore`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to restore version");
      }
      setSelectedVersionId(data.id);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restore version");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
      {/* Version history sidebar */}
      <aside className="order-2 lg:order-1">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Version History
        </h2>
        <ol className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => {
                  setSelectedVersionId(v.id);
                  setMode("view");
                }}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                  selectedVersion.id === v.id
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    v{v.versionNumber}
                    {v.id === latest.id && (
                      <span className="ml-1 text-xs font-normal opacity-70">(current)</span>
                    )}
                  </span>
                </div>
                <div className="text-xs opacity-70">{formatDate(v.createdAt)}</div>
                {v.note && <div className="mt-0.5 truncate text-xs italic opacity-80">{v.note}</div>}
              </button>
            </li>
          ))}
        </ol>
      </aside>

      {/* Main content */}
      <main className="order-1 lg:order-2">
        {mode === "edit" ? (
          <div>
            <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Edit {character.name}
            </h1>
            <CharacterForm
              initialValues={{
                name: latest.name,
                personality: latest.personality,
                greeting: latest.greeting,
                scenario: latest.scenario,
                imageUrl: latest.imageUrl,
              }}
              submitLabel="Save New Version"
              showNoteField
              onSubmit={handleSaveNewVersion}
              onCancel={() => setMode("view")}
            />
          </div>
        ) : (
          <div>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                  {selectedVersion.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedVersion.imageUrl}
                      alt={selectedVersion.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl text-zinc-400">?</span>
                  )}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                    {selectedVersion.name}
                  </h1>
                  <p className="text-sm text-zinc-500">
                    Version {selectedVersion.versionNumber} of {versions.length} ·{" "}
                    {formatDate(selectedVersion.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {isLatestSelected ? (
                  <button
                    onClick={() => setMode("edit")}
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Edit
                  </button>
                ) : (
                  <button
                    onClick={() => handleRestore(selectedVersion)}
                    disabled={restoring}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {restoring ? "Restoring..." : "Restore this version"}
                  </button>
                )}
              </div>
            </div>

            {selectedVersion.note && (
              <p className="mb-6 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                {selectedVersion.note}
              </p>
            )}

            {!isLatestSelected && (
              <p className="mb-4 text-xs uppercase tracking-wide text-zinc-400">
                {previousVersion
                  ? `Comparing to version ${previousVersion.versionNumber}`
                  : "Earliest version — nothing to compare"}
              </p>
            )}

            <div className="flex flex-col gap-6">
              <Field label="Personality">
                <DiffText
                  oldText={previousVersion?.personality ?? selectedVersion.personality}
                  newText={selectedVersion.personality}
                />
              </Field>
              <Field label="Scenario">
                <DiffText
                  oldText={previousVersion?.scenario ?? selectedVersion.scenario}
                  newText={selectedVersion.scenario}
                />
              </Field>
              <Field label="Opening Greeting">
                <DiffText
                  oldText={previousVersion?.greeting ?? selectedVersion.greeting}
                  newText={selectedVersion.greeting}
                />
              </Field>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">{label}</h3>
      <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {children}
      </div>
    </div>
  );
}
