import { useCallback, useEffect, useState } from "react";

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
  useEffect(() => {
    const restore = () => {
      // The accessible skip link changes the fragment without changing sections.
      if (window.location.hash === "#main-content") return;
      const section = sectionFromHash(window.location.hash, administrator);
      selectPage(section);
      if (window.location.hash !== `#${section}`)
        window.history.replaceState(null, "", `#${section}`);
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
      if (window.location.hash !== `#${section}`)
        window.history.pushState(null, "", `#${section}`);
      selectPage(section);
    },
    [administrator],
  );
  return [page, setPage] as const;
}
