import { db } from "../src/db";
import {
  tasks,
  steps,
  relayJobs,
  submittedResults,
  submittedRatings,
} from "../src/schema";

async function main() {
  console.log("Clearing task-related tables from Turso DB to resolve indexer lag mismatch...");

  console.log("Deleting submitted_ratings...");
  await db.delete(submittedRatings);

  console.log("Deleting submitted_results...");
  await db.delete(submittedResults);

  console.log("Deleting relay_jobs...");
  await db.delete(relayJobs);

  console.log("Deleting steps...");
  await db.delete(steps);

  console.log("Deleting tasks...");
  await db.delete(tasks);

  console.log("Done clearing DB!");
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed to clear DB:", e);
  process.exit(1);
});
