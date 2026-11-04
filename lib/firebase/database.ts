import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { firestore } from "./core";

// Existing CMS schemas are heterogeneous. Keep their dynamic row type inside
// this server-only repository adapter; routes continue validating with Zod.
export type Row = Record<string, any>;
export type DataError = { code: string; message: string };
export type DataResult<T> = { data: T | null; error: DataError | null; count?: number };
export const MAX_COLLECTION_ROWS = 5000;
export const collectionNames = [
  "profile", "hero", "about", "skills", "projects", "project_sections",
  "project_section_items", "project_media", "project_links", "project_uploads",
  "project_slug_history", "project_section_definitions", "experience", "education",
  "certifications", "resumes", "social_links", "site_settings", "contact_messages",
  "uploads", "pages", "page_sections", "page_section_items", "volunteering",
  "admins", "admin_security_preferences", "admin_remembered_devices",
  "admin_audit_logs", "cms_content_revisions", "cms_builder_action_requests",
] as const;

export const rowKey = (table: string, row: Row) => ["project_uploads", "cms_builder_action_requests"].includes(table)
  ? createHash("sha256").update(JSON.stringify(table === "project_uploads" ? [row.project_id, row.upload_id, row.usage] : [row.actor_user_id, row.idempotency_key])).digest("hex")
  : String(
  table === "site_settings" ? row.key
    : ["admins", "admin_security_preferences"].includes(table) ? row.user_id
      : row.id,
);
export const assertCollection = (table: string) => {
  if (!(collectionNames as readonly string[]).includes(table)) throw new Error("Unknown collection.");
};
export type Equality = readonly [string, unknown];
export const loadCollection = async (table: string, transaction?: Transaction, equality?: Equality): Promise<Row[]> => {
  assertCollection(table);
  const collection = firestore().collection(table);
  const query = (equality ? collection.where(equality[0], "==", equality[1]) : collection).limit(MAX_COLLECTION_ROWS + 1);
  const snapshot = transaction ? await transaction.get(query) : await query.get();
  if (snapshot.size > MAX_COLLECTION_ROWS) throw new Error(`Collection ${table} exceeds the portfolio query limit.`);
  return snapshot.docs.map((doc) => doc.data());
};

export const defaultsFor = (table: string): Row => {
  const now = new Date().toISOString();
  const common = { id: randomUUID(), created_at: now, updated_at: now };
  if (table === "contact_messages") return { ...common, status: "new", read_at: null, archived_at: null, delivery_status: "pending", delivery_attempts: 0, last_delivery_attempt_at: null, next_delivery_attempt_at: null, delivered_at: null, delivery_error_code: null, provider_message_id: null };
  if (table === "uploads") return { ...common, deletion_status: "active", deletion_requested_at: null, deletion_error_code: null };
  if (table === "projects") return { ...common, published: false, featured: false, status: "draft", deletion_status: "active", deletion_requested_at: null, deletion_error_code: null, archived_at: null, published_at: null, tags: [], tools: [], home_featured_order: null, projects_page_order: null, sort_order: 0 };
  if (table === "admin_remembered_devices") return { ...common, revoked_at: null, last_used_at: null, rotation_counter: 0 };
  if (table === "admin_security_preferences") return { ...common, remember_device_enabled: true };
  if (["page_sections", "project_sections"].includes(table)) return { ...common, is_visible: true, is_archived: false, layout_variant: "default", bullets: [], body: "", title: "", display_order: 0, sort_order: 0 };
  if (["page_section_items", "project_section_items", "project_media"].includes(table)) return { ...common, is_visible: true, display_order: 0 };
  return common;
};

type Filter = (row: Row) => boolean;
const publicRootTables = new Set(["profile", "hero", "about", "skills", "experience", "education", "certifications", "resumes", "social_links", "volunteering"]);
export const publicRowAllowed = async (table: string, row: Row, read: (table: string) => Promise<Row[]>): Promise<boolean> => {
  if (publicRootTables.has(table)) return row.published === true && (table !== "volunteering" || row.archived === false);
  if (table === "projects") return row.published === true && row.status === "published" && row.deletion_status === "active";
  if (table === "pages") return row.is_published === true;
  if (table === "project_slug_history") {
    const target = (await read("projects")).find((project) => project.id === row.project_id);
    return Boolean(target && await publicRowAllowed("projects", target, read));
  }
  if (["page_sections", "project_sections"].includes(table)) {
    if (row.is_visible !== true || row.is_archived !== false) return false;
    const parentTable = table === "page_sections" ? "pages" : "projects";
    const parentId = table === "page_sections" ? row.page_id : row.project_id;
    const parent = (await read(parentTable)).find((item) => item.id === parentId);
    return Boolean(parent && await publicRowAllowed(parentTable, parent, read));
  }
  if (["page_section_items", "project_section_items"].includes(table)) {
    if (row.is_visible !== true) return false;
    const parentTable = table === "page_section_items" ? "page_sections" : "project_sections";
    const parentId = table === "page_section_items" ? row.page_section_id : row.project_section_id;
    const parent = (await read(parentTable)).find((item) => item.id === parentId);
    return Boolean(parent && await publicRowAllowed(parentTable, parent, read));
  }
  if (table === "project_media") {
    if (row.is_visible !== true) return false;
    const project = (await read("projects")).find((item) => item.id === row.project_id);
    if (!project || !await publicRowAllowed("projects", project, read)) return false;
    if (!row.project_section_id) return true;
    const section = (await read("project_sections")).find((item) => item.id === row.project_section_id && item.project_id === row.project_id);
    return Boolean(section && await publicRowAllowed("project_sections", section, read));
  }
  return false;
};

export class CollectionQuery<T = Row[]> implements PromiseLike<DataResult<T>> {
  private filters: Filter[] = [];
  private columns = "*";
  private orders: Array<{ field: string; ascending: boolean; nullsFirst: boolean }> = [];
  private maxRows = MAX_COLLECTION_ROWS;
  private mode: "many" | "single" | "maybe" = "many";
  private operation: "read" | "insert" | "update" | "delete" | "upsert" = "read";
  private values: Row[] = [];
  private conflict = "";
  private result?: Promise<DataResult<T>>;
  private equality?: Equality;
  constructor(private table: string, private publicOnly: boolean, private read: (table: string, equality?: Equality) => Promise<Row[]>) { assertCollection(table); }
  select(columns = "*", _options?: unknown) { this.columns = columns; return this; }
  eq(field: string, value: unknown) { this.equality ??= [field, value]; this.filters.push((row) => row[field] === value); return this; }
  neq(field: string, value: unknown) { this.filters.push((row) => row[field] != null && row[field] !== value); return this; }
  is(field: string, value: unknown) { this.filters.push((row) => value === null ? row[field] == null : row[field] === value); return this; }
  in(field: string, values: unknown[]) { this.filters.push((row) => values.includes(row[field])); return this; }
  gt(field: string, value: string | number) { this.filters.push((row) => row[field] != null && row[field] > value); return this; }
  gte(field: string, value: string | number) { this.filters.push((row) => row[field] != null && row[field] >= value); return this; }
  lt(field: string, value: string | number) { this.filters.push((row) => row[field] != null && row[field] < value); return this; }
  lte(field: string, value: string | number) { this.filters.push((row) => row[field] != null && row[field] <= value); return this; }
  order(field: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.orders.push({ field, ascending: options.ascending !== false, nullsFirst: options.nullsFirst === true }); return this; }
  limit(value: number) { this.maxRows = Math.max(0, Math.min(MAX_COLLECTION_ROWS, value)); return this; }
  single() { this.mode = "single"; return this as unknown as CollectionQuery<Row>; }
  maybeSingle() { this.mode = "maybe"; return this as unknown as CollectionQuery<Row>; }
  overrideTypes<R, _Options = unknown>() { return this as unknown as CollectionQuery<R>; }
  insert(values: Row | Row[]) { this.operation = "insert"; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values: Row) { this.operation = "update"; this.values = [values]; return this; }
  upsert(values: Row | Row[], options?: { onConflict?: string }) { this.operation = "upsert"; this.values = Array.isArray(values) ? values : [values]; this.conflict = options?.onConflict ?? ""; return this; }
  delete() { this.operation = "delete"; return this; }
  private async execute(): Promise<DataResult<T>> {
    try {
      if (this.publicOnly && this.operation !== "read") throw Object.assign(new Error("Public writes are denied."), { code: "permission-denied" });
      let rows: Row[];
      const matches = (row: Row) => this.filters.every((filter) => filter(row));
      if (this.operation === "read") {
        rows = (await this.read(this.table, this.equality)).filter(matches);
        if (this.publicOnly) {
          const allowed = await Promise.all(rows.map((row) => publicRowAllowed(this.table, row, this.read)));
          rows = rows.filter((_, index) => allowed[index]);
        }
      } else if (this.operation === "insert" && ["admin_audit_logs", "cms_content_revisions"].includes(this.table)) {
        if (this.values.length > 400) throw new Error("Mutation exceeds the portfolio transaction limit.");
        rows = this.values.map((value) => ({ ...defaultsFor(this.table), ...value }));
        const batch = firestore().batch();
        for (const row of rows) batch.create(firestore().collection(this.table).doc(rowKey(this.table, row)), row);
        await batch.commit();
      } else {
        // Filters are re-evaluated inside the transaction, including contact
        // delivery claims, so concurrent requests cannot both acquire a claim.
        rows = await firestore().runTransaction(async (transaction) => {
          const insertEquality: Equality | undefined = this.operation === "insert" && this.values.length === 1
            ? this.table === "contact_messages" && this.values[0].submission_id ? ["submission_id", this.values[0].submission_id]
              : this.table === "uploads" ? ["bucket", this.values[0].bucket] : undefined
            : undefined;
          const existing = await loadCollection(this.table, transaction, this.equality ?? insertEquality);
          const selected = existing.filter(matches);
          const uploadRelations = this.operation === "delete" && this.table === "uploads"
            ? (await Promise.all(selected.map((row) => loadCollection("project_uploads", transaction, ["upload_id", row.id])))).flat()
            : [];
          const changes: Row[] = [];
          const collection = firestore().collection(this.table);
          const failConflict = () => { throw Object.assign(new Error("Unique content conflict."), { code: "23505" }); };
          if (this.operation === "insert" || this.operation === "upsert") {
            for (const values of this.values) {
              const keyFields = this.conflict ? this.conflict.split(",") : [this.table === "site_settings" ? "key" : ["admins", "admin_security_preferences"].includes(this.table) ? "user_id" : "id"];
              const previous = existing.find((row) => keyFields.every((key) => values[key] != null && row[key] === values[key]));
              if (previous && this.operation === "insert") failConflict();
              if (this.table === "contact_messages" && values.submission_id && existing.some((row) => row.submission_id === values.submission_id)) failConflict();
              if (this.table === "uploads" && existing.some((row) => row.bucket === values.bucket && row.path === values.path)) failConflict();
              const row = { ...defaultsFor(this.table), ...previous, ...values, updated_at: new Date().toISOString() };
              const key = rowKey(this.table, row);
              if (!key || key === "undefined" || key.includes("/")) throw new Error("Invalid document key.");
              transaction.set(collection.doc(key), row);
              changes.push(row);
            }
          } else {
            if (selected.length > 400) throw new Error("Mutation exceeds the portfolio transaction limit.");
            for (const previous of selected) {
              const ref = collection.doc(rowKey(this.table, previous));
              if (this.operation === "delete") { transaction.delete(ref); changes.push(previous); }
              else {
                const row = { ...previous, ...this.values[0], updated_at: new Date().toISOString() };
                transaction.set(ref, row); changes.push(row);
              }
            }
            for (const relation of uploadRelations) transaction.delete(firestore().collection("project_uploads").doc(rowKey("project_uploads", relation)));
          }
          return changes;
        });
      }
      for (let i = this.orders.length - 1; i >= 0; i--) {
        const { field, ascending, nullsFirst } = this.orders[i];
        rows.sort((a, b) => a[field] == null ? b[field] == null ? 0 : nullsFirst ? -1 : 1 : b[field] == null ? nullsFirst ? 1 : -1 : (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, this.maxRows);
      const count = rows.length;
      if (this.columns !== "*") {
        const fields = this.columns.split(",").map((column) => column.trim()).filter(Boolean);
        rows = rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
      }
      if (this.mode !== "many" && (rows.length > 1 || (this.mode === "single" && !rows.length))) throw Object.assign(new Error("Expected one row."), { code: "PGRST116" });
      return { data: (this.mode === "many" ? rows : rows[0] ?? null) as T, error: null, count };
    } catch (error) {
      const candidate = error as { code?: string | number; message?: string };
      return { data: null, error: { code: String(candidate.code ?? "firebase_error"), message: candidate.message ?? "Firebase operation failed." } };
    }
  }
  then<TResult1 = DataResult<T>, TResult2 = never>(onfulfilled?: ((value: DataResult<T>) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    this.result ??= this.execute();
    return this.result.then(onfulfilled, onrejected);
  }
}

export const createDataClient = (publicOnly: boolean) => {
  const reads = new Map<string, Promise<Row[]>>();
  const read = (table: string, equality?: Equality) => {
    if (!publicOnly) return loadCollection(table, undefined, equality);
    const key = `${table}:${JSON.stringify(equality ?? null)}`;
    if (!reads.has(key)) reads.set(key, loadCollection(table, undefined, equality));
    return reads.get(key)!;
  };
  return { from: (table: string) => new CollectionQuery(table, publicOnly, read) };
};
