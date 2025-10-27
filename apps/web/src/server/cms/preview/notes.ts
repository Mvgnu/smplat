import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordNoteRevision } from "@/server/cms/history";

// meta: module: marketing-preview-notes
// meta: feature: marketing-preview-cockpit

const DEFAULT_NOTES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/marketing-preview-notes.json"
);

const DEFAULT_NOTE_SEVERITY = "info" as const;

type MarketingPreviewTriageNoteSeverity = "info" | "warning" | "blocker";

type MarketingPreviewTriageNote = {
  id: string;
  route: string;
  generatedAt: string;
  author?: string;
  body: string;
  severity: MarketingPreviewTriageNoteSeverity;
  createdAt: string;
};

type MarketingPreviewTriageNoteInput = {
  route: string;
  generatedAt: string;
  body: string;
  author?: string;
  severity?: MarketingPreviewTriageNoteSeverity;
};

type NoteFilter = {
  generatedAt?: string;
  route?: string;
};

type NotesFile = {
  notes: MarketingPreviewTriageNote[];
};

const readNotesFile = async (): Promise<NotesFile> => {
  try {
    const payload = await fs.readFile(DEFAULT_NOTES_PATH, "utf8");
    const data = JSON.parse(payload) as NotesFile;
    if (!Array.isArray(data.notes)) {
      return { notes: [] };
    }
    return data;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { notes: [] };
    }
    throw error;
  }
};

const writeNotesFile = async (notes: MarketingPreviewTriageNote[]) => {
  await fs.mkdir(path.dirname(DEFAULT_NOTES_PATH), { recursive: true });
  const payload: NotesFile = {
    notes: notes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  };
  await fs.writeFile(DEFAULT_NOTES_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const getMarketingPreviewNotes = async (
  filter: NoteFilter = {}
): Promise<MarketingPreviewTriageNote[]> => {
  const data = await readNotesFile();
  return data.notes.filter((note) => {
    if (filter.generatedAt && note.generatedAt !== filter.generatedAt) {
      return false;
    }
    if (filter.route && note.route !== filter.route) {
      return false;
    }
    return true;
  });
};

export const createMarketingPreviewNote = async (
  input: MarketingPreviewTriageNoteInput
): Promise<MarketingPreviewTriageNote> => {
  const data = await readNotesFile();
  const now = new Date().toISOString();
  const note: MarketingPreviewTriageNote = {
    id: crypto.randomUUID(),
    route: input.route,
    generatedAt: input.generatedAt,
    author: input.author,
    body: input.body,
    severity: input.severity ?? DEFAULT_NOTE_SEVERITY,
    createdAt: now
  };

  const nextNotes = [note, ...data.notes];
  await writeNotesFile(nextNotes);

  try {
    recordNoteRevision({
      noteId: note.id,
      manifestGeneratedAt: note.generatedAt,
      route: note.route,
      severity: note.severity,
      body: note.body,
      author: note.author,
      recordedAt: note.createdAt
    });
  } catch (error) {
    console.error("Failed to persist note revision", error);
  }

  return note;
};

export type {
  MarketingPreviewTriageNote,
  MarketingPreviewTriageNoteInput,
  MarketingPreviewTriageNoteSeverity
};
