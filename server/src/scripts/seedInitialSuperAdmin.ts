import { seedInitialSuperAdmin } from "../lib/seedInitialSuperAdmin.js";

seedInitialSuperAdmin().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
