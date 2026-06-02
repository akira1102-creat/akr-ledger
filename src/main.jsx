import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/* ===================== 常數 ===================== */
const CURRENCIES = [
  { code:"MOP", symbol:"MOP$" },
  { code:"HKD", symbol:"HK$" },
  { code:"CNY", symbol:"CN¥" },
  { code:"JPY", symbol:"¥" },
  { code:"TWD", symbol:"NT$" },
];
const DEFAULT_RATES = { MOP: 1, HKD: 1.03, CNY: 1.11, JPY: 0.055, TWD: 0.25 };

const reportError = (scope, error, userMessage) => {
  const message = userMessage || (error?.message ? `${scope}：${error.message}` : scope);
  console.error(`[AKR Ledger] ${scope}`, error);
  window.dispatchEvent(new CustomEvent("akr-app-error", { detail: { message } }));
};

/* ===================== Firebase / Google 同步 ===================== */
const FB_STATE_KEY = "akr-fb-state";
const FB_REDIRECT_KEY = "akr-fb-redirect-pending";
const FB_CDN = "https://www.gstatic.com/firebasejs/10.12.2";
const FB_CONFIG = {
  apiKey: "AIzaSyCoAVgCDo1vh-YI3IWv7nm5nVav7hdqjoc",
  authDomain: "akira-project-508eb.firebaseapp.com",
  projectId: "akira-project-508eb",
  storageBucket: "akira-project-508eb.firebasestorage.app",
  messagingSenderId: "19932489246",
  appId: "1:19932489246:web:46ad2fd86929eb4ba5700f",
};

// Dynamically load Firebase scripts only when needed (keeps initial render fast)
let _fbPromise = null;
const loadFirebase = () => {
  if (_fbPromise) return _fbPromise;
  _fbPromise = (async () => {
    if (window._fbDb) return;
    const loadScript = src => new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    await loadScript(FB_CDN + "/firebase-app-compat.js");
    await loadScript(FB_CDN + "/firebase-auth-compat.js");
    await loadScript(FB_CDN + "/firebase-firestore-compat.js");
    const app = firebase.initializeApp(FB_CONFIG);
    window._fbAuth = firebase.auth(app);
    window._fbDb   = firebase.firestore(app);
  })();
  return _fbPromise;
};

function useFirebaseSync(store, setStore) {
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(FB_STATE_KEY)||"null"); } catch { return null; } };
  const saved = loadSaved();

  const [fbUser,     setFbUser]     = useState(null);
  const [lastSync,   setLastSync]   = useState(saved?.lastSync   ? new Date(saved.lastSync)   : null);
  const [lastUpload, setLastUpload] = useState(saved?.lastUpload ? new Date(saved.lastUpload) : null);
  const [startupDone, setStartupDone] = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncError,  setSyncError]  = useState(null);

  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);

  const persistState = (user, sync, upload) => {
    try {
      localStorage.setItem(FB_STATE_KEY, JSON.stringify({
        user,
        lastSync:   sync   ? sync.toISOString()   : null,
        lastUpload: upload !== undefined ? (upload ? upload.toISOString() : null) : (lastUpload ? lastUpload.toISOString() : null),
      }));
    } catch(e) {
      reportError("Google 同步狀態儲存失敗", e, "Google 同步狀態儲存失敗，請稍後再試。");
    }
  };

  const toFbUser = (user) => user ? {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  } : null;

  const docRef = (uid) => window._fbDb.collection("akr_ledger").doc(uid);

  const downloadFb = async (uid) => {
    const snap = await docRef(uid).get();
    if (!snap.exists) return { storeData: null, syncedAt: null };
    const { _cloudSyncedAt, ...storeData } = snap.data();
    return { storeData, syncedAt: _cloudSyncedAt || null };
  };

  const uploadFb = async (uid, data) => {
    await docRef(uid).set({ ...data, _cloudSyncedAt: new Date().toISOString() });
  };

  const justImportedRef      = useRef(false);
  const startupJustSyncedRef = useRef(false);

  useEffect(() => {
    const shouldRestore = !!saved?.user || localStorage.getItem(FB_REDIRECT_KEY) === "1";
    if (!shouldRestore) return;

    let alive = true;
    let unsubscribe = null;
    (async () => {
      try {
        await loadFirebase();
        await window._fbAuth.getRedirectResult().catch(e => {
          if (alive) setSyncError(e.message || "Google redirect 登入失敗");
        });
        if (!alive) return;
        unsubscribe = window._fbAuth.onAuthStateChanged(user => {
          if (!alive) return;
          try { localStorage.removeItem(FB_REDIRECT_KEY); } catch(e) {
            reportError("Google redirect 狀態清除失敗", e);
          }
          const nextUser = toFbUser(user);
          setFbUser(nextUser);
          if (nextUser) {
            persistState(nextUser, lastSync, lastUpload);
          } else if (saved?.user) {
            try { localStorage.removeItem(FB_STATE_KEY); } catch(e) {
              reportError("Google 同步狀態清除失敗", e);
            }
            setSyncError("Google 登入已失效，請重新登入");
          }
        });
      } catch(e) {
        if (alive) setSyncError(e.message || "Google 登入狀態恢復失敗");
      }
    })();

    return () => {
      alive = false;
      if (unsubscribe) unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setSyncing(true); setSyncError(null);
    try {
      await loadFirebase();
      const provider = new firebase.auth.GoogleAuthProvider();
      let result;
      try {
        result = await window._fbAuth.signInWithPopup(provider);
      } catch(e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
          try { localStorage.setItem(FB_REDIRECT_KEY, "1"); } catch(err) {
            reportError("Google redirect 狀態儲存失敗", err, "Google 登入狀態儲存失敗，請重試。");
          }
          await window._fbAuth.signInWithRedirect(provider);
          return;
        }
        throw e;
      }
      const user = toFbUser(result.user);

      const { storeData: cloudData } = await downloadFb(user.uid);

      if (cloudData && cloudData.entries) {
        const doImport = window.confirm(
          "發現已有 Google 帳戶備份資料。\n\n按「確定」→ 導入雲端資料（覆蓋本機）\n按「取消」→ 以本機資料覆蓋雲端"
        );
        if (doImport) {
          normalizeStore(cloudData);
          justImportedRef.current = true;
          setStore(cloudData);
        } else {
          await uploadFb(user.uid, storeRef.current);
        }
        const now = new Date();
        setFbUser(user); setLastSync(now);
        if (!doImport) setLastUpload(now);
        setStartupDone(true);
        persistState(user, now, doImport ? lastUpload : now);
        alert("✅ " + (doImport ? "已導入雲端資料，" : "已上傳本機資料，") + "Google 自動同步已啟用！");
      } else {
        await uploadFb(user.uid, storeRef.current);
        const now = new Date();
        setFbUser(user); setLastSync(now); setLastUpload(now);
        setStartupDone(true);
        persistState(user, now, now);
        alert("✅ 已建立 Google 雲端備份並啟用自動同步！\n\n換機時以同一 Google 帳號登入即可恢復資料。");
      }
    } catch(e) {
      if (e.code !== "auth/popup-closed-by-user") {
        setSyncError(e.message);
        alert("❌ Google 登入失敗：" + (e.message || "未知錯誤"));
      }
    } finally { setSyncing(false); }
  };

  const disconnect = () => {
    if (!window.confirm("確定斷開 Google 同步？（本機資料保留，雲端備份不刪除）")) return;
    setFbUser(null); setLastSync(null); setLastUpload(null); setSyncError(null);
    setStartupDone(false);
    justImportedRef.current = false;
    startupJustSyncedRef.current = false;
    try { localStorage.removeItem(FB_STATE_KEY); } catch(e) {
      reportError("Google 同步狀態清除失敗", e);
    }
    window._fbAuth?.signOut?.().catch(e => reportError("Google 登出失敗", e));
  };

  const syncNow = async () => {
    if (!fbUser) { alert("尚未連接 Google 同步"); return; }
    setSyncing(true); setSyncError(null);
    try {
      await loadFirebase();
      await uploadFb(fbUser.uid, storeRef.current);
      const now = new Date();
      setLastSync(now); setLastUpload(now);
      persistState(fbUser, now, now);
    } catch(e) {
      setSyncError(e.message);
    } finally { setSyncing(false); }
  };

  // ── Startup sync — loads Firebase then syncs once on mount ──────────────
  const startupRanRef = useRef(false);
  useEffect(() => {
    if (!fbUser) {
      startupRanRef.current = false;
      setStartupDone(false);
      return;
    }
    if (startupRanRef.current === fbUser.uid) return;
    startupRanRef.current = fbUser.uid;
    let alive = true;
    (async () => {
      try {
        setSyncing(true); setSyncError(null);
        await loadFirebase();
        const { storeData: cloudData, syncedAt: cloudSyncedAt } = await downloadFb(fbUser.uid);
        if (!alive) return;

        if (!cloudData || !cloudData.entries) {
          await uploadFb(fbUser.uid, storeRef.current);
          if (alive) { const now=new Date(); setLastSync(now); setLastUpload(now); startupJustSyncedRef.current=true; setStartupDone(true); persistState(fbUser,now,now); }
          return;
        }

        const cloudModMs = dateToMs(cloudData._lastModified) || dateToMs(cloudSyncedAt);
        const localModMs = dateToMs(storeRef.current._lastModified) || dateToMs(saved?.lastSync);
        const cloudIsNewer = cloudModMs > localModMs;

        if (cloudIsNewer) {
          normalizeStore(cloudData);
          justImportedRef.current = true;
          if (alive) setStore(cloudData);
        } else {
          if (alive) await uploadFb(fbUser.uid, storeRef.current);
        }
        if (alive) {
          const now = new Date();
          setLastSync(now);
          if (!cloudIsNewer) setLastUpload(now);
          startupJustSyncedRef.current = true;
          setStartupDone(true);
          persistState(fbUser, now, cloudIsNewer ? lastUpload : now);
        }
      } catch(e) {
        if (alive) setSyncError(e.message || "啟動同步失敗");
        if (alive) { startupJustSyncedRef.current = true; setStartupDone(true); }
      } finally { if (alive) setSyncing(false); }
    })();
    return () => { alive = false; };
  }, [fbUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounce upload ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!fbUser) return;
    if (!startupDone) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || justImportedRef.current) { justImportedRef.current = false; return; }
      if (startupJustSyncedRef.current) { startupJustSyncedRef.current = false; return; }
      try {
        setSyncing(true); setSyncError(null);
        await loadFirebase();
        await uploadFb(fbUser.uid, storeRef.current);
        if (!cancelled) { const now=new Date(); setLastSync(now); setLastUpload(now); persistState(fbUser,now,now); }
      } catch(e) { if (!cancelled) setSyncError(e.message || "同步失敗"); }
      finally { if (!cancelled) setSyncing(false); }
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [store, fbUser, startupDone]); // eslint-disable-line react-hooks/exhaustive-deps

  return { fbUser, lastSync, lastUpload, syncing, syncError, connect, disconnect, syncNow };
}
// ===================== End GitHub Gist Sync =====================


const DEFAULT_EXPENSE_CATS = [
  // 飲食
  { id:"food",      name:"飲食",           icon:"🍜", color:"#FFB4A2" },
  { id:"breakfast", name:"早餐",           icon:"🌅", color:"#FDBA74", parentId:"food" },
  { id:"lunch",     name:"午餐",           icon:"🍱", color:"#FFB4A2", parentId:"food" },
  { id:"dinner",    name:"晚餐",           icon:"🍽️", color:"#F87171", parentId:"food" },
  { id:"drink",     name:"飲品",           icon:"🧋", color:"#9BD1E5", parentId:"food" },
  { id:"snack",     name:"零食",           icon:"🍬", color:"#FCD34D", parentId:"food" },
  { id:"alcohol",   name:"酒類",           icon:"🍺", color:"#B5A6F5", parentId:"food" },
  { id:"grocery",   name:"食材雜貨",       icon:"🥬", color:"#86EFAC", parentId:"food" },
  // 日常消費
  { id:"daily",     name:"日常消費",       icon:"🛒", color:"#F7C873" },
  { id:"transit",   name:"交通費",         icon:"🚆", color:"#9BD1E5", parentId:"daily" },
  { id:"shop",      name:"服裝",           icon:"👕", color:"#F5A6C9", parentId:"daily" },
  { id:"fun",       name:"娛樂",           icon:"🎮", color:"#B5A6F5", parentId:"daily" },
  { id:"med",       name:"健康",           icon:"🏥", color:"#F29E9E", parentId:"daily" },
  { id:"home",      name:"日常用品",       icon:"🧴", color:"#FBBF24", parentId:"daily" },
  { id:"edu",       name:"學習/工作用品",  icon:"📚", color:"#C9A0DC", parentId:"daily" },
  { id:"pickup",    name:"取貨費",         icon:"📦", color:"#CBD5E1", parentId:"daily" },
  // 人際社交
  { id:"social",    name:"人際社交",       icon:"👥", color:"#F5A6C9" },
  { id:"family",    name:"家人",           icon:"🏠", color:"#F5A6C9", parentId:"social" },
  { id:"friend",    name:"朋友",           icon:"👫", color:"#FDA4AF", parentId:"social" },
  { id:"coworker",  name:"同事",           icon:"🤝", color:"#FBBF24", parentId:"social" },
  // 水電雜費
  { id:"util",      name:"水電雜費",       icon:"💡", color:"#A7E0A0" },
  { id:"bill",      name:"電費",           icon:"⚡", color:"#A7E0A0", parentId:"util" },
  { id:"water",     name:"水費",           icon:"💧", color:"#7DD3FC", parentId:"util" },
  { id:"gasfee",    name:"煤氣費",         icon:"🔥", color:"#FF7043", parentId:"util" },
  { id:"tel",       name:"通訊費",         icon:"📱", color:"#8BCEC2", parentId:"util" },
  // 其他
  { id:"other_e",   name:"其他",           icon:"💸", color:"#CBD5E1" },
];
const DEFAULT_INCOME_CATS = [
  { id:"salary_g",  name:"薪酬",     icon:"💼", color:"#36B7C6" },
  { id:"salary",    name:"月薪",     icon:"💰", color:"#36B7C6", parentId:"salary_g" },
  { id:"bonus",     name:"獎金",     icon:"🎁", color:"#5AC8A6", parentId:"salary_g" },
  { id:"misc_i",    name:"額外收入", icon:"✨", color:"#7BC67E" },
  { id:"invest",    name:"投資",     icon:"📈", color:"#7BC67E", parentId:"misc_i" },
  { id:"refund",    name:"退款",     icon:"💰", color:"#F2C94C", parentId:"misc_i" },
  { id:"other_i",   name:"其他",     icon:"💵", color:"#CBD5E1", parentId:"misc_i" },
];

const weekdayZH = ["日","一","二","三","四","五","六"];
const pad2 = n => String(n).padStart(2,"0");
const toISO = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const parseISO = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const monthKey = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
const sameMonth = (iso, ym) => iso.startsWith(ym);
const shiftMonth = (set, cur, delta) => {
  const [y,m] = cur.split("-").map(Number);
  const d = new Date(y, m-1+delta, 1);
  set(monthKey(d));
};

/* ===================== 儲存 ===================== */
const STORE_KEY = "zaim_store_v3";
const defaultStore = () => ({
  entries: [],
  categories: { expense: DEFAULT_EXPENSE_CATS, income: DEFAULT_INCOME_CATS },
  budgets: {},
  totalBudget: 0,
  settings: { baseCurrency:"MOP", rates: DEFAULT_RATES },
});
// Ensure all required fields exist (used after load or cloud import)
const DEFAULT_LAYOUT = {
  home: [
    {id:"monthly_summary",visible:true},
    {id:"expense_overview",visible:true},
    {id:"entry_list",visible:true},
  ],
  cal: [{id:"day_entries",visible:true}],
  chart: [
    {id:"trend",visible:true},
    {id:"donut",visible:true},
    {id:"breakdown",visible:true},
    {id:"budget",visible:true},
  ],
};
const normalizeStore = (s) => {
  if (!s.totalBudget) s.totalBudget = 0;
  if (!s.budgets) s.budgets = {};
  if (s.budgetInBalance == null) s.budgetInBalance = false;
  if (!s.monthlyBudgets) s.monthlyBudgets = {};
  if (s.useMonthlyBudget == null) s.useMonthlyBudget = false;
  if (!s.categories?.expense) s.categories = defaultStore().categories;
  if (!s.settings) s.settings = defaultStore().settings;
  if (s.settings.noDecimals == null) s.settings.noDecimals = false;
  if (s.settings.weekStart == null) s.settings.weekStart = "mon";
  if (!s.layout) {
    s.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  } else {
    Object.keys(DEFAULT_LAYOUT).forEach(tab => {
      if (!s.layout[tab]) s.layout[tab] = JSON.parse(JSON.stringify(DEFAULT_LAYOUT[tab]));
      else DEFAULT_LAYOUT[tab].forEach(def => {
        if (!s.layout[tab].find(item => item.id === def.id)) s.layout[tab].push({...def});
      });
    });
  }
  return s;
};
const dateToMs = s => s ? new Date(s).getTime() : 0;
const loadStore = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultStore();
    return normalizeStore(JSON.parse(raw));
  } catch { return defaultStore(); }
};
const saveStore = s => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    return true;
  } catch(e) {
    reportError("本機資料儲存失敗", e, "資料未能儲存到本機，請先匯出備份再清理瀏覽器空間。");
    return false;
  }
};

/* ===================== 金額格式化 ===================== */
const toBase = (amount, currency, rates, base) => amount * (rates[currency]||1) / (rates[base]||1);
// Use locked baseAmount if present (set at entry time), else calculate live
const eBase = (e, rates, base) => e.baseAmount != null ? e.baseAmount : toBase(e.amount, e.currency, rates, base);
const evalExpr = (expr) => {
  try {
    const s = (expr||"").replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/＋/g,'+');
    const tokens = s.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
    if (!tokens) return null;
    const nums = [], ops = [];
    for (const tok of tokens) {
      if (/[\d.]/.test(tok[0])) { const n=parseFloat(tok); if(isNaN(n)) return null; nums.push(n); }
      else ops.push(tok);
    }
    if (nums.length === 0 || nums.length !== ops.length + 1) return null;
    let i = 0;
    while (i < ops.length) {
      if (ops[i]==='*'||ops[i]==='/') {
        const r = ops[i]==='*' ? nums[i]*nums[i+1] : nums[i]/nums[i+1];
        nums.splice(i,2,r); ops.splice(i,1);
      } else i++;
    }
    let r = nums[0];
    for (let j=0;j<ops.length;j++) r = ops[j]==='+'?r+nums[j+1]:r-nums[j+1];
    return isFinite(r)&&!isNaN(r)&&r>0 ? Math.round(r*10000)/10000 : null;
  } catch { return null; }
};
const fmt = (v, currency, nd=false) => {
  const cur = CURRENCIES.find(c=>c.code===currency) || CURRENCIES[0];
  const n = nd ? Math.trunc(Math.abs(v)) : Math.abs(v);
  return `${cur.symbol} ${n.toLocaleString("en-US", {minimumFractionDigits:0, maximumFractionDigits:nd?0:2})}`;
};

/* ===================== Zaim CSV 導入 ===================== */
const CSV_CAT_COLORS = ["#FFB4A2","#9BD1E5","#F5A6C9","#B5A6F5","#F7C873","#A7E0A0","#F29E9E","#8BCEC2","#C9A0DC","#CBD5E1"];
function parseCSVRow(line) {
  const cols=[]; let cur="",inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){inQ=!inQ;}
    else if(ch===','&&!inQ){cols.push(cur.trim());cur="";}
    else{cur+=ch;}
  }
  cols.push(cur.trim());
  return cols;
}
function importZaimCSV(text, store) {
  // Zaim CSV format:
  // 日付(0), 方法(1), カテゴリ(2), カテゴリの内訳(3), 支払元(4), 入金先(5),
  // 品目(6), メモ(7), お店(8), 通貨(9), 収入(10), 支出(11), 振替(12), 残高調整(13), ...
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  if (lines.length < 2) return null;
  const newEntries = [];
  const catColorMap = {};
  let colorIdx = 0;
  const expCats = [...store.categories.expense];
  const incCats = [...store.categories.income];
  let imported = 0;
  for (let i=1;i<lines.length;i++) {
    const cols = parseCSVRow(lines[i]);
    if (cols.length < 12) continue;
    const date     = cols[0];
    const catName  = cols[2];
    const subName  = cols[3];
    const itemName = cols[6];
    const memoStr  = cols[7];
    const shopName = cols[8];
    const currency = cols[9] || "MOP";
    const incAmt   = parseFloat(cols[10]) || 0;
    const expAmt   = parseFloat(cols[11]) || 0;
    const transfer = parseFloat(cols[12]) || 0;

    // Skip transfer/adjustment entries
    if (transfer > 0) continue;
    if (incAmt === 0 && expAmt === 0) continue;

    const entryType = incAmt > 0 ? "income" : "expense";
    const amount    = entryType === "income" ? incAmt : expAmt;
    // memo = itemName or memoStr or shopName
    const memo = [itemName, memoStr, shopName].filter(s=>s&&s!=="-"&&s!=="").join(" ").trim();

    const cats = entryType==="income" ? incCats : expCats;
    // Match parent category by name
    let parentCat = cats.find(c=>!c.parentId && c.name===catName);
    if (!parentCat && catName && catName!=="-") {
      const color = catColorMap[catName] || CSV_CAT_COLORS[colorIdx++ % CSV_CAT_COLORS.length];
      catColorMap[catName] = color;
      const safeId = "csv_p_"+catName.replace(/[^\w]/g,"_")+"_"+Date.now();
      parentCat = {id:safeId, name:catName, icon:"📌", color, parentId:null};
      cats.push(parentCat);
    }
    let catId = parentCat ? parentCat.id : (entryType==="expense" ? "other_e" : "other_i");
    // Match sub-category
    if (subName && subName!=="-" && parentCat) {
      let subCat = cats.find(c=>c.parentId===parentCat.id && c.name===subName);
      if (!subCat) {
        const safeSubId = "csv_s_"+subName.replace(/[^\w]/g,"_")+"_"+Date.now()+"_"+i;
        subCat = {id:safeSubId, name:subName, icon:"📌", color:parentCat.color, parentId:parentCat.id};
        cats.push(subCat);
      }
      catId = subCat.id;
    }
    newEntries.push({
      id: Date.now()+"_csv_"+i,
      date, type:entryType, category:catId, amount, currency, memo
    });
    imported++;
  }
  return {
    entries: [...store.entries, ...newEntries],
    categories: { expense: expCats, income: incCats },
    imported,
  };
}

/* ===================== UI 小組件 ===================== */
/* ===================== CSV 匯出 / 匯入 ===================== */
const csvEscape = value => {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCSV(store) {
  const catMap = [...store.categories.expense,...store.categories.income].reduce((m,c)=>{m[c.id]=c;return m;},{});
  const rows = store.entries.map(e=>{
    const cat=catMap[e.category]||{name:"未分類"};
    return [e.date, e.type==="expense"?"支出":"收入", e.amount, e.currency, cat.name, e.memo||""].map(csvEscape).join(",");
  });
  return [["日期","類型","金額","幣種","分類","備注"].map(csvEscape).join(","),...rows].join("\n");
}
function importOurCSV(text, store) {
  const lines = text.trim().split(/\r?\n/);
  if(lines.length<2) return null;
  if(!lines[0].includes("日期")||!lines[0].includes("金額")) return null;
  const catMap = [...store.categories.expense,...store.categories.income].reduce((m,c)=>{m[c.name]=c;return m;},{});
  const entries=[...store.entries]; let imported=0;
  for(let i=1;i<lines.length;i++){
    const cols=parseCSVRow(lines[i]);
    if(cols.length<4) continue;
    const [date,typeStr,amtStr,currency,catName,memo]=cols;
    const amount=parseFloat(amtStr); if(isNaN(amount)||!date) continue;
    const type=typeStr==="收入"?"income":"expense";
    const cat=catMap[catName?.trim()];
    entries.push({id:`imp_${Date.now()}_${i}`,date,type,amount,currency:currency?.trim()||"MOP",category:cat?.id||"",memo:memo?.trim()||""});
    imported++;
  }
  return {entries,categories:store.categories,imported};
}

/* ── 撤銷刪除 Toast ── */
function UndoToast({onUndo, onDismiss}) {
  useEffect(()=>{ const t=setTimeout(onDismiss,5000); return()=>clearTimeout(t); },[onDismiss]);
  return (
    <div className="fixed bottom-28 left-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg fade-in"
      style={{transform:"translateX(-50%)",background:"#1f2937",color:"#f9fafb",whiteSpace:"nowrap"}}>
      <span className="text-sm">已刪除記帳</span>
      <button onClick={onUndo} className="text-sm font-bold" style={{color:"var(--brand)"}}>撤銷</button>
    </div>
  );
}

/* ── 金額變化動畫 ── */
function AnimatedAmount({value, className, style}) {
  const prev = useRef(value);
  const [key, setKey] = useState(0);
  useEffect(()=>{ if(prev.current!==value){ prev.current=value; setKey(k=>k+1); } },[value]);
  return <span key={key} className={`amount-change ${className||""}`} style={style}>{value}</span>;
}

/* ── 月份選擇器 ── */
function MonthPicker({value, onChange, onClose}) {
  const [y,m] = value.split("-").map(Number);
  const [pickY, setPickY] = useState(y);
  const now = new Date();
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{background:"rgba(0,0,0,0.4)"}} onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl pb-safe sheet-bottom" onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mt-3 mb-4"/>
        <div className="flex items-center justify-between px-6 mb-4">
          <button onClick={()=>setPickY(y=>y-1)} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="text-base font-bold">{pickY} 年</span>
          <button onClick={()=>setPickY(y=>y+1)} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"
            disabled={pickY>=now.getFullYear()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 px-4 pb-6">
          {monthNames.map((ml,i)=>{
            const mv=`${pickY}-${String(i+1).padStart(2,"0")}`;
            const isActive=mv===value;
            const isFuture=pickY>now.getFullYear()||(pickY===now.getFullYear()&&i+1>now.getMonth()+1);
            return (
              <button key={i} onClick={()=>{ if(!isFuture){onChange(mv);onClose();} }}
                className={`py-3 rounded-2xl text-sm font-semibold transition-all ${isActive?"text-white":isFuture?"text-gray-200":"text-gray-600 bg-gray-50 active:bg-gray-100"}`}
                style={isActive?{background:"var(--brand)"}:{}}>
                {ml}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryPill({label, value, color}) {
  return (
    <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className={`text-sm font-semibold amount-font truncate ${color}`}>{value}</div>
    </div>
  );
}
const TAB_ICONS = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  cal:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  chart:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  fun:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  set:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
};
function TabBtn({active, onClick, iconKey, label}) {
  return (
    <button onClick={onClick} className="tab-btn flex flex-col items-center justify-center gap-0.5">
      <div className={`transition-colors ${active?"text-[color:var(--brand)]":"text-gray-400"}`}>{TAB_ICONS[iconKey]}</div>
      <div className={`text-[10px] font-medium transition-colors ${active?"text-[color:var(--brand)]":"text-gray-400"}`}>{label}</div>
    </button>
  );
}

/* ===================== SortableList (pointer-events drag) ===================== */
function SortableList({ items, renderItem, onReorder, itemHeight = 68 }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const pointerStartY = useRef(null);

  const commit = useCallback((from, to) => {
    setDragIdx(null); setOverIdx(null);
    if (from !== null && to !== null && from !== to) onReorder(from, to);
  }, [onReorder]);

  const handlePointerDown = (e, idx) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartY.current = e.clientY;
    setDragIdx(idx); setOverIdx(idx);
  };
  const handlePointerMove = (e, idx) => {
    if (dragIdx === null || dragIdx !== idx) return;
    e.preventDefault();
    const dy = e.clientY - pointerStartY.current;
    setOverIdx(Math.max(0, Math.min(items.length-1, dragIdx + Math.round(dy/itemHeight))));
  };
  const handlePointerUp = (e, idx) => {
    if (dragIdx === null || dragIdx !== idx) return;
    commit(dragIdx, overIdx);
  };

  const getStyle = (i) => {
    if (dragIdx === null) return { transform:"translateY(0)", transition:"transform 0.18s ease", position:"relative", zIndex:0, opacity:1 };
    if (i === dragIdx) return { transform:`translateY(${(overIdx-dragIdx)*itemHeight}px)`, zIndex:20, opacity:0.88, boxShadow:"0 8px 28px rgba(0,0,0,0.18)", borderRadius:"16px", transition:"box-shadow 0.1s", position:"relative" };
    const dir = overIdx > dragIdx ? 1 : -1;
    const inRange = dir===1 ? (i>dragIdx&&i<=overIdx) : (i<dragIdx&&i>=overIdx);
    return { transform: inRange ? `translateY(${-dir*itemHeight}px)` : "translateY(0)", transition:"transform 0.18s ease", position:"relative", zIndex:0, opacity:1 };
  };

  return (
    <div style={{position:"relative"}}>
      {items.map((item, i) => (
        <div key={item.id} style={getStyle(i)}>
          {renderItem(item, i, {
            handlePointerDown: e => handlePointerDown(e, i),
            handlePointerMove: e => handlePointerMove(e, i),
            handlePointerUp:   e => handlePointerUp(e, i),
            isDragging: dragIdx === i,
          })}
        </div>
      ))}
    </div>
  );
}

/* ===================== Swipe / Back helpers ===================== */
// Named back-navigation layers — priority order is fixed (index 0 = highest).
// Each slot holds at most one handler. consumeBack fires the highest-priority
// active layer, so push ordering never matters.
const _layers = { calcPad:null, entryModal:null, chartPanel:null, chartSub:null, settingsTab:null, goHome:null };
const _layerOrder = ['calcPad','entryModal','chartPanel','chartSub','settingsTab','goHome'];
const setLayer   = (name, fn) => { _layers[name] = fn; };
const clearLayer = (name)     => { _layers[name] = null; };
const consumeBack = () => {
  for (const name of _layerOrder) {
    if (_layers[name]) { const fn=_layers[name]; _layers[name]=null; fn(); return true; }
  }
  return false;
};

function useSwipeNav({onSwipeLeft, onSwipeRight, onBack}={}) {
  const t0   = useRef(null);
  const cbL  = useRef(onSwipeLeft);
  const cbR  = useRef(onSwipeRight);
  const cbB  = useRef(onBack);
  useEffect(() => { cbL.current=onSwipeLeft; cbR.current=onSwipeRight; cbB.current=onBack; });
  const onTouchStart = useCallback(e => {
    const t = e.touches[0];
    t0.current = {x:t.clientX, y:t.clientY, edge:t.clientX<28};
  }, []);
  // touchend on document so it fires even if finger slides off the element
  useEffect(() => {
    const onEnd = (e) => {
      if(!t0.current) return;
      const s=t0.current; t0.current=null;
      const dx=e.changedTouches[0].clientX-s.x;
      const dy=e.changedTouches[0].clientY-s.y;
      if(Math.abs(dx)<52||Math.abs(dy)>Math.abs(dx)*0.75) return;
      if(dx>0){ if(s.edge&&cbB.current){cbB.current();return;} cbR.current?.(); }
      else { cbL.current?.(); }
    };
    document.addEventListener("touchend", onEnd);
    return () => document.removeEventListener("touchend", onEnd);
  }, []);
  return {onTouchStart};
}

function useLongPress(callback, ms=520) {
  const timer = useRef(null);
  const fired = useRef(false);
  const start = useCallback((e) => {
    fired.current = false;
    timer.current = setTimeout(()=>{ fired.current=true; try{navigator.vibrate&&navigator.vibrate(30);}catch(_){} callback(e); }, ms);
  }, [callback, ms]);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const click  = useCallback((e) => { if(fired.current) e.stopPropagation(); }, []);
  return { onPointerDown:start, onPointerUp:cancel, onPointerCancel:cancel, onPointerLeave:cancel, onClick:click };
}

/* ===================== App ===================== */
function App() {
  const [store, setStore] = useState(loadStore);
  const [appError, setAppError] = useState(null);
  const [swUpdate, setSwUpdate] = useState(null);
  const [tab, setTab] = useState("home");
  const [tabDir, setTabDir] = useState(0);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const TAB_ORDER = ["home","cal","chart","fun","set"];
  const tabRef = useRef(tab);
  const changeTab = useCallback((newTab) => {
    const cur = tabRef.current;
    if(cur===newTab) return;
    setTabDir(TAB_ORDER.indexOf(newTab)>TAB_ORDER.indexOf(cur)?1:-1);
    setTab(newTab);
  }, []);
  const [mountedTabs, setMountedTabs] = useState(()=>new Set([tab]));
  useEffect(()=>{ setMountedTabs(prev=>{ const s=new Set(prev); s.add(tab); return s; }); },[tab]);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryCloseSignal, setEntryCloseSignal] = useState(0);
  const [editing, setEditing] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => { const d=new Date(); return monthKey(d); });
  const fbDrive = useFirebaseSync(store, setStore);

  useEffect(() => { saveStore(store); }, [store]);

  useEffect(() => {
    let timer = null;
    const onAppError = e => {
      setAppError(e.detail?.message || "操作失敗，請稍後再試。");
      clearTimeout(timer);
      timer = setTimeout(() => setAppError(null), 5000);
    };
    const onSwUpdate = e => setSwUpdate(e.detail);
    window.addEventListener("akr-app-error", onAppError);
    window.addEventListener("akr-sw-update", onSwUpdate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("akr-app-error", onAppError);
      window.removeEventListener("akr-sw-update", onSwUpdate);
    };
  }, []);

  useEffect(()=>{ tabRef.current=tab; }, [tab]);

  // Register "go home" layer when on a non-home tab.
  useEffect(()=>{
    if(tab==="home"){ clearLayer('goHome'); return; }
    setLayer('goHome', ()=>changeTab("home"));
  }, [tab, changeTab]);

  // handleBack is a pure stack consumer — all layers manage themselves.
  const handleBack = useCallback(()=>{ consumeBack(); }, []);

  // PWA shortcut + notification check on first mount
  const openAddRef = useRef(null);
  useEffect(()=>{ openAddRef.current = openAdd; });
  useEffect(()=>{
    // Request persistent storage (prevents iOS from clearing localStorage)
    navigator.storage?.persist?.().catch(e => reportError("持久化儲存權限申請失敗", e));
    // Handle ?action=add from manifest shortcut
    if(new URLSearchParams(window.location.search).get("action")==="add"){
      setTimeout(()=>openAddRef.current?.(), 150);
      window.history.replaceState({},document.title,window.location.pathname);
    }
    // Notify if > 1 day without entry
    if(localStorage.getItem("akr-notify")==="1" && "Notification" in window && Notification.permission==="granted"){
      const all = loadStore().entries;
      if(all.length > 0){
        const last = all.map(e=>e.date).sort().reverse()[0];
        const days = (Date.now() - new Date(last).getTime()) / 86400000;
        if(days > 1) new Notification("AKR記帳本 提醒", {body:`你已 ${Math.floor(days)} 日未記帳，記得記低每日支出！`, icon:"./icon-192.png"});
      }
    }
    // Auto-fetch rates once per day
    const todayKey = new Date().toISOString().slice(0,10);
    if(localStorage.getItem("akr-last-rate-date") !== todayKey) {
      const initS = loadStore();
      const b = initS.settings.baseCurrency;
      fetch(`https://open.er-api.com/v6/latest/${b}`)
        .then(r=>r.json())
        .then(data=>{
          if(data.result!=="success") return;
          setStore(s=>{
            const r={...s.settings.rates};
            Object.keys(r).forEach(code=>{
              if(code===b){r[code]=1;return;}
              const v=data.rates[code];
              if(v) r[code]=Math.round((1/v)*10000)/10000;
            });
            return {...s,settings:{...s.settings,rates:r}, _lastModified:new Date().toISOString()};
          });
          try { localStorage.setItem("akr-last-rate-date",todayKey); } catch(e) {
            reportError("匯率更新日期儲存失敗", e);
          }
        })
        .catch(e => reportError("自動同步匯率失敗", e, "自動同步匯率失敗，可稍後到設定手動同步。"));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) return; // iOS: no pushState → no white-screen swipe-back issue
    history.pushState({akr:1},"");
    history.pushState({akr:2},"");
    const onPop = () => { history.pushState({akr:2},""); handleBack(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [handleBack]);

  const base = store.settings.baseCurrency;
  const rates = store.settings.rates;

  const monthEntries = useMemo(
    () => store.entries.filter(e => sameMonth(e.date, viewMonth)).sort((a,b)=> a.date<b.date?1:-1),
    [store.entries, viewMonth]
  );

  const monthTotals = useMemo(() => {
    let inc=0, exp=0;
    monthEntries.forEach(e => {
      const v = eBase(e, rates, base);
      if (e.type==="income") inc+=v; else exp+=v;
    });
    const mNum = parseInt(viewMonth.split("-")[1]);
    const tb = store.useMonthlyBudget
      ? (store.monthlyBudgets?.[mNum] || 0)
      : (store.totalBudget || 0);
    const net = (store.budgetInBalance && tb > 0) ? tb + inc - exp : inc - exp;
    return { inc, exp, net, tb };
  }, [monthEntries, rates, base, store.totalBudget, store.budgetInBalance, store.useMonthlyBudget, store.monthlyBudgets, viewMonth]);

  const [undoEntry, setUndoEntry] = useState(null);

  const upsertEntry = (entry) => {
    setStore(s => {
      const list = [...s.entries];
      const idx = list.findIndex(x=>x.id===entry.id);
      if (idx>=0) list[idx]=entry; else list.push(entry);
      return {...s, entries:list, _lastModified: new Date().toISOString()};
    });
  };
  const removeEntry = (id) => {
    const entry = store.entries.find(e=>e.id===id);
    setStore(s => ({...s, entries:s.entries.filter(e=>e.id!==id), _lastModified: new Date().toISOString()}));
    if (entry) setUndoEntry(entry);
  };
  const undoDelete = useCallback(() => {
    if (!undoEntry) return;
    setStore(s => ({...s, entries:[...s.entries, undoEntry], _lastModified: new Date().toISOString()}));
    setUndoEntry(null);
  }, [undoEntry]);

  // Track the back-stack handler for the entry modal so we can pop it
  const openAdd  = () => { setEditing(null); setLayer('entryModal', ()=>setEntryCloseSignal(s=>s+1)); setEntryOpen(true); };
  const openEdit = (e) => { setEditing(e);   setLayer('entryModal', ()=>setEntryCloseSignal(s=>s+1)); setEntryOpen(true); };
  const openCopy = useCallback((e) => {
    setEditing({...e, id:undefined, date:toISO(new Date())});
    setLayer('entryModal', ()=>setEntryCloseSignal(s=>s+1));
    setEntryOpen(true);
  }, []);

  const handleEntryClose = useCallback(() => {
    clearLayer('entryModal');
    clearLayer('calcPad');   // in case calc pad was open when modal closed
    setEntryOpen(false);
    setEntryCloseSignal(0);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-100">
        {/* ── Sync status bar ── */}
        {(()=>{
          const fbOn  = !!fbDrive.fbUser;
          return (
            <div className="px-4 pt-2 pb-1 flex items-center justify-between border-b border-gray-50">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                {fbDrive.syncing ? <span>☁️ 同步中…</span>
                 : fbDrive.syncError ? <span className="text-amber-500">⚠️ 同步失敗</span>
                 : fbOn ? <>
                     <span style={{color:"var(--brand)"}}>☁️</span>
                     <span style={{color:"var(--brand)"}}>已同步</span>
                     {fbDrive.lastUpload && <span className="text-gray-300">{new Date(fbDrive.lastUpload).toLocaleTimeString("zh-HK",{hour:"2-digit",minute:"2-digit"})}</span>}
                   </>
                 : <span>☁️ 未啟用同步</span>}
              </div>
              <div className="flex items-center gap-2">
                {fbOn && <span className="text-xs text-gray-300 max-w-[100px] truncate">{fbDrive.fbUser.email?.split("@")[0]}</span>}
              </div>
            </div>
          );
        })()}
        {/* ── Month nav / Tab title ── */}
        {tab==="set"||tab==="fun" ? (
          <div className="px-4 py-2 text-center">
            <div className="text-base font-bold">{tab==="set"?"設定":"趣味玩法"}</div>
          </div>
        ) : (
          <div className="px-4 py-1.5 flex items-center justify-between">
            <button onClick={()=>shiftMonth(setViewMonth,viewMonth,-1)} className="w-9 h-9 rounded-full active:bg-gray-100 text-gray-400 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="text-center active:opacity-60" onClick={()=>setMonthPickerOpen(true)}>
              <div className="text-base font-bold tracking-wide">{viewMonth.replace("-"," 年 ")} 月 ▾</div>
            </button>
            <button onClick={()=>shiftMonth(setViewMonth,viewMonth,+1)} className="w-9 h-9 rounded-full active:bg-gray-100 text-gray-400 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}
      </header>

      <main className="safe-bottom" style={{overflow:"hidden"}} {...useSwipeNav({onBack: handleBack})}>
        {["home","cal","chart","fun","set"].map(t=>(
          <div key={t}
            className={tab===t?(tabDir>0?"tab-slide-right":tabDir<0?"tab-slide-left":""):""}
            style={{display:tab===t?"":"none"}}>
            {mountedTabs.has(t)&&(
              <>
                {t==="home"  && <HomeView store={store} rates={rates} base={base} entries={monthEntries} onEdit={openEdit} onDelete={removeEntry} onCopy={openCopy} monthTotals={monthTotals} viewMonth={viewMonth}/>}
                {t==="cal"   && <CalendarView store={store} rates={rates} base={base} viewMonth={viewMonth} entries={monthEntries} onEdit={openEdit}/>}
                {t==="chart" && <ChartView store={store} rates={rates} base={base} entries={monthEntries} allEntries={store.entries} viewMonth={viewMonth} onEdit={openEdit}/>}
                {t==="fun"   && <FunView store={store}/>}
                {t==="set"   && <SettingsView store={store} setStore={setStore} fbDrive={fbDrive}/>}
              </>
            )}
          </div>
        ))}
      </main>

      <button onClick={openAdd} className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center active:scale-90 transition-transform duration-100" style={{background:"linear-gradient(135deg,var(--brand-from),var(--brand-to))",color:"white",boxShadow:"0 6px 24px var(--brand-glow)"}} aria-label="新增記帳">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="28" height="28"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 z-10">
        <div className="grid grid-cols-5 h-16" style={{paddingBottom:"env(safe-area-inset-bottom)"}}>
          <TabBtn active={tab==="home"}  onClick={()=>changeTab("home")}  iconKey="home"  label="首頁" />
          <TabBtn active={tab==="cal"}   onClick={()=>changeTab("cal")}   iconKey="cal"   label="月曆" />
          <TabBtn active={tab==="chart"} onClick={()=>changeTab("chart")} iconKey="chart" label="圖表" />
          <TabBtn active={tab==="fun"}   onClick={()=>changeTab("fun")}   iconKey="fun"   label="趣味" />
          <TabBtn active={tab==="set"}   onClick={()=>changeTab("set")}   iconKey="set"   label="設定" />
        </div>
      </nav>

      {entryOpen && (
        <EntryModal
          entry={editing}
          store={store}
          base={base}
          rates={rates}
          onSave={e=>{upsertEntry(e);handleEntryClose();}}
          onDelete={id=>{removeEntry(id);handleEntryClose();}}
          onClose={handleEntryClose}
          closeSignal={entryCloseSignal}
        />
      )}
      {monthPickerOpen && (
        <MonthPicker value={viewMonth} onChange={setViewMonth} onClose={()=>setMonthPickerOpen(false)}/>
      )}
      {undoEntry && (
        <UndoToast onUndo={undoDelete} onDismiss={()=>setUndoEntry(null)}/>
      )}
      {appError && (
        <div className={`fixed left-4 right-4 ${swUpdate ? "bottom-40" : "bottom-24"} z-[70] bg-red-500 text-white rounded-xl shadow-lg px-4 py-3 text-sm`}>
          {appError}
        </div>
      )}
      {swUpdate && (
        <div className="fixed left-4 right-4 bottom-24 z-[80] bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm">有新版本可以使用。</span>
          <button onClick={swUpdate.reload} className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-gray-900 text-sm font-semibold">
            重新載入
          </button>
        </div>
      )}
    </div>
  );
}

/* ===================== 首頁 ===================== */
function EntryItem({e, cat, base, rates, onEdit, onCopy, onDelete, nd=false}) {
  const lp = useLongPress(useCallback(()=>onCopy&&onCopy(e),[e,onCopy]));
  const [swipeX, setSwipeX] = useState(0);
  const [delConfirm, setDelConfirm] = useState(false);
  const startX = useRef(null);
  const DELETE_W = 76;
  const onTouchStart = useCallback(ev=>{ startX.current=ev.touches[0].clientX; },[]);
  const onTouchMove  = useCallback(ev=>{
    if(startX.current===null) return;
    const dx=ev.touches[0].clientX-startX.current;
    if(dx<0){ setSwipeX(Math.max(dx,-DELETE_W)); }
    else if(swipeX<0){ setSwipeX(0); }
  },[swipeX]);
  const onTouchEnd   = useCallback(()=>{
    setSwipeX(s=>s<-DELETE_W/2?-DELETE_W:0);
    startX.current=null;
  },[]);
  const handleClick  = useCallback(()=>{ if(swipeX<-8){setSwipeX(0);}else{onEdit(e);} },[swipeX,e,onEdit]);
  return (
    <>
    <ConfirmDialog open={delConfirm} title="刪除記錄" message="確定刪除此筆記帳？此操作無法還原。"
      confirmLabel="刪除" danger={true}
      onConfirm={()=>{ setDelConfirm(false); onDelete&&onDelete(e.id); }}
      onCancel={()=>{ setDelConfirm(false); setSwipeX(0); }}/>
    <li className="relative overflow-hidden border-t border-gray-50" style={{background:"#EF4444"}}>
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center px-5"
        onClick={()=>setDelConfirm(true)}>
        <span className="text-white text-sm font-semibold">刪除</span>
      </div>
      <div {...lp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={handleClick}
        className="px-4 py-3 flex items-center gap-3 select-none bg-white"
        style={{transform:`translateX(${swipeX}px)`,transition:startX.current?"none":"transform .2s ease",touchAction:"pan-y"}}>
        <div className="w-10 h-10 rounded-full grid place-items-center text-lg flex-shrink-0" style={{background:cat.color+"55"}}>{cat.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{cat.name}{e.memo?` · ${e.memo}`:""}</div>
          <div className="text-[11px] text-gray-400">{e.currency}{e.currency!==base?" → "+base:""}</div>
        </div>
        <div className={`text-sm font-semibold amount-font flex-shrink-0 text-right ${e.type==="income"?"text-[color:var(--income)]":"text-[color:var(--expense)]"}`}>
          <div>{e.type==="income"?"+":"-"}{fmt(e.amount,e.currency,nd)}</div>
          {e.currency!==base&&<div className="text-[11px] font-normal text-gray-400">({e.type==="income"?"+":"-"}{fmt(eBase(e,rates,base),base,nd)})</div>}
        </div>
      </div>
    </li>
    </>
  );
}

function MiniDonut({topP,topCatMap,total,base,nd}) {
  const [selId,setSelId]=useState(null);
  const size=132,r=46,strokeW=18,circ=2*Math.PI*r;
  const labelR=r+strokeW/2+10;
  let acc=0,lAcc=0;
  const segs=topP.map((c,i)=>{
    const amt=topCatMap[c.id]||0,frac=amt/total;
    const midAng=((lAcc+frac/2)*360-90)*Math.PI/180;
    const rot=(acc/total)*360-90;
    const ringX=size/2+(r+strokeW/2)*Math.cos(midAng);
    const ringY=size/2+(r+strokeW/2)*Math.sin(midAng);
    const lx=size/2+labelR*Math.cos(midAng);
    const ly=size/2+labelR*Math.sin(midAng);
    acc+=amt; lAcc+=frac;
    return {c,amt,frac,rot,ringX,ringY,lx,ly,showLabel:i<4};
  });
  const sel=selId?topP.find(c=>c.id===selId):null;
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{overflow:"visible"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#F1F1F4" strokeWidth={strokeW}/>
        {segs.map(({c,frac,rot,ringX,ringY,lx,ly,showLabel})=>(
          <g key={c.id} style={{cursor:"pointer"}} onClick={()=>setSelId(selId===c.id?null:c.id)}>
            <circle cx={size/2} cy={size/2} r={r} fill="none"
              stroke={c.color} strokeWidth={selId===c.id?strokeW+10:strokeW}
              strokeDasharray={`${frac*circ} ${circ}`} strokeDashoffset="0"
              opacity={selId&&selId!==c.id?0.3:1}
              transform={`rotate(${rot} ${size/2} ${size/2})`}
              style={{transition:"all .15s ease"}}/>
            {showLabel&&frac>=0.05&&!selId&&lx>=size/2&&(
              <g>
                <line x1={ringX} y1={ringY} x2={lx} y2={ly} stroke={c.color} strokeWidth="1" opacity="0.7"/>
                <text x={lx+2} y={ly} textAnchor="start" dominantBaseline="middle"
                  fontSize="8" fontWeight="600" fill={c.color}>{c.name}</text>
              </g>
            )}
          </g>
        ))}
      </svg>
      <div style={{position:"absolute",top:0,left:0,width:size,height:size,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
        {sel&&<>
          <div style={{fontSize:9,color:'#888',maxWidth:60,textAlign:"center",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{sel.icon} {sel.name}</div>
          <div style={{fontSize:13,fontWeight:"bold",color:sel.color}} className="amount-font">{fmt(topCatMap[sel.id]||0,base,nd)}</div>
          <div style={{fontSize:9,color:'#aaa'}}>{Math.round((topCatMap[sel.id]||0)/total*100)}%</div>
        </>}
      </div>
    </div>
  );
}

function HomeView({store, rates, base, entries, onEdit, onDelete, onCopy, monthTotals, viewMonth}) {
  const nd = store.settings?.noDecimals||false;

  // 今日：每日午夜自動更新
  const [todayISO, setTodayISO] = useState(() => toISO(new Date()));
  useEffect(() => {
    const schedule = () => {
      const n = new Date();
      const midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
      return setTimeout(() => setTodayISO(toISO(new Date())), midnight - n + 100);
    };
    const t = schedule();
    return () => clearTimeout(t);
  }, [todayISO]);

  const now = new Date(todayISO);
  const weekStartSetting = store.settings?.weekStart || "mon";
  const weekStart = new Date(now);
  const dow = now.getDay(); // 0=Sun
  weekStart.setDate(now.getDate() - (weekStartSetting === "sun" ? dow : (dow + 6) % 7));
  // 本週：每週首日午夜自動更新（todayISO 更新時 weekStartISO 跟著重算）
  const weekStartISO = toISO(weekStart);

  const todayExp = useMemo(()=>entries.filter(e=>e.type==="expense"&&e.date===todayISO).reduce((s,e)=>s+eBase(e,rates,base),0),[entries,rates,base,todayISO]);
  const weekExp  = useMemo(()=>entries.filter(e=>e.type==="expense"&&e.date>=weekStartISO).reduce((s,e)=>s+eBase(e,rates,base),0),[entries,rates,base,weekStartISO]);
  const monthExp = monthTotals.exp;
  const tb = monthTotals.tb ?? 0;

  const [ymY, ymM] = viewMonth.split("-").map(Number);
  const daysInMonth = new Date(ymY, ymM, 0).getDate();
  const isCurrentMonth = viewMonth === todayISO.slice(0,7);

  // ── 預算計算 ──
  const budgetInBalance = store.budgetInBalance && tb > 0;
  const remainingBudget = tb > 0 ? (budgetInBalance ? monthTotals.net : tb - monthExp) : 0;
  const todayDate = now.getDate();
  const remainingDays = isCurrentMonth ? (daysInMonth - todayDate + 1) : daysInMonth;
  // 今日可用（動態：剩餘預算 ÷ 剩餘天數）
  const dayAllowance = tb > 0 && remainingDays > 0 ? remainingBudget / remainingDays : 0;
  const dayBudget    = tb > 0 ? tb / daysInMonth : 0;
  // 本週天數（固定）
  const weekDays = 7;
  const weekBudget = tb > 0 ? (budgetInBalance ? tb + monthTotals.inc : tb) * 7 / daysInMonth : 0;

  const expCatMap = store.categories.expense.reduce((a,c)=>{a[c.id]=c;return a;},{});
  const catMap = [...store.categories.expense,...store.categories.income].reduce((a,c)=>{a[c.id]=c;return a;},{});

  const topCatMap = useMemo(()=>{
    const map={};
    entries.filter(e=>e.type==="expense").forEach(e=>{
      const cat=expCatMap[e.category]; const topId=cat?.parentId||e.category;
      map[topId]=(map[topId]||0)+eBase(e,rates,base);
    });
    return map;
  },[entries,rates,base]);

  const topCats = store.categories.expense.filter(c=>!c.parentId&&(topCatMap[c.id]||0)>0)
    .sort((a,b)=>(topCatMap[b.id]||0)-(topCatMap[a.id]||0)).slice(0,4);

  const groups = useMemo(()=>{
    const map={};
    entries.forEach(e=>{(map[e.date]||=[]).push(e);});
    return Object.entries(map).sort((a,b)=>a[0]<b[0]?1:-1);
  },[entries]);

  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;

  const filteredGroups = useMemo(()=>{
    if(!isSearching) return groups;
    const q=search.toLowerCase();
    const srcMap={};
    store.entries.forEach(e=>{ (srcMap[e.date]||(srcMap[e.date]=[])).push(e); });
    return Object.entries(srcMap)
      .map(([date,list])=>[date,list.filter(e=>{
        const cat=catMap[e.category]||{};
        return (e.memo||"").toLowerCase().includes(q)||(cat.name||"").toLowerCase().includes(q)||String(e.amount).includes(q);
      })])
      .filter(([,list])=>list.length>0)
      .sort((a,b)=>a[0]<b[0]?1:-1);
  },[groups,search,isSearching,store.entries,catMap]);

  const PAGE=7;
  const [visibleCount,setVisibleCount]=useState(PAGE);
  const visibleGroups=filteredGroups.slice(0,visibleCount);
  const hasMore=filteredGroups.length>visibleCount;

  const [ym1,ym2] = viewMonth.split("-");

  const homeLayout = store.layout?.home || DEFAULT_LAYOUT.home;
  const renderHomeSection = (id) => {
    if (id==="monthly_summary") return (
      <div key="monthly_summary" className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-3">{ym1} 年 {ym2} 月 收支</div>
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">收入</span>
              <AnimatedAmount value={fmt(monthTotals.inc,base,nd)} className="text-sm font-semibold amount-font" style={{color:"var(--income)"}}/>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">支出</span>
              <AnimatedAmount value={fmt(monthTotals.exp,base,nd)} className="text-sm font-semibold amount-font" style={{color:"var(--expense)"}}/>
            </div>
            <div className="flex justify-between items-center border-t border-gray-100 pt-2">
              <span className="text-sm font-bold">結餘</span>
              <AnimatedAmount value={fmt(monthTotals.net,base,nd)} className={`text-base font-bold amount-font ${monthTotals.net>=0?"text-gray-800":"text-[color:var(--expense)]"}`}/>
            </div>
          </div>
          {(()=>{
            const total=Object.values(topCatMap).reduce((a,b)=>a+b,0);
            if(!total) return <div className="w-36 h-36 rounded-full bg-gray-100 grid place-items-center text-gray-400 text-xs flex-shrink-0">無支出</div>;
            const topP=store.categories.expense.filter(c=>!c.parentId&&(topCatMap[c.id]||0)>0);
            return <MiniDonut topP={topP} topCatMap={topCatMap} total={total} base={base} nd={nd}/>;
          })()}
        </div>
        {topCats.length>0&&(
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {topCats.map(c=>{
              const spent=topCatMap[c.id]||0;
              const bgt=store.budgets?.[c.id]||0;
              const over=bgt>0&&spent>bgt;
              return (
                <div key={c.id} className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${over?"bg-red-50":"bg-gray-50"}`} style={over?{color:'#374151'}:undefined}>
                  <span className="text-base">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate flex items-center gap-1">{c.name}{over&&<span className="text-red-400 text-[9px] font-bold">超支</span>}</div>
                    <div className={`text-[11px] amount-font ${over?"text-red-500":"text-[color:var(--expense)]"}`}>{fmt(spent,base,nd)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    );
    if (id==="expense_overview") return (
      <div key="expense_overview" className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-3">支出概況</div>
        {[
          {label:"本月", exp:monthExp, budget:tb,          sub:tb>0?`共 ${daysInMonth} 日`:null,                                         net:monthTotals.net},
          {label:"本週", exp:weekExp, budget:weekBudget, sub:tb>0?`共 ${weekDays} 日`:null, net:null},
          {label:"今日", exp:todayExp, budget:isCurrentMonth?dayAllowance:dayBudget,   sub:tb>0?`剩 ${remainingDays} 日均分`:null,       net:null},
        ].map(({label,exp,budget,sub,net})=>{
          const has=budget>0;
          const remain=has?(net!==null?net:budget-exp):0;
          const pct=has?Math.min(100,exp/budget*100):0, over=has&&remain<0;
          return (
            <div key={label} className="mb-4 last:mb-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-500 font-medium">{label}</span>
                  {sub&&<span className="text-[10px] text-gray-300">{sub}</span>}
                </div>
                {has
                  ? <span className={`text-base font-bold amount-font ${over?"text-[color:var(--expense)]":"text-gray-800"}`}>{over?`-${fmt(Math.abs(remain),base,nd)}`:fmt(remain,base,nd)}</span>
                  : <span className="text-base font-bold amount-font text-gray-800">{fmt(exp,base,nd)}</span>
                }
              </div>
              {has&&(
                <>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <div className="h-full rounded-full transition-all duration-500" style={{width:pct+"%",background:over?"var(--expense)":"var(--income)"}}></div>
                  </div>
                  <div className={`text-[11px] ${over?"text-[color:var(--expense)] font-semibold":"text-gray-400"}`}>
                    {over?`⚠️ 已超出預算，已用 ${fmt(exp,base,nd)}`:`已用 ${fmt(exp,base,nd)}`}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {tb===0&&<div className="mt-1 text-[11px] text-gray-400 text-center">設定總預算後可顯示剩餘可用金額</div>}
      </div>

    );
    if (id==="entry_list") return (
      <React.Fragment key="entry_list">
      <div className="flex items-center gap-2 px-1">
        <div className="flex-1 flex items-center gap-2 bg-white rounded-xl shadow-sm px-3 py-2">
          <span className="text-gray-400 text-sm">🔍</span>
          <input value={search} onChange={e=>{setSearch(e.target.value);setVisibleCount(PAGE);}}
            placeholder="搜尋備注、分類、金額…"
            className="flex-1 text-sm bg-transparent border-0 outline-none"/>
          {search&&<button onClick={()=>{setSearch("");setVisibleCount(PAGE);}} className="text-gray-300 text-lg leading-none">×</button>}
        </div>
      </div>
      {isSearching&&filteredGroups.some(([date])=>!date.startsWith(viewMonth))&&(
        <div className="text-xs text-center text-gray-400 px-1">顯示所有月份的搜尋結果</div>
      )}

      {filteredGroups.length===0?(
        <div className="flex flex-col items-center py-14 text-center px-6">
          {search ? (
            <>
              <svg viewBox="0 0 80 80" width="80" height="80" className="mb-4 opacity-20">
                <circle cx="34" cy="34" r="22" fill="none" stroke="#6B7280" strokeWidth="5"/>
                <line x1="50" y1="50" x2="68" y2="68" stroke="#6B7280" strokeWidth="5" strokeLinecap="round"/>
              </svg>
              <div className="text-base font-semibold text-gray-400 mb-1">找不到符合記帳</div>
              <div className="text-sm text-gray-300">試試其他關鍵字</div>
            </>
          ) : (
            <>
              <svg viewBox="0 0 80 80" width="80" height="80" className="mb-4 opacity-20">
                <rect x="12" y="8" width="56" height="64" rx="6" fill="none" stroke="#6B7280" strokeWidth="4"/>
                <line x1="24" y1="28" x2="56" y2="28" stroke="#6B7280" strokeWidth="3.5" strokeLinecap="round"/>
                <line x1="24" y1="40" x2="48" y2="40" stroke="#6B7280" strokeWidth="3.5" strokeLinecap="round"/>
                <line x1="24" y1="52" x2="40" y2="52" stroke="#6B7280" strokeWidth="3.5" strokeLinecap="round"/>
              </svg>
              <div className="text-base font-semibold text-gray-400 mb-1">本月尚無記錄</div>
              <div className="text-sm text-gray-300">撳右下角「+」開始記帳</div>
            </>
          )}
        </div>
      ):(
        <>
          {visibleGroups.map(([date,list])=>{
            const daySum=list.reduce((acc,e)=>{const v=eBase(e,rates,base);return e.type==="income"?acc+v:acc-v;},0);
            const d=parseISO(date);
            const diffDays=Math.round((new Date(todayISO)-new Date(date))/86400000);
            const dayLabel=diffDays===0?"今天":diffDays===1?"昨天":null;
            return (
              <div key={date} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">{date.slice(5).replace("-","/")}</span>
                    <span className="text-xs text-gray-400">週{weekdayZH[d.getDay()]}</span>
                    {dayLabel&&<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{background:"var(--brand-soft)",color:"var(--brand)"}}>{dayLabel}</span>}
                  </div>
                  <div className={`text-sm font-semibold amount-font ${daySum>=0?"text-[color:var(--income)]":"text-[color:var(--expense)]"}`}>{daySum>=0?"+":""}{fmt(daySum,base,nd)}</div>
                </div>
                <ul>
                  {list.map(e=>{
                    const cat=catMap[e.category]||{icon:"❓",name:"未分類",color:"#ddd"};
                    return <EntryItem key={e.id} e={e} cat={cat} base={base} rates={rates} onEdit={onEdit} onCopy={onCopy} onDelete={onDelete} nd={nd}/>;
                  })}
                </ul>
              </div>
            );
          })}
          {hasMore&&(
            <button onClick={()=>setVisibleCount(v=>v+PAGE)}
              className="w-full py-3 rounded-2xl bg-white shadow-sm text-sm text-gray-400 active:bg-gray-50">
              顯示更多（剩餘 {filteredGroups.length-visibleCount} 日）
            </button>
          )}
        </>
      )}
      </React.Fragment>
    );
    return null;
  };

  return (
    <div className="px-3 pt-3 space-y-3">
      {homeLayout.filter(item=>item.visible).map(item=>renderHomeSection(item.id))}
    </div>
  );
}


/* ===================== 月曆 ===================== */
function CalendarView({store, rates, base, viewMonth, entries, onEdit}) {
  const nd = store.settings?.noDecimals||false;
  const [y,m] = viewMonth.split("-").map(Number);
  const first = new Date(y,m-1,1);
  const weekStart = store.settings.weekStart || "mon";
  const startDow = weekStart==="sun" ? first.getDay() : (first.getDay()+6)%7;
  const daysInMonth = new Date(y,m,0).getDate();
  const catMap = [...store.categories.expense,...store.categories.income].reduce((a,c)=>{a[c.id]=c;return a;},{});
  const [selectedDay, setSelectedDay] = useState(()=>{
    const now=new Date();
    return (now.getFullYear()===y&&now.getMonth()+1===m)?now.getDate():null;
  });

  const dayMap = useMemo(()=>{
    const map={};
    entries.forEach(e=>{
      if(!map[e.date]) map[e.date]={inc:0,exp:0};
      const v=eBase(e,rates,base);
      if(e.type==="income") map[e.date].inc+=v; else map[e.date].exp+=v;
    });
    return map;
  },[entries,rates,base]);

  const dayEntries = useMemo(()=>{
    if(!selectedDay) return [];
    const iso=`${viewMonth}-${pad2(selectedDay)}`;
    return entries.filter(e=>e.date===iso).sort((a,b)=>a.date<b.date?1:-1);
  },[selectedDay,entries,viewMonth]);

  const cells=[];
  for(let i=0;i<startDow;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);

  return (
    <div className="px-3 pt-3">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-3">
        <div className="grid grid-cols-7 text-center border-b border-gray-100">
          {(weekStart==="sun"?["日","一","二","三","四","五","六"]:["一","二","三","四","五","六","日"]).map(d=>(
            <div key={d} className="py-2 text-xs text-gray-400">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d,i)=>{
            if(!d) return <div key={i}/>;
            const iso=`${viewMonth}-${pad2(d)}`;
            const day=dayMap[iso];
            const isToday=iso===toISO(new Date());
            const isSel=selectedDay===d;
            return (
              <button key={d} onClick={()=>setSelectedDay(isSel?null:d)}
                className={`py-1.5 flex flex-col items-center min-h-[52px] ${isSel?"bg-[color:var(--brand-soft)]":""}`}>
                <span className={`text-xs w-6 h-6 flex items-center justify-center rounded-full mb-0.5 ${isToday?"bg-[color:var(--brand)] text-white font-semibold":""}`}>{d}</span>
                {day&&(
                  <div className="flex flex-col items-center gap-0.5">
                    {day.inc>0&&<span className="text-[9px] amount-font text-[color:var(--income)]">+{Math.round(day.inc)}</span>}
                    {day.exp>0&&<span className="text-[9px] amount-font text-[color:var(--expense)]">-{Math.round(day.exp)}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay&&(store.layout?.cal??DEFAULT_LAYOUT.cal).find(i=>i.id==="day_entries")?.visible!==false&&(
        <div className="mt-3 bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-2 text-sm font-semibold" style={{background:"var(--brand-soft)"}}>
            {y}/{pad2(m)}/{pad2(selectedDay)} 明細
          </div>
          {dayEntries.length===0?(
            <div className="px-4 py-6 text-center text-gray-400 text-sm">當日沒有紀錄</div>
          ):(
            <ul>
              {dayEntries.map(e=>{
                const cat=catMap[e.category]||{icon:"❓",name:"未分類"};
                return (
                  <li key={e.id} onClick={()=>onEdit(e)} className="px-4 py-3 flex items-center gap-3 border-t border-gray-50 active:bg-gray-50">
                    <div className="text-lg">{cat.icon}</div>
                    <div className="flex-1 truncate"><div className="text-sm">{cat.name}{e.memo?` · ${e.memo}`:""}</div></div>
                    <div className={`text-sm amount-font text-right ${e.type==="income"?"text-[color:var(--income)]":"text-[color:var(--expense)]"}`}>
                      <div>{e.type==="income"?"+":"-"}{fmt(e.amount,e.currency,nd)}</div>
                      {e.currency!==base&&<div className="text-[11px] font-normal text-gray-400">({e.type==="income"?"+":"-"}{fmt(eBase(e,rates,base),base,nd)})</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 近6個月趨勢 ── */
function TrendChart({allEntries, base, rates, nd}) {
  const months = useMemo(()=>{
    const now=new Date();
    return Array.from({length:6},(_,i)=>{
      const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);
      const ym=monthKey(d);
      let inc=0,exp=0;
      allEntries.filter(e=>e.date.startsWith(ym)).forEach(e=>{
        const v=eBase(e,rates,base);
        if(e.type==="income") inc+=v; else exp+=v;
      });
      return {ym, label:`${d.getMonth()+1}月`, inc, exp};
    });
  },[allEntries,base,rates]);

  const maxVal=Math.max(...months.flatMap(m=>[m.inc,m.exp]),1);
  const H=90, BAR=18, SLOT=56;
  const W=months.length*SLOT;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="text-sm font-semibold mb-3">近 6 個月趨勢</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H+28}`} preserveAspectRatio="xMidYMid meet">
        {months.map((m,i)=>{
          const x=i*SLOT+SLOT/2;
          const iH=Math.round((m.inc/maxVal)*H);
          const eH=Math.round((m.exp/maxVal)*H);
          return (
            <g key={m.ym}>
              <rect x={x-BAR-1} y={H-iH} width={BAR} height={iH||2} rx="3" fill="var(--income)" opacity="0.65"/>
              <rect x={x+1}     y={H-eH} width={BAR} height={eH||2} rx="3" fill="var(--expense)" opacity="0.65"/>
              <text x={x} y={H+16} textAnchor="middle" fontSize="10" fill="#9CA3AF">{m.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-1">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{background:"var(--income)",opacity:.7}}/><span className="text-xs text-gray-400">收入</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{background:"var(--expense)",opacity:.7}}/><span className="text-xs text-gray-400">支出</span></div>
      </div>
    </div>
  );
}

/* ===================== 圖表 ===================== */
function ChartView({store, rates, base, entries, allEntries, viewMonth, onEdit}) {
  const nd = store.settings?.noDecimals||false;
  const [period, setPeriod] = useState("month");
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const closeCat = useCallback(()=>{ setSelectedCatId(null); setSelectedChildId(null); },[]);

  const now = new Date();

  const { rangeLabel, rangeEntries } = useMemo(()=>{
    const [ymY,ymM] = viewMonth.split("-").map(Number);
    if(period==="month"){
      const d1=`${viewMonth}-01`, d2=`${viewMonth}-${String(new Date(ymY,ymM,0).getDate()).padStart(2,"0")}`;
      return {rangeLabel:`${ymY} 年 ${ymM} 月`, rangeEntries:(allEntries||entries).filter(e=>e.date>=d1&&e.date<=d2)};
    }
    if(period==="week"){
      const ws=new Date(now); ws.setDate(now.getDate()-now.getDay());
      const we=new Date(ws); we.setDate(ws.getDate()+6);
      const d1=toISO(ws), d2=toISO(we);
      return {rangeLabel:`${d1.slice(5).replace("-","/")} ～ ${d2.slice(5).replace("-","/")}`, rangeEntries:(allEntries||entries).filter(e=>e.date>=d1&&e.date<=d2)};
    }
    const yr=ymY;
    return {rangeLabel:`${yr} 年`, rangeEntries:(allEntries||entries).filter(e=>e.date>=`${yr}-01-01`&&e.date<=`${yr}-12-31`)};
  },[period,viewMonth,allEntries,entries]);

  const expCatMap = store.categories.expense.reduce((a,c)=>{a[c.id]=c;return a;},{});
  const incCatMap = store.categories.income.reduce((a,c)=>{a[c.id]=c;return a;},{});
  const allCatMap = {...expCatMap,...incCatMap};
  const parentExpCats = store.categories.expense.filter(c=>!c.parentId);
  const parentIncCats = store.categories.income.filter(c=>!c.parentId);

  const expByCat = useMemo(()=>{
    const map={};
    rangeEntries.filter(e=>e.type==="expense").forEach(e=>{
      const cat=expCatMap[e.category]; const topId=cat?.parentId||e.category;
      map[topId]=(map[topId]||0)+eBase(e,rates,base);
    });
    return map;
  },[rangeEntries,rates,base]);

  const incByCat = useMemo(()=>{
    const map={};
    rangeEntries.filter(e=>e.type==="income").forEach(e=>{
      const cat=incCatMap[e.category]; const topId=cat?.parentId||e.category;
      map[topId]=(map[topId]||0)+eBase(e,rates,base);
    });
    return map;
  },[rangeEntries,rates,base]);

  // Previous month spending (for trend %, only shown in month view)
  const prevExpByCat = useMemo(()=>{
    if(period!=="month") return {};
    const [y,m]=viewMonth.split("-").map(Number);
    const pm=m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`;
    const map={};
    (allEntries||[]).filter(e=>e.type==="expense"&&e.date.startsWith(pm)).forEach(e=>{
      const cat=expCatMap[e.category]; const topId=cat?.parentId||e.category;
      map[topId]=(map[topId]||0)+eBase(e,rates,base);
    });
    return map;
  },[period,viewMonth,allEntries,expCatMap,rates,base]);

  const totalExp=Object.values(expByCat).reduce((a,b)=>a+b,0);
  const totalInc=Object.values(incByCat).reduce((a,b)=>a+b,0);
  const netTotal=totalInc-totalExp;

  const pieData=parentExpCats.filter(c=>(expByCat[c.id]||0)>0).map(c=>({id:c.id,value:expByCat[c.id],cat:c})).sort((a,b)=>b.value-a.value);

  const childExpData = useMemo(()=>{
    if(!selectedCatId) return [];
    const childMap={};
    rangeEntries.filter(e=>e.type==="expense").forEach(e=>{
      const cat=expCatMap[e.category];
      if((cat?.parentId||e.category)===selectedCatId){
        const cid=cat?.parentId?e.category:selectedCatId;
        childMap[cid]=(childMap[cid]||0)+eBase(e,rates,base);
      }
    });
    return store.categories.expense
      .filter(c=>c.parentId===selectedCatId&&(childMap[c.id]||0)>0)
      .map(c=>({id:c.id,value:childMap[c.id],cat:c}))
      .sort((a,b)=>b.value-a.value);
  },[selectedCatId,rangeEntries,expCatMap,rates,base,store.categories.expense]);

  const cardEntries = useMemo(()=>{
    if(!selectedCatId) return [];
    return rangeEntries.filter(e=>{
      if(e.type!=="expense") return false;
      const cat=expCatMap[e.category];
      if(selectedChildId) return e.category===selectedChildId;
      return (cat?.parentId||e.category)===selectedCatId;
    }).sort((a,b)=>a.date<b.date?1:-1);
  },[selectedCatId,selectedChildId,rangeEntries,expCatMap]);

  useEffect(()=>{
    if(selectedChildId) setLayer('chartPanel', ()=>setSelectedChildId(null));
    else clearLayer('chartPanel');
    return ()=>clearLayer('chartPanel');
  },[selectedChildId]);

  useEffect(()=>{
    if(selectedCatId) setLayer('chartSub', closeCat);
    else clearLayer('chartSub');
    return ()=>clearLayer('chartSub');
  },[selectedCatId,closeCat]);

  const selectedCat = selectedCatId ? expCatMap[selectedCatId] : null;
  const totalBudget=store.totalBudget||0;
  const budgetRows=period==="month"
    ?parentExpCats.filter(c=>(store.budgets[c.id]||0)>0).map(c=>({id:c.id,limit:store.budgets[c.id],used:expByCat[c.id]||0,cat:c}))
    :[];

  const chartLayout = store.layout?.chart || DEFAULT_LAYOUT.chart;
  const renderChartSection = (id) => {
    if (id==="trend") return period==="month"
      ? <TrendChart key="trend" allEntries={allEntries||[]} base={base} rates={rates} nd={nd}/>
      : null;

    if (id==="donut") return (
      <div key="donut" className="bg-white rounded-2xl shadow-sm p-4">
        {totalExp===0?(
          <div className="py-10 text-center text-gray-400 text-sm">本期暫無支出</div>
        ):(()=>{
          const inSub=!!(selectedCatId&&childExpData.length>0);
          const activeData=dedupeColors(inSub?childExpData:pieData);
          const activeTotal=inSub?childExpData.reduce((s,d)=>s+d.value,0):totalExp;
          const activeSelected=inSub?selectedChildId:selectedCatId;
          const handleSelect=inSub
            ?id=>setSelectedChildId(id===selectedChildId?null:id)
            :id=>{ setSelectedCatId(id===selectedCatId?null:id); setSelectedChildId(null); };
          return (
            <div className="flex flex-col items-center">
              {inSub&&(
                <div className="w-full flex items-center gap-2 mb-3">
                  <button onClick={closeCat}
                    className="text-xs text-gray-400 px-2.5 py-1 bg-gray-100 rounded-lg active:bg-gray-200">← 返回</button>
                  <span className="text-xs font-medium text-gray-600">{allCatMap[selectedCatId]?.icon} {allCatMap[selectedCatId]?.name} 細項</span>
                </div>
              )}
              <LargeDonut data={activeData} total={activeTotal} base={base} onSelect={handleSelect} selectedId={activeSelected} nd={nd}/>
              <div className="w-full mt-4 space-y-2">
                {activeData.map(d=>{
                  const isActive=activeSelected===d.id;
                  return (
                    <button key={d.id} onClick={()=>handleSelect(d.id)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl transition-all ${isActive?"bg-gray-100":""}`}>
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:d.cat.color}}/>
                      <span className="text-sm flex-1 text-left text-gray-700">{d.cat.icon} {d.cat.name}</span>
                      <span className="text-xs text-gray-400 w-8 text-right">{Math.round(d.value/activeTotal*100)}%</span>
                      <span className="text-sm amount-font text-gray-800 w-24 text-right">{fmt(d.value,base,nd)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

    );
    if (id==="breakdown") return (
      <div key="breakdown" className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
        {selectedCatId&&selectedCat ? (
          <>
            <div className="px-4 py-2.5 flex items-center gap-2">
              <button onClick={selectedChildId?()=>setSelectedChildId(null):closeCat} className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded-lg active:bg-gray-200">← 返回</button>
              {selectedChildId ? (
                <>
                  <span className="w-6 h-6 rounded-full grid place-items-center text-sm flex-shrink-0" style={{background:allCatMap[selectedChildId]?.color+"55"}}>{allCatMap[selectedChildId]?.icon}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{selectedCat.name} ›</span>
                  <span className="text-sm font-semibold flex-1 truncate">{allCatMap[selectedChildId]?.name}</span>
                </>
              ) : (
                <>
                  <span className="w-6 h-6 rounded-full grid place-items-center text-sm flex-shrink-0" style={{background:selectedCat.color+"55"}}>{selectedCat.icon}</span>
                  <span className="text-sm font-semibold flex-1">{selectedCat.name}</span>
                </>
              )}
              <span className="text-sm amount-font font-semibold flex-shrink-0" style={{color:"var(--expense)"}}>
                {fmt(cardEntries.reduce((s,e)=>s+eBase(e,rates,base),0),base,nd)}
              </span>
            </div>
            {cardEntries.length===0?(
              <div className="px-4 py-6 text-center text-gray-400 text-sm">本期無此分類支出</div>
            ):(
              <ul>
                {cardEntries.map(e=>{
                  const cat=allCatMap[e.category]||{icon:"❓",name:"未分類",color:"#ddd"};
                  return (
                    <li key={e.id} className="px-4 py-3 flex items-center gap-3 border-t border-gray-50 active:bg-gray-50 cursor-pointer"
                      onClick={()=>onEdit&&onEdit(e)}>
                      <div className="w-9 h-9 rounded-full grid place-items-center text-base flex-shrink-0" style={{background:cat.color+"55"}}>{cat.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{cat.name}{e.memo?` · ${e.memo}`:""}</div>
                        <div className="text-[11px] text-gray-400">{e.date}</div>
                      </div>
                      <div className="text-sm font-semibold amount-font text-[color:var(--expense)] text-right">
                        <div>-{fmt(e.amount,e.currency,nd)}</div>
                        {e.currency!==base&&<div className="text-[11px] font-normal text-gray-400">(-{fmt(eBase(e,rates,base),base,nd)})</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            {totalExp>0&&<>
              <div className="px-4 py-2.5 flex justify-between text-sm font-semibold">
                <span>支出</span><span className="amount-font text-[color:var(--expense)]">{fmt(totalExp,base,nd)}</span>
              </div>
              {parentExpCats.filter(c=>(expByCat[c.id]||0)>0).map(c=>{
                const curr=expByCat[c.id]||0;
                return (
                  <button key={c.id} className="w-full px-4 py-3 flex items-center gap-3 active:bg-gray-50"
                    onClick={()=>setSelectedCatId(c.id)}>
                    <div className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 text-lg" style={{background:c.color+"44"}}>{c.icon}</div>
                    <div className="flex-1 text-left">
                      <div className="text-sm">{c.name}</div>
                      <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                        <div className="h-full rounded-full" style={{width:Math.round(curr/totalExp*100)+"%",background:c.color}}></div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm amount-font text-gray-700">{fmt(curr,base,nd)}</div>
                    </div>
                  </button>
                );
              })}
            </>}
            {totalInc>0&&<>
              <div className="px-4 py-2.5 flex justify-between text-sm font-semibold">
                <span>收入</span><span className="amount-font text-[color:var(--income)]">{fmt(totalInc,base,nd)}</span>
              </div>
              {parentIncCats.filter(c=>(incByCat[c.id]||0)>0).map(c=>(
                <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 text-lg" style={{background:c.color+"44"}}>{c.icon}</div>
                  <div className="flex-1 text-left">
                    <div className="text-sm">{c.name}</div>
                    <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                      <div className="h-full rounded-full" style={{width:Math.round((incByCat[c.id]||0)/totalInc*100)+"%",background:c.color}}></div>
                    </div>
                  </div>
                  <span className="text-sm amount-font text-gray-700">{fmt(incByCat[c.id]||0,base,nd)}</span>
                </div>
              ))}
            </>}
          </>
        )}
      </div>

    );
    if (id==="budget") return period==="month"&&(budgetRows.length>0||totalBudget>0) ? (
      <div key="budget" className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-sm font-semibold mb-3">預算進度</div>
          {totalBudget>0&&(
            <div className="mb-3 pb-3 border-b border-gray-100">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-semibold">📊 總預算</span>
                <span className={`amount-font ${totalExp>totalBudget?"text-[color:var(--expense)] font-semibold":"text-gray-500"}`}>{fmt(totalExp,base,nd)} / {fmt(totalBudget,base,nd)}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{width:Math.min(100,totalBudget>0?totalExp/totalBudget*100:0)+"%",background:totalExp>totalBudget?"var(--expense)":"var(--brand)"}}></div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {budgetRows.map(r=>{
              const pct=Math.min(100,r.limit>0?r.used/r.limit*100:0), over=r.used>r.limit;
              return (
                <div key={r.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{r.cat.icon} {r.cat.name}</span>
                    <span className={`amount-font ${over?"text-[color:var(--expense)] font-semibold":"text-gray-500"}`}>{fmt(r.used,base,nd)} / {fmt(r.limit,base,nd)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width:pct+"%",background:over?"var(--expense)":r.cat.color}}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
    ) : null;
    return null;
  };

  return (
    <React.Fragment>
    <div className="px-3 pt-3 space-y-3 pb-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500 font-medium">{rangeLabel}</div>
        <div className="bg-white rounded-xl shadow-sm p-0.5 flex text-xs">
          {[["week","本週"],["month","本月"],["year","本年"]].map(([k,l])=>(
            <button key={k} onClick={()=>{setPeriod(k);setSelectedCatId(null);}}
              className={`px-3 py-1.5 rounded-lg ${period===k?"text-white font-semibold":"text-gray-500"}`}
              style={{background:period===k?"var(--brand)":"transparent"}}>{l}</button>
          ))}
        </div>
      </div>
      {chartLayout.filter(item=>item.visible).map(item=>renderChartSection(item.id))}
    </div>
    </React.Fragment>
  );
}

const CHART_PALETTE = ["#FFB4A2","#9BD1E5","#B5A6F5","#FCD34D","#86EFAC","#FDBA74","#F87171","#FDA4AF","#7DD3FC","#FBBF24","#A7E0A0","#C9A0DC","#F5A6C9","#8BCEC2","#F29E9E","#CBD5E1","#FF7043","#36B7C6"];
function dedupeColors(data) {
  const seen = new Set();
  let pi = 0;
  return data.map(d => {
    if (!seen.has(d.cat.color)) { seen.add(d.cat.color); return d; }
    let c; do { c = CHART_PALETTE[pi++ % CHART_PALETTE.length]; } while (seen.has(c));
    seen.add(c);
    return { ...d, cat: { ...d.cat, color: c } };
  });
}

function LargeDonut({data, total, base, onSelect, selectedId, nd=false}) {
  const size=200, r=78, strokeW=28, circ=2*Math.PI*r;
  let acc=0;
  const segs=data.map(d=>{
    const frac=d.value/total;
    const rot=(acc/total)*360-90;
    const midAng=((acc+d.value/2)/total*360-90)*Math.PI/180;
    const ringR=r+strokeW/2;
    const lblR=ringR+22;
    acc+=d.value;
    const lx=size/2+lblR*Math.cos(midAng);
    const ly=size/2+lblR*Math.sin(midAng);
    return {d,frac,rot,midAng,
      dash:`${frac*circ} ${circ}`,
      ringX:size/2+ringR*Math.cos(midAng),
      ringY:size/2+ringR*Math.sin(midAng),
      lx, ly,
      anchor:lx<size/2?"end":"start",
    };
  });
  return (
    <div style={{position:"relative",width:size,height:size,overflow:"visible"}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{overflow:"visible"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#F1F1F4" strokeWidth={strokeW}/>
        {segs.map(({d,frac,rot,midAng,dash,ringX,ringY,lx,ly,anchor})=>{
          const isSel=selectedId===d.id;
          return (
            <g key={d.id} style={{cursor:"pointer"}} onClick={()=>onSelect&&onSelect(d.id===selectedId?null:d.id)}>
              <circle cx={size/2} cy={size/2} r={r} fill="none"
                stroke={d.cat.color} strokeWidth={isSel?38:strokeW}
                strokeDasharray={dash} strokeDashoffset="0"
                opacity={selectedId&&!isSel?0.3:1}
                transform={`rotate(${rot} ${size/2} ${size/2})`}
                style={{transition:"all .15s ease"}}/>
              {frac>=0.05&&!selectedId&&(
                <g>
                  <line x1={ringX} y1={ringY} x2={lx} y2={ly} stroke={d.cat.color} strokeWidth="1.5" opacity="0.75"/>
                  <text x={lx+(anchor==="start"?4:-4)} y={ly} textAnchor={anchor} dominantBaseline="middle"
                    fontSize="9.5" fontWeight="600" fill={d.cat.color}>{d.cat.icon} {d.cat.name}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{position:"absolute",top:0,left:0,width:size,height:size,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
        {selectedId?(()=>{
          const sel=data.find(d=>d.id===selectedId);
          return sel?<>
            <div className="text-[10px] text-gray-500 max-w-[80px] text-center truncate">{sel.cat.icon} {sel.cat.name}</div>
            <div className="text-base font-bold amount-font" style={{color:sel.cat.color}}>{fmt(sel.value,base,nd)}</div>
            <div className="text-[10px] text-gray-400">{Math.round(sel.value/total*100)}%</div>
          </>:null;
        })():<>
          <div className="text-xs text-gray-400">支出</div>
          <div className="text-lg font-bold amount-font" style={{color:"var(--expense)"}}>{fmt(total,base,nd)}</div>
        </>}
      </div>
    </div>
  );
}


/* ===================== 設定頁 ===================== */
const LAYOUT_LABELS = {
  home:  {monthly_summary:"本月收支", expense_overview:"支出概況", entry_list:"記帳明細"},
  cal:   {day_entries:"當日明細"},
  chart: {trend:"近6個月趨勢", donut:"圓餅圖", breakdown:"收支分類", budget:"預算進度"},
};
function LayoutSettings({store, setStore}) {
  const [tab, setTab] = useState("home");
  const layout = store.layout;
  const toggleVisible = (t, id) => setStore(s=>({...s, layout:{...s.layout, [t]:s.layout[t].map(item=>item.id===id?{...item,visible:!item.visible}:item)}, _lastModified:new Date().toISOString()}));
  const reorder = (t, from, to) => setStore(s=>{
    const items=[...s.layout[t]]; const [m]=items.splice(from,1); items.splice(to,0,m);
    return {...s, layout:{...s.layout,[t]:items}, _lastModified:new Date().toISOString()};
  });
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-1 flex gap-1">
        {[["home","首頁"],["cal","月曆"],["chart","圖表"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`flex-1 py-1.5 rounded-xl text-sm ${tab===t?"bg-[color:var(--brand-soft)] text-[color:var(--brand)] font-semibold":"bg-gray-100 text-gray-500"}`}>{l}</button>
        ))}
      </div>
      <div className="text-[11px] text-gray-400 px-1">長按 ☰ 拖拉排序；右側開關控制顯示</div>
      <SortableList
        items={layout[tab]}
        itemHeight={56}
        onReorder={(from,to)=>reorder(tab,from,to)}
        renderItem={(item,_i,drag)=>(
          <div className={`bg-white rounded-2xl shadow-sm px-3 py-3 flex items-center gap-3 mb-2 ${drag.isDragging?"ring-2 ring-[color:var(--brand)]":""}`}>
            <div onPointerDown={drag.handlePointerDown} onPointerMove={drag.handlePointerMove} onPointerUp={drag.handlePointerUp}
              className="text-gray-300 text-lg px-1 cursor-grab active:cursor-grabbing select-none flex-shrink-0" style={{touchAction:"none"}}>☰</div>
            <span className="flex-1 text-sm font-medium text-gray-700">{LAYOUT_LABELS[tab][item.id]}</span>
            <button onClick={()=>toggleVisible(tab,item.id)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${item.visible?"bg-[color:var(--brand)]":"bg-gray-200"}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${item.visible?"left-5":"left-0.5"}`}/>
            </button>
          </div>
        )}
      />
    </div>
  );
}

function OtherView({store, setStore}) {
  const [theme, setTheme] = useState(()=>localStorage.getItem("akr-theme")||"system");
  const applyTheme = (t) => {
    const dark = t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme:dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("akr-theme", t);
    setTheme(t);
  };
  const themeOpts = [["light","淺色","☀️"],["dark","深色","🌙"],["system","跟隨系統","⚙️"]];

  const [accent, setAccent] = useState(()=>localStorage.getItem("akr-accent")||"sky");
  const applyAccent = (a) => {
    document.documentElement.classList.toggle("accent-sky", a==="sky");
    localStorage.setItem("akr-accent", a);
    setAccent(a);
  };
  const accentOpts = [["pink","珊瑚粉","#FF6B8A","#FF8FA3"],["sky","天空藍","#0EA5E9","#38BDF8"]];

  const [notifyOn, setNotifyOn] = useState(()=>localStorage.getItem("akr-notify")==="1");
  const toggleNotify = async () => {
    if(!notifyOn) {
      if(!("Notification" in window)){ alert("此瀏覽器不支援通知"); return; }
      const perm = await Notification.requestPermission();
      if(perm!=="granted"){ alert("需要開啟通知權限才能啟用提醒"); return; }
      localStorage.setItem("akr-notify","1"); setNotifyOn(true);
    } else {
      localStorage.setItem("akr-notify","0"); setNotifyOn(false);
    }
  };
  const aboutRows = [
    ["版本","v1.1.260602b",false],
    ["製作者","AKiRa",true],
    ["技術","React · Tailwind · PWA",false],
    ["支援幣種","MOP · HKD · CNY · JPY · TWD",false],
  ];
  const noDecimals = store?.settings?.noDecimals||false;
  const toggleNoDecimals = () => setStore(s=>({...s, settings:{...s.settings, noDecimals:!s.settings?.noDecimals}, _lastModified:new Date().toISOString()}));
  const weekStart = store?.settings?.weekStart||"mon";
  const setWeekStart = v => setStore(s=>({...s, settings:{...s.settings, weekStart:v}, _lastModified:new Date().toISOString()}));

  return (
    <div className="space-y-3">
      {/* 小數點強迫症模式 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-700">整數模式</div>
            <div className="text-xs text-gray-400 mt-0.5">隱藏所有金額小數點 · 記帳時自動截去小數</div>
          </div>
          <button onClick={toggleNoDecimals}
            className={`relative w-11 h-6 rounded-full transition-colors ${noDecimals?"bg-[color:var(--brand)]":"bg-gray-200"}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${noDecimals?"left-5":"left-0.5"}`}/>
          </button>
        </div>
      </div>

      {/* 月曆首天 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-700">月曆首天</div>
            <div className="text-xs text-gray-400 mt-0.5">選擇每週第一天</div>
          </div>
          <div className="flex gap-1">
            {[["mon","星期一"],["sun","星期日"]].map(([v,l])=>(
              <button key={v} onClick={()=>setWeekStart(v)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${weekStart===v?"text-white bg-[color:var(--brand)]":"text-gray-500 bg-gray-100"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 記帳提醒 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-700">記帳提醒</div>
            <div className="text-xs text-gray-400 mt-0.5">超過 1 日無記帳時提醒</div>
          </div>
          <button onClick={toggleNotify}
            className={`relative w-11 h-6 rounded-full transition-colors ${notifyOn?"bg-[color:var(--brand)]":"bg-gray-200"}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${notifyOn?"left-5":"left-0.5"}`}/>
          </button>
        </div>
      </div>

      {/* 主題色 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">主題色</div>
        <div className="flex gap-2">
          {accentOpts.map(([v,l,c1,c2])=>(
            <button key={v} onClick={()=>applyAccent(v)}
              className={`flex-1 flex flex-col items-center gap-2 py-3 rounded-xl text-xs font-medium border-2 transition-all
                ${accent===v?"border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-[color:var(--brand)]":"border-gray-100 text-gray-500"}`}>
              <span className="w-7 h-7 rounded-full block shadow-sm" style={{background:`linear-gradient(135deg,${c2},${c1})`}}/>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 主題 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">深淺設定</div>
        <div className="flex gap-2">
          {themeOpts.map(([v,l,ic])=>(
            <button key={v} onClick={()=>applyTheme(v)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-medium border-2 transition-all
                ${theme===v?"border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-[color:var(--brand)]":"border-gray-100 text-gray-500"}`}>
              <span className="text-lg">{ic}</span>{l}
            </button>
          ))}
        </div>
      </div>

      {/* 關於 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-700">關於這個 App</span>
        </div>
        <div className="flex flex-col items-center pt-6 pb-4 px-6">
          <img src="icon-192.png" alt="AKR記帳本" className="w-16 h-16 rounded-2xl mb-3 shadow-md object-cover"/>
          <div className="text-lg font-bold text-gray-800 mb-1">AKR記帳本</div>
          <div className="text-xs text-gray-400 mb-5">繁中 PWA 記帳應用</div>
          <div className="w-full">
            {aboutRows.map(([l,v,brand],i)=>(
              <div key={l} className={`flex justify-between items-center py-3 ${i<aboutRows.length-1?"border-b border-gray-100":""}`}>
                <span className="text-sm text-gray-500">{l}</span>
                <span className={`text-sm font-semibold ${brand?"":"text-gray-700"}`}
                  style={brand?{color:"var(--brand)"}:{}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="text-center text-[11px] text-gray-300 pb-2">Made with ❤️ by AKiRa</div>
    </div>
  );
}

/* ===================== 趣味玩法 ===================== */
function FunView({store}) {
  return (
    <div className="px-3 pt-3 pb-6 space-y-4">
      <div className="text-xs text-gray-400 px-1 font-medium tracking-wide">✨ 趣味統計玩法</div>
      <ReceiptView store={store}/>
    </div>
  );
}

/* ===================== 收據生成 ===================== */
function ReceiptView({store}) {
  const base = store.settings.baseCurrency;
  const rates = store.settings.rates;
  const nd = store.settings?.noDecimals || false;
  const [month, setMonth] = useState(monthKey(new Date()));
  const [showPicker, setShowPicker] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const data = useMemo(()=>{
    const expCatMap = store.categories.expense.reduce((a,c)=>{a[c.id]=c;return a;},{});
    const exps = store.entries.filter(e=>e.date.startsWith(month)&&e.type==='expense');
    const incs = store.entries.filter(e=>e.date.startsWith(month)&&e.type==='income');
    const pTot={}, cTot={};
    exps.forEach(e=>{
      const cat=expCatMap[e.category]; const pid=cat?.parentId||e.category;
      const amt=eBase(e,rates,base);
      pTot[pid]=(pTot[pid]||0)+amt;
      if(cat?.parentId){ if(!cTot[pid]) cTot[pid]={}; cTot[pid][e.category]=(cTot[pid][e.category]||0)+amt; }
    });
    const cats=store.categories.expense.filter(c=>!c.parentId&&(pTot[c.id]||0)>0)
      .map(c=>({...c,total:pTot[c.id]||0,children:store.categories.expense
        .filter(ch=>ch.parentId===c.id&&(cTot[c.id]?.[ch.id]||0)>0)
        .map(ch=>({...ch,total:cTot[c.id][ch.id]})).sort((a,b)=>b.total-a.total)}))
      .sort((a,b)=>b.total-a.total);
    const totalExp=cats.reduce((s,c)=>s+c.total,0);
    const totalInc=incs.reduce((s,e)=>s+eBase(e,rates,base),0);
    return {cats, totalExp, totalInc, count:exps.length+incs.length};
  },[store.entries,store.categories.expense,month,rates,base]);

  const MSGS=['消費就係生活，記帳係態度！','錢花得值，唔使唔好意思 ♡','今個月都幾勤力，繼續加油！','理財達人就係你！繼續努力！','記好每分錢，生活更有底氣。'];

  const download = () => {
    setDownloading(true);
    const {cats,totalExp,totalInc,count}=data;
    const [y1,y2]=month.split('-');
    const net=totalInc-totalExp;
    const today=new Date().toLocaleDateString('zh-HK');
    const msg=MSGS[new Date().getDate()%MSGS.length];
    const W=480, PAD=32;
    const TOOTH_W=24, TH=16;
    const IS=48;
    const F=(sz,b)=>b?`bold ${sz}px 'Courier New',Courier,monospace`:`${sz}px 'Courier New',Courier,monospace`;
    let h=130;
    cats.forEach(c=>{h+=36+c.children.length*24+20;});
    if(cats.length===0) h+=40;
    h+=totalInc>0?130:80; h+=110+IS+24+TH;
    const draw=(icon)=>{
      const cv=document.createElement('canvas');
      cv.width=W; cv.height=h;
      const ctx=cv.getContext('2d');
      ctx.fillStyle='#e8e4da'; ctx.fillRect(0,0,W,h);
      ctx.beginPath(); ctx.moveTo(0,TH);
      for(let x=0;x<W;x+=TOOTH_W){ctx.lineTo(x+TOOTH_W/2,0);ctx.lineTo(x+TOOTH_W,TH);}
      ctx.lineTo(W,h-TH);
      for(let x=W;x>0;x-=TOOTH_W){ctx.lineTo(x-TOOTH_W/2,h);ctx.lineTo(x-TOOTH_W,h-TH);}
      ctx.closePath();
      ctx.fillStyle='#FFFEF7'; ctx.fill();
      let y=TH+28;
      const T=(s,align,yp,sz,bold,col)=>{
        ctx.font=F(sz,bold); ctx.fillStyle=col||'#1a1a1a'; ctx.textAlign=align;
        ctx.fillText(s,align==='center'?W/2:align==='right'?W-PAD:PAD,yp); ctx.textAlign='left';
      };
      const dsh=(yp,c='#ccc',p=[4,4])=>{ctx.setLineDash(p);ctx.strokeStyle=c;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PAD,yp);ctx.lineTo(W-PAD,yp);ctx.stroke();ctx.setLineDash([]);};
      const sld=(yp,c='#666',lw=1.5)=>{ctx.setLineDash([]);ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(PAD,yp);ctx.lineTo(W-PAD,yp);ctx.stroke();};
      T('* AKR 記帳本 · 收據 *','center',y,17,true); y+=26;
      T('━━━━━━━━━━━━━━━━━━━━━━━━━━━━','center',y,12,false,'#bbb'); y+=22;
      T(`${y1} 年 ${y2} 月份支出明細`,'center',y,15,true); y+=22;
      T(`生成日期: ${today}`,'center',y,11,false,'#888'); y+=22;
      dsh(y,'#bbb',[3,3]); y+=18;
      if(cats.length===0){T('本月無支出記錄','center',y,13,false,'#aaa');y+=36;}
      else cats.forEach(cat=>{
        T(`${cat.icon} ${cat.name}`,'left',y,14,true); T(fmt(cat.total,base,nd),'right',y,14,true,'#c0392b'); y+=30;
        cat.children.forEach(ch=>{T(`  └ ${ch.name}`,'left',y,12,false,'#555');T(fmt(ch.total,base,nd),'right',y,12,false,'#555');y+=22;});
        y+=4; dsh(y,'#ddd'); y+=14;
      });
      sld(y,'#555',2); y+=22;
      T('支出合計','left',y,15,true); T(fmt(totalExp,base,nd),'right',y,15,true,'#c0392b'); y+=30;
      if(totalInc>0){
        T('收入合計','left',y,15,true); T(fmt(totalInc,base,nd),'right',y,15,true,'#27ae60'); y+=30;
        dsh(y,'#999',[2,2]); y+=14;
        T('結　　餘','left',y,16,true); T((net<0?'-':'')+fmt(Math.abs(net),base,nd),'right',y,16,true,net>=0?'#27ae60':'#c0392b'); y+=30;
      }
      sld(y,'#555',2); y+=22;
      T(`共 ${count} 筆記帳`,'center',y,11,false,'#888'); y+=20;
      T(msg,'center',y,11,false,'#888'); y+=20;
      dsh(y,'#ccc',[3,6]); y+=16;
      T(`No.${month.replace('-','')}-${String(count).padStart(4,'0')}`,'center',y,11,false,'#bbb'); y+=16;
      T('─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─','center',y,11,false,'#ddd'); y+=20;
      if(icon){
        const ix=(W-IS)/2, iy=y;
        ctx.save();
        const r=10;
        ctx.beginPath();
        ctx.moveTo(ix+r,iy);ctx.lineTo(ix+IS-r,iy);ctx.quadraticCurveTo(ix+IS,iy,ix+IS,iy+r);
        ctx.lineTo(ix+IS,iy+IS-r);ctx.quadraticCurveTo(ix+IS,iy+IS,ix+IS-r,iy+IS);
        ctx.lineTo(ix+r,iy+IS);ctx.quadraticCurveTo(ix,iy+IS,ix,iy+IS-r);
        ctx.lineTo(ix,iy+r);ctx.quadraticCurveTo(ix,iy,ix+r,iy);
        ctx.closePath();ctx.clip();
        ctx.drawImage(icon,ix,iy,IS,IS);
        ctx.restore();
      }
      cv.toBlob(blob=>{
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download=`AKR收據_${month}.png`; a.click();
        URL.revokeObjectURL(url); setDownloading(false);
      },'image/png');
    };
    const img=new Image(); img.onload=()=>draw(img); img.onerror=()=>draw(null); img.src='./icon-192.png';
  };

  const {cats,totalExp,totalInc,count}=data;
  const [y1,y2]=month.split('-');
  const net=totalInc-totalExp;
  const msgIdx=new Date().getDate()%MSGS.length;
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-xs text-gray-500 mb-2">選擇月份</div>
        <button onClick={()=>setShowPicker(true)}
          className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-700 active:bg-gray-50">
          {y1} 年 {y2} 月 ▾
        </button>
      </div>
      {/* Receipt Preview */}
      <div className="overflow-hidden shadow-md" style={{fontFamily:"'Courier New',Courier,monospace",background:'#e8e4da',borderRadius:'0 0 16px 16px'}}>
        <svg viewBox="0 0 480 16" preserveAspectRatio="none" style={{display:'block',width:'100%',height:16}}>
          <polygon points="0,16 12,0 24,16 36,0 48,16 60,0 72,16 84,0 96,16 108,0 120,16 132,0 144,16 156,0 168,16 180,0 192,16 204,0 216,16 228,0 240,16 252,0 264,16 276,0 288,16 300,0 312,16 324,0 336,16 348,0 360,16 372,0 384,16 396,0 408,16 420,0 432,16 444,0 456,16 468,0 480,16" fill="#FFFEF7"/>
        </svg>
        <div style={{background:'#FFFEF7',color:'#1a1a1a'}}>
          <div className="text-center py-4 px-4 border-b border-dashed border-gray-300">
            <div className="font-bold tracking-wide" style={{fontSize:15}}>* AKR 記帳本 · 收據 *</div>
            <div className="text-gray-400 mt-0.5" style={{fontSize:11}}>━━━━━━━━━━━━━━━━━━━━━━━━━━</div>
            <div className="font-bold mt-1" style={{fontSize:13}}>{y1} 年 {y2} 月份支出明細</div>
            <div className="text-gray-400 mt-0.5" style={{fontSize:11}}>生成日期: {new Date().toLocaleDateString('zh-HK')}</div>
          </div>
          <div className="px-4 py-2" style={{fontSize:13}}>
            {cats.length===0?(
              <div className="text-center text-gray-400 py-3" style={{fontSize:12}}>本月無支出記錄</div>
            ):cats.map(cat=>(
              <div key={cat.id} className="mb-1">
                <div className="flex justify-between items-baseline py-1 font-bold">
                  <span>{cat.icon} {cat.name}</span>
                  <span style={{color:'#c0392b'}}>{fmt(cat.total,base,nd)}</span>
                </div>
                {cat.children.map(ch=>(
                  <div key={ch.id} className="flex justify-between items-baseline py-0.5 pl-3" style={{fontSize:11,color:'#555'}}>
                    <span>└ {ch.name}</span><span>{fmt(ch.total,base,nd)}</span>
                  </div>
                ))}
                <div className="border-b border-dashed border-gray-200 mt-1"/>
              </div>
            ))}
          </div>
          <div className="mx-4 border-t-2 border-gray-500 py-2" style={{fontSize:13}}>
            <div className="flex justify-between font-bold py-0.5">
              <span>支出合計</span><span style={{color:'#c0392b'}}>{fmt(totalExp,base,nd)}</span>
            </div>
            {totalInc>0&&<>
              <div className="flex justify-between font-bold py-0.5">
                <span>收入合計</span><span style={{color:'#27ae60'}}>{fmt(totalInc,base,nd)}</span>
              </div>
              <div className="border-t border-dashed border-gray-300 my-1"/>
              <div className="flex justify-between font-bold py-0.5" style={{fontSize:14}}>
                <span>結　　餘</span>
                <span style={{color:net>=0?'#27ae60':'#c0392b'}}>{net<0?'-':''}{fmt(Math.abs(net),base,nd)}</span>
              </div>
            </>}
          </div>
          <div className="text-center py-3 mx-4 border-t-2 border-gray-500" style={{fontSize:11}}>
            <div className="text-gray-400">共 {count} 筆記帳</div>
            <div className="text-gray-400 mt-0.5">{MSGS[msgIdx]}</div>
            <div className="border-t border-dashed border-gray-200 mt-2 mb-1"/>
            <div className="text-gray-300">No.{month.replace('-','')}-{String(count).padStart(4,'0')}</div>
            <div style={{color:'#e5e7eb'}}>─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─</div>
            <img src="./icon-192.png" alt="" style={{width:40,height:40,borderRadius:8,margin:'8px auto 4px'}}/>
          </div>
        </div>
        <svg viewBox="0 0 480 16" preserveAspectRatio="none" style={{display:'block',width:'100%',height:16}}>
          <polygon points="0,0 480,0 468,16 456,0 444,16 432,0 420,16 408,0 396,16 384,0 372,16 360,0 348,16 336,0 324,16 312,0 300,16 288,0 276,16 264,0 252,16 240,0 228,16 216,0 204,16 192,0 180,16 168,0 156,16 144,0 132,16 120,0 108,16 96,0 84,16 72,0 60,16 48,0 36,16 24,0 12,16" fill="#FFFEF7"/>
        </svg>
      </div>
      <button onClick={download} disabled={downloading}
        className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white shadow-md active:opacity-80 disabled:opacity-50"
        style={{background:'linear-gradient(135deg,var(--brand-from),var(--brand-to))'}}>
        {downloading?'⏳ 生成中…':'📥 下載收據圖片 (.png)'}
      </button>
      {showPicker&&<MonthPicker value={month} onChange={setMonth} onClose={()=>setShowPicker(false)}/>}
    </div>
  );
}

function SettingsView({store, setStore, fbDrive}) {
  const [tab, setTab] = useState(null);
  useEffect(()=>{
    if(tab){ setLayer('settingsTab', ()=>setTab(null)); }
    else { clearLayer('settingsTab'); }
    return ()=>clearLayer('settingsTab');
  },[tab]);
  const menu = [
    {key:"layout",icon:"📐", label:"頁面佈局",   desc:"調整首頁、月曆、圖表的卡片順序及顯示", bg:"#F0F4FF"},
    {key:"cat",   icon:"🏷️", label:"分類管理",   desc:"新增、編輯、排序收支分類",     bg:"#FFF0F3"},
    {key:"budget",icon:"💰", label:"預算設定",   desc:"設定月度總預算及各分類上限",   bg:"#F0FFF4"},
    {key:"data",  icon:"📁", label:"數據與同步", desc:"備份、匯入匯出、雲端同步",     bg:"#EFF6FF"},
    {key:"basic", icon:"💱", label:"幣值設定",   desc:"基準幣值與匯率管理",           bg:"#FFFBEB"},
    {key:"other", icon:"⚙️", label:"其他",       desc:"主題、提醒、關於",             bg:"#F5F3FF"},
  ];
  const chevron = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>;

  if(!tab) return (
    <div className="px-3 pt-3 space-y-2 pb-4">
      {menu.map(({key,icon,label,desc,bg})=>(
        <button key={key} onClick={()=>setTab(key)}
          className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 active:bg-gray-50 text-left">
          <div className="w-11 h-11 rounded-xl grid place-items-center text-xl flex-shrink-0" style={{background:bg}}>{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-700">{label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
          </div>
          <div className="text-gray-300 flex-shrink-0">{chevron}</div>
        </button>
      ))}
    </div>
  );

  const current = menu.find(m=>m.key===tab);
  return (
    <div className="px-3 pt-3">
      <button onClick={()=>setTab(null)}
        className="flex items-center gap-1.5 text-sm mb-3 active:opacity-60"
        style={{color:"var(--brand)"}}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        設定
      </button>
      <div className="tab-slide-right">
        {tab==="layout" && <LayoutSettings store={store} setStore={setStore}/>}
        {tab==="cat"    && <CatSettings store={store} setStore={setStore}/>}
        {tab==="budget" && <BudgetSettings store={store} setStore={setStore}/>}
        {tab==="data"   && <DataSettings store={store} setStore={setStore} fbDrive={fbDrive}/>}
        {tab==="basic"  && <BasicSettings store={store} setStore={setStore}/>}
        {tab==="other"  && <OtherView store={store} setStore={setStore}/>}
      </div>
    </div>
  );
}

function BasicSettings({store, setStore}) {
  const base = store.settings.baseCurrency;
  const rates = store.settings.rates;
  const [fetchingRates, setFetchingRates] = useState(false);
  const [rateMsg, setRateMsg] = useState("");
  const [convBase, setConvBase] = useState(base);
  const [convAmount, setConvAmount] = useState("100");
  useEffect(()=>{ setConvBase(base); }, [base]);

  const getConverted = (code) => {
    const amt = parseFloat(convAmount);
    if(!amt || isNaN(amt) || amt<=0) return "";
    if(code===convBase) return convAmount;
    const inBase = amt * (rates[convBase]||1);
    const result = inBase / (rates[code]||1);
    if(result>=1000) return result.toFixed(0);
    if(result>=10)   return result.toFixed(1);
    if(result>=1)    return result.toFixed(2);
    return result.toFixed(4);
  };

  const setBase = (newBase) => {
    if(newBase === base) return;
    setStore(s => {
      const r = s.settings.rates;
      const factor = r[newBase] || 1; // 1 oldBase = factor newBase (via 1/rate)
      // Convert budgets: oldBase amount → newBase amount = amount / factor
      const newTotalBudget = s.totalBudget > 0 ? Math.round(s.totalBudget / factor * 100) / 100 : 0;
      const newBudgets = {};
      Object.entries(s.budgets || {}).forEach(([k,v]) => {
        newBudgets[k] = Math.round(v / factor * 100) / 100;
      });
      // Recalculate rates relative to new base
      const newRates = {};
      Object.keys(r).forEach(code => {
        if(code === newBase) { newRates[code] = 1; return; }
        // r[code] = oldBase per 1 code; r[newBase] = oldBase per 1 newBase
        // newRate[code] = newBase per 1 code = r[code] / r[newBase]
        newRates[code] = Math.round(r[code] / factor * 10000) / 10000;
      });
      return {
        ...s,
        totalBudget: newTotalBudget,
        budgets: newBudgets,
        settings: { ...s.settings, baseCurrency: newBase, rates: newRates },
        _lastModified: new Date().toISOString(),
      };
    });
  };
  const fetchRates = async () => {
    setFetchingRates(true);
    setRateMsg("");
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
      if (!res.ok) throw new Error("網絡錯誤");
      const data = await res.json();
      if (data.result !== "success") throw new Error("API 錯誤");
      const newRates = {...rates};
      CURRENCIES.forEach(c => {
        if (c.code === base) { newRates[c.code] = 1; return; }
        const r = data.rates[c.code];
        if (r) newRates[c.code] = Math.round((1/r) * 10000) / 10000;
      });
      setStore(s=>({...s, settings:{...s.settings, rates:newRates}, _lastModified:new Date().toISOString()}));
      setRateMsg("✅ 匯率已更新（" + new Date().toLocaleTimeString("zh-HK") + "）");
    } catch(e) {
      setRateMsg("❌ 同步失敗：" + e.message);
    } finally {
      setFetchingRates(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-3">主要幣值</div>
        <div className="grid grid-cols-5 gap-2">
          {CURRENCIES.map(c=>(
            <button key={c.code} onClick={()=>setBase(c.code)}
              className={`py-2 rounded-xl text-xs font-medium ${base===c.code?"text-white":"bg-gray-100 text-gray-600"}`}
              style={{background:base===c.code?"var(--brand)":undefined}}>{c.code}</button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">匯率換算</div>
          <button onClick={fetchRates} disabled={fetchingRates}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium transition-all ${fetchingRates?"bg-gray-100 text-gray-400":"bg-[color:var(--brand-soft)] text-[color:var(--brand)] active:opacity-70"}`}>
            <span className={fetchingRates?"animate-spin":""}>{fetchingRates?"⟳":"🔄"}</span>
            {fetchingRates?"同步中...":"同步最新匯率"}
          </button>
        </div>
        {rateMsg&&<div className="text-xs mb-3 px-1" style={{color:rateMsg.startsWith("✅")?"#2ECC71":"#E74C3C"}}>{rateMsg}</div>}
        <div className="space-y-2">
          {CURRENCIES.map(c=>{
            const isActive = convBase===c.code;
            const displayVal = getConverted(c.code);
            return (
              <div key={c.code} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border-2 transition-all ${isActive?"border-[color:var(--brand)] bg-[color:var(--brand-soft)]":"border-gray-100 bg-gray-50"}`}>
                <span className={`text-sm font-bold w-10 flex-shrink-0 ${c.code===base?"text-[color:var(--brand)]":"text-gray-600"}`}>{c.code}</span>
                <input type="number" inputMode="decimal"
                  value={isActive ? convAmount : displayVal}
                  onChange={e=>{setConvBase(c.code);setConvAmount(e.target.value);}}
                  onFocus={()=>setConvBase(c.code)}
                  className="flex-1 bg-transparent outline-none text-right text-sm font-medium text-gray-800 min-w-0"
                  placeholder="0"/>
                {c.code!==base&&(
                  <span className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap">1 {c.code}={rates[c.code]} {base}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-gray-400 mt-2 px-1">輸入任一幣值即時換算 · 匯率僅可透過同步更新</div>
      </div>
    </div>
  );
}

function CatSettings({store, setStore}) {
  const [type, setType] = useState("expense");
  const cats = store.categories[type];
  const parentCats = cats.filter(c=>!c.parentId);

  const updateCat = (id, field, val) =>
    setStore(s=>({...s, categories:{...s.categories, [type]:s.categories[type].map(c=>c.id===id?{...c,[field]:val}:c)}}));

  const addParent = () => {
    const id = "cat_"+type+"_"+Date.now();
    const color = CSV_CAT_COLORS[parentCats.length % CSV_CAT_COLORS.length];
    const newCat = {id, name:"新分類", icon:"📁", color};
    setStore(s=>({...s, categories:{...s.categories, [type]:[...s.categories[type], newCat]}}));
  };

  const deleteParent = (id) => {
    setStore(s => {
      const newBudgets = {...s.budgets};
      delete newBudgets[id];
      return {...s, categories:{...s.categories, [type]:s.categories[type].filter(c=>c.id!==id&&c.parentId!==id)}, budgets:newBudgets};
    });
  };

  const addChild = (parentId, parentColor) => {
    const id = "cat_"+type+"_c_"+Date.now();
    const newCat = {id, name:"新子分類", icon:"📌", color:parentColor, parentId};
    setStore(s=>({...s, categories:{...s.categories, [type]:[...s.categories[type], newCat]}}));
  };

  const deleteChild = (id) =>
    setStore(s=>({...s, categories:{...s.categories, [type]:s.categories[type].filter(c=>c.id!==id)}}));

  const reorderParents = (from, to) => {
    setStore(s => {
      const all = [...s.categories[type]];
      const parents = all.filter(c=>!c.parentId);
      const children = all.filter(c=>c.parentId);
      const moved = parents.splice(from, 1)[0];
      parents.splice(to, 0, moved);
      const result = [];
      parents.forEach(p => {
        result.push(p);
        children.filter(c=>c.parentId===p.id).forEach(c=>result.push(c));
      });
      return {...s, categories:{...s.categories, [type]:result}};
    });
  };

  const reorderChildren = (parentId, from, to) => {
    setStore(s => {
      const all = [...s.categories[type]];
      const children = all.filter(c=>c.parentId===parentId);
      const moved = children.splice(from, 1)[0];
      children.splice(to, 0, moved);
      const others = all.filter(c=>c.parentId!==parentId);
      const parentIdx = others.findIndex(c=>c.id===parentId);
      const result = [...others.slice(0,parentIdx+1), ...children, ...others.slice(parentIdx+1)];
      return {...s, categories:{...s.categories, [type]:result}};
    });
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-1 flex gap-1">
        {[["expense","支出"],["income","收入"]].map(([t,l])=>(
          <button key={t} onClick={()=>setType(t)}
            className={`flex-1 py-1.5 rounded-xl text-sm ${type===t?"bg-[color:var(--brand-soft)] text-[color:var(--brand)] font-semibold":"bg-gray-100 text-gray-500"}`}>{l}</button>
        ))}
      </div>
      <div className="text-[11px] text-gray-400 px-1">點擊 Icon／名稱可修改；長按 ☰ 拖拉排序；🗑️ 刪除</div>
      <SortableList
        items={parentCats}
        itemHeight={60}
        onReorder={reorderParents}
        renderItem={(parent, pi, drag) => {
          const children=cats.filter(c=>c.parentId===parent.id);
          return (
            <div className={`bg-white rounded-2xl shadow-sm overflow-hidden mb-2 ${drag.isDragging?"ring-2 ring-[color:var(--brand)]":""}`}>
              {/* 第一層分類 */}
              <div className="px-3 py-2.5 flex items-center gap-3 bg-gray-50">
                <div
                  onPointerDown={drag.handlePointerDown}
                  onPointerMove={drag.handlePointerMove}
                  onPointerUp={drag.handlePointerUp}
                  className="text-gray-300 text-lg px-1 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
                  style={{touchAction:"none"}}>☰</div>
                <div className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{background:parent.color+"55"}}>
                  <input type="text" value={parent.icon} onChange={e=>updateCat(parent.id,"icon",e.target.value.trim().slice(0,4))}
                    className="w-7 text-center text-xl bg-transparent border-0 outline-none"/>
                </div>
                <input type="text" value={parent.name} onChange={e=>updateCat(parent.id,"name",e.target.value.slice(0,10))}
                  className="flex-1 font-semibold text-sm bg-transparent border-0 outline-none"/>
                <span className="text-[10px] text-gray-400 flex-shrink-0 mr-1">{children.length>0?`${children.length}項`:""}</span>
                <button onClick={()=>{ if(window.confirm(`確定刪除「${parent.name}」分類？此操作無法還原。`)) deleteParent(parent.id); }}
                  className="text-gray-300 hover:text-red-400 text-base flex-shrink-0 px-1 active:scale-90 transition-transform">🗑️</button>
              </div>
              {/* 第二層分類 */}
              {children.length>0&&(
                <SortableList
                  items={children}
                  itemHeight={52}
                  onReorder={(from,to)=>reorderChildren(parent.id,from,to)}
                  renderItem={(c, ci, cdrag) => (
                    <div className={`px-3 py-2 flex items-center gap-3 border-t border-gray-50 ${cdrag.isDragging?"bg-gray-50":""}`}>
                      <div
                        onPointerDown={cdrag.handlePointerDown}
                        onPointerMove={cdrag.handlePointerMove}
                        onPointerUp={cdrag.handlePointerUp}
                        className="text-gray-300 text-base ml-2 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
                        style={{touchAction:"none"}}>☰</div>
                      <div className="w-8 h-8 rounded-full grid place-items-center flex-shrink-0" style={{background:c.color+"55"}}>
                        <input type="text" value={c.icon} onChange={e=>updateCat(c.id,"icon",e.target.value.trim().slice(0,4))}
                          className="w-6 text-center text-base bg-transparent border-0 outline-none"/>
                      </div>
                      <input type="text" value={c.name} onChange={e=>updateCat(c.id,"name",e.target.value.slice(0,10))}
                        className="flex-1 text-sm bg-gray-50 rounded-lg px-2.5 py-1.5"/>
                      <button onClick={()=>{ if(window.confirm(`確定刪除「${c.name}」子分類？`)) deleteChild(c.id); }}
                        className="text-gray-300 hover:text-red-400 text-sm flex-shrink-0 px-1 active:scale-90 transition-transform">🗑️</button>
                    </div>
                  )}
                />
              )}
              {/* 新增子分類按鈕 */}
              <button onClick={()=>addChild(parent.id, parent.color)}
                className="w-full py-2 text-xs text-gray-400 hover:text-[color:var(--brand)] border-t border-gray-50 flex items-center justify-center gap-1 active:bg-gray-50">
                <span className="text-base leading-none">＋</span> 新增子分類
              </button>
            </div>
          );
        }}
      />
      {/* 新增第一層分類按鈕 */}
      <button onClick={addParent}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-200 text-sm text-gray-400 hover:border-[color:var(--brand)] hover:text-[color:var(--brand)] flex items-center justify-center gap-2 active:bg-gray-50">
        <span className="text-lg leading-none">＋</span> 新增分類
      </button>
    </div>
  );
}

function BudgetSettings({store, setStore}) {
  const base = store.settings.baseCurrency;
  const parentExpCats = store.categories.expense.filter(c=>!c.parentId);
  const budgets = store.budgets || {};
  const totalBudget = store.totalBudget || 0;

  const budgetInBalance = store.budgetInBalance || false;
  const useMonthlyBudget = store.useMonthlyBudget || false;
  const monthlyBudgets = store.monthlyBudgets || {};
  const setBudget = (id, val) => setStore(s=>({...s, budgets:{...s.budgets, [id]:parseFloat(val)||0}, _lastModified: new Date().toISOString()}));
  const setTotalBudget = (val) => setStore(s=>({...s, totalBudget:parseFloat(val)||0, _lastModified: new Date().toISOString()}));
  const setMonthlyBudget = (m, val) => setStore(s=>({...s, monthlyBudgets:{...s.monthlyBudgets, [m]:parseFloat(val)||0}, _lastModified: new Date().toISOString()}));
  const toggleBudgetInBalance = () => setStore(s=>({...s, budgetInBalance:!s.budgetInBalance, _lastModified: new Date().toISOString()}));
  const toggleMonthlyBudget = () => setStore(s=>({...s, useMonthlyBudget:!s.useMonthlyBudget, _lastModified: new Date().toISOString()}));

  const catBudgetSum = parentExpCats.reduce((sum,c)=>(budgets[c.id]||0)>0?sum+(budgets[c.id]||0):sum,0);
  const overAlloc = totalBudget>0 && catBudgetSum>totalBudget;

  const MONTH_NAMES = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  return (
    <div className="space-y-3">
      {/* 每月個別預算 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">📅 每月個別預算</div>
          <button onClick={toggleMonthlyBudget}
            className={`relative w-11 h-6 rounded-full transition-colors ${useMonthlyBudget?"bg-[color:var(--brand)]":"bg-gray-200"}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${useMonthlyBudget?"left-5":"left-0.5"}`}/>
          </button>
        </div>
        {useMonthlyBudget && (
          <div className="grid grid-cols-2 gap-2">
            {MONTH_NAMES.map((name,i)=>(
              <div key={i+1} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8 flex-shrink-0">{name}</span>
                <input type="number" value={monthlyBudgets[i+1]||""} placeholder="0"
                  onChange={e=>setMonthlyBudget(i+1, e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-right min-w-0"/>
              </div>
            ))}
          </div>
        )}
        {!useMonthlyBudget && <div className="text-xs text-gray-400">開啟後可為 1–12 月各自設定預算，啟用時下方總預算設定將停用</div>}
      </div>

      {/* 總預算 */}
      <div className={`bg-white rounded-2xl shadow-sm p-4 ${useMonthlyBudget?"opacity-40 pointer-events-none":""}`}>
        <div className="text-sm font-semibold mb-3">📊 每月總預算 ({base})</div>
        <div className="flex items-center gap-3">
          <input type="number" value={totalBudget||""} placeholder="0 = 不設定"
            onChange={e=>setTotalBudget(e.target.value)}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right"/>
          <span className="text-sm text-gray-400">{base}</span>
        </div>
        {overAlloc&&(
          <div className="mt-2 text-xs text-[color:var(--expense)] font-medium">
            ⚠️ 分類預算合計 {fmt(catBudgetSum,base)} 已超過總預算 {fmt(totalBudget,base)}
          </div>
        )}
        {totalBudget>0&&<div className="mt-2 text-xs text-gray-400">分類預算啟用後，合計不能超過總預算</div>}
      </div>

      {/* 將預算納入結餘 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-700">將預算納入結餘計算</div>
            <div className="text-xs text-gray-400 mt-0.5">{budgetInBalance ? "結餘 = 預算 + 收入 − 支出" : "結餘 = 收入 − 支出"}</div>
          </div>
          <button onClick={toggleBudgetInBalance} disabled={!totalBudget&&!useMonthlyBudget}
            className={`relative w-11 h-6 rounded-full transition-colors ${budgetInBalance&&(totalBudget||useMonthlyBudget)?"bg-[color:var(--brand)]":"bg-gray-200"} ${!totalBudget&&!useMonthlyBudget?"opacity-40 cursor-not-allowed":""}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${budgetInBalance&&(totalBudget||useMonthlyBudget)?"left-5":"left-0.5"}`}/>
          </button>
        </div>
      </div>

      {/* 分類預算 */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-3">分類預算 ({base})</div>
        <div className="space-y-3">
          {parentExpCats.map(c=>(
            <div key={c.id} className="flex items-center gap-3">
              <span className="text-xl w-8 flex-shrink-0">{c.icon}</span>
              <span className="text-sm flex-1 truncate">{c.name}</span>
              <input type="number" value={budgets[c.id]||""} placeholder="0"
                onChange={e=>setBudget(c.id,e.target.value)}
                className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm text-right"/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({open, title, message, onConfirm, onCancel, confirmLabel="確認", danger=false}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40"/>
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 fade-in" onClick={e=>e.stopPropagation()}>
        <div className="text-base font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-500 mb-5 leading-relaxed">{message}</div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600">取消</button>
          <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl text-sm font-medium text-white ${danger?"bg-red-500":"bg-[color:var(--brand)]"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function FirebaseSyncPanel({ fbDrive, dataModified }) {
  const connected = !!fbDrive.fbUser;
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold">☁️ 雲端同步（Google 帳號）</div>
      {connected ? (
        <>
          <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 px-3 py-2.5 rounded-xl">
            {fbDrive.fbUser.photoURL && <img src={fbDrive.fbUser.photoURL} className="w-5 h-5 rounded-full flex-shrink-0" alt=""/>}
            <span>✅ 已連接</span>
            <span className="text-green-500 font-medium truncate">{fbDrive.fbUser.email}</span>
          </div>
          {fbDrive.syncError && (
            <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">⚠️ {fbDrive.syncError}</div>
          )}
          {fbDrive.lastUpload && (
            <div className="text-xs text-gray-400">最後上傳：{new Date(fbDrive.lastUpload).toLocaleString("zh-HK",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:true})}</div>
          )}
          {dataModified && (
            <div className="text-xs text-gray-400">資料更新至：{new Date(dataModified).toLocaleString("zh-HK",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:true})}</div>
          )}
          <button onClick={fbDrive.syncNow} disabled={fbDrive.syncing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 active:opacity-80"
            style={{color:"var(--brand)", background:"var(--brand-soft)"}}>
            {fbDrive.syncing ? "同步中…" : "🔄 立即同步"}
          </button>
          <button onClick={fbDrive.disconnect}
            className="w-full py-2 rounded-xl text-xs text-gray-400 bg-gray-50 active:opacity-80">
            斷開連接
          </button>
        </>
      ) : (
        <>
          <div className="text-xs text-gray-400 leading-relaxed">
            以 Google 帳號登入同步資料，換機時以同一帳號登入即可一鍵恢復所有資料。
          </div>
          <button onClick={fbDrive.connect} disabled={fbDrive.syncing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 active:opacity-80 flex items-center justify-center gap-2"
            style={{background:"#4285F4"}}>
            {fbDrive.syncing ? "⏳ 登入中…" : <><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFF" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg>以 Google 帳號登入</>}
          </button>
        </>
      )}
    </div>
  );
}

function DataSettings({store, setStore, fbDrive}) {
  const [msg, setMsg] = useState("");
  const [dialog, setDialog] = useState(null); // {title, message, onConfirm, danger}
  const flash = (m, isErr=false) => { setMsg({text:m, err:isErr}); setTimeout(()=>setMsg(null),3000); };
  const showConfirm = (cfg) => setDialog(cfg);
  const closeDialog = () => setDialog(null);

  const doExportCSV = () => {
    const count = store.entries.length;
    const csv = exportCSV(store);
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv);
    a.download = `akr_backup_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    flash("✅ 已匯出 " + count + " 筆資料");
  };

  const doImportCSV = (e) => {
    const file = e.target.files[0]; if(!file) return;
    e.target.value="";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importOurCSV(ev.target.result, store);
      if(!result){ flash("❌ CSV 格式無法識別", true); return; }
      showConfirm({
        title:"確認匯入 CSV",
        message:`包含 ${result.imported} 筆記帳資料，將新增至現有 ${store.entries.length} 筆中。`,
        confirmLabel:`匯入 ${result.imported} 筆`,
        danger:false,
        onConfirm:()=>{ closeDialog(); setStore(s=>({...s,entries:result.entries,_lastModified:new Date().toISOString()})); flash("✅ 成功匯入 "+result.imported+" 筆"); }
      });
    };
    reader.readAsText(file,"UTF-8");
  };

  const importCSV = (e) => {
    const file = e.target.files[0]; if(!file) return;
    e.target.value="";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importZaimCSV(ev.target.result, store);
      if (!result) { flash("❌ CSV 格式無法識別", true); return; }
      const count = result.imported;
      showConfirm({
        title: "確認匯入 Zaim CSV",
        message: `解析到 ${count} 筆記帳資料。
將新增至現有 ${store.entries.length} 筆記錄中（不覆蓋）。`,
        confirmLabel: `匯入 ${count} 筆`,
        danger: false,
        onConfirm: () => {
          closeDialog();
          setStore(s=>({...s, entries:result.entries, categories:result.categories, _lastModified: new Date().toISOString()}));
          flash("✅ 成功匯入 " + count + " 筆");
        }
      });
    };
    reader.readAsText(file, "UTF-8");
  };

  const clearAll = () => {
    showConfirm({
      title: "⚠️ 清除全部資料",
      message: `即將永久刪除全部 ${store.entries.length} 筆記帳資料及所有設定，此操作不可還原。`,
      confirmLabel: "確認清除",
      danger: true,
      onConfirm: () => {
        closeDialog();
        setStore({...defaultStore(), _lastModified: new Date().toISOString()});
        flash("🗑️ 已清除全部資料");
      }
    });
  };

  return (
    <>
    <ConfirmDialog
      open={!!dialog}
      title={dialog?.title}
      message={dialog?.message}
      confirmLabel={dialog?.confirmLabel}
      danger={dialog?.danger}
      onConfirm={dialog?.onConfirm}
      onCancel={closeDialog}
    />
    <div className="space-y-3">
      {msg&&<div className={`text-sm px-4 py-3 rounded-2xl text-center font-medium ${msg.err?"bg-red-50 text-red-600":"bg-green-50 text-green-700"}`}>{msg.text}</div>}
      <FirebaseSyncPanel fbDrive={fbDrive} dataModified={store._lastModified} />

      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <div className="text-sm font-semibold">資料備份</div>
        <button onClick={doExportCSV} className="w-full py-3 rounded-xl text-sm font-medium text-white" style={{background:"var(--brand)"}}>📤 匯出 CSV 備份</button>
        <label className="block w-full py-3 rounded-xl text-sm font-medium text-center border-2 border-dashed border-gray-200 text-gray-500 cursor-pointer hover:border-[color:var(--brand)]">
          📥 匯入 CSV 備份
          <input type="file" accept=".csv,.txt" className="hidden" onChange={doImportCSV}/>
        </label>
        <label className="block w-full py-3 rounded-xl text-sm font-medium text-center border-2 border-dashed border-gray-200 text-gray-500 cursor-pointer hover:border-[color:var(--brand)]">
          📊 匯入 Zaim CSV
          <input type="file" accept=".csv,.txt" className="hidden" onChange={importCSV}/>
        </label>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-3">統計</div>
        <div className="text-sm text-gray-500">總記帳筆數：<span className="font-semibold text-gray-800">{store.entries.length}</span></div>
      </div>
      <button onClick={clearAll} className="w-full py-3 rounded-xl text-sm font-medium text-red-500 bg-red-50">🗑️ 清除全部資料</button>
    </div>
    </>
  );
}

/* ===================== 計算盤 ===================== */
function CalcPad({expr, onKey}) {
  const rows = [
    ["7","8","9","÷"],
    ["4","5","6","×"],
    ["1","2","3","−"],
    ["AC","0",".","＋"],
  ];
  const btnBase = "flex items-center justify-center rounded-2xl text-xl font-semibold active:scale-90 transition-transform duration-75 select-none";
  return (
    <div className="flex-shrink-0 bg-white border-t border-gray-100 pad-enter">
      <div className="grid grid-cols-4 gap-2 p-3 pb-1.5">
        {rows.map((row,ri)=>row.map(k=>(
          <button key={ri+k} onPointerDown={e=>{e.preventDefault();onKey(k);}}
            className={`${btnBase} h-14 ${k==="AC"?"bg-red-50 text-red-400":["÷","×","−","＋"].includes(k)?"text-[color:var(--brand)]":"bg-gray-100 text-gray-700"}`}
            style={["÷","×","−","＋"].includes(k)?{background:"var(--brand-soft)"}:{}}>
            {k}
          </button>
        )))}
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-3">
        <button onPointerDown={e=>{e.preventDefault();onKey("⌫");}}
          className={`${btnBase} h-14 bg-gray-100 text-gray-700`}>⌫</button>
        <button onPointerDown={e=>{e.preventDefault();onKey("=");}}
          className={`${btnBase} h-14 bg-gray-200 text-gray-700`}>=</button>
        <button onPointerDown={e=>{e.preventDefault();onKey("✓");}}
          className={`${btnBase} h-14 text-white`} style={{background:"linear-gradient(135deg,var(--brand-from),var(--brand-to))"}}>完成</button>
      </div>
    </div>
  );
}

/* ===================== 記帳 Modal ===================== */
function EntryModal({entry, store, base, rates, onSave, onDelete, onClose, closeSignal}) {
  const [exiting, setExiting] = React.useState(false);
  const [delConfirm, setDelConfirm] = React.useState(false);
  const handleClose = React.useCallback(()=>{ setExiting(true); setTimeout(onClose,230); },[onClose]);
  useEffect(()=>{ if(closeSignal>0) handleClose(); },[closeSignal]);
  const isEdit = !!entry;
  const today = toISO(new Date());
  const [type, setType] = useState(entry?.type || "expense");
  const [category, setCategory] = useState(entry?.category || "");
  const [amount, setAmount] = useState(entry?.amount ? String(entry.amount) : "");
  const [currency, setCurrency] = useState(entry?.currency || base);
  const [date, setDate] = useState(entry?.date || today);
  const [memo, setMemo] = useState(entry?.memo || "");
  const [calcOpen, setCalcOpen] = useState(!entry); // auto-open for new entries
  const [calcExpr, setCalcExpr] = useState(entry?.amount ? String(entry.amount) : "");
  // 初始展開：新增時預設第一個主分類；編輯時還原子分類所屬的父分類
  const [catTab, setCatTab] = useState(()=>{
    if (!entry?.category) {
      const fp = store.categories.expense.find(c=>!c.parentId);
      return fp?.id || null;
    }
    const allCats=[...(store.categories.expense||[]),...(store.categories.income||[])];
    const ec=allCats.find(c=>c.id===entry.category);
    return ec?.parentId||null;
  });

  useEffect(()=>{
    if(calcOpen) setLayer('calcPad', ()=>setCalcOpen(false));
    else clearLayer('calcPad');
  },[calcOpen]);
  const memoRef = useRef(null);
  const scrollRef = useRef(null);

  const handleCalcKey = (key) => {
    if(key==="AC"){ setCalcExpr(""); setAmount(""); return; }
    if(key==="⌫"){
      setCalcExpr(e=>{
        const ne=e.slice(0,-1);
        const v=parseFloat(ne); if(/^\d*\.?\d*$/.test(ne)&&!isNaN(v)) setAmount(ne);
        return ne;
      });
      return;
    }
    if(key==="✓"){
      const r=evalExpr(calcExpr);
      if(r!==null){ setAmount(String(r)); setCalcExpr(String(r)); }
      setCalcOpen(false); return;
    }
    if(key==="="){
      const r=evalExpr(calcExpr);
      if(r!==null){ setAmount(String(r)); setCalcExpr(String(r)); }
      return;
    }
    setCalcExpr(e=>{
      const ne=e+key;
      if(/^\d*\.?\d*$/.test(ne)){ const v=parseFloat(ne); if(!isNaN(v)) setAmount(ne); }
      return ne;
    });
  };

  const cats = store.categories[type];
  const parentCats = cats.filter(c=>!c.parentId);
  const selectedCat = cats.find(c=>c.id===category);
  const parentOfSelected = selectedCat?.parentId ? cats.find(c=>c.id===selectedCat.parentId) : null;

  const convertedBase = amount ? toBase(parseFloat(amount)||0, currency, rates, base) : 0;

  const save = () => {
    let v = parseFloat(amount);
    if (!v || v<=0 || !category) return;
    if (store.settings?.noDecimals) v = Math.trunc(v);
    const entryData = { id: entry?.id || Date.now()+"_"+Math.random().toString(36).slice(2), type, category, amount:v, currency, date, memo };
    if (currency !== base) entryData.baseAmount = Math.round(toBase(v, currency, rates, base) * 10000) / 10000;
    else delete entryData.baseAmount;
    onSave(entryData);
  };

  return (
    <>
    <ConfirmDialog open={delConfirm} title="刪除記錄" message="確定刪除此筆記帳？此操作無法還原。"
      confirmLabel="刪除" danger={true}
      onConfirm={()=>{ setDelConfirm(false); onDelete(entry.id); }}
      onCancel={()=>setDelConfirm(false)}/>
    <div className={`fixed inset-0 z-40 bg-white flex flex-col sheet ${exiting?"sheet-exit":""}`}
      onClick={()=>setCalcOpen(false)}>
      {/* Header */}
      <div className="px-4 py-4 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
        <button onClick={handleClose} className="text-sm text-gray-400">取消</button>
        <div className="text-base font-semibold">{isEdit?"編輯記帳":"新增記帳"}</div>
        <button onClick={save} className="text-sm font-semibold" style={{color:"var(--brand)"}}>確定</button>
      </div>

      <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 no-scrollbar px-4 py-3 space-y-4">
        {/* 收支切換 */}
        <div className="flex gap-2">
          {[["expense","支出","var(--expense)"],["income","收入","var(--income)"]].map(([t,l,c])=>(
            <button key={t} onClick={()=>{ setType(t); setCategory(""); const fp=store.categories[t].find(x=>!x.parentId); setCatTab(fp?.id||null); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${type===t?"text-white shadow-md":"bg-gray-100 text-gray-500"}`}
              style={{background:type===t?c:undefined}}>{l}</button>
          ))}
        </div>

        {/* 金額 */}
        <div className={`bg-gray-50 rounded-2xl p-4 overflow-hidden cursor-pointer ${calcOpen?"ring-2 ring-[color:var(--brand)]":""}`}
          onClick={e=>{ e.stopPropagation(); setCalcExpr(amount||""); setCalcOpen(true); }}>
          <div className="flex items-center gap-3 min-w-0">
            <select value={currency} onChange={e=>{e.stopPropagation();setCurrency(e.target.value);}}
              onClick={e=>e.stopPropagation()}
              className="flex-shrink-0 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium">
              {CURRENCIES.map(c=><option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
            <div className="min-w-0 flex-1 text-right font-bold text-gray-800 select-none"
              style={{fontSize: (calcOpen?calcExpr:amount).length > 10 ? "1.5rem" : (calcOpen?calcExpr:amount).length > 7 ? "2rem" : "1.875rem"}}>
              {calcOpen ? (calcExpr||<span className="text-gray-300">0</span>) : (amount||<span className="text-gray-300">0.0</span>)}
            </div>
          </div>
          {currency!==base&&amount&&(
            <div className="text-xs text-gray-400 text-right mt-1">≈ {fmt(convertedBase,base,store.settings?.noDecimals)}</div>
          )}
        </div>

        {/* 日期 */}
        <div>
          <div className="text-sm text-gray-500 mb-2">日期</div>
          <div className="flex gap-2 mb-2">
            {[["今天",0],["昨天",1],["前天",2]].map(([l,d])=>{
              const t=new Date(); t.setDate(t.getDate()-d); const v=toISO(t);
              return <button key={l} onClick={()=>setDate(v)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${date===v?"border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-[color:var(--brand)]":"border-gray-200 text-gray-500"}`}>{l}</button>;
            })}
          </div>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            className="w-full min-w-0 max-w-full border border-gray-200 rounded-xl px-4 py-3 text-sm"
            style={{boxSizing:"border-box"}}/>
        </div>

        {/* 備注 */}
        <div>
          <div className="text-sm text-gray-500 mb-2">備注</div>
          <input ref={memoRef} type="text" value={memo} onChange={e=>setMemo(e.target.value)} placeholder="選填"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm"/>
        </div>

        {/* 分類選擇 */}
        <div>
          <div className="text-sm text-gray-500 mb-2">分類</div>
          <div className="flex rounded-2xl border border-gray-200 overflow-hidden" style={{minHeight:180}}>
            {/* 左：主分類清單 */}
            <div className="w-2/5 border-r border-gray-100 bg-gray-50 overflow-y-auto no-scrollbar">
              {parentCats.map(parent=>{
                const children=cats.filter(c=>c.parentId===parent.id);
                const highlight=catTab===parent.id;
                return (
                  <button key={parent.id} onClick={e=>{
                    e.stopPropagation();
                    setCatTab(parent.id);
                    if(children.length===0) setCategory(parent.id);
                  }}
                    className={`w-full flex flex-col items-center gap-1 py-3 px-1 text-center transition-colors relative ${highlight?"bg-white":"bg-transparent"}`}>
                    {highlight && <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r" style={{background:parent.color}}/>}
                    <div className="w-9 h-9 rounded-xl grid place-items-center text-xl" style={{background:parent.color+"33"}}>{parent.icon}</div>
                    <span className="text-[10px] leading-tight text-gray-600 font-medium w-full truncate px-1" style={{fontWeight:highlight?700:400}}>{parent.name}</span>
                  </button>
                );
              })}
            </div>
            {/* 右：次分類 2列 grid */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-2">
              {!catTab && (
                <div className="flex items-center justify-center h-full text-xs text-gray-300">選擇左側分類</div>
              )}
              {catTab&&(()=>{
                const children=cats.filter(c=>c.parentId===catTab);
                const parentCat=cats.find(c=>c.id===catTab);
                if(!children.length) return (
                  <div className="flex items-center justify-center h-full text-xs text-gray-300">無子分類</div>
                );
                return (
                  <div className="grid grid-cols-2 gap-1.5">
                    {children.map(c=>{
                      const isSel=category===c.id;
                      return (
                        <button key={c.id} onClick={e=>{ e.stopPropagation(); setCategory(c.id); }}
                          className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all text-center ${isSel?"":"bg-gray-50"}`}
                          style={isSel?{background:c.color+"33",outline:`2px solid ${c.color}`}:{outline:"none"}}>
                          <span className="text-xl">{c.icon}</span>
                          <span className="text-[10px] leading-tight text-gray-600 font-medium truncate w-full px-1" style={{fontWeight:isSel?700:400}}>{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 刪除 */}
        {isEdit&&(
          <button onClick={()=>setDelConfirm(true)} className="w-full py-3 rounded-xl text-sm font-medium text-red-500 bg-red-50">
            刪除此記錄
          </button>
        )}
        <div className="h-4"/>
      </div>
      {calcOpen && <div onClick={e=>e.stopPropagation()}><CalcPad expr={calcExpr} onKey={handleCalcKey}/></div>}
    </div>
    </>
  );
}

/* ===================== 啟動 ===================== */
createRoot(document.getElementById("root")).render(<App/>);

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("sw.js").then(reg => {
    const notifyUpdate = worker => {
      window.dispatchEvent(new CustomEvent("akr-sw-update", {
        detail: {
          reload: () => worker.postMessage({ type: "SKIP_WAITING" }),
        },
      }));
    };
    if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) notifyUpdate(worker);
      });
    });
  }).catch(e => reportError("Service Worker 註冊失敗", e));
}

