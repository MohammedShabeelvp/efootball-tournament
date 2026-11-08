import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getAuth, setAuth } from "./api.js";

// user = { token, username, role }  (role is "admin" or "organizer"); null for visitors
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getAuth());

  // api.js fires this when the server rejects an old token
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await api.login(username, password);
    setAuth(result);
    setUser(result);
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* token may already be invalid */
    }
    setAuth(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}