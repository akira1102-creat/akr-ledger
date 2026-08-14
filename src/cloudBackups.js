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

const ownsLedgerId = (uid, ledgerId) => (
  typeof uid === "string"
  && uid.length > 0
  && typeof ledgerId === "string"
  && (ledgerId === uid || ledgerId.startsWith(`${uid}__profile__`))
);

const ledgerRef = (db, ledgerId) => db.collection("akr_ledger").doc(ledgerId);
const backupCollectionRef = (db, ledgerId) => ledgerRef(db, ledgerId).collection("backups");
const ownedBackupQuery = (backups, uid, ledgerId) => (
  typeof backups.where === "function"
    ? backups.where("_ownerUid", "==", uid).where("_sourceLedgerId", "==", ledgerId)
    : backups
);

const alreadyExists = error => (
  error?.code === "already-exists"
  || error?.code === 6
  || error?.code === "ALREADY_EXISTS"
);

const writeBackupIfMissing = async (db, backupRef, data, validateExisting = null) => {
  if (typeof db?.runTransaction === "function") {
    let created = false;
    await db.runTransaction(async transaction => {
      created = false;
      const current = await transaction.get(backupRef);
      if (current.exists) {
        if (validateExisting && !validateExisting(current.data() || {})) {
          throw new Error("Backup ownership mismatch");
        }
        return;
      }
      transaction.set(backupRef, data);
      created = true;
    });
    return created;
  }

  const current = await backupRef.get();
  if (current.exists) {
    if (validateExisting && !validateExisting(current.data() || {})) {
      throw new Error("Backup ownership mismatch");
    }
    return false;
  }

  if (typeof backupRef.create === "function") {
    try {
      await backupRef.create(data);
      return true;
    } catch (error) {
      if (alreadyExists(error)) {
        const concurrent = await backupRef.get();
        if (validateExisting && (!concurrent.exists || !validateExisting(concurrent.data() || {}))) {
          throw new Error("Backup ownership mismatch");
        }
        return false;
      }
      throw error;
    }
  }

  await backupRef.set(data);
  return true;
};

const deleteBackupDocuments = async (db, documents) => {
  if (!documents.length) return;
  const batch = db.batch();
  documents.forEach(document => batch.delete(document.ref));
  await batch.commit();
};

export const backupBeforeUpload = async (db, {
  uid,
  ledgerId,
  now = new Date(),
} = {}) => {
  if (!ownsLedgerId(uid, ledgerId)) throw new Error("Invalid ledger ownership");

  const current = await ledgerRef(db, ledgerId).get();
  if (!current.exists) return { created: false, backupDate: null };

  const currentData = current.data() || {};
  if (currentData._ownerUid && currentData._ownerUid !== uid) {
    throw new Error("Cloud ledger owner mismatch");
  }
  if (currentData._sourceLedgerId && currentData._sourceLedgerId !== ledgerId) {
    throw new Error("Cloud ledger path mismatch");
  }

  const backupDate = getBackupDate(now);
  const backups = backupCollectionRef(db, ledgerId);
  const backupRef = backups.doc(getBackupDocId(now));
  const backupData = buildBackupData(currentData, {
    uid,
    ledgerId,
    backupDate,
    backupCreatedAt: normalizeDate(now).toISOString(),
    sourceCloudSyncedAt: currentData._cloudSyncedAt || null,
    sourceLastModified: currentData._lastModified || null,
  });
  const created = await writeBackupIfMissing(
    db,
    backupRef,
    backupData,
    data => validateBackupData(data, uid, ledgerId),
  );

  const list = await ownedBackupQuery(backups, uid, ledgerId).get();
  const documents = Array.isArray(list?.docs) ? list.docs : [];
  const { remove } = selectBackupDocuments(documents, now);
  await deleteBackupDocuments(db, remove);
  return { created, backupDate };
};

export const writeCloudWithBackup = async (db, {
  uid,
  ledgerId,
  data,
  now = new Date(),
} = {}) => {
  if (!ownsLedgerId(uid, ledgerId)) throw new Error("Invalid ledger ownership");
  await backupBeforeUpload(db, { uid, ledgerId, now });
  const timestamp = normalizeDate(now).toISOString();
  await ledgerRef(db, ledgerId).set({
    ...stripCloudMetadata(data),
    _ownerUid: uid,
    _cloudSyncedAt: timestamp,
  });
};

export const readCloudBackups = async (db, {
  uid,
  ledgerId,
  now = new Date(),
} = {}) => {
  if (!ownsLedgerId(uid, ledgerId)) throw new Error("Invalid ledger ownership");
  const backups = backupCollectionRef(db, ledgerId);
  const snapshot = await ownedBackupQuery(backups, uid, ledgerId).get();
  const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
  const { keep } = selectBackupDocuments(documents, now);
  return keep
    .map(document => ({ id: document.id, data: document.data() || {} }))
    .filter(item => validateBackupData(item.data, uid, ledgerId))
    .sort((a, b) => b.id.localeCompare(a.id))
    .map(({ id, data }) => ({
      id,
      entryCount: Number.isFinite(data._entryCount)
        ? data._entryCount
        : (Array.isArray(data.entries) ? data.entries.length : 0),
      sourceLastModified: data._sourceLastModified || null,
      backupCreatedAt: data._backupCreatedAt || null,
    }));
};

export const restoreCloudBackup = async (db, {
  uid,
  ledgerId,
  backupId,
  now = new Date(),
} = {}) => {
  if (!ownsLedgerId(uid, ledgerId)) throw new Error("Invalid ledger ownership");
  if (!getBackupDates(now).includes(backupId)) throw new Error("Backup is outside retention window");

  const backups = backupCollectionRef(db, ledgerId);
  const selected = await backups.doc(backupId).get();
  if (!selected.exists) throw new Error("Backup not found");
  const selectedData = selected.data() || {};
  if (!validateBackupData(selectedData, uid, ledgerId)) throw new Error("Backup ownership mismatch");

  const current = await ledgerRef(db, ledgerId).get();
  if (current.exists) {
    const currentData = current.data() || {};
    if (currentData._ownerUid && currentData._ownerUid !== uid) {
      throw new Error("Cloud ledger owner mismatch");
    }
  }
  await backupBeforeUpload(db, { uid, ledgerId, now });

  const timestamp = normalizeDate(now).toISOString();
  const restored = {
    ...stripCloudMetadata(selectedData),
    _lastModified: timestamp,
    _ownerUid: uid,
    _cloudSyncedAt: timestamp,
  };
  await ledgerRef(db, ledgerId).set(restored);
  return stripCloudMetadata(restored);
};
