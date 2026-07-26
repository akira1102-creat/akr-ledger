export const MEMBERSHIP_COLLECTION = "qys_memberships";
export const PROFILE_INDEX_COLLECTION = "akr_ledger_profiles";

const toExpiryMs = value => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const hasActivePremiumMembership = (membership, now = Date.now()) => {
  if (!membership || membership.entitlement !== "premium" || membership.status !== "active") {
    return false;
  }
  return membership.lifetime === true || toExpiryMs(membership.expiresAt) > now;
};

const cleanProfile = (profile, index) => {
  const id = String(profile?.id || "").trim();
  if (!id) return null;
  const fallbackName = id === "main" ? "自己" : `舊帳本 ${index + 1}`;
  return {
    id,
    name: String(profile?.name || fallbackName).trim() || fallbackName,
    createdAt: profile?.createdAt || new Date(0).toISOString(),
  };
};

export const mergeCloudProfiles = (localProfiles = [], cloudProfiles = []) => {
  const merged = new Map();
  cloudProfiles.forEach((profile, index) => {
    const clean = cleanProfile(profile, index);
    if (clean) merged.set(clean.id, clean);
  });
  localProfiles.forEach((profile, index) => {
    const clean = cleanProfile(profile, index);
    if (clean) merged.set(clean.id, { ...merged.get(clean.id), ...clean });
  });
  if (!merged.has("main")) {
    merged.set("main", { id: "main", name: "自己", createdAt: new Date(0).toISOString() });
  }
  return [...merged.values()].sort((a, b) => {
    if (a.id === "main") return -1;
    if (b.id === "main") return 1;
    return String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id);
  });
};

export const readAccountCloudState = async (db, uid) => {
  const [membershipSnap, profileSnap] = await Promise.all([
    db.collection(MEMBERSHIP_COLLECTION).doc(uid).get(),
    db.collection(PROFILE_INDEX_COLLECTION).doc(uid).get(),
  ]);
  const profileData = profileSnap.exists ? profileSnap.data() : null;
  let cloudProfiles = Array.isArray(profileData?.profiles) ? profileData.profiles : [];
  if (!cloudProfiles.length && profileData?.profilesJson) {
    try {
      const parsed = JSON.parse(profileData.profilesJson);
      if (Array.isArray(parsed)) cloudProfiles = parsed;
    } catch {}
  }
  return {
    isPremium: membershipSnap.exists && hasActivePremiumMembership(membershipSnap.data()),
    cloudProfiles,
  };
};

export const saveCloudProfileIndex = async (db, uid, profiles) => {
  const normalized = mergeCloudProfiles(profiles, []);
  await db.collection(PROFILE_INDEX_COLLECTION).doc(uid).set({
    _ownerUid: uid,
    schemaVersion: 1,
    profiles: normalized,
    profilesJson: JSON.stringify(normalized),
    updatedAt: new Date().toISOString(),
  });
};
