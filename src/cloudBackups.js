export const BACKUP_RETENTION_DAYS = 7;

const CLOUD_METADATA_FIELDS = new Set([
  "_ownerUid",
  "_cloudSyncedAt",
  "_backupDate",
  "_backupCreatedAt",
  "_sourceCloudSyncedAt",
  "_sourceLastModified",
  "_sourceLedgerId",
  "_entryCount",
]);

const cloneValue = value => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const normalizeDate = value => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid backup date");
  return date;
};

const pad = value => String(value).padStart(2, "0");

export const getBackupDate = (date = new Date()) => {
  const normalized = normalizeDate(date);
  return `${normalized.getUTCFullYear()}-${pad(normalized.getUTCMonth() + 1)}-${pad(normalized.getUTCDate())}`;
};

export const getBackupDocId = (date = new Date()) => getBackupDate(date);

export const stripCloudMetadata = (data = {}) => {
  const source = data && typeof data === "object" ? data : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !CLOUD_METADATA_FIELDS.has(key))
      .map(([key, value]) => [key, cloneValue(value)]),
  );
};

export const buildBackupData = (storeData, metadata = {}) => {
  const cleanStore = stripCloudMetadata(storeData);
  const entries = Array.isArray(cleanStore.entries) ? cleanStore.entries : [];
  return {
    ...cleanStore,
    _backupDate: String(metadata.backupDate || ""),
    _backupCreatedAt: String(metadata.backupCreatedAt || ""),
    _sourceCloudSyncedAt: metadata.sourceCloudSyncedAt || null,
    _sourceLastModified: metadata.sourceLastModified || null,
    _ownerUid: String(metadata.uid || ""),
    _sourceLedgerId: String(metadata.ledgerId || ""),
    _entryCount: entries.length,
  };
};

export const validateBackupData = (data, uid, ledgerId) => (
  Boolean(data)
  && typeof data === "object"
  && typeof uid === "string"
  && uid.length > 0
  && typeof ledgerId === "string"
  && ledgerId.length > 0
  && data._ownerUid === uid
  && data._sourceLedgerId === ledgerId
);

export const getBackupDates = (now = new Date(), retentionDays = BACKUP_RETENTION_DAYS) => {
  const normalized = normalizeDate(now);
  const count = Math.max(0, Math.floor(Number(retentionDays) || 0));
  const dates = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(normalized.getTime());
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(getBackupDate(date));
  }
  return dates;
};

export const selectBackupDocuments = (
  documents = [],
  now = new Date(),
  retentionDays = BACKUP_RETENTION_DAYS,
) => {
  const keepIds = new Set(getBackupDates(now, retentionDays));
  const keep = [];
  const remove = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (keepIds.has(document?.id)) keep.push(document);
    else remove.push(document);
  }
  return { keep, remove };
};
