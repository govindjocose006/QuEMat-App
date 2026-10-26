import { useState } from "react";
import type { Member } from "../shared/schema.js";
import { Icon } from "./components.js";
import type { Page } from "./navigation.js";

type Task = { page: Page; title: string; description: string };
const sampleTask: Task = {
  page: "samples",
  title: "Register a sample",
  description: "Add the compound and sample details before making a booking.",
};
const bookingTask: Task = {
  page: "calendar",
  title: "Plan a measurement",
  description:
    "Check availability, then reserve a slot with the sample and measurement details.",
};
const reportTask: Task = {
  page: "weekly",
  title: "Write a weekly update",
  description:
    "Save a private draft, then submit it when it is ready for review.",
};
const issueTask: Task = {
  page: "issues",
  title: "Report or follow up on a problem",
  description:
    "Record a refill, instrument problem or decision that needs attention.",
};

function startingTasks(role: Member["appRole"]): Task[] {
  if (role === "administrator")
    return [
      {
        page: "members",
        title: "Welcome a new member",
        description:
          "Review membership requests, permissions and mentor assignments.",
      },
      bookingTask,
      {
        page: "meetings",
        title: "Arrange a meeting or notice",
        description: "Choose attendees for a meeting, or publish a lab notice.",
      },
    ];
  if (role === "supervisor")
    return [
      {
        page: "weekly",
        title: "Review weekly updates",
        description:
          "Open Review weekly reports to read submissions and record follow-ups.",
      },
      issueTask,
      {
        page: "meetings",
        title: "Arrange a meeting or notice",
        description: "Choose attendees for a meeting, or publish a lab notice.",
      },
    ];
  if (role === "mentor")
    return [
      {
        page: "weekly",
        title: "Update and review progress",
        description:
          "Submit your own update; use Review weekly reports for your assigned students.",
      },
      bookingTask,
      issueTask,
    ];
  return [sampleTask, bookingTask, reportTask];
}

function TaskLinks({
  user,
  navigate,
}: {
  user: Member;
  navigate: (page: Page) => void;
}) {
  return (
    <div className="guide-tasks">
      {startingTasks(user.appRole).map((task) => (
        <button
          key={task.page}
          className="guide-task"
          onClick={() => navigate(task.page)}
        >
          <Icon name={task.page} />
          <span>
            <strong>{task.title}</strong>
            <span>{task.description}</span>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
}

// A versioned display preference only. No drafts, profile text or lab records
// are stored here. A different account on the same device gets its own choice.
export function useWelcomeTips(userId: string) {
  const key = `quemat-welcome:v1:${userId}`;
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(key) !== "hidden";
    } catch {
      return true;
    }
  });
  function change(show: boolean) {
    setVisible(show);
    try {
      if (show) localStorage.removeItem(key);
      else localStorage.setItem(key, "hidden");
    } catch {
      /* Tips still work for this session when browser storage is blocked. */
    }
  }
  return { visible, change };
}

export function WelcomeTips({
  user,
  navigate,
  hide,
}: {
  user: Member;
  navigate: (page: Page) => void;
  hide: () => void;
}) {
  return (
    <section className="welcome-tips" aria-labelledby="welcome-tips-title">
      <div className="guide-heading">
        <div>
          <p className="eyebrow">NEW TO THE WORKSPACE?</p>
          <h2 id="welcome-tips-title">Start here</h2>
        </div>
        <button className="text-button" onClick={hide}>
          Hide welcome tips
        </button>
      </div>
      <p>
        Pick the task you need today. You do not need to set up every section.
      </p>
      <TaskLinks user={user} navigate={navigate} />
      <div className="guide-footer">
        <button className="secondary" onClick={() => navigate("guide")}>
          Open Quick Guide
        </button>
        <span>Find it again in the menu, under More on your phone.</span>
      </div>
    </section>
  );
}

export function QuickGuide({
  user,
  navigate,
  showWelcome,
}: {
  user: Member;
  navigate: (page: Page) => void;
  showWelcome: () => void;
}) {
  const reviewer = user.appRole !== "member";
  const manager =
    user.appRole === "administrator" || user.appRole === "supervisor";
  const student =
    user.academicRole === "Intern" || user.academicRole === "Master’s student";
  return (
    <div className="quick-guide">
      <section className="panel" aria-labelledby="guide-start-title">
        <h2 id="guide-start-title">A simple place to start</h2>
        <p>
          Choose one task below. Come back to this guide whenever you need a
          hand.
        </p>
        <TaskLinks user={user} navigate={navigate} />
        {student && (
          <p className="guide-note">
            For project students and interns: check your mentor in My account.
            If the assignment is missing or incorrect, contact a lab
            administrator.
          </p>
        )}
      </section>
      <section
        className="panel guide-topics"
        aria-labelledby="guide-tasks-title"
      >
        <h2 id="guide-tasks-title">How do I…?</h2>
        <p>Open just the topic you need.</p>
        <details>
          <summary>Book and run a measurement</summary>
          <ol>
            <li>
              In Samples, add a new sample or find its existing sample ID. Avoid
              adding the same sample twice.
            </li>
            <li>
              In Calendar, check the date and instrument, then make a booking.
              Select the actual operator, sample, measurement type and requested
              settings.
            </li>
            <li>
              A reservation shows planned time. When the run really starts, open
              the booking and use Check in to record actual usage.
            </li>
            <li>
              At the end, complete the measurement and leave a handover note.
              For a furnace, confirm cooling and unloading only after they have
              actually been completed.
            </li>
          </ol>
          <p>
            Times are shown in Indian Standard Time (IST). A booking is not
            permission to operate equipment: follow the lab’s training and
            operating procedures.
          </p>
          <div className="actions">
            <button className="secondary" onClick={() => navigate("samples")}>
              Go to Samples
            </button>
            <button className="secondary" onClick={() => navigate("calendar")}>
              Go to Calendar
            </button>
          </div>
        </details>
        <details>
          <summary>Write or review weekly progress</summary>
          <ol>
            <li>
              Open Weekly Progress and choose the week. Describe your work,
              results, blockers and next plan.
            </li>
            <li>
              Link relevant samples or bookings. Use Save draft while writing; a
              draft is private to you.
            </li>
            <li>
              Submit when ready for review. Later corrections create a new
              revision, keeping the earlier submission history.
            </li>
          </ol>
          {reviewer ? (
            <p>
              Use Review weekly reports to read submissions and add feedback.
              Mentors review their assigned students; supervisors and
              administrators have the wider review view.
            </p>
          ) : (
            <p>
              Your submitted report is available to supervisors, administrators
              and your assigned mentor with review permission.
            </p>
          )}
          <button className="secondary" onClick={() => navigate("weekly")}>
            Go to Weekly Progress
          </button>
        </details>
        <details>
          <summary>Report an issue or ask for help</summary>
          <ol>
            <li>
              In Issues &amp; Requests, describe the problem or request. Add the
              relevant instrument or sample, priority and assignee where
              appropriate.
            </li>
            <li>
              Request supervisor attention when needed. This flags the issue; it
              does not mark it acknowledged or resolved.
            </li>
            <li>
              Acknowledged means someone has explicitly taken notice. In
              progress means work has started; Resolved means the issue is
              finished. Available actions depend on your permissions and
              assignment.
            </li>
          </ol>
          <p>
            Add comments to keep the discussion together. Resolved issues remain
            in history and can be found using the status filter.
          </p>
          <button className="secondary" onClick={() => navigate("issues")}>
            Go to Issues &amp; Requests
          </button>
        </details>
        <details>
          <summary>Find meetings, notices and updates</summary>
          <p>
            Open Meetings &amp; Notices to see meetings you can access, notes
            and actions. When a notice asks for acknowledgement, use its
            acknowledgement button after reading it.
          </p>
          <p>
            Inbox collects updates. Marking a notification read is separate from
            acknowledging a notice or an issue. Check the app regularly; these
            are in-app updates, not email or phone push reminders.
          </p>
          {manager && (
            <p>
              You can create meetings and publish notices here. Choose meeting
              attendees carefully; meeting access follows the attendee and
              permission rules.
            </p>
          )}
          <div className="actions">
            <button className="secondary" onClick={() => navigate("meetings")}>
              Go to Meetings &amp; Notices
            </button>
            <button
              className="secondary"
              onClick={() => navigate("notifications")}
            >
              Go to Inbox
            </button>
          </div>
        </details>
        <details>
          <summary>Request a chemical or track an order</summary>
          <p>
            In Chemicals &amp; Orders, record the chemical, quantity, supplier
            and cost details you know. Open the request to follow its status and
            history. Approval and purchasing actions depend on your permissions.
          </p>
          <p>
            Recording a request does not place an order or make a payment.
            Follow the lab’s purchasing process and record ordering or receipt
            details when they happen.
          </p>
          <button className="secondary" onClick={() => navigate("orders")}>
            Go to Chemicals &amp; Orders
          </button>
        </details>
        <details>
          <summary>Find an older sample or check my account</summary>
          <p>
            Samples starts with Active samples. Choose Archived or All to find
            older entries; archiving keeps their history.
          </p>
          <p>
            My account shows your mentor, academic role and application
            permissions. Ask an administrator to correct membership details. An
            academic title alone does not grant supervisor or administrator
            access.
          </p>
          <div className="actions">
            <button className="secondary" onClick={() => navigate("samples")}>
              Go to Samples
            </button>
            <button className="secondary" onClick={() => navigate("settings")}>
              Go to My account
            </button>
          </div>
        </details>
        {user.appRole === "administrator" && (
          <details>
            <summary>Help a new member join</summary>
            <ol>
              <li>
                Ask them to choose Request access on the sign-in page and
                complete their profile.
              </li>
              <li>
                In Members &amp; access, verify their identity, academic role
                and mentor assignment.
              </li>
              <li>
                Choose the appropriate application permissions and approve their
                membership. Ask them to check approval status, then use this
                Quick Guide.
              </li>
            </ol>
            <button className="secondary" onClick={() => navigate("members")}>
              Go to Members &amp; access
            </button>
          </details>
        )}
      </section>
      <section
        className="panel guide-footer"
        aria-label="Welcome tips preference"
      >
        <div>
          <h2>Need the starting points again?</h2>
          <p>
            Show the welcome tips on Overview. Hiding them affects only your
            account in this browser.
          </p>
        </div>
        <button className="secondary" onClick={showWelcome}>
          Show welcome tips
        </button>
      </section>
    </div>
  );
}

export function MembershipSteps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="membership-steps" aria-label="Joining the lab">
      {["Create account", "Your details", "Approval"].map((label, index) => (
        <li key={label} aria-current={index + 1 === step ? "step" : undefined}>
          <span aria-hidden="true">{index + 1}</span>
          <span>
            {label}
            {index + 1 < step && <span className="sr-only"> — completed</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
