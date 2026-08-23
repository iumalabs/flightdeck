import { useCallback, useEffect, useState } from "react";

export interface Project {
  id: string;
  name: string;
}

export interface UseSelectedProjectResult {
  selectedProjectId: string | null;
  selectProject: (id: string) => void;
}

const STORAGE_KEY = "flightdeck.selectedProjectId";

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — selection just won't survive
    // navigation; every screen still works off in-memory state for the rest of this render.
  }
}

// specs/008-multi-project-support research.md §4 — sessionStorage, not localStorage, matching
// spec FR-007's "survives navigation within a session, no requirement to survive browser
// restart." `projects` is `null` while `GET /api/internal/v1/projects` is still loading; once
// loaded, a stored id that no longer resolves (deleted, or from a stale session) falls back to
// the first project, mirroring the server's own resolveRequestedProject() fallback.
export function useSelectedProject(projects: Project[] | null): UseSelectedProjectResult {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(readStored);

  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (selectedProjectId && projects.some((p) => p.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  const selectProject = useCallback((id: string) => {
    setSelectedProjectId(id);
    writeStored(id);
  }, []);

  return { selectedProjectId, selectProject };
}
