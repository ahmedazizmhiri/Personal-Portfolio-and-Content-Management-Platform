export type AuthError = { code?: string; message: string };
export type User = {
  id: string;
  email?: string;
  authValidAfter?: string;
  factors?: Array<{ id: string; factor_type: string; status: string }>;
};
