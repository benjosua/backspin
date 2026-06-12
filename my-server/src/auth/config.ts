import { auth, JWT } from "@colyseus/auth";
import { rankedStore } from "../ranked/store.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const publicUser = (user: any): AuthUser => ({ id: user.id, email: user.email, name: user.name });

export function configureAuth() {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "production") process.env.JWT_SECRET = "dev-ranked-secret";
  if (!process.env.AUTH_SALT && process.env.NODE_ENV !== "production") process.env.AUTH_SALT = "dev-ranked-salt";
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== "production") process.env.SESSION_SECRET = "dev-ranked-session";
  JWT.settings.secret = process.env.JWT_SECRET;

  auth.settings.onFindUserByEmail = async (email) => rankedStore.findUserByEmail(email);
  auth.settings.onRegisterWithEmailAndPassword = async (email, password, options: any = {}) => {
    return rankedStore.createUser(email, password, options.name);
  };
  auth.settings.onParseToken = async (token: any) => {
    if (!token?.id) throw new Error("invalid_token");
    const user = await rankedStore.findUserById(token.id);
    if (!user) throw new Error("user_not_found");
    return publicUser(user);
  };
  auth.settings.onGenerateToken = async (userdata: any) => JWT.sign(publicUser(userdata), { expiresIn: "30d" });
}

export async function authUserFromToken(token?: string): Promise<AuthUser | null> {
  if (!token) return null;
  const decoded = await JWT.verify<any>(token);
  const user = await auth.settings.onParseToken(decoded) as AuthUser;
  return user;
}
