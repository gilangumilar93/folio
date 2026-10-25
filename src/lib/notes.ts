import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export const STORAGE_KEY = "folio.notes.v1";

export type Note = {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

type NotesState = {
  notes: Note[];
  activeId: string | null;
  ready: boolean;
  createNote: (body?: string) => string;
  updateBody: (id: string, body: string) => void;
  deleteNote: (id: string) => string | null;
  setActive: (id: string) => void;
  seedStarter: () => void;
};

const WELCOME = `# Welcome to Folio

The first line is the title. Everything under it is the note.

Write in markdown, then switch to preview when you want it set in type.

- **Bold** for what matters
- *Italic* for the aside
- \`code\` when the exact word counts
- Lists, quotes, and headings

> Keep the list for finding. Keep this pane for thinking.

Notes stay in this browser. Nothing is uploaded.

On a keyboard: Ctrl or ⌘ N makes a note, K searches, \\ toggles preview, Alt with the arrow keys moves between notes, and Backspace deletes (press twice).
`;

const MARGIN = `# Margin notes

Things worth keeping in the margin, not a thread.

## Open loops

- [ ] Send the revised schedule
- [x] Sketch the writing layout
- [ ] Decide what stays on the desk

## A line

> The first line is the title. The rest can wander.

A fenced block, when you need the exact shape:

\`\`\`
desk → list → page
\`\`\`
`;

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Note;
  return (
    typeof note.id === "string" &&
    typeof note.body === "string" &&
    typeof note.createdAt === "number" &&
    typeof note.updatedAt === "number"
  );
}

function browserStorage(): StateStorage {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { name: string; value: string } | null = null;

  const flush = () => {
    if (!pending) return;
    try {
      localStorage.setItem(pending.name, pending.value);
    } catch {
      /* private mode or a full disk — the desk still works in memory */
    }
    pending = null;
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (name) => {
      if (pending?.name === name) return pending.value;
      return localStorage.getItem(name);
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 160);
    },
    removeItem: (name) => {
      pending = null;
      if (timer) clearTimeout(timer);
      localStorage.removeItem(name);
    },
  };
}

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useNotes = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: [],
      activeId: null,
      ready: false,
      createNote: (body = "") => {
        const now = Date.now();
        const note: Note = {
          id: crypto.randomUUID(),
          body,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ notes: [note, ...state.notes], activeId: note.id }));
        return note.id;
      },
      updateBody: (id, body) => {
        const now = Date.now();
        set((state) => ({
          notes: state.notes.map((note) => {
            if (note.id !== id || note.body === body) return note;
            return { ...note, body, updatedAt: now };
          }),
        }));
      },
      deleteNote: (id) => {
        const state = get();
        const remaining = state.notes.filter((note) => note.id !== id);
        const sorted = [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt);
        const index = sorted.findIndex((note) => note.id === id);
        const neighbor = sorted[index + 1] ?? sorted[index - 1];
        let nextId = state.activeId;
        if (state.activeId === id) {
          nextId = neighbor && neighbor.id !== id ? neighbor.id : (remaining[0]?.id ?? null);
        }
        if (nextId && !remaining.some((note) => note.id === nextId)) {
          nextId = remaining[0]?.id ?? null;
        }
        set({ notes: remaining, activeId: nextId });
        return nextId;
      },
      setActive: (id) => set({ activeId: id }),
      seedStarter: () => {
        const now = Date.now();
        const welcome: Note = {
          id: crypto.randomUUID(),
          body: WELCOME,
          createdAt: now - 1000 * 60 * 40,
          updatedAt: now - 1000 * 60 * 2,
        };
        const margin: Note = {
          id: crypto.randomUUID(),
          body: MARGIN,
          createdAt: now - 1000 * 60 * 60 * 26,
          updatedAt: now - 1000 * 60 * 60 * 5,
        };
        set({ notes: [welcome, margin], activeId: welcome.id });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : browserStorage(),
      ),
      skipHydration: true,
      partialize: (state) => ({ notes: state.notes, activeId: state.activeId }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<NotesState, "notes" | "activeId">>;
        const notes = Array.isArray(saved.notes) ? saved.notes.filter(isNote) : [];
        const activeId = typeof saved.activeId === "string" ? saved.activeId : null;
        return { ...current, notes, activeId };
      },
    },
  ),
);

export function useHydrateNotes() {
  const ready = useNotes((state) => state.ready);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await useNotes.persist.rehydrate();
      } catch {
        /* unreadable storage falls through to an empty desk */
      }
      if (cancelled) return;

      const state = useNotes.getState();
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        stored = "blocked";
      }

      if (stored == null && state.notes.length === 0) {
        state.seedStarter();
      } else if (state.notes.length > 0) {
        const ids = new Set(state.notes.map((note) => note.id));
        if (!state.activeId || !ids.has(state.activeId)) {
          const newest = [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          useNotes.setState({ activeId: newest?.id ?? null });
        }
      }

      if (!cancelled) useNotes.setState({ ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

export function stripMarks(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/`+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

export function noteTitle(body: string): string {
  const line = body.split("\n").find((entry) => entry.trim().length > 0) ?? "";
  return stripMarks(line) || "Untitled";
}

export function noteExcerpt(body: string, query: string): string {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const needle = query.trim().toLowerCase();
  if (needle) {
    const hit = lines.find((line) => line.toLowerCase().includes(needle));
    if (hit) return stripMarks(hit) || "Empty note";
  }
  const rest = lines.slice(1).map(stripMarks).find(Boolean);
  return rest || "Empty note";
}

export function noteMatches(body: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return body.toLowerCase().includes(needle);
}

export function wordCount(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`#>*_~\-[\]()!]/g, " ");
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function editedLabel(updatedAt: number, now: number): string {
  const minutes = Math.round(Math.max(0, now - updatedAt) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(updatedAt);
}

export function editedExact(updatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(updatedAt);
}

export function sortedNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
