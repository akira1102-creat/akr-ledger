import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Purchases, LOG_LEVEL } from "@revenuecat/purchases-capacitor";

const ENTITLEMENT_ID = import.meta.env.VITE_REVENUECAT_ENTITLEMENT_ID || "premium";
const PREVIEW_PREMIUM =
  import.meta.env.DEV && import.meta.env.VITE_PREVIEW_ENTITLEMENT === "premium";

const keyForPlatform = () => {
  const platform = Capacitor.getPlatform();
  if (platform === "android") return import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY;
  if (platform === "ios") return import.meta.env.VITE_REVENUECAT_IOS_API_KEY;
  return null;
};

const hasPremium = customerInfo =>
  Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);

const packageRank = aPackage => {
  const kind = String(aPackage?.packageType || "").toUpperCase();
  if (kind.includes("ANNUAL")) return 0;
  if (kind.includes("MONTH")) return 1;
  return 2;
};

export function useSubscription() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [accountPremium, setAccountPremium] = useState(false);
  const [packages, setPackages] = useState([]);
  const [customerInfo, setCustomerInfo] = useState(null);
  const [error, setError] = useState("");
  const configuredRef = useRef(false);
  const identifiedUidRef = useRef("");
  const listenerRef = useRef(null);

  const applyCustomerInfo = useCallback(info => {
    setCustomerInfo(info || null);
  }, []);

  // Firebase is the single source of truth for feature access on every platform.
  const isPremium = PREVIEW_PREMIUM || accountPremium;
  const setAccountEntitlement = useCallback(enabled => {
    setAccountPremium(Boolean(enabled));
  }, []);

  const loadStoreState = useCallback(async () => {
    const [{ customerInfo: info }, offerings] = await Promise.all([
      Purchases.getCustomerInfo(),
      Purchases.getOfferings(),
    ]);
    applyCustomerInfo(info);
    const available = offerings?.current?.availablePackages || [];
    setPackages([...available].sort((a, b) => packageRank(a) - packageRank(b)));
    return info;
  }, [applyCustomerInfo]);

  useEffect(() => {
    setLoading(false);
    return () => {
      if (listenerRef.current) {
        Purchases.removeCustomerInfoUpdateListener({
          listenerToRemove: listenerRef.current,
        }).catch(() => {});
      }
    };
  }, []);

  const identify = useCallback(async appUserID => {
    if (!appUserID) {
      setError("請先登入會員帳號。");
      return false;
    }
    if (!Capacitor.isNativePlatform()) return true;

    const apiKey = keyForPlatform();
    if (!apiKey) {
      setError("尚未設定商店訂閱金鑰。");
      return false;
    }

    setLoading(true);
    setError("");
    try {
      if (!configuredRef.current) {
        if (import.meta.env.DEV) await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
        await Purchases.configure({ apiKey, appUserID });
        configuredRef.current = true;
        setConfigured(true);
        listenerRef.current = await Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
      } else if (identifiedUidRef.current !== appUserID) {
        const result = await Purchases.logIn({ appUserID });
        applyCustomerInfo(result.customerInfo);
      }
      identifiedUidRef.current = appUserID;
      await loadStoreState();
      return true;
    } catch (e) {
      setError(e?.message || "未能連結訂閱身份。");
      return false;
    } finally {
      setLoading(false);
    }
  }, [applyCustomerInfo, loadStoreState]);

  const refresh = useCallback(async () => {
    if (!configuredRef.current) return;
    try {
      await loadStoreState();
      setError("");
    } catch (e) {
      setError(e?.message || "未能讀取訂閱狀態。");
    }
  }, [loadStoreState]);

  const purchase = useCallback(async (aPackage, appUserID) => {
    if (!appUserID) {
      setError("請先登入會員帳號先購買。");
      return false;
    }
    if (!aPackage || !(await identify(appUserID))) return false;
    setBusy(true);
    setError("");
    try {
      const { customerInfo: info } = await Purchases.purchasePackage({ aPackage });
      applyCustomerInfo(info);
      return hasPremium(info);
    } catch (e) {
      if (!e?.userCancelled) setError(e?.message || "訂閱未能完成。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyCustomerInfo, identify]);

  const restore = useCallback(async appUserID => {
    if (!appUserID) {
      setError("請先登入會員帳號先恢復購買。");
      return false;
    }
    if (!(await identify(appUserID))) return false;
    setBusy(true);
    setError("");
    try {
      const { customerInfo: info } = await Purchases.restorePurchases();
      applyCustomerInfo(info);
      if (!hasPremium(info)) setError("搵唔到有效嘅 Premium 訂閱。");
      return hasPremium(info);
    } catch (e) {
      setError(e?.message || "恢復購買失敗。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyCustomerInfo, identify]);

  const manage = useCallback(async () => {
    const url = customerInfo?.managementURL;
    if (!url) {
      setError("暫時未有可管理嘅訂閱。");
      return;
    }
    await Browser.open({ url });
  }, [customerInfo]);

  const clearIdentity = useCallback(() => {
    setAccountPremium(false);
    setCustomerInfo(null);
    setPackages([]);
    identifiedUidRef.current = "";
    setError("");
    // Do not call RevenueCat logOut(): that would create an anonymous App User ID.
  }, []);

  return useMemo(() => ({
    loading,
    busy,
    configured,
    isPremium,
    packages,
    error,
    refresh,
    purchase,
    restore,
    manage,
    identify,
    clearIdentity,
    setAccountEntitlement,
    entitlementId: ENTITLEMENT_ID,
  }), [busy, clearIdentity, configured, error, identify, isPremium, loading, manage, packages, purchase, refresh, restore, setAccountEntitlement]);
}
