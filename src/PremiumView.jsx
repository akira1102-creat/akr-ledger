import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";

const labelForPackage = aPackage => {
  const kind = String(aPackage?.packageType || "").toUpperCase();
  if (kind.includes("ANNUAL")) return "年費計劃";
  if (kind.includes("MONTH")) return "月費計劃";
  return aPackage?.product?.title || "Premium";
};

const detailForPackage = aPackage => {
  const product = aPackage?.product;
  if (!product) return "";
  return product.priceString || product.description || "";
};

export function PremiumBadge({ isPremium }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
      isPremium ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
    }`}>
      {isPremium ? "PREMIUM" : "免費版"}
    </span>
  );
}

export function PremiumGate({ title, description, onUpgrade }) {
  return (
    <div className="px-3 pt-3">
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-2xl bg-amber-50">✨</div>
        <div className="mt-4 text-base font-bold">{title}</div>
        <div className="mt-2 text-sm text-gray-400 leading-relaxed">{description}</div>
        <button
          onClick={onUpgrade}
          className="mt-5 w-full py-3 rounded-xl text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg,var(--brand-from),var(--brand-to))" }}
        >
          查看 Premium
        </button>
      </div>
    </div>
  );
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function PremiumView({ subscription, fbDrive, onRefreshMembership }) {
  const [success, setSuccess] = useState("");
  const uid = fbDrive?.fbUser?.uid || "";
  const isNative = Capacitor.isNativePlatform();
  const showApple = Capacitor.getPlatform() === "ios";
  const benefits = [
    "Google 雲端同步及跨裝置備份",
    "無限帳本及家庭分帳",
    "完整趨勢、分類及預算分析",
    "自訂分類、版面及進階匯入",
    "自動匯率及日後新增嘅 Premium 功能",
  ];

  const buy = async aPackage => {
    setSuccess("");
    if (!uid) return;
    if (!(await subscription.purchase(aPackage, uid))) return;
    setSuccess("付款已完成，正在等候 Firebase 確認會員資格…");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await onRefreshMembership?.()) {
        setSuccess("✅ Firebase 已確認 Premium 會員資格");
        return;
      }
      await wait(1500);
    }
    setSuccess("付款已完成；Firebase 會員資格仍在同步，稍後會自動生效。");
  };

  const restore = async () => {
    setSuccess("");
    if (!uid) return;
    if (!(await subscription.restore(uid))) return;
    setSuccess("已找到商店訂閱，正在等候 Firebase 確認會員資格…");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await onRefreshMembership?.()) {
        setSuccess("✅ Firebase 已恢復 Premium 會員資格");
        return;
      }
      await wait(1500);
    }
    setSuccess("已找到商店訂閱；Firebase 會員資格仍在同步，稍後會自動生效。");
  };

  return (
    <div className="space-y-3 pb-4">
      <section
        className="rounded-3xl p-5 text-white shadow-sm"
        style={{ background: "linear-gradient(145deg,#334155,#111827)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-white/60">錢有數</div>
            <div className="text-xl font-bold mt-1">Premium</div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/10 grid place-items-center text-2xl">✨</div>
        </div>
        <div className="mt-4 space-y-2">
          {benefits.map(item => (
            <div key={item} className="flex gap-2 text-sm text-white/90">
              <span className="text-emerald-300">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      {!uid ? (
        <section className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-50 grid place-items-center text-xl">👤</div>
            <div className="text-sm font-semibold mt-3">請先登入會員帳號</div>
            <div className="text-xs text-gray-400 mt-1 leading-relaxed">
              購買會綁定你嘅 Firebase UID，換手機或使用 PWA 都可以確認同一個 Premium 會籍。
            </div>
          </div>
          {showApple && (
            <button
              onClick={() => fbDrive.connect("apple", true)}
              disabled={fbDrive.syncing}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-black disabled:opacity-50"
            >
               使用 Apple 登入
            </button>
          )}
          <button
            onClick={() => fbDrive.connect("google", true)}
            disabled={fbDrive.syncing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#4285F4" }}
          >
            {fbDrive.syncing ? "登入中…" : "使用 Google 帳號登入"}
          </button>
          {fbDrive.syncError && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              {fbDrive.syncError}
            </div>
          )}
        </section>
      ) : subscription.isPremium ? (
        <section className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 grid place-items-center">✓</div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-emerald-700">Premium 使用中</div>
              <div className="text-xs text-gray-400 mt-0.5">多謝你支持錢有數。</div>
            </div>
          </div>
          <button
            onClick={subscription.manage}
            className="mt-4 w-full py-2.5 rounded-xl text-sm font-medium bg-gray-50 text-gray-500"
          >
            管理訂閱
          </button>
        </section>
      ) : (
        <section className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 px-3 py-2.5 rounded-xl">
            <span>✓</span>
            <span className="truncate">已登入 {fbDrive.fbUser.email}</span>
          </div>
          {!isNative ? (
            <div className="text-sm text-center text-gray-400 py-4 leading-relaxed">
              網頁版可以使用已綁定嘅 Premium；新訂閱請喺 Android 或 iPhone App 內完成。
            </div>
          ) : (
            <>
              {subscription.loading && <div className="text-sm text-center text-gray-400 py-4">讀取計劃中…</div>}
              {!subscription.loading && subscription.packages.map(aPackage => (
                <button
                  key={aPackage.identifier}
                  disabled={subscription.busy}
                  onClick={() => buy(aPackage)}
                  className="w-full rounded-2xl border border-gray-100 p-4 flex items-center gap-3 text-left disabled:opacity-50"
                >
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{labelForPackage(aPackage)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{aPackage.product?.description || "自動續訂，可隨時取消"}</div>
                  </div>
                  <div className="text-sm font-bold" style={{ color: "var(--brand)" }}>
                    {detailForPackage(aPackage)}
                  </div>
                </button>
              ))}
              {!subscription.loading && subscription.packages.length === 0 && (
                <div className="text-sm text-center text-gray-400 py-3">
                  {subscription.configured ? "商店暫時未提供訂閱計劃。" : "登入完成後會讀取月費及年費計劃。"}
                </div>
              )}
              <button
                onClick={restore}
                disabled={subscription.busy}
                className="w-full py-2.5 text-sm font-medium text-gray-500 disabled:opacity-50"
              >
                恢復購買
              </button>
            </>
          )}
        </section>
      )}

      {(success || subscription.error) && (
        <div className={`rounded-2xl px-4 py-3 text-sm text-center ${
          subscription.error ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
        }`}>
          {subscription.error || success}
        </div>
      )}

      <div className="px-2 text-[11px] text-gray-400 leading-relaxed text-center">
        訂閱會經 Apple App Store 或 Google Play 自動續訂，除非你喺目前週期結束前取消。
        價格及試用期以付款畫面為準。
        <div className="mt-2 flex justify-center gap-3">
          <a href="./privacy.html" target="_blank" rel="noreferrer">私隱政策</a>
          <a href="./terms.html" target="_blank" rel="noreferrer">使用條款</a>
        </div>
      </div>
    </div>
  );
}
