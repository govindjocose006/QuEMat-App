export function managesOperations(role: string) {
  return role === "administrator" || role === "supervisor";
}
// Explicit IST conversion avoids depending on the browser or server timezone.
export const istInput = (value: string) =>
  new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 16);
export const fromIST = (value: string) =>
  new Date(value + ":00+05:30").toISOString();
