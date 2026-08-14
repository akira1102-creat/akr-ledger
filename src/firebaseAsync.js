export const waitForInitialAuthState = auth => new Promise((resolve, reject) => {
  let settled = false;
  let unsubscribe = () => {};

  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    Promise.resolve().then(() => unsubscribe());
    callback(value);
  };

  try {
    unsubscribe = auth.onAuthStateChanged(
      user => finish(resolve, user),
      error => finish(reject, error),
    );
  } catch (error) {
    finish(reject, error);
  }
});

export const withTimeout = (operation, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  Promise.resolve(operation).then(
    value => {
      clearTimeout(timer);
      resolve(value);
    },
    error => {
      clearTimeout(timer);
      reject(error);
    },
  );
});

export const getFirebaseErrorMessage = (error, fallback = "操作失敗。") => {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  if (
    code === "permission-denied"
    || code.endsWith("/permission-denied")
    || /missing or insufficient permissions/i.test(message)
  ) {
    return "雲端同步權限不足，請稍後再試。";
  }
  return message || fallback;
};
