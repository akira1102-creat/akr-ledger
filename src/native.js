import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";

const REMINDER_ID = 1102;

export const isNative = () => Capacitor.isNativePlatform();

export async function prepareNativeShell() {
  if (!isNative()) return;
  const platform = Capacitor.getPlatform();
  document.documentElement.classList.add("native-app", `native-${platform}`);
  await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  if (platform === "android") {
    await StatusBar.setBackgroundColor({ color: "#F8F9FA" }).catch(() => {});
  }
}

export async function lightHaptic() {
  if (!isNative()) return;
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export async function setDailyReminder(enabled) {
  if (!isNative()) return false;

  if (!enabled) {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    return true;
  }

  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== "granted") return false;

  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
  await LocalNotifications.schedule({
    notifications: [{
      id: REMINDER_ID,
      title: "今日記帳未？",
      body: "用一分鐘記低今日收支，月底會更容易睇清消費習慣。",
      schedule: {
        on: { hour: 20, minute: 30 },
        repeats: true,
        allowWhileIdle: true,
      },
      smallIcon: "ic_stat_qys_ledger",
    }],
  });
  return true;
}
