import "server-only";

import { createDataClient } from "./database";
import { createStorageClient } from "./storage";
import { runMutation } from "./mutations";
export { getFirebaseApp, firebaseAuth, firestore, firebaseBucket } from "./core";

export const createFirebaseAdminClient = () => ({
  ...createDataClient(false),
  storage: createStorageClient(),
  rpc: runMutation,
});
