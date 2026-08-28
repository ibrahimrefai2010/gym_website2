(function apiModule() {
  let accessToken = null;
  let currentUserValue = null;

  function token() {
    return accessToken;
  }

  function refreshToken() {
    return null;
  }

  function setSession(data) {
    accessToken = data.accessToken || data.token || null;
    currentUserValue = data.user || null;
  }

  function clearSession() {
    accessToken = null;
    currentUserValue = null;
  }

  function currentUser() {
    return currentUserValue;
  }

  async function refreshSession() {
    const data = await rawRequest("/api/v1/auth/refresh", {
      method: "POST"
    });
    setSession(data);
    return data;
  }

  async function ensureSession() {
    if (accessToken) {
      return currentUserValue;
    }
    const data = await refreshSession();
    return data.user;
  }

  async function rawRequest(path, options) {
    const headers = {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(path, {
      credentials: "include",
      ...options,
      headers
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || "Request failed.");
    }

    return payload.data;
  }

  async function request(path, options, retried) {
    try {
      return await rawRequest(path, options);
    } catch (error) {
      if (!retried && accessToken && /auth|session|token|unauthorized|required/i.test(error.message)) {
        await refreshSession();
        return request(path, options, true);
      }
      throw error;
    }
  }

  async function download(path, filename) {
    const send = () =>
      fetch(path, {
        credentials: "include",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      });

    let response = await send();
    if (response.status === 401 && accessToken) {
      await refreshSession();
      response = await send();
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || "Download failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function bootstrap() {
    try {
      return await request("/api/v1/public/bootstrap");
    } catch (_error) {
      return window.GYM_DEFAULT_DATA;
    }
  }

  async function publicSettings() {
    return request("/api/v1/settings/public");
  }

  async function login(identifier, password, admin) {
    const data = await request(admin ? "/api/v1/admin/auth/login" : "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });
    setSession(data);
    return data;
  }

  async function register(payload) {
    const data = await request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setSession(data);
    return data;
  }

  async function forgotPassword(identifier) {
    return request("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ identifier })
    });
  }

  async function logout(admin) {
    try {
      await request(admin ? "/api/v1/admin/auth/logout" : "/api/v1/auth/logout", {
        method: "POST"
      });
    } finally {
      clearSession();
    }
  }

  window.GymApi = {
    bootstrap,
    clearSession,
    currentUser,
    download,
    ensureSession,
    forgotPassword,
    login,
    logout,
    publicSettings,
    refreshSession,
    refreshToken,
    register,
    request,
    token
  };
})();
