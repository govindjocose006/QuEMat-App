import { useCallback, useEffect, useRef, useState } from "react";

import { mayLeaveWorkspace } from "./unsaved.js";

export const pageLabels = {
  overview: "Overview",
  calendar: "Calendar",
  samples: "Samples",
  weekly: "Weekly Progress",
  orders: "Chemicals & Orders",
  issues: "Issues & Requests",
  meetings: "Meetings & Notices",
  notifications: "Notifications",
  instruments: "Instruments",
  members: "Members & access",
  audit: "Audit history",
  settings: "My account",
};
export type Page = keyof typeof pageLabels;

export function sectionFromHash(hash: string, administrator: boolean): Page {
  const section = hash.slice(1);
  if (!Object.hasOwn(pageLabels, section)) return "overview";
  if (!administrator && (section === "members" || section === "audit"))
    return "overview";
  return section as Page;
}

// URLs hold section names only, never record IDs, searches, form data or tokens.
// This hook mounts only inside the approved, authenticated workspace. Server
// permissions remain authoritative regardless of the hash supplied by a user.
export function useWorkspaceNavigation(administrator: boolean) {
  const [page, selectPage] = useState<Page>(() =>
    sectionFromHash(window.location.hash, administrator),
  );
  const currentPage = useRef(page);
  const position = useRef<number>(window.history.state?.quematPosition ?? 0);
  const restoring = useRef(false);
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, quematPosition: position.current },
      "",
    );
    const restore = () => {
      let nextPosition = window.history.state?.quematPosition;
      if (!Number.isInteger(nextPosition)) {
        // A native fragment/skip-link navigation creates a new history entry.
        nextPosition = position.current + 1;
        window.history.replaceState(
          { ...window.history.state, quematPosition: nextPosition },
          "",
        );
      }
      if (restoring.current) {
        if (nextPosition === position.current) restoring.current = false;
        return;
      }
      // Skip links move focus inside the current section, not between sections.
      if (window.location.hash === "#main-content") {
        position.current = nextPosition;
        return;
      }
      const section = sectionFromHash(window.location.hash, administrator);
      if (section !== currentPage.current && !mayLeaveWorkspace()) {
        if (
          typeof nextPosition === "number" &&
          nextPosition !== position.current
        ) {
          restoring.current = true;
          window.history.go(position.current - nextPosition);
        } else {
          window.history.replaceState(
            { ...window.history.state, quematPosition: position.current },
            "",
            `#${currentPage.current}`,
          );
        }
        return;
      }
      position.current =
        typeof nextPosition === "number" ? nextPosition : position.current + 1;
      currentPage.current = section;
      selectPage(section);
      window.history.replaceState(
        { ...window.history.state, quematPosition: position.current },
        "",
        `#${section}`,
      );
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, [administrator]);
  useEffect(() => {
    document.title = `${pageLabels[page]} | QuEMat Lab Hub`;
    return () => {
      document.title = "QuEMat Lab Hub";
    };
  }, [page]);
  const setPage = useCallback(
    (next: Page) => {
      const section = sectionFromHash(`#${next}`, administrator);
      if (restoring.current) return;
      if (section !== currentPage.current && !mayLeaveWorkspace()) return;
      if (window.location.hash !== `#${section}`) {
        position.current++;
        window.history.pushState(
          { quematPosition: position.current },
          "",
          `#${section}`,
        );
      }
      currentPage.current = section;
      selectPage(section);
    },
    [administrator],
  );
  return [page, setPage] as const;
}
