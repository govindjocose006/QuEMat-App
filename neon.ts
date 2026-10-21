import { defineConfig } from "@neon/config/v1";

// Postgres already exists on the selected branch. No optional Neon services
// are declared: authentication and the API remain in the Vercel application.
export default defineConfig({
  branch: (branch) => {
    if (!branch.exists || branch.name !== "production") {
      throw new Error(
        "Use the existing production branch; do not create a branch.",
      );
    }
    // Preserve the existing branch's lifecycle, compute, and protection settings.
    return {};
  },
});
