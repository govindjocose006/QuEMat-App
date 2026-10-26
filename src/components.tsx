import { useEffect, useRef, type ReactNode } from "react";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        Q<span>·</span>
      </span>
      <div>
        <strong>
          QuEMat<span className="brand-light"> Lab Hub</span>
        </strong>
        <small>IISER Thiruvananthapuram</small>
      </div>
    </div>
  );
}
const iconPaths = {
  guide: (
    <>
      <path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v15" />
      <path d="M6 9h3M15 9h3M6 13h3M15 13h3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M7 14h2M15 14h2M7 18h2M15 18h2" />
    </>
  ),
  samples: (
    <>
      <path d="M8 3h8M9 3v5l-5 9a3 3 0 0 0 2.6 4h10.8a3 3 0 0 0 2.6-4l-5-9V3M6 15h12" />
      <circle cx="10" cy="18" r=".5" />
      <circle cx="14" cy="17" r=".5" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  weekly: (
    <>
      <path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" />
    </>
  ),
  meetings: <path d="M4 4h16v13H9l-5 4V4ZM8 8h8M8 12h5" />,
  orders: <path d="M3 4h3l2 12h11l2-9H7M10 20h.01M18 20h.01M11 3h8v4" />,
  issues: <path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v1" />,
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  instruments: (
    <>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <rect x="6" y="7" width="9" height="8" rx="1" />
      <path d="M7 12h2l1-3 2 5 1-2h1M18 8v1M18 12v2M7 19v2M17 19v2" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" />
    </>
  ),
  audit: (
    <>
      <path d="M3 11a9 9 0 1 1 2.7 7.4M3 4v7h7M12 7v5l4 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  logout: (
    <>
      <path d="M10 3H4v18h6M9 12h12m-4-4 4 4-4 4" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.replaceAll(" ", "-")}`}>
      <span aria-hidden="true">●</span> {value}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name="instruments" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    return () => {
      dialog.close();
      queueMicrotask(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
