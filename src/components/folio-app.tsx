import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronLeft,
  Eye,
  PenLine,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { MarkdownView } from "@/lib/markdown";
import {
  editedExact,
  editedLabel,
  noteExcerpt,
  noteMatches,
  noteTitle,
  sortedNotes,
  useHydrateNotes,
  useNotes,
  wordCount,
  type Note,
} from "@/lib/notes";

function useNow(paused: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [paused]);
  return now;
}

function useModLabel() {
  const [label, setLabel] = useState("Ctrl");
  useEffect(() => {
    const platform = navigator.platform || "";
    const agent = navigator.userAgent || "";
    const mac = /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS/.test(agent);
    setLabel(mac ? "⌘" : "Ctrl");
  }, []);
  return label;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(target, cursor);
    if (at < 0) {
      parts.push(text.slice(cursor));
      break;
    }
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(
      <mark key={key} className="bg-transparent font-medium text-lamp">
        {text.slice(at, at + target.length)}
      </mark>,
    );
    key += 1;
    cursor = at + target.length;
  }
  return <>{parts}</>;
}

function EditorSurface({
  value,
  onChange,
  inputRef,
  measureKey,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  measureKey: string;
}) {
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element || element.getClientRects().length === 0) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value, inputRef, measureKey]);

  return (
    <textarea
      ref={inputRef}
      id="note-editor"
      aria-label="Note markdown"
      value={value}
      placeholder="Title on the first line"
      spellCheck
      autoCapitalize="sentences"
      autoCorrect="on"
      rows={1}
      onChange={(event) => onChange(event.target.value)}
      className="folio-editor block w-full resize-none overflow-hidden bg-transparent font-serif text-lg leading-relaxed text-ink placeholder:text-faint"
    />
  );
}

export function FolioApp() {
  const ready = useHydrateNotes();
  const notes = useNotes((state) => state.notes);
  const activeId = useNotes((state) => state.activeId);
  const createNote = useNotes((state) => state.createNote);
  const updateBody = useNotes((state) => state.updateBody);
  const deleteNote = useNotes((state) => state.deleteNote);
  const setActive = useNotes((state) => state.setActive);

  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [pane, setPane] = useState<"list" | "editor">("list");
  const [armed, setArmed] = useState(false);
  const now = useNow(!ready);
  const mod = useModLabel();

  const searchRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const noteRefs = useRef(new Map<string, HTMLButtonElement>());

  const ordered = sortedNotes(notes);
  const filtered = ordered.filter((note) => noteMatches(note.body, query));
  const active = ordered.find((note) => note.id === activeId) ?? null;

  const filteredRef = useRef(filtered);
  const activeIdRef = useRef(activeId);
  const previewRefState = useRef(preview);
  filteredRef.current = filtered;
  activeIdRef.current = activeId;
  previewRefState.current = preview;

  useEffect(() => {
    setArmed(false);
  }, [activeId]);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3200);
    return () => window.clearTimeout(timer);
  }, [armed]);

  function moveSelection(delta: number, focusButton: boolean) {
    const list = filteredRef.current;
    if (list.length === 0) return;
    const index = list.findIndex((note) => note.id === activeIdRef.current);
    const nextIndex =
      index === -1 ? (delta > 0 ? 0 : list.length - 1) : (index + delta + list.length) % list.length;
    const next = list[nextIndex];
    if (!next) return;
    setActive(next.id);
    requestAnimationFrame(() => {
      const button = noteRefs.current.get(next.id);
      button?.scrollIntoView({ block: "nearest" });
      if (focusButton) button?.focus();
    });
  }

  function focusWriting(nextPreview: boolean) {
    requestAnimationFrame(() => {
      if (nextPreview) previewRef.current?.focus();
      else editorRef.current?.focus();
    });
  }

  function makeNote() {
    createNote("");
    setQuery("");
    setPreview(false);
    setPane("editor");
    setArmed(false);
    focusWriting(false);
  }

  function openWriting() {
    if (!activeIdRef.current) return;
    setPane("editor");
    focusWriting(previewRefState.current);
  }

  function togglePreview() {
    setPane("editor");
    setPreview((value) => {
      focusWriting(!value);
      return !value;
    });
  }

  function requestDelete() {
    const id = activeIdRef.current;
    if (!id) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    const next = deleteNote(id);
    setArmed(false);
    if (!next) setPane("list");
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing) return;
      const modKey = event.metaKey || event.ctrlKey;
      const target = event.target;
      const inSearch = target instanceof HTMLElement && target.dataset.role === "search";
      const onNote = target instanceof HTMLElement && target.dataset.role === "note";
      const key = event.key;

      if (modKey && !event.altKey && !event.shiftKey && !event.repeat && key.toLowerCase() === "n") {
        event.preventDefault();
        makeNote();
        return;
      }

      if (modKey && !event.altKey && !event.shiftKey && key.toLowerCase() === "k") {
        event.preventDefault();
        setPane("list");
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (
        modKey &&
        !event.altKey &&
        !event.shiftKey &&
        (key === "\\" || event.code === "Backslash")
      ) {
        event.preventDefault();
        togglePreview();
        return;
      }

      if (modKey && event.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
        event.preventDefault();
        moveSelection(key === "ArrowDown" ? 1 : -1, false);
        return;
      }

      if (modKey && !event.altKey && !event.shiftKey && !event.repeat && key === "Backspace") {
        event.preventDefault();
        requestDelete();
        return;
      }

      if ((inSearch || onNote) && (key === "ArrowDown" || key === "ArrowUp")) {
        event.preventDefault();
        moveSelection(key === "ArrowDown" ? 1 : -1, onNote);
        return;
      }

      if (onNote && (key === "j" || key === "k")) {
        event.preventDefault();
        moveSelection(key === "j" ? 1 : -1, true);
        return;
      }

      if (inSearch && key === "Enter") {
        event.preventDefault();
        openWriting();
        return;
      }

      if (key === "Escape") {
        if (armed) {
          event.preventDefault();
          setArmed(false);
          return;
        }
        if (inSearch && searchRef.current && searchRef.current.value) {
          event.preventDefault();
          setQuery("");
          return;
        }
        if (inSearch) {
          event.preventDefault();
          searchRef.current?.blur();
          return;
        }
        if (window.matchMedia("(max-width: 767px)").matches && pane === "editor") {
          event.preventDefault();
          setPane("list");
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = active ? noteTitle(active.body) : "Folio";
  const words = active ? wordCount(active.body) : 0;
  const wordLabel = words === 1 ? "1 word" : `${words} words`;
  const countLabel = !ready
    ? "Opening"
    : query.trim()
      ? `${filtered.length} shown`
      : notes.length === 1
        ? "1 note"
        : `${notes.length} notes`;
  const alt = mod === "⌘" ? "⌥" : "Alt";
  const hints = `${mod} N new · ${mod} K search · ${mod} \\ preview · ${mod} ${alt} ↑↓ notes · ${mod} ⌫ delete`;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-desk text-ink" aria-busy={!ready}>
      <p className="sr-only" aria-live="polite">
        {ready
          ? query.trim()
            ? `${filtered.length} matching notes`
            : `${notes.length} notes`
          : "Opening notes"}
      </p>

      <aside
        aria-label="Notes"
        className={clsx(
          "h-full w-full flex-col bg-panel md:w-80 md:shrink-0 md:border-r md:border-line",
          pane === "list" ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex shrink-0 flex-col gap-3 px-4 pt-5 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-serif text-3xl leading-tight tracking-tight text-ink italic">Folio</h1>
            <p className="text-xs text-faint tabular-nums">{countLabel}</p>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <input
              ref={searchRef}
              data-role="search"
              type="search"
              value={query}
              disabled={!ready}
              aria-label="Search notes"
              placeholder="Search notes"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-raised pr-11 pl-10 text-base text-ink placeholder:text-faint focus:border-lamp disabled:opacity-60"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="absolute top-0 right-0 inline-flex size-11 items-center justify-center text-faint transition-colors duration-150 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={makeNote}
            disabled={!ready}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-lamp text-sm font-medium text-lamp-ink transition-transform duration-150 ease-out hover:bg-lamp/90 active:scale-[0.96] disabled:opacity-60"
          >
            <Plus className="size-4" />
            New note
          </button>
        </div>

        <div className="folio-scroll min-h-0 flex-1 overflow-y-auto px-2">
          {ready && filtered.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="font-serif text-xl text-balance text-ink">
                {query.trim() ? "No notes match" : "The desk is clear"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-pretty text-muted">
                {query.trim()
                  ? `Nothing contains “${query.trim()}”.`
                  : "A new note starts with a title on the first line."}
              </p>
              {query.trim() ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-4 inline-flex h-11 items-center rounded-lg px-3 text-sm text-lamp transition-colors duration-150 hover:bg-raised"
                >
                  Clear search
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 pb-3" aria-label="Note list">
              {filtered.map((note) => (
                <li key={note.id}>
                  <NoteRow
                    note={note}
                    query={query}
                    active={note.id === activeId}
                    now={now}
                    buttonRef={(node) => {
                      if (node) noteRefs.current.set(note.id, node);
                      else noteRefs.current.delete(note.id);
                    }}
                    onSelect={() => {
                      setActive(note.id);
                      setPane("editor");
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {!ready ? <p className="px-3 py-6 text-sm text-faint">Opening your desk…</p> : null}
        </div>

        <footer className="shrink-0 border-t border-line px-4 py-3">
          <p className="text-xs leading-5 text-faint">Saved on this device</p>
          <p className="mt-1 hidden text-xs leading-5 text-pretty text-faint md:block">{hints}</p>
        </footer>
      </aside>

      <section
        aria-label="Editor"
        className={clsx(
          "h-full min-w-0 flex-1 flex-col bg-desk",
          pane === "editor" ? "flex" : "hidden md:flex",
        )}
      >
        {active ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
              {!armed ? (
                <button
                  type="button"
                  aria-label="Back to notes"
                  onClick={() => setPane("list")}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-raised hover:text-ink md:hidden"
                >
                  <ChevronLeft className="size-5" />
                </button>
              ) : null}
              {armed ? (
                <p className="min-w-0 flex-1 truncate px-2 text-sm text-ink">Delete this note?</p>
              ) : (
                <>
                  <p className="min-w-0 flex-1 truncate px-1 text-sm text-muted md:hidden">{title}</p>
                  <p className="hidden flex-1 px-1 text-sm text-faint md:block">
                    {preview ? "Reading" : "Editing"}
                  </p>
                </>
              )}
              {armed ? (
                <>
                  <button
                    type="button"
                    onClick={() => setArmed(false)}
                    className="inline-flex h-11 items-center rounded-lg px-3 text-sm whitespace-nowrap text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={requestDelete}
                    className="inline-flex h-11 items-center rounded-lg bg-danger px-3 text-sm font-medium whitespace-nowrap text-danger-ink transition-transform duration-150 ease-out active:scale-[0.96]"
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-pressed={preview}
                    aria-label={preview ? "Edit markdown" : "Preview markdown"}
                    onClick={togglePreview}
                    className={clsx(
                      "inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-150",
                      preview
                        ? "bg-raised text-lamp"
                        : "text-muted hover:bg-raised hover:text-ink",
                    )}
                  >
                    {preview ? <PenLine className="size-4" /> : <Eye className="size-4" />}
                    <span className="hidden md:inline">{preview ? "Edit" : "Preview"}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete note"
                    onClick={() => setArmed(true)}
                    className="inline-flex size-11 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </header>

            <div
              className="folio-scroll min-h-0 flex-1 overflow-y-auto"
              onMouseDown={(event) => {
                if (preview) return;
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target.closest("textarea, a, button")) return;
                editorRef.current?.focus();
              }}
            >
              <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 py-8 md:px-8 md:py-12">
                <div className={preview ? "hidden" : "block"}>
                  <EditorSurface
                    value={active.body}
                    onChange={(body) => updateBody(active.id, body)}
                    inputRef={editorRef}
                    measureKey={`${pane}-${preview}-${active.id}`}
                  />
                </div>
                <div
                  ref={previewRef}
                  tabIndex={-1}
                  className={clsx("outline-none", preview ? "block" : "hidden")}
                >
                  <MarkdownView source={active.body} />
                </div>
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3 text-xs text-faint tabular-nums">
              <span>{wordLabel}</span>
              <time
                dateTime={new Date(active.updatedAt).toISOString()}
                title={editedExact(active.updatedAt)}
              >
                Edited {editedLabel(active.updatedAt, now)}
              </time>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="font-serif text-3xl text-balance text-ink">
              {ready ? "Nothing on the desk" : "Opening your desk"}
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-pretty text-muted">
              {ready
                ? "Notes stay in this browser. Start one and it will still be here when you come back."
                : "Fetching the notes saved on this device."}
            </p>
            {ready ? (
              <button
                type="button"
                onClick={makeNote}
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-lamp px-4 text-sm font-medium text-lamp-ink transition-transform duration-150 ease-out hover:bg-lamp/90 active:scale-[0.96]"
              >
                <Plus className="size-4" />
                New note
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function NoteRow({
  note,
  query,
  active,
  now,
  onSelect,
  buttonRef,
}: {
  note: Note;
  query: string;
  active: boolean;
  now: number;
  onSelect: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const title = noteTitle(note.body);
  const excerpt = noteExcerpt(note.body, query);
  const when = editedLabel(note.updatedAt, now);

  return (
    <button
      type="button"
      ref={buttonRef}
      data-role="note"
      tabIndex={active ? 0 : -1}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={clsx(
        "relative flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150",
        active ? "bg-raised" : "hover:bg-raised/70",
      )}
    >
      <span
        className={clsx(
          "absolute top-2 bottom-2 left-0 w-0.5 rounded-full",
          active ? "bg-lamp" : "bg-transparent",
        )}
        aria-hidden
      />
      <span className="truncate text-base font-medium text-ink">
        <Highlight text={title} query={query} />
      </span>
      <span className="truncate text-xs text-faint">
        <span className="text-muted">
          <Highlight text={excerpt} query={query} />
        </span>
        <span> · </span>
        <time dateTime={new Date(note.updatedAt).toISOString()} title={editedExact(note.updatedAt)}>
          {when}
        </time>
      </span>
    </button>
  );
}
