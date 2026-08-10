"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/shared/money";
import type { StudentSearchResult } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { requestStudentSearch, searchErrorMessage } from "./api";

const DEBOUNCE_MS = 250;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; results: StudentSearchResult[] }
  | { status: "error"; message: string };

function ResultRow({ student }: { student: StudentSearchResult }) {
  const subtitle = student.studentNumber ? `#${student.studentNumber}` : student.email;
  return (
    <li>
      <Link
        href={`/admin/students/${student.uid}`}
        className="flex items-center justify-between gap-4 rounded-md px-3 py-3 hover:bg-surface"
      >
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">{student.displayName}</span>
            {student.suspended ? (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                Suspended
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted">{subtitle}</span>
        </span>
        <span className="text-right font-medium text-foreground">
          {formatCents(student.balanceCents)}
        </span>
      </Link>
    </li>
  );
}

export function StudentSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) return;
    const id = seq.current + 1;
    seq.current = id;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: "loading" });
      requestStudentSearch(q, controller.signal)
        .then((dto) => {
          if (seq.current === id) setState({ status: "loaded", results: dto.results });
        })
        .catch((err) => {
          if (controller.signal.aborted || seq.current !== id) return;
          const code = err instanceof ApiError ? err.code : "NETWORK";
          setState({ status: "error", message: searchErrorMessage(code) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const trimmed = query.trim();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">Students</h1>

      <div className="flex flex-col gap-2">
        <label htmlFor="student-search" className="text-sm font-medium text-foreground">
          Find a student
        </label>
        <input
          id="student-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Student number, name, or email"
          aria-label="Search by student number, name, or email"
          className="h-12 w-full rounded-md border border-border bg-background px-4 text-base text-foreground"
        />
      </div>

      <div aria-live="polite">
        {trimmed.length === 0 ? (
          <p className="text-sm text-muted">
            Search by exact student number or email, or the start of a name.
          </p>
        ) : state.status === "error" ? (
          <p role="status" className="text-sm font-medium text-danger">
            {state.message}
          </p>
        ) : state.status === "loaded" ? (
          state.results.length === 0 ? (
            <p className="text-sm text-muted">No students match “{trimmed}”.</p>
          ) : (
            <ul className="-mx-3 flex flex-col divide-y divide-border">
              {state.results.map((student) => (
                <ResultRow key={student.uid} student={student} />
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted">Searching…</p>
        )}
      </div>
    </div>
  );
}
