// Interpret date/time inputs in the lab timezone, regardless of the browser's zone.
export function bookingDuration(start: string, end: string): string {
  if (!start || !end) return "Choose both times to see the reserved duration.";
  const minutes =
    (Date.parse(`${end}:00+05:30`) - Date.parse(`${start}:00+05:30`)) / 60000;
  if (!Number.isFinite(minutes)) return "Choose valid start and end times.";
  if (minutes <= 0) return "End must be after start.";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const duration = [
    hours ? `${hours} h` : "",
    remainder ? `${remainder} min` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `Reserved duration: ${duration} · includes cooling; setup and cleanup buffers are additional.`;
}

// Improve old booking messages for display only; retain the stored event/history.
export function notificationMessage(
  message: string,
  isBooking: boolean,
): string {
  return isBooking
    ? message.replace(/: cancel\. /, ": Booking cancelled. ")
    : message;
}
