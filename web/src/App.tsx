import { useState, useCallback, useEffect, useRef } from "react";
import { useReviews, useStatus, useUrlState, sortReviews } from "./hooks";
import { Sidebar } from "./components/Sidebar";
import { Detail } from "./components/Detail";
import "./App.css";

export default function App() {
  const { data, reload } = useReviews();
  const status = useStatus();
  const { activeRepo, setActiveRepo, selectedReviewId, setSelectedReviewId } =
    useUrlState();
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Track open state for snippets, editors, asks
  const [openSnippets, setOpenSnippets] = useState<Set<string>>(
    () => new Set()
  );
  const [openEditors, setOpenEditors] = useState<Set<string>>(
    () => new Set()
  );
  const [openAsks, setOpenAsks] = useState<Set<string>>(() => new Set());

  // Ref to track whether we should skip detail re-render on poll
  const openEditorsRef = useRef(openEditors);
  const openAsksRef = useRef(openAsks);
  openEditorsRef.current = openEditors;
  openAsksRef.current = openAsks;

  const toggleSnippet = useCallback((id: string) => {
    setOpenSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleEditor = useCallback((id: string) => {
    setOpenEditors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAsk = useCallback((id: string) => {
    setOpenAsks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Get filtered + sorted reviews
  const getFiltered = useCallback(() => {
    const filtered = activeRepo
      ? data.reviews.filter(
          (r) => `${r.prInfo.owner}/${r.prInfo.repo}` === activeRepo
        )
      : data.reviews;
    return sortReviews(filtered);
  }, [data.reviews, activeRepo]);

  const handleSelectReview = useCallback(
    (id: string) => {
      setSelectedReviewId(id);
      const filtered = getFiltered();
      const idx = filtered.findIndex((r) => r.id === id);
      setFocusedIndex(idx);
    },
    [setSelectedReviewId, getFiltered]
  );

  const handleSetRepo = useCallback(
    (repo: string | null) => {
      setActiveRepo(repo);
      setSelectedReviewId(null);
      setFocusedIndex(-1);
    },
    [setActiveRepo, setSelectedReviewId]
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const filtered = getFiltered();
      const len = filtered.length;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!len) return;
        const newIdx = Math.min(focusedIndex + 1, len - 1);
        setFocusedIndex(newIdx);
        handleSelectReview(filtered[newIdx].id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!len) return;
        const newIdx = Math.max(focusedIndex - 1, 0);
        setFocusedIndex(newIdx);
        handleSelectReview(filtered[newIdx].id);
      } else if (e.key === "r") {
        // trigger scan handled by sidebar
        document
          .querySelector<HTMLButtonElement>(".scan-btn")
          ?.click();
      } else if (e.key >= "0" && e.key <= "9") {
        const repos = [...new Set(data.reviews.map((r) => `${r.prInfo.owner}/${r.prInfo.repo}`))];
        const idx = parseInt(e.key);
        if (idx === 0) {
          handleSetRepo(null);
        } else if (idx <= repos.length) {
          handleSetRepo(repos[idx - 1]);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedIndex, data.reviews, getFiltered, handleSelectReview, handleSetRepo]);

  // Find selected review
  const selectedReview = selectedReviewId
    ? data.reviews.find((r) => r.id === selectedReviewId)
    : null;

  // Poll protection: don't re-render detail when inputs focused or editors/asks open
  const [stableReview, setStableReview] = useState(selectedReview);
  const prevSelectedIdRef = useRef(selectedReviewId);

  useEffect(() => {
    // If selected review changed by user action, always update
    if (prevSelectedIdRef.current !== selectedReviewId) {
      prevSelectedIdRef.current = selectedReviewId;
      setStableReview(selectedReview ?? null);
      return;
    }

    // If editors or asks are open, skip update
    if (openEditorsRef.current.size > 0 || openAsksRef.current.size > 0) return;

    // If any input/textarea is focused, skip update
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    )
      return;

    setStableReview(selectedReview ?? null);
  }, [selectedReview, selectedReviewId]);

  return (
    <>
      <Sidebar
        data={data}
        activeRepo={activeRepo}
        selectedReviewId={selectedReviewId}
        focusedIndex={focusedIndex}
        status={status}
        onSelectReview={handleSelectReview}
        onSetRepo={handleSetRepo}
        onScanComplete={reload}
      />
      <div className="main">
        {stableReview ? (
          <Detail
            review={stableReview}
            onAction={reload}
            openSnippets={openSnippets}
            openEditors={openEditors}
            openAsks={openAsks}
            onToggleSnippet={toggleSnippet}
            onToggleEditor={toggleEditor}
            onToggleAsk={toggleAsk}
          />
        ) : (
          <div className="main-empty">
            Select a PR from the sidebar
            <br />
            <span style={{ fontSize: 13, marginTop: 8, display: "block" }}>
              <span className="kbd">j</span>/<span className="kbd">k</span>{" "}
              navigate &nbsp; <span className="kbd">r</span> scan &nbsp;{" "}
              <span className="kbd">1</span>-<span className="kbd">9</span>{" "}
              switch repo
            </span>
          </div>
        )}
      </div>
    </>
  );
}
