import { pool } from "./client.js";

export interface GoogleAccount {
  creatorId: string;
  googleEmail: string;
  refreshToken: string;
  connectedAtIso: string;
}

interface GoogleAccountRow {
  creator_id: string;
  google_email: string;
  refresh_token: string;
  connected_at_iso: string;
}

function accountFromRow(row: GoogleAccountRow): GoogleAccount {
  return {
    creatorId: row.creator_id,
    googleEmail: row.google_email,
    refreshToken: row.refresh_token,
    connectedAtIso: row.connected_at_iso,
  };
}

/** One Google account per creator — connecting again replaces the stored refresh token. */
export async function upsertGoogleAccount(
  input: Omit<GoogleAccount, "connectedAtIso">,
): Promise<GoogleAccount> {
  const { rows } = await pool.query<GoogleAccountRow>(
    `INSERT INTO google_accounts (creator_id, google_email, refresh_token, connected_at_iso)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (creator_id) DO UPDATE SET
       google_email = EXCLUDED.google_email,
       refresh_token = EXCLUDED.refresh_token
     RETURNING *`,
    [input.creatorId, input.googleEmail, input.refreshToken, new Date().toISOString()],
  );
  return accountFromRow(rows[0]);
}

export async function getGoogleAccount(creatorId: string): Promise<GoogleAccount | undefined> {
  const { rows } = await pool.query<GoogleAccountRow>(
    "SELECT * FROM google_accounts WHERE creator_id = $1",
    [creatorId],
  );
  return rows[0] ? accountFromRow(rows[0]) : undefined;
}

export interface FormWatch {
  formId: string;
  creatorId: string;
  watchId: string;
  expireTimeIso: string;
  lastFetchedIso: string;
  createdAtIso: string;
}

interface FormWatchRow {
  form_id: string;
  creator_id: string;
  watch_id: string;
  expire_time_iso: string;
  last_fetched_iso: string;
  created_at_iso: string;
}

function watchFromRow(row: FormWatchRow): FormWatch {
  return {
    formId: row.form_id,
    creatorId: row.creator_id,
    watchId: row.watch_id,
    expireTimeIso: row.expire_time_iso,
    lastFetchedIso: row.last_fetched_iso,
    createdAtIso: row.created_at_iso,
  };
}

export async function upsertFormWatch(input: Omit<FormWatch, "createdAtIso">): Promise<FormWatch> {
  const { rows } = await pool.query<FormWatchRow>(
    `INSERT INTO form_watches (form_id, creator_id, watch_id, expire_time_iso, last_fetched_iso, created_at_iso)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (form_id) DO UPDATE SET
       watch_id = EXCLUDED.watch_id,
       expire_time_iso = EXCLUDED.expire_time_iso
     RETURNING *`,
    [input.formId, input.creatorId, input.watchId, input.expireTimeIso, input.lastFetchedIso, new Date().toISOString()],
  );
  return watchFromRow(rows[0]);
}

export async function getFormWatch(formId: string): Promise<FormWatch | undefined> {
  const { rows } = await pool.query<FormWatchRow>("SELECT * FROM form_watches WHERE form_id = $1", [formId]);
  return rows[0] ? watchFromRow(rows[0]) : undefined;
}

export async function getAllFormWatches(): Promise<FormWatch[]> {
  const { rows } = await pool.query<FormWatchRow>("SELECT * FROM form_watches");
  return rows.map(watchFromRow);
}

export async function updateWatchAfterFetch(formId: string, lastFetchedIso: string): Promise<void> {
  await pool.query("UPDATE form_watches SET last_fetched_iso = $2 WHERE form_id = $1", [formId, lastFetchedIso]);
}

export async function updateWatchAfterRenew(
  formId: string,
  watchId: string,
  expireTimeIso: string,
): Promise<void> {
  await pool.query("UPDATE form_watches SET watch_id = $2, expire_time_iso = $3 WHERE form_id = $1", [
    formId,
    watchId,
    expireTimeIso,
  ]);
}
