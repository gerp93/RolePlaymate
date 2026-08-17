"use client";

import { useState } from "react";
import ImageUploader from "./ImageUploader";
import type { CharacterFormValues } from "@/lib/types";

export default function CharacterForm({
  initialValues,
  submitLabel,
  showNoteField = false,
  onSubmit,
  onCancel,
}: {
  initialValues: CharacterFormValues;
  submitLabel: string;
  showNoteField?: boolean;
  onSubmit: (values: CharacterFormValues & { note?: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [personality, setPersonality] = useState(initialValues.personality);
  const [greeting, setGreeting] = useState(initialValues.greeting);
  const [scenario, setScenario] = useState(initialValues.scenario);
  const [imageUrl, setImageUrl] = useState<string | null>(initialValues.imageUrl);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name, personality, greeting, scenario, imageUrl, note });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Portrait
        </label>
        <ImageUploader value={imageUrl} onChange={setImageUrl} />
      </div>

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Captain Nova"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div>
        <label htmlFor="personality" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Personality
        </label>
        <textarea
          id="personality"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Describe traits, speech patterns, quirks, values..."
          rows={5}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div>
        <label htmlFor="scenario" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Scenario
        </label>
        <textarea
          id="scenario"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          placeholder="The setting or context the conversation takes place in..."
          rows={4}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div>
        <label htmlFor="greeting" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Opening Greeting
        </label>
        <textarea
          id="greeting"
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder="The first message the character sends to start the chat..."
          rows={4}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {showNoteField && (
        <div>
          <label htmlFor="note" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            What changed? <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Made her more sarcastic, rewrote greeting"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
