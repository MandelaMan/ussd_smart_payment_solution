/**
 * Barrel for auth — prefer importing AuthProvider / useAuth from their
 * dedicated modules so Vite Fast Refresh does not invalidate the whole tree.
 */
export { AuthProvider } from "./AuthProvider";
export { useAuth, AuthContext, type AuthContextValue } from "./authContext";
