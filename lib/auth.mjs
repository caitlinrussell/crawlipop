import { createHash, randomBytes } from "node:crypto";

import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const SESSION_COOKIE_NAME = "crawlipop_session";
const GOOGLE_STATE_COOKIE_NAME = "crawlipop_google_state";
const GOOGLE_NONCE_COOKIE_NAME = "crawlipop_google_nonce";
const GOOGLE_CODE_VERIFIER_COOKIE_NAME = "crawlipop_google_code_verifier";
const GOOGLE_RETURN_TO_COOKIE_NAME = "crawlipop_google_return_to";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 10;
const DEFAULT_NON_PROD_SESSION_SECRET = "ppk";

function getSecureCookieSetting() {
  return process.env.NODE_ENV === "production";
}

function getBaseCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: getSecureCookieSetting()
  };
}

function getAuthorizedEmailSet() {
  return new Set(
    (process.env.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getSessionSecret() {
  const configuredSecret = process.env.AUTH_SESSION_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return DEFAULT_NON_PROD_SESSION_SECRET;
}

function getAuthConfig() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const sessionSecret = getSessionSecret();
  const allowedEmails = getAuthorizedEmailSet();

  if (!googleClientId || !googleClientSecret || !sessionSecret || allowedEmails.size === 0) {
    throw new Error(
      "Google auth is not fully configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and AUTH_ALLOWED_EMAILS. AUTH_SESSION_SECRET defaults to 'ppk' outside production."
    );
  }

  return {
    allowedEmails,
    googleClientId,
    googleClientSecret,
    sessionSecret
  };
}

function getSessionSecretKey() {
  const sessionSecret = getSessionSecret();
  return sessionSecret ? new TextEncoder().encode(sessionSecret) : null;
}

function createRandomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

function createCodeChallenge(codeVerifier) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

async function getGoogleDiscoveryDocument() {
  const response = await fetch(GOOGLE_DISCOVERY_URL, {
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error("Could not load the Google OpenID configuration.");
  }

  return response.json();
}

async function getGoogleJwks() {
  const discovery = await getGoogleDiscoveryDocument();
  return createRemoteJWKSet(new URL(discovery.jwks_uri));
}

async function signSessionToken(session) {
  const secret = getSessionSecretKey();

  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET is required in production before signing a session.");
  }

  return new SignJWT({
    email: session.email,
    name: session.name,
    picture: session.picture
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

async function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  const secret = getSessionSecretKey();
  if (!secret) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"]
    });

    const email = typeof payload.email === "string" ? payload.email : null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;

    if (!email || !sub) {
      return null;
    }

    return {
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      sub
    };
  } catch {
    return null;
  }
}

async function verifyGoogleIdToken(idToken, nonce) {
  const { allowedEmails, googleClientId } = getAuthConfig();
  const jwks = await getGoogleJwks();
  const { payload } = await jwtVerify(idToken, jwks, {
    audience: googleClientId
  });

  if (!GOOGLE_ISSUERS.has(String(payload.iss ?? ""))) {
    throw new Error("Google returned an ID token with an unexpected issuer.");
  }

  if (payload.nonce !== nonce) {
    throw new Error("Google returned an ID token with an invalid nonce.");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const emailVerified = payload.email_verified === true;
  const sub = typeof payload.sub === "string" ? payload.sub : null;

  if (!email || !sub || !emailVerified) {
    throw new Error("Google did not return a verified email address.");
  }

  if (!allowedEmails.has(email)) {
    throw new Error("That Google account is not on the Crawlipop allowlist.");
  }

  return {
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    sub
  };
}

function parseCookieHeader(value) {
  return Object.fromEntries(
    value
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        const key = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
        const rawValue = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);
        return [key, decodeURIComponent(rawValue)];
      })
  );
}

function readCookie(request, cookieName) {
  return parseCookieHeader(request.headers.cookie ?? "")[cookieName];
}

function getRequestOrigin(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  const forwardedProto = request.headers["x-forwarded-proto"];

  if (forwardedHost && forwardedProto) {
    return `${String(forwardedProto).split(",")[0]}://${String(forwardedHost).split(",")[0]}`;
  }

  if (request.headers.host) {
    return `${request.protocol}://${request.headers.host}`;
  }

  return request.protocol ? `${request.protocol}://localhost` : "http://localhost";
}

function getCallbackUrl(request) {
  return new URL("/api/auth/google/callback", getRequestOrigin(request)).toString();
}

export function sanitizeReturnTo(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export function getAuthConfigurationErrors() {
  const errors = [];

  if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
    errors.push("Missing GOOGLE_CLIENT_ID.");
  }

  if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    errors.push("Missing GOOGLE_CLIENT_SECRET.");
  }

  if (!getSessionSecret()) {
    errors.push("Missing AUTH_SESSION_SECRET.");
  }

  if (getAuthorizedEmailSet().size === 0) {
    errors.push("Missing AUTH_ALLOWED_EMAILS.");
  }

  return errors;
}

export function isGoogleAuthConfigured() {
  return getAuthConfigurationErrors().length === 0;
}

export async function getSessionFromRequest(request) {
  return verifySessionToken(readCookie(request, SESSION_COOKIE_NAME));
}

export async function createGoogleAuthorizationRequest(request, returnToInput) {
  const { allowedEmails, googleClientId } = getAuthConfig();
  const discovery = await getGoogleDiscoveryDocument();
  const state = createRandomToken(24);
  const nonce = createRandomToken(24);
  const codeVerifier = createRandomToken(48);
  const codeChallenge = createCodeChallenge(codeVerifier);
  const returnTo = sanitizeReturnTo(Array.isArray(returnToInput) ? returnToInput[0] : returnToInput);
  const authorizationUrl = new URL(discovery.authorization_endpoint);

  authorizationUrl.searchParams.set("client_id", googleClientId);
  authorizationUrl.searchParams.set("redirect_uri", getCallbackUrl(request));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  if (allowedEmails.size === 1) {
    authorizationUrl.searchParams.set("login_hint", Array.from(allowedEmails)[0]);
  }

  return {
    authorizationUrl,
    codeVerifier,
    nonce,
    returnTo,
    state
  };
}

export async function exchangeGoogleCallbackCode(request, code, codeVerifier, nonce) {
  const { googleClientId, googleClientSecret } = getAuthConfig();
  const discovery = await getGoogleDiscoveryDocument();
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: getCallbackUrl(request)
    })
  });

  if (!response.ok) {
    throw new Error("Google token exchange failed.");
  }

  const tokens = await response.json();
  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token.");
  }

  return verifyGoogleIdToken(tokens.id_token, nonce);
}

export function setGoogleAuthFlowCookies(response, authorizationRequest) {
  const cookieOptions = {
    ...getBaseCookieOptions(),
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS * 1000
  };

  response.cookie(GOOGLE_STATE_COOKIE_NAME, authorizationRequest.state, cookieOptions);
  response.cookie(GOOGLE_NONCE_COOKIE_NAME, authorizationRequest.nonce, cookieOptions);
  response.cookie(GOOGLE_CODE_VERIFIER_COOKIE_NAME, authorizationRequest.codeVerifier, cookieOptions);
  response.cookie(GOOGLE_RETURN_TO_COOKIE_NAME, authorizationRequest.returnTo, cookieOptions);
}

export function clearGoogleAuthFlowCookies(response) {
  const cookieOptions = {
    ...getBaseCookieOptions(),
    maxAge: 0
  };

  response.cookie(GOOGLE_STATE_COOKIE_NAME, "", cookieOptions);
  response.cookie(GOOGLE_NONCE_COOKIE_NAME, "", cookieOptions);
  response.cookie(GOOGLE_CODE_VERIFIER_COOKIE_NAME, "", cookieOptions);
  response.cookie(GOOGLE_RETURN_TO_COOKIE_NAME, "", cookieOptions);
}

export function readGoogleAuthFlowCookies(request) {
  return {
    codeVerifier: readCookie(request, GOOGLE_CODE_VERIFIER_COOKIE_NAME),
    nonce: readCookie(request, GOOGLE_NONCE_COOKIE_NAME),
    returnTo: sanitizeReturnTo(readCookie(request, GOOGLE_RETURN_TO_COOKIE_NAME)),
    state: readCookie(request, GOOGLE_STATE_COOKIE_NAME)
  };
}

export async function setSessionCookie(response, session) {
  const token = await signSessionToken(session);

  response.cookie(SESSION_COOKIE_NAME, token, {
    ...getBaseCookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS * 1000
  });
}

export function clearSessionCookie(response) {
  response.cookie(SESSION_COOKIE_NAME, "", {
    ...getBaseCookieOptions(),
    maxAge: 0
  });
}
