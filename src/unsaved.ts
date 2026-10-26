// Synchronous, ephemeral guard; report contents never leave the editor.
export const beforeWorkspaceLeave = "quemat-before-workspace-leave";
export function mayLeaveWorkspace(): boolean {
  return window.dispatchEvent(
    new Event(beforeWorkspaceLeave, { cancelable: true }),
  );
}
