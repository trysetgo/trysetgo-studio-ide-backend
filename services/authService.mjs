import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

export class AuthService {
  async loginWithPassword({ email, password }) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return createLocalSession(email);
    }

    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      }
    );

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    return response.json();
  }

  async sendMagicLink({ email, redirectTo }) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return { ok: true };
    }

    const response = await fetch(`${config.supabaseUrl}/auth/v1/magiclink`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        options: redirectTo ? { email_redirect_to: redirectTo } : undefined
      })
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    return { ok: true };
  }
}

function createLocalSession(email) {
  return {
    access_token: "local-dev-token",
    refresh_token: "local-dev-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "00000000-0000-4000-8000-000000000002",
      email
    }
  };
}

export const authService = new AuthService();
